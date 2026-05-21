export interface TimedCue {
    id: string;
    startMs: number;
    endMs: number;
    text: string;
    [key: string]: unknown;
}

export interface DriftCorrection {
    scale: number;
    offset: number;
    anchors: number;
}

export interface SegmentAnchor {
    centerMs: number;
    shiftMs: number;
}

export interface SyncResult {
    matches: Map<number, number[]>;
    shiftedTrans: TimedCue[];
    globalShiftMs: number;
    drift: DriftCorrection | null;
    segmentAnchors: SegmentAnchor[];
    matchRate: number;
}

export interface SyncOptions {
    enableGlobalShift?: boolean;
    enableDriftCorrection?: boolean;
    enableSegmentOffsets?: boolean;
    matchWindowMs?: number;
    allowManyTranslations?: boolean;
    maxTranslationsPerMain?: number;
    minOverlapFraction?: number;
    log?: (msg: string) => void;
}

interface CompleteSyncOptions {
    enableGlobalShift: boolean;
    enableDriftCorrection: boolean;
    enableSegmentOffsets: boolean;
    matchWindowMs: number;
    allowManyTranslations: boolean;
    maxTranslationsPerMain: number;
    minOverlapFraction: number;
    log: (msg: string) => void;
}

const DEFAULT_SYNC_OPTIONS: CompleteSyncOptions = {
    enableGlobalShift: true,
    enableDriftCorrection: true,
    enableSegmentOffsets: true,
    matchWindowMs: 1500,
    allowManyTranslations: true,
    maxTranslationsPerMain: 3,
    minOverlapFraction: 0.1,
    log: () => {},
};

function mergeOptions(opts: SyncOptions | undefined): CompleteSyncOptions {
    return { ...DEFAULT_SYNC_OPTIONS, ...opts };
}

function buildActivityMap(
    subs: TimedCue[],
    cells: number,
    stepMs: number
): Uint8Array {
    const map = new Uint8Array(cells);
    for (let i = 0; i < subs.length; i++) {
        const s = subs[i];
        if (s.endMs <= s.startMs) continue;
        const start = (s.startMs / stepMs) | 0;
        const end = Math.min(cells - 1, ((s.endMs - 1) / stepMs) | 0);
        if (start < 0) continue;
        for (let j = start; j <= end; j++) map[j] = 1;
    }
    return map;
}

function countActiveCells(map: Uint8Array): number {
    let n = 0;
    for (let i = 0; i < map.length; i++) n += map[i];
    return n;
}

function crossCorrelate(
    mainMap: Uint8Array,
    transMap: Uint8Array,
    cells: number,
    maxLag: number,
    stepMs: number
): { bestLag: number; bestScore: number; zeroScore: number } {
    let bestLag = 0;
    let bestScore = -1;
    let zeroScore = 0;

    for (let lag = -maxLag; lag <= maxLag; lag++) {
        let score = 0;
        const iStart = lag > 0 ? 0 : -lag;
        const iEnd = lag > 0 ? cells - lag : cells;
        for (let i = iStart; i < iEnd; i++) {
            score += mainMap[i] & transMap[i + lag];
        }
        if (lag === 0) zeroScore = score;
        if (score > bestScore) {
            bestScore = score;
            bestLag = lag;
        }
    }

    return { bestLag, bestScore, zeroScore };
}

