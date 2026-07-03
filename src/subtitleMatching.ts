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

// One estimated sync point: at main time `mainMs` the translation runs
// `offsetMs` late (transMs = mainMs + offsetMs).
interface AlignmentAnchor {
    mainMs: number;
    transMs: number;
    offsetMs: number;
    pairCount: number;
    pairRatio: number;
    segmentIndex: number;
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

// --- Time-alignment tuning ---
// Cues per tracking segment; the alignment is estimated per segment so it can
// follow fps drift and step offsets instead of assuming one global shift.
const SEGMENT_TARGET_CUES = 16;
const MAX_ALIGNMENT_SEGMENTS = 64;
const MAX_SEGMENT_SAMPLES = 24;
// Delta search window around the previous segment's offset. The wide retry
// covers larger jumps (badly synced releases, removed ad breaks).
const BASE_SEARCH_WINDOW_MS = 15000;
const WIDE_SEARCH_WINDOW_MS = 60000;
// Until the tracker has locked onto the true offset once, it scans this much
// wider window (PAL-shifted releases can start half a minute or more off) and
// demands stronger cluster evidence before trusting an initial lock.
const INITIAL_SEARCH_WINDOW_MS = 120000;
const MIN_INITIAL_LOCK_PAIRS = 4;
const MIN_INITIAL_LOCK_RATIO = 0.8;
// Reconciling the forward and backward tracking passes: anchors within this
// are the same estimate; on a dispute, the stronger cluster wins only if it
// clearly dominates, otherwise the segment is dropped.
const ANCHOR_AGREEMENT_MS = 2000;
const ANCHOR_DISPUTE_DOMINANCE = 1.25;
// Width of the densest start-delta cluster taken as a segment's true offset.
const CLUSTER_WINDOW_MS = 1500;
const MIN_SEGMENT_PAIRS = 3;
const MIN_SEGMENT_PAIR_RATIO = 0.3;
// Offsets below this are already absorbed by the merge threshold.
const MIN_APPLY_OFFSET_MS = 350;
// If every segment offset agrees within this, a single constant shift is used.
const CONSTANT_OFFSET_TOLERANCE_MS = 400;
// A segment offset this far from two agreeing neighbours is discarded as noise.
const ANCHOR_SPIKE_MS = 4000;
const ANCHOR_NEIGHBOR_AGREEMENT_MS = 1500;
// Offset changes between adjacent anchors up to this are treated as gradual
// drift and interpolated; larger jumps are step changes (edited-out breaks)
// and switch at the midpoint instead of smearing across the whole span.
const DRIFT_RAMP_MAX_MS = 5000;
// An estimated alignment is only applied when it beats the raw timeline:
// strictly more matched main cues, or the same count with more total overlap.
const ALIGNMENT_OVERLAP_IMPROVEMENT = 1.01;
// Match quality is also compared block by block: an alignment that wrecks one
// region of the file to help another (a wrong local anchor) is rejected.
const ALIGNMENT_BLOCK_CUES = 32;
const MAX_BLOCK_LOSS_RATIO = 0.25;
const MIN_BLOCK_LOSS_ALLOWANCE = 2;
// A translation cue owned by a neighbouring main cue is repeated here only
// when it also covers at least this fraction of this main cue.
const SPANNING_COVERAGE_RATIO = 0.5;
// Consecutive main cues that share the same single translation cue are
// combined into one entry (instead of repeating the translation), as long as
// the joined main text stays short and the cues are adjacent on screen.
const MERGED_MAIN_MAX_CHARS = 90;
const MERGED_MAIN_MAX_GAP_MS = 1500;
const MERGED_MAIN_MAX_DURATION_MS = 8000;

const STANDALONE_SDH_LINE_PATTERN = /^\s*(?:-\s*)?[\[(][^\])]+[\])]\s*$/;
const ANNOTATION_PATTERN = /[\[(][^\])]*[\])]/g;
const SPEAKER_LABEL_PATTERN = /^\s*(?:-\s*)?(?:[A-Z][A-Z0-9'._-]*)(?:\s+[A-Z][A-Z0-9'._-]*){0,4}\s*:\s*/;
const MUSIC_NOTE_LINE_PATTERN = /^\s*(?:-\s*)?[♪♫♬]/;
const HASH_MUSIC_LINE_PATTERN = /^\s*(?:-\s*)?#.*#\s*$/;
const MUSIC_NOTE_CHARS_PATTERN = /[♪♫♬]/g;
const PUNCTUATION_ONLY_LINE_PATTERN = /^[\s\-–—.,;:!?'"“”‘’#~*]*$/;

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
        .map(line => {
            if (STANDALONE_SDH_LINE_PATTERN.test(line)) return '';
            if (MUSIC_NOTE_LINE_PATTERN.test(line) || HASH_MUSIC_LINE_PATTERN.test(line)) return '';
            return line
                .replace(SPEAKER_LABEL_PATTERN, '')
                .replace(ANNOTATION_PATTERN, ' ')
                .replace(MUSIC_NOTE_CHARS_PATTERN, ' ')
                .trim();
        })
        .filter(line => line && !PUNCTUATION_ONLY_LINE_PATTERN.test(line))
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

    // Estimate the trans->main time alignment, but only use it when it
    // demonstrably matches more cues than the untouched timeline — a wrong
    // estimate must never make an already-synced pair worse.
    let transTimed = rawTransTimed;
    const anchors = estimateAlignmentAnchors(mainTimed, rawTransTimed);
    if (anchors.length > 0) {
        const aligned = alignTransCues(rawTransTimed, anchors);
        if (aligned !== rawTransTimed && isBetterAlignment(
            scoreAlignment(mainTimed, aligned, mergeThresholdMs),
            scoreAlignment(mainTimed, rawTransTimed, mergeThresholdMs)
        )) {
            transTimed = aligned;
        }
    }

    const mergedSubs: T[] = [];
    if (mainTimed.length === 0) return mergedSubs;

    // Pass 1: give each translation cue a single owner — the main cue it
    // overlaps most. This prevents a cue that merely brushes a neighbouring
    // main cue (boundary jitter) from being duplicated onto it.
    const bestMainForTrans = new Int32Array(transTimed.length).fill(-1);
    const bestOverlapForTrans = new Float64Array(transTimed.length);
    const windowStart = new Int32Array(mainTimed.length);
    const windowEnd = new Int32Array(mainTimed.length);
    let transCursor = 0;

    for (let mi = 0; mi < mainTimed.length; mi++) {
        const mainCue = mainTimed[mi];
        while (
            transCursor < transTimed.length &&
            transTimed[transCursor].endMs < mainCue.startMs - mergeThresholdMs
        ) {
            transCursor++;
        }
        windowStart[mi] = transCursor;

        let i = transCursor;
        for (; i < transTimed.length; i++) {
            const transCue = transTimed[i];
            if (transCue.startMs > mainCue.endMs + mergeThresholdMs) break;

            const overlapMs = Math.max(0, Math.min(mainCue.endMs, transCue.endMs) - Math.max(mainCue.startMs, transCue.startMs));
            if (overlapMs > bestOverlapForTrans[i]) {
                bestOverlapForTrans[i] = overlapMs;
                bestMainForTrans[i] = mi;
            }
        }
        windowEnd[mi] = i;
    }

    // Pass 2: pick the translation cues for each main cue. A main cue takes
    // the translation cues it owns (plus any cue that genuinely spans it),
    // and falls back to the best nearby cue when it owns none.
    const pickedTranslations: Array<Array<TimedCue<T>>> = new Array(mainTimed.length);

    for (let mi = 0; mi < mainTimed.length; mi++) {
        const mainCue = mainTimed[mi];
        const chosenTranslations: Array<TimedCue<T>> = [];
        let fallback: MatchCandidate<T> | null = null;

        for (let i = windowStart[mi]; i < windowEnd[mi]; i++) {
            const transCue = transTimed[i];
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
                const isOwner = bestMainForTrans[i] === mi;
                const spansThisMain = match.overlapMs >= SPANNING_COVERAGE_RATIO * mainCue.durationMs;
                if (isOwner || spansThisMain) {
                    chosenTranslations.push(transCue);
                }
            }

            if (!fallback || isBetterTimeMatch(match, fallback)) {
                fallback = match;
            }
        }

        pickedTranslations[mi] = chosenTranslations.length > 0
            ? chosenTranslations
            : fallback
                ? [fallback.cue]
                : [];
    }

    // Pass 3: emit the entries. When consecutive main cues share the same
    // single translation cue (one translation spanning a split main line),
    // combine them into one entry instead of repeating the translation —
    // as long as the joined line stays short and the cues sit close together.
    for (let mi = 0; mi < mainTimed.length;) {
        const picked = pickedTranslations[mi];
        let last = mi;

        if (picked.length === 1) {
            const sharedCue = picked[0];
            let joinedLength = mainTimed[mi].text.length;
            while (last + 1 < mainTimed.length) {
                const nextPicked = pickedTranslations[last + 1];
                if (nextPicked.length !== 1 || nextPicked[0] !== sharedCue) break;
                const nextMain = mainTimed[last + 1];
                if (nextMain.startMs - mainTimed[last].endMs > MERGED_MAIN_MAX_GAP_MS) break;
                if (nextMain.endMs - mainTimed[mi].startMs > MERGED_MAIN_MAX_DURATION_MS) break;
                const nextLength = joinedLength + 1 + nextMain.text.length;
                if (nextLength > MERGED_MAIN_MAX_CHARS) break;
                joinedLength = nextLength;
                last++;
            }
        }

        const mainText = last === mi
            ? mainTimed[mi].text
            : mainTimed.slice(mi, last + 1).map(cue => cue.text).join(' ');

        let mergedText = mainText;
        if (picked.length > 0) {
            const parts: string[] = [];
            for (const translation of picked) {
                if (translation.text && (parts.length === 0 || parts[parts.length - 1] !== translation.text)) {
                    parts.push(translation.text);
                }
            }
            const translationText = parts.join(' ');
            if (translationText) {
                mergedText = (`<b>${mainText}</b>\n<i>> ${translationText}</i>`).trim();
            }
        }

        if (mergedText) {
            mergedSubs.push(last > mi
                ? { ...mainTimed[mi].cue, endTime: mainTimed[last].cue.endTime, text: mergedText }
                : { ...mainTimed[mi].cue, text: mergedText });
        }
        mi = last + 1;
    }

    return mergedSubs;
}

