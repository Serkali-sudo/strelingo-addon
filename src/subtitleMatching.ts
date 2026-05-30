export interface SubtitleCue {
    id: string;
    startTime: string;
    endTime: string;
    text: string;
}

export interface SubtitleCandidate {
    id: string | number;
    url: string;
    lang: string;
    format: string;
    langName: string;
    releaseName: string;
    rating: number;
    g: number;
}

interface TimedCue<T extends SubtitleCue> {
    cue: T;
    startMs: number;
    endMs: number;
    midMs: number;
    durationMs: number;
    text: string;
}

interface MatchCandidate<T extends SubtitleCue> {
    cue: TimedCue<T>;
    overlapMs: number;
    midpointGapMs: number;
    startGapMs: number;
}

export interface RankedSubtitleCandidate<T extends SubtitleCandidate> {
    sub: T;
    score: number;
    filename: string | null;
    filenameScore: number;
    weakVariantPenalty: number;
    providerScore: number;
    originalIndex: number;
}

interface RankSubtitleOptions {
    videoFilename?: string;
    fetchSubtitleFilename?: (url: string) => Promise<string | null>;
}

const WEAK_VARIANT_TOKENS = new Set([
    'forced',
    'sdh',
    'commentary',
    'commentaries',
    'commentator',
    'director',
    'directors',
    'lyrics',
    'lyric',
    'sign',
    'signs',
    'song',
    'songs'
]);

const LOW_VALUE_TOKENS = new Set([
    'the',
    'and',
    'for',
    'with',
    'from',
    'movie',
    'film',
    'proper',
    'repack',
    'internal',
    'complete'
]);

const RELEASE_TOKENS = new Set([
    'bluray',
    'blu',
    'ray',
    'brrip',
    'bdrip',
    'bdremux',
    'remux',
    'web',
    'dl',
    'webdl',
    'webrip',
    'hdtv',
    'hdrip',
    'dvdrip',
    'x264',
    'x265',
    'h264',
    'h265',
    'hevc',
    'hdr',
    'dv',
    'dolby',
    'vision',
    'aac',
    'dts'
]);

const MAX_OFFSET_SAMPLE_SIZE = 160;
const MAX_AUTO_OFFSET_MS = 15000;
const OFFSET_CONFIDENCE_WINDOW_MS = 750;
const MIN_OFFSET_CONFIDENCE = 0.6;
const STANDALONE_SDH_LINE_PATTERN = /^\s*(?:-\s*)?[\[(][^\])]+[\])]\s*$/;
const ANNOTATION_PATTERN = /[\[(][^\])]*[\])]/g;
const SPEAKER_LABEL_PATTERN = /^\s*(?:-\s*)?(?:[A-Z][A-Z0-9'._-]*)(?:\s+[A-Z][A-Z0-9'._-]*){0,4}\s*:\s*/;

export function sanitizeSubtitleText(text: string): string {
    if (!text) return '';
    return text
        .replace(/<[^>]+>/g, '')
        .replace(/\{[^}]*\}/g, '')
        .replace(/&nbsp;/gi, ' ')
        .replace(/&quot;/gi, '"')
        .replace(/&#39;/gi, "'")
        .replace(/&lt;/gi, '<')
        .replace(/&gt;/gi, '>')
        .replace(/&amp;/gi, '&')
        .split(/\r?\n|\r/g)
        .map(line => line.replace(SPEAKER_LABEL_PATTERN, '').replace(ANNOTATION_PATTERN, ' ').trim())
        .filter(line => line && !STANDALONE_SDH_LINE_PATTERN.test(line))
        .join(' ')
        .replace(/\s+/g, ' ')
        .replace(/\s+([.,!?;:])/g, '$1')
        .trim();
}

export function parseSrtTimeToMs(timeString: string): number | null {
    const match = /^(\d{2}):(\d{2}):(\d{2})[,.](\d{3})$/.exec(timeString || '');
    if (!match) return null;

    const hours = Number(match[1]);
    const minutes = Number(match[2]);
    const seconds = Number(match[3]);
    const milliseconds = Number(match[4]);

    return (hours * 3600 + minutes * 60 + seconds) * 1000 + milliseconds;
}