export function computeGlobalShift(
    mainSubs: TimedCue[],
    transSubs: TimedCue[],
    opts: { maxShiftMs?: number; stepMs?: number; minConfidence?: number } = {}
): number {
    const {
        maxShiftMs = 30000,
        stepMs = 100,
        minConfidence = 0.25,
    } = opts;

    if (!mainSubs || !transSubs || mainSubs.length < 5 || transSubs.length < 5) {
        return 0;
    }

    const maxMain = mainSubs[mainSubs.length - 1].endMs || 0;
    const maxTrans = transSubs[transSubs.length - 1].endMs || 0;
    const totalDuration = Math.max(maxMain, maxTrans) + maxShiftMs;
    if (totalDuration <= 0) return 0;

    const coarseStep = stepMs * 3;
    const coarseMaxLag = Math.floor(maxShiftMs / coarseStep);
    const coarseCells = Math.ceil(totalDuration / coarseStep) + 1;

    const coarseMain = buildActivityMap(mainSubs, coarseCells, coarseStep);
    const coarseTrans = buildActivityMap(transSubs, coarseCells, coarseStep);

    const mainActive = countActiveCells(coarseMain);
    const transActive = countActiveCells(coarseTrans);
    if (mainActive === 0 || transActive === 0) return 0;

    const coarseResult = crossCorrelate(coarseMain, coarseTrans, coarseCells, coarseMaxLag, coarseStep);

    const maxPossible = Math.min(mainActive, transActive);
    if (coarseResult.bestScore < minConfidence * maxPossible) return 0;
    if (coarseResult.bestLag !== 0 && coarseResult.bestScore < coarseResult.zeroScore * 1.05) return 0;

    const coarseOffsetMs = -coarseResult.bestLag * coarseStep;

    const refineRangeMs = coarseStep * 3;
    const fineCells = Math.ceil((2 * refineRangeMs) / stepMs) + 1;
    const fineMaxMain = refineRangeMs;
    const offsetMain = mainSubs.filter(s => s.startMs >= 0 && s.startMs < refineRangeMs * 2);
    const offsetTrans = transSubs.map(s => ({
        ...s,
        startMs: s.startMs + coarseOffsetMs,
        endMs: s.endMs + coarseOffsetMs,
    })).filter(s => s.startMs >= -refineRangeMs && s.startMs < refineRangeMs * 2);

    if (offsetMain.length < 3 || offsetTrans.length < 3) return coarseOffsetMs;

    const fineMain = buildActivityMap(offsetMain, fineCells, stepMs);
    const fineTrans = buildActivityMap(offsetTrans, fineCells, stepMs);

    const fineMaxLag = Math.floor(refineRangeMs / stepMs);
    const fineResult = crossCorrelate(fineMain, fineTrans, fineCells, fineMaxLag, stepMs);

    const fineActive = countActiveCells(fineMain);
    const fineTransActive = countActiveCells(fineTrans);
    if (fineActive === 0 || fineTransActive === 0) return coarseOffsetMs;

    const fineMaxPossible = Math.min(fineActive, fineTransActive);
    if (fineResult.bestScore < minConfidence * fineMaxPossible) return coarseOffsetMs;

    const fineOffsetMs = -fineResult.bestLag * stepMs;
    return coarseOffsetMs + fineOffsetMs;
}

function bisectStart(arr: TimedCue[], ms: number): number {
    let lo = 0, hi = arr.length;
    while (lo < hi) {
        const mid = (lo + hi) >>> 1;
        if (arr[mid].startMs < ms) lo = mid + 1;
        else hi = mid;
    }
    return lo;
}

function bisectEnd(arr: TimedCue[], ms: number): number {
    let lo = 0, hi = arr.length;
    while (lo < hi) {
        const mid = (lo + hi) >>> 1;
        if (arr[mid].startMs <= ms) lo = mid + 1;
        else hi = mid;
    }
    return lo;
}

function findDriftAnchors(
    mainSubs: TimedCue[],
    transSubs: TimedCue[],
    anchorThresholdMs: number
): Array<[number, number]> {
    const anchors: Array<[number, number]> = [];
    let j = 0;
    for (let i = 0; i < mainSubs.length; i++) {
        const m = mainSubs[i];
        while (j < transSubs.length && transSubs[j].endMs < m.startMs - anchorThresholdMs) j++;
        let bestK = -1;
        let bestD = Infinity;
        let secondD = Infinity;
        for (let k = j; k < transSubs.length; k++) {
            const t = transSubs[k];
            if (t.startMs > m.endMs + anchorThresholdMs) break;
            const d = Math.abs(t.startMs - m.startMs);
            if (d < bestD) {
                secondD = bestD;
                bestD = d;
                bestK = k;
            } else if (d < secondD) {
                secondD = d;
            }
        }
        if (bestK >= 0 && bestD <= anchorThresholdMs && secondD > bestD * 1.5) {
            anchors.push([m.startMs, transSubs[bestK].startMs]);
        }
    }
    return anchors;
}

export function computeAffineDrift(
    mainSubs: TimedCue[],
    transSubs: TimedCue[],
    opts: { anchorThresholdMs?: number; minAnchors?: number } = {}
): DriftCorrection | null {
    const { anchorThresholdMs = 1500, minAnchors = 8 } = opts;

    const anchors = findDriftAnchors(mainSubs, transSubs, anchorThresholdMs);
    if (anchors.length < minAnchors) return null;

    let sumX = 0, sumY = 0, sumXY = 0, sumXX = 0;
    for (let i = 0; i < anchors.length; i++) {
        const x = anchors[i][0];
        const y = anchors[i][1];
        sumX += x;
        sumY += y;
        sumXY += x * y;
        sumXX += x * x;
    }
    const n = anchors.length;
    const denom = n * sumXX - sumX * sumX;
    if (denom === 0) return null;
    const a = (n * sumXY - sumX * sumY) / denom;
    const b = (sumY - a * sumX) / n;

    if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
    if (a < 0.85 || a > 1.15) return null;

    return { scale: a, offset: b, anchors: n };
}