// Estimates how the translation timeline maps onto the main timeline by
// tracking the start-time offset segment by segment. Each segment finds the
// densest cluster of pairwise start deltas near the previous segment's offset,
// so the estimate follows constant shifts, linear fps drift and step changes
// without any global assumption. Cost is O(samples * candidates-per-window).
function estimateAlignmentAnchors<T extends SubtitleCue>(
    mainTimed: Array<TimedCue<T>>,
    transTimed: Array<TimedCue<T>>
): AlignmentAnchor[] {
    if (mainTimed.length < 3 || transTimed.length < 3) return [];

    const transStarts = transTimed.map(cue => cue.startMs);
    const segmentCount = Math.max(1, Math.min(MAX_ALIGNMENT_SEGMENTS, Math.ceil(mainTimed.length / SEGMENT_TARGET_CUES)));
    const bounds: Array<{ from: number; to: number }> = [];
    for (let s = 0; s < segmentCount; s++) {
        bounds.push({
            from: Math.floor(s * mainTimed.length / segmentCount),
            to: Math.floor((s + 1) * mainTimed.length / segmentCount)
        });
    }

    const forwardOrder = bounds.map((_, i) => i);
    const forward = trackSegments(mainTimed, transTimed, transStarts, bounds, forwardOrder, 0, false);

    // Second pass in reverse, seeded from the forward tail. It heals segments
    // the forward pass mis-locked while it was still converging on the true
    // offset, and regions beyond a jump the forward pass could not follow.
    const backwardOrder = [...forwardOrder].reverse();
    const seedOffsetMs = forward.length > 0 ? forward[forward.length - 1].offsetMs : 0;
    const backward = trackSegments(mainTimed, transTimed, transStarts, bounds, backwardOrder, seedOffsetMs, forward.length > 0);

    return filterAnchorSpikes(reconcileAnchors(forward, backward));
}