export function mergeSubtitlesByTime<T extends SubtitleCue>(
    mainSubs: T[],
    transSubs: T[],
    mergeThresholdMs = 500
): T[] {
    const mainTimed = buildTimedCues(mainSubs);
    const rawTransTimed = buildTimedCues(transSubs);
    const estimatedOffsetMs = estimateSubtitleOffsetMs(mainTimed, rawTransTimed);
    const transTimed = estimatedOffsetMs === 0
        ? rawTransTimed
        : shiftTimedCues(rawTransTimed, -estimatedOffsetMs);
    const mergedSubs: T[] = [];
    let transCursor = 0;

    for (const mainCue of mainTimed) {
        while (
            transCursor < transTimed.length &&
            transTimed[transCursor].endMs < mainCue.startMs - mergeThresholdMs
        ) {
            transCursor++;
        }

        const materialMatches: TimedCue<T>[] = [];
        let bestMatch: MatchCandidate<T> | null = null;

        for (let i = transCursor; i < transTimed.length; i++) {
            const transCue = transTimed[i];
            if (transCue.startMs > mainCue.endMs + mergeThresholdMs) break;

            const match = scoreTimeMatch(mainCue, transCue);
            const gapMs = match.overlapMs > 0
                ? 0
                : Math.min(
                    Math.abs(transCue.startMs - mainCue.endMs),
                    Math.abs(mainCue.startMs - transCue.endMs),
                    Math.abs(transCue.startMs - mainCue.startMs)
                );

            if (match.overlapMs <= 0 && gapMs > mergeThresholdMs) continue;

            if (isMaterialOverlap(mainCue, transCue, match.overlapMs)) {
                materialMatches.push(transCue);
            }

            if (!bestMatch || isBetterTimeMatch(match, bestMatch)) {
                bestMatch = match;
            }
        }

        const chosenTranslations = materialMatches.length > 0
            ? materialMatches
            : bestMatch
                ? [bestMatch.cue]
                : [];

        let mergedText = mainCue.text;
        if (chosenTranslations.length > 0) {
            const translationText = chosenTranslations
                .map(cue => cue.text)
                .filter(Boolean)
                .join(' ');

            if (translationText) {
                mergedText = (`<b>${mainCue.text}</b>\n<i>> ${translationText}</i>`).trim();
            }
        }

        if (!mergedText) continue;
        mergedSubs.push({
            ...mainCue.cue,
            text: mergedText
        });
    }

    return mergedSubs;
}

function estimateSubtitleOffsetMs<T extends SubtitleCue>(
    mainTimed: Array<TimedCue<T>>,
    transTimed: Array<TimedCue<T>>
): number {
    if (mainTimed.length < 3 || transTimed.length < 3) return 0;

    const sampleCount = Math.min(MAX_OFFSET_SAMPLE_SIZE, mainTimed.length, transTimed.length);
    const deltas: number[] = [];

    for (let i = 0; i < sampleCount; i++) {
        const mainIndex = sampleIndex(i, sampleCount, mainTimed.length);
        const transIndex = sampleIndex(i, sampleCount, transTimed.length);
        const mainCue = mainTimed[mainIndex];
        const transCue = transTimed[transIndex];

        const durationRatio = Math.min(mainCue.durationMs, transCue.durationMs) / Math.max(mainCue.durationMs, transCue.durationMs);
        if (durationRatio < 0.25) continue;

        const delta = transCue.startMs - mainCue.startMs;
        if (Math.abs(delta) <= MAX_AUTO_OFFSET_MS) {
            deltas.push(delta);
        }
    }

    if (deltas.length < 3) return 0;

    deltas.sort((a, b) => a - b);
    const median = deltas[Math.floor(deltas.length / 2)];
    const confidentSamples = deltas.filter(delta => Math.abs(delta - median) <= OFFSET_CONFIDENCE_WINDOW_MS).length;
    const confidence = confidentSamples / deltas.length;

    if (confidence < MIN_OFFSET_CONFIDENCE) return 0;

    return Math.abs(median) > OFFSET_CONFIDENCE_WINDOW_MS
        ? Math.round(median)
        : 0;
}

export async function rankSubtitleCandidates<T extends SubtitleCandidate>(
    subList: T[],
    options: RankSubtitleOptions = {}
): Promise<Array<RankedSubtitleCandidate<T>>> {
    const uniqueSubs = dedupeByUrl(subList);
    const videoTokens = options.videoFilename ? tokenizeFilename(options.videoFilename) : [];
    const shouldFetchFilenames = videoTokens.length > 0 && Boolean(options.fetchSubtitleFilename);

    const ranked = await Promise.all(uniqueSubs.map(async ({ sub, originalIndex }) => {
        const filename = shouldFetchFilenames && options.fetchSubtitleFilename
            ? await options.fetchSubtitleFilename(sub.url)
            : null;
        const candidateText = filename || sub.url || '';
        const candidateTokens = tokenizeFilename(candidateText);
        const filenameScore = videoTokens.length > 0
            ? scoreFilenameMatch(candidateTokens, videoTokens)
            : 0;
        const weakVariantPenalty = scoreWeakVariant(candidateTokens);
        const providerScore = Math.max(0, Math.min(Number(sub.g) || 0, 100000));
        const score = filenameScore * 10000 - weakVariantPenalty * 1000 + providerScore;

        return {
            sub,
            score,
            filename,
            filenameScore,
            weakVariantPenalty,
            providerScore,
            originalIndex
        };
    }));

    if (videoTokens.length === 0) {
        const normal: Array<RankedSubtitleCandidate<T>> = [];
        const weak: Array<RankedSubtitleCandidate<T>> = [];
        for (const candidate of ranked) {
            if (candidate.weakVariantPenalty > 0) {
                weak.push(candidate);
            } else {
                normal.push(candidate);
            }
        }
        return normal.concat(weak);
    }

    ranked.sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score;
        return a.originalIndex - b.originalIndex;
    });

    return ranked;
}