export function computeSegmentOffsets(
    mainSubs: TimedCue[],
    transSubs: TimedCue[],
    opts: {
        windowMs?: number;
        stepMs?: number;
        minCuesPerWindow?: number;
        maxSegmentShiftMs?: number;
    } = {}
): SegmentAnchor[] {
    const {
        windowMs = 300000,
        stepMs = 150000,
        minCuesPerWindow = 5,
        maxSegmentShiftMs = 15000,
    } = opts;

    if (!mainSubs || !transSubs || mainSubs.length === 0 || transSubs.length === 0) {
        return [];
    }

    const total = Math.max(
        mainSubs[mainSubs.length - 1].endMs || 0,
        transSubs[transSubs.length - 1].endMs || 0
    );
    if (total <= 0) return [];

    const anchors: SegmentAnchor[] = [];
    for (let winStart = 0; winStart < total; winStart += stepMs) {
        const winEnd = winStart + windowMs;
        const mainLo = bisectStart(mainSubs, winStart);
        const mainHi = bisectEnd(mainSubs, winEnd);
        const transLo = bisectStart(transSubs, winStart - maxSegmentShiftMs);
        const transHi = bisectEnd(transSubs, winEnd + maxSegmentShiftMs);

        if (mainHi - mainLo < minCuesPerWindow || transHi - transLo < minCuesPerWindow) {
            continue;
        }

        const mainSlice = mainSubs.slice(mainLo, mainHi);
        const transSlice = transSubs.slice(transLo, transHi);

        const localShift = computeGlobalShift(mainSlice, transSlice, {
            maxShiftMs: maxSegmentShiftMs,
            stepMs: 100,
            minConfidence: 0.3,
        });

        if (localShift === 0) continue;
        anchors.push({ centerMs: winStart + windowMs / 2, shiftMs: localShift });
    }
    return anchors;
}

function bisectAnchors(sorted: SegmentAnchor[], t: number): number {
    let lo = 0, hi = sorted.length - 1;
    while (lo < hi) {
        const mid = (lo + hi + 1) >>> 1;
        if (sorted[mid].centerMs <= t) lo = mid;
        else hi = mid - 1;
    }
    return lo;
}

function computeShiftAtTime(sorted: SegmentAnchor[], t: number): number {
    if (sorted.length === 0) return 0;
    if (sorted.length === 1) return sorted[0].shiftMs;
    if (t <= sorted[0].centerMs) return sorted[0].shiftMs;
    if (t >= sorted[sorted.length - 1].centerMs) return sorted[sorted.length - 1].shiftMs;

    const idx = bisectAnchors(sorted, t);
    if (idx >= sorted.length - 1) return sorted[sorted.length - 1].shiftMs;

    const a = sorted[idx];
    const b = sorted[idx + 1];
    const ratio = (t - a.centerMs) / (b.centerMs - a.centerMs);
    return Math.round(a.shiftMs + ratio * (b.shiftMs - a.shiftMs));
}

export function computeJaccardOverlap(m: TimedCue, t: TimedCue): number {
    const overlapStart = m.startMs > t.startMs ? m.startMs : t.startMs;
    const overlapEnd = m.endMs < t.endMs ? m.endMs : t.endMs;
    const overlap = overlapEnd - overlapStart;
    if (overlap <= 0) return 0;
    const unionStart = m.startMs < t.startMs ? m.startMs : t.startMs;
    const unionEnd = m.endMs > t.endMs ? m.endMs : t.endMs;
    const union = unionEnd - unionStart;
    if (union <= 0) return 0;
    return overlap / union;
}

function rateCuePair(m: TimedCue, t: TimedCue, threshold: number): number {
    const o = computeJaccardOverlap(m, t);
    if (o > 0) return o;
    const startDiff = Math.abs(t.startMs - m.startMs);
    if (startDiff < threshold) return 0.001 + 1 / (1 + startDiff);
    return 0;
}