function trackSegments<T extends SubtitleCue>(
    mainTimed: Array<TimedCue<T>>,
    transTimed: Array<TimedCue<T>>,
    transStarts: number[],
    bounds: Array<{ from: number; to: number }>,
    order: number[],
    seedOffsetMs: number,
    seedLocked: boolean
): AlignmentAnchor[] {
    const anchors: AlignmentAnchor[] = [];
    let prevOffsetMs = seedOffsetMs;
    let locked = seedLocked;

    for (const s of order) {
        const { from, to } = bounds[s];
        let anchor: AlignmentAnchor | null;
        if (locked) {
            anchor = estimateSegmentOffset(mainTimed, transTimed, transStarts, from, to, prevOffsetMs, BASE_SEARCH_WINDOW_MS, s)
                || estimateSegmentOffset(mainTimed, transTimed, transStarts, from, to, prevOffsetMs, WIDE_SEARCH_WINDOW_MS, s);
        } else {
            anchor = estimateSegmentOffset(mainTimed, transTimed, transStarts, from, to, prevOffsetMs, INITIAL_SEARCH_WINDOW_MS, s);
            // A first lock must be unambiguous — a thin cluster inside such a
            // wide window is more likely rhythm noise than the true offset.
            if (anchor && anchor.pairCount < MIN_INITIAL_LOCK_PAIRS && anchor.pairRatio < MIN_INITIAL_LOCK_RATIO) {
                anchor = null;
            }
        }
        if (!anchor) continue;
        anchors.push(anchor);
        prevOffsetMs = anchor.offsetMs;
        locked = true;
    }

    return anchors;
}