export function tokenizeFilename(filename: string): string[] {
    return filename
        .replace(/\.[^.]+$/, '')
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .filter(token => token.length > 1);
}

export function scoreFilenameMatch(candidateTokens: string[], videoTokens: string[]): number {
    if (candidateTokens.length === 0 || videoTokens.length === 0) return 0;

    const videoSet = new Set(videoTokens);
    let score = 0;
    for (const token of candidateTokens) {
        if (!videoSet.has(token)) continue;
        score += filenameTokenWeight(token);
    }
    return score;
}

function buildTimedCues<T extends SubtitleCue>(subs: T[]): Array<TimedCue<T>> {
    const timed: Array<TimedCue<T>> = [];

    for (const cue of subs) {
        if (!cue || !cue.startTime || !cue.endTime) continue;

        const startMs = parseSrtTimeToMs(cue.startTime);
        const endMs = parseSrtTimeToMs(cue.endTime);
        if (startMs === null || endMs === null || endMs <= startMs) continue;

        const text = sanitizeSubtitleText(cue.text);
        if (!text) continue;

        const durationMs = endMs - startMs;
        timed.push({
            cue,
            startMs,
            endMs,
            midMs: startMs + durationMs / 2,
            durationMs,
            text
        });
    }

    return timed;
}

function shiftTimedCues<T extends SubtitleCue>(timedCues: Array<TimedCue<T>>, offsetMs: number): Array<TimedCue<T>> {
    return timedCues.map(cue => ({
        ...cue,
        startMs: cue.startMs + offsetMs,
        endMs: cue.endMs + offsetMs,
        midMs: cue.midMs + offsetMs
    }));
}

function sampleIndex(sampleNumber: number, sampleCount: number, itemCount: number): number {
    if (sampleCount <= 1 || itemCount <= 1) return 0;
    return Math.round(sampleNumber * (itemCount - 1) / (sampleCount - 1));
}

function scoreTimeMatch<T extends SubtitleCue>(mainCue: TimedCue<T>, transCue: TimedCue<T>): MatchCandidate<T> {
    const overlapMs = Math.max(0, Math.min(mainCue.endMs, transCue.endMs) - Math.max(mainCue.startMs, transCue.startMs));
    return {
        cue: transCue,
        overlapMs,
        midpointGapMs: Math.abs(mainCue.midMs - transCue.midMs),
        startGapMs: Math.abs(mainCue.startMs - transCue.startMs)
    };
}

function isBetterTimeMatch<T extends SubtitleCue>(candidate: MatchCandidate<T>, current: MatchCandidate<T>): boolean {
    if (candidate.overlapMs !== current.overlapMs) return candidate.overlapMs > current.overlapMs;
    if (candidate.midpointGapMs !== current.midpointGapMs) return candidate.midpointGapMs < current.midpointGapMs;
    return candidate.startGapMs < current.startGapMs;
}

function isMaterialOverlap<T extends SubtitleCue>(
    mainCue: TimedCue<T>,
    transCue: TimedCue<T>,
    overlapMs: number
): boolean {
    if (overlapMs <= 0) return false;
    const shortestDuration = Math.max(1, Math.min(mainCue.durationMs, transCue.durationMs));
    return overlapMs >= 250 || overlapMs / shortestDuration >= 0.35;
}

function dedupeByUrl<T extends SubtitleCandidate>(subList: T[]): Array<{ sub: T; originalIndex: number }> {
    const seenUrls = new Set<string>();
    const uniqueSubs: Array<{ sub: T; originalIndex: number }> = [];

    for (let i = 0; i < subList.length; i++) {
        const sub = subList[i];
        const key = (sub.url || '').trim();
        if (!key || seenUrls.has(key)) continue;
        seenUrls.add(key);
        uniqueSubs.push({ sub, originalIndex: i });
    }

    return uniqueSubs;
}

function filenameTokenWeight(token: string): number {
    if (RELEASE_TOKENS.has(token)) return 40;
    if (/^s\d{1,2}e\d{1,2}$/.test(token)) return 24;
    if (/^(480|576|720|1080|1440|2160)p$/.test(token)) return 16;
    if (/^\d{4}$/.test(token)) return 6;
    if (/^\d+$/.test(token)) return 4;
    if (LOW_VALUE_TOKENS.has(token)) return 1;
    return token.length >= 5 ? 3 : 2;
}

function scoreWeakVariant(tokens: string[]): number {
    const tokenSet = new Set(tokens);
    let penalty = 0;

    for (const token of tokenSet) {
        if (WEAK_VARIANT_TOKENS.has(token)) penalty += 2;
    }

    if (tokenSet.has('hearing') || tokenSet.has('impaired')) penalty += 4;
    if (tokenSet.has('hearing') && tokenSet.has('impaired')) penalty += 3;
    if (tokenSet.has('closed') && (tokenSet.has('caption') || tokenSet.has('captions') || tokenSet.has('cc'))) penalty += 4;
    if (tokenSet.has('full') || tokenSet.has('normal')) penalty -= 1;

    return Math.max(0, penalty);
}