export function assignOverlaps(
    mainSubs: TimedCue[],
    transSubs: TimedCue[],
    opts: {
        threshold?: number;
        minOverlapFraction?: number;
        allowManyTranslations?: boolean;
        maxTranslationsPerMain?: number;
    } = {}
): Map<number, number[]> {
    const {
        threshold = 1500,
        minOverlapFraction = 0.1,
        allowManyTranslations = true,
        maxTranslationsPerMain = 3,
    } = opts;

    const matches = new Map<number, number[]>();
    const usedMain = new Set<number>();
    const usedTrans = new Set<number>();

    const pairs: Array<{ mi: number; ti: number; score: number }> = [];
    let transStart = 0;
    for (let mi = 0; mi < mainSubs.length; mi++) {
        const m = mainSubs[mi];
        while (
            transStart < transSubs.length &&
            transSubs[transStart].endMs < m.startMs - threshold
        ) {
            transStart++;
        }
        for (let ti = transStart; ti < transSubs.length; ti++) {
            const t = transSubs[ti];
            if (t.startMs > m.endMs + threshold) break;
            const score = rateCuePair(m, t, threshold);
            if (score > 0) pairs.push({ mi, ti, score });
        }
    }

    pairs.sort((a, b) => b.score - a.score);
    for (let i = 0; i < pairs.length; i++) {
        const p = pairs[i];
        if (usedMain.has(p.mi) || usedTrans.has(p.ti)) continue;
        usedMain.add(p.mi);
        usedTrans.add(p.ti);
        matches.set(p.mi, [p.ti]);
    }

    if (!allowManyTranslations) return matches;

    matches.forEach((picked, mi) => {
        if (picked.length >= maxTranslationsPerMain) return;
        const m = mainSubs[mi];
        const anchor = picked[0];

        for (let di = 0; di < 2; di++) {
            const dir = di === 0 ? 1 : -1;
            let ti = anchor + dir;
            while (
                ti >= 0 &&
                ti < transSubs.length &&
                picked.length < maxTranslationsPerMain &&
                !usedTrans.has(ti)
            ) {
                const t = transSubs[ti];
                const score = computeJaccardOverlap(m, t);
                if (score < minOverlapFraction) break;
                picked.push(ti);
                usedTrans.add(ti);
                ti += dir;
            }
        }
        picked.sort((a, b) => a - b);
    });

    return matches;
}

export function synchronizeTracks(
    mainSubs: TimedCue[],
    transSubs: TimedCue[],
    opts: SyncOptions = {}
): SyncResult {
    const o = mergeOptions(opts);
    let globalShiftMs = 0;
    let drift: DriftCorrection | null = null;
    let segmentAnchors: SegmentAnchor[] = [];

    const trans = transSubs.map(s => ({
        id: s.id,
        text: s.text,
        startMs: s.startMs,
        endMs: s.endMs,
    }));

    if (o.enableGlobalShift && trans.length > 0 && mainSubs.length > 0) {
        globalShiftMs = computeGlobalShift(mainSubs, trans);
        if (globalShiftMs !== 0) {
            for (let i = 0; i < trans.length; i++) {
                trans[i].startMs += globalShiftMs;
                trans[i].endMs += globalShiftMs;
            }
            o.log(`Alignment: applied global shift ${globalShiftMs}ms`);
        }
    }

    if (o.enableDriftCorrection && trans.length >= 8 && mainSubs.length >= 8) {
        drift = computeAffineDrift(mainSubs, trans);
        if (drift && Math.abs(drift.scale - 1) > 0.001) {
            const { scale, offset } = drift;
            for (let i = 0; i < trans.length; i++) {
                trans[i].startMs = Math.round((trans[i].startMs - offset) / scale);
                trans[i].endMs = Math.round((trans[i].endMs - offset) / scale);
            }
            o.log(
                `Alignment: applied drift correction scale=${drift.scale.toFixed(5)} ` +
                `offset=${drift.offset.toFixed(0)} from ${drift.anchors} anchors`
            );
        } else {
            drift = null;
        }
    }

    if (o.enableSegmentOffsets && trans.length >= 20 && mainSubs.length >= 20) {
        segmentAnchors = computeSegmentOffsets(mainSubs, trans);
        if (segmentAnchors.length >= 2) {
            const sorted = [...segmentAnchors].sort((a, b) => a.centerMs - b.centerMs);
            let minMs = Infinity, maxMs = -Infinity;
            for (let i = 0; i < sorted.length; i++) {
                if (sorted[i].shiftMs < minMs) minMs = sorted[i].shiftMs;
                if (sorted[i].shiftMs > maxMs) maxMs = sorted[i].shiftMs;
            }
            if (maxMs - minMs >= 500) {
                for (let i = 0; i < trans.length; i++) {
                    const shift = computeShiftAtTime(sorted, trans[i].startMs);
                    trans[i].startMs += shift;
                    trans[i].endMs += shift;
                }
                o.log(
                    `Alignment: applied ${segmentAnchors.length} segment anchors ` +
                    `(spread ${minMs}..${maxMs} ms)`
                );
            } else {
                segmentAnchors = [];
            }
        } else {
            segmentAnchors = [];
        }
    }

    const matches = assignOverlaps(mainSubs, trans, {
        threshold: o.matchWindowMs,
        allowManyTranslations: o.allowManyTranslations,
        maxTranslationsPerMain: o.maxTranslationsPerMain,
        minOverlapFraction: o.minOverlapFraction,
    });

    const matchRate = mainSubs.length > 0 ? matches.size / mainSubs.length : 0;
    o.log(
        `Alignment: matched ${matches.size}/${mainSubs.length} ` +
        `(${(matchRate * 100).toFixed(1)}%)`
    );

    return {
        matches,
        shiftedTrans: trans,
        globalShiftMs,
        drift,
        segmentAnchors,
        matchRate,
    };
}