// Merge the two tracking passes: agreeing anchors keep the stronger estimate,
// disputes go to the clearly denser cluster, and ambiguous segments are
// dropped so their neighbours interpolate across them.
function reconcileAnchors(forward: AlignmentAnchor[], backward: AlignmentAnchor[]): AlignmentAnchor[] {
    const bySegment = new Map<number, AlignmentAnchor>();
    for (const anchor of forward) bySegment.set(anchor.segmentIndex, anchor);

    for (const candidate of backward) {
        const existing = bySegment.get(candidate.segmentIndex);
        if (!existing) {
            bySegment.set(candidate.segmentIndex, candidate);
        } else if (Math.abs(existing.offsetMs - candidate.offsetMs) <= ANCHOR_AGREEMENT_MS) {
            if (candidate.pairCount > existing.pairCount) bySegment.set(candidate.segmentIndex, candidate);
        } else if (candidate.pairCount >= existing.pairCount * ANCHOR_DISPUTE_DOMINANCE) {
            bySegment.set(candidate.segmentIndex, candidate);
        } else if (existing.pairCount < candidate.pairCount * ANCHOR_DISPUTE_DOMINANCE) {
            bySegment.delete(candidate.segmentIndex);
        }
    }

    return [...bySegment.values()].sort((a, b) => a.mainMs - b.mainMs);
}

function estimateSegmentOffset<T extends SubtitleCue>(
    mainTimed: Array<TimedCue<T>>,
    transTimed: Array<TimedCue<T>>,
    transStarts: number[],
    from: number,
    to: number,
    centerOffsetMs: number,
    searchWindowMs: number,
    segmentIndex: number
): AlignmentAnchor | null {
    const segmentLength = to - from;
    if (segmentLength <= 0) return null;

    const sampleCount = Math.min(MAX_SEGMENT_SAMPLES, segmentLength);
    const perCue: Array<{ mainMs: number; deltas: number[] }> = [];
    const allDeltas: number[] = [];

    for (let i = 0; i < sampleCount; i++) {
        const mainCue = mainTimed[from + Math.floor(i * segmentLength / sampleCount)];
        const firstIndex = lowerBound(transStarts, mainCue.startMs + centerOffsetMs - searchWindowMs);
        const deltas: number[] = [];

        for (let j = firstIndex; j < transTimed.length; j++) {
            const transCue = transTimed[j];
            if (transCue.startMs > mainCue.startMs + centerOffsetMs + searchWindowMs) break;

            const durationRatio = Math.min(mainCue.durationMs, transCue.durationMs) / Math.max(mainCue.durationMs, transCue.durationMs);
            if (durationRatio < 0.25) continue;

            deltas.push(transCue.startMs - mainCue.startMs);
        }

        if (deltas.length > 0) {
            perCue.push({ mainMs: mainCue.startMs, deltas });
            for (const delta of deltas) allDeltas.push(delta);
        }
    }

    if (perCue.length < MIN_SEGMENT_PAIRS) return null;

    // The true offset shows up as the densest cluster of deltas: every cue
    // with a genuine counterpart contributes one delta there, while deltas to
    // unrelated neighbouring cues spread out.
    allDeltas.sort((a, b) => a - b);
    let clusterStart = 0;
    let clusterCount = 0;
    for (let hi = 0, lo = 0; hi < allDeltas.length; hi++) {
        while (allDeltas[hi] - allDeltas[lo] > CLUSTER_WINDOW_MS) lo++;
        if (hi - lo + 1 > clusterCount) {
            clusterCount = hi - lo + 1;
            clusterStart = lo;
        }
    }
    const clusterLo = allDeltas[clusterStart];
    const clusterHi = clusterLo + CLUSTER_WINDOW_MS;
    const clusterCenter = clusterLo + CLUSTER_WINDOW_MS / 2;

    // At most one refined pair per sampled cue, so a burst of nearby cues
    // cannot outvote the rest of the segment.
    const pairMainMs: number[] = [];
    const pairDeltas: number[] = [];
    for (const { mainMs, deltas } of perCue) {
        let best: number | null = null;
        for (const delta of deltas) {
            if (delta < clusterLo || delta > clusterHi) continue;
            if (best === null || Math.abs(delta - clusterCenter) < Math.abs(best - clusterCenter)) {
                best = delta;
            }
        }
        if (best !== null) {
            pairMainMs.push(mainMs);
            pairDeltas.push(best);
        }
    }

    if (pairDeltas.length < MIN_SEGMENT_PAIRS || pairDeltas.length < MIN_SEGMENT_PAIR_RATIO * perCue.length) {
        return null;
    }

    const offsetMs = median(pairDeltas);
    const mainMs = median(pairMainMs);
    return {
        mainMs,
        transMs: mainMs + offsetMs,
        offsetMs,
        pairCount: pairDeltas.length,
        pairRatio: pairDeltas.length / perCue.length,
        segmentIndex
    };
}

function filterAnchorSpikes(anchors: AlignmentAnchor[]): AlignmentAnchor[] {
    if (anchors.length < 3) return enforceMonotonicAnchors(anchors);

    const kept = anchors.filter((anchor, i) => {
        if (i === 0 || i === anchors.length - 1) return true;
        const prev = anchors[i - 1];
        const next = anchors[i + 1];
        const neighborsAgree = Math.abs(prev.offsetMs - next.offsetMs) <= ANCHOR_NEIGHBOR_AGREEMENT_MS;
        const isSpike = Math.abs(anchor.offsetMs - prev.offsetMs) > ANCHOR_SPIKE_MS
            && Math.abs(anchor.offsetMs - next.offsetMs) > ANCHOR_SPIKE_MS;
        return !(neighborsAgree && isSpike);
    });

    return enforceMonotonicAnchors(kept);
}

function enforceMonotonicAnchors(anchors: AlignmentAnchor[]): AlignmentAnchor[] {
    const monotonic: AlignmentAnchor[] = [];
    for (const anchor of anchors) {
        const last = monotonic[monotonic.length - 1];
        if (!last || (anchor.mainMs > last.mainMs && anchor.transMs > last.transMs)) {
            monotonic.push(anchor);
        }
    }
    return monotonic;
}

function alignTransCues<T extends SubtitleCue>(
    transTimed: Array<TimedCue<T>>,
    anchors: AlignmentAnchor[]
): Array<TimedCue<T>> {
    if (anchors.length === 0) return transTimed;

    const offsets = anchors.map(anchor => anchor.offsetMs);
    const offsetRange = Math.max(...offsets) - Math.min(...offsets);

    if (anchors.length === 1 || offsetRange <= CONSTANT_OFFSET_TOLERANCE_MS) {
        const constantOffset = Math.round(median(offsets));
        if (Math.abs(constantOffset) < MIN_APPLY_OFFSET_MS) return transTimed;
        return shiftTimedCues(transTimed, -constantOffset);
    }

    // Piecewise warp between anchors (extrapolated at the edges). This covers
    // both fps drift (anchors along a line) and step offsets.
    const warped = transTimed.map(cue => {
        const startMs = mapTransToMainTime(cue.startMs, anchors);
        let endMs = mapTransToMainTime(cue.endMs, anchors);
        if (endMs <= startMs) endMs = startMs + cue.durationMs;
        return {
            ...cue,
            startMs,
            endMs,
            midMs: (startMs + endMs) / 2,
            durationMs: endMs - startMs
        };
    });
    // A step change can locally reorder cues; matching assumes start order.
    warped.sort((a, b) => a.startMs - b.startMs || a.endMs - b.endMs);
    return warped;
}

function mapTransToMainTime(transMs: number, anchors: AlignmentAnchor[]): number {
    if (anchors.length === 1) return transMs - anchors[0].offsetMs;

    // Rightmost anchor at or before transMs, clamped so [k, k+1] is valid;
    // out-of-range values extrapolate along the nearest anchor pair.
    let lo = 0;
    let hi = anchors.length - 1;
    while (lo < hi) {
        const mid = (lo + hi + 1) >> 1;
        if (anchors[mid].transMs <= transMs) lo = mid;
        else hi = mid - 1;
    }
    const k = Math.min(lo, anchors.length - 2);
    const a = anchors[k];
    const b = anchors[k + 1];
    const fraction = (transMs - a.transMs) / (b.transMs - a.transMs);
    const diffMs = b.offsetMs - a.offsetMs;
    const offsetMs = Math.abs(diffMs) <= DRIFT_RAMP_MAX_MS
        ? a.offsetMs + fraction * diffMs
        : (fraction < 0.5 ? a.offsetMs : b.offsetMs);
    return transMs - offsetMs;
}

interface AlignmentScore {
    matchedMains: number;
    overlapTotalMs: number;
    blockMatched: number[];
}

// How well a translation timeline fits the main one: the number of main cues
// with at least one material overlap (in total and per block of consecutive
// main cues), plus the summed best overlap per cue.
function scoreAlignment<T extends SubtitleCue>(
    mainTimed: Array<TimedCue<T>>,
    transTimed: Array<TimedCue<T>>,
    mergeThresholdMs: number
): AlignmentScore {
    let matchedMains = 0;
    let overlapTotalMs = 0;
    const blockMatched: number[] = new Array(Math.ceil(mainTimed.length / ALIGNMENT_BLOCK_CUES) || 1).fill(0);
    let cursor = 0;

    for (let mi = 0; mi < mainTimed.length; mi++) {
        const mainCue = mainTimed[mi];
        while (cursor < transTimed.length && transTimed[cursor].endMs < mainCue.startMs - mergeThresholdMs) {
            cursor++;
        }

        let bestOverlapMs = 0;
        let hasMaterial = false;
        for (let i = cursor; i < transTimed.length; i++) {
            const transCue = transTimed[i];
            if (transCue.startMs > mainCue.endMs + mergeThresholdMs) break;
            const overlapMs = Math.max(0, Math.min(mainCue.endMs, transCue.endMs) - Math.max(mainCue.startMs, transCue.startMs));
            if (overlapMs > bestOverlapMs) bestOverlapMs = overlapMs;
            if (!hasMaterial && isMaterialOverlap(mainCue, transCue, overlapMs)) hasMaterial = true;
        }

        if (hasMaterial) {
            matchedMains++;
            blockMatched[Math.floor(mi / ALIGNMENT_BLOCK_CUES)]++;
        }
        overlapTotalMs += bestOverlapMs;
    }

    return { matchedMains, overlapTotalMs, blockMatched };
}

function isBetterAlignment(aligned: AlignmentScore, raw: AlignmentScore): boolean {
    // Reject any alignment that noticeably degrades one region of the file,
    // even if it helps elsewhere — that is the signature of a wrong anchor.
    for (let b = 0; b < raw.blockMatched.length; b++) {
        const rawBlock = raw.blockMatched[b];
        const alignedBlock = aligned.blockMatched[b] || 0;
        const allowedLoss = Math.max(MIN_BLOCK_LOSS_ALLOWANCE, Math.floor(rawBlock * MAX_BLOCK_LOSS_RATIO));
        if (alignedBlock < rawBlock - allowedLoss) return false;
    }
    if (aligned.matchedMains !== raw.matchedMains) return aligned.matchedMains > raw.matchedMains;
    return aligned.overlapTotalMs > raw.overlapTotalMs * ALIGNMENT_OVERLAP_IMPROVEMENT;
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

    // Matching and alignment both assume start-time order; real files almost
    // always are sorted, so this is a cheap safety net for the ones that aren't.
    for (let i = 1; i < timed.length; i++) {
        if (timed[i].startMs < timed[i - 1].startMs) {
            timed.sort((a, b) => a.startMs - b.startMs || a.endMs - b.endMs);
            break;
        }
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

function lowerBound(sorted: number[], target: number): number {
    let lo = 0;
    let hi = sorted.length;
    while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (sorted[mid] < target) lo = mid + 1;
        else hi = mid;
    }
    return lo;
}

function median(values: number[]): number {
    const sorted = [...values].sort((a, b) => a - b);
    const mid = sorted.length >> 1;
    return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
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