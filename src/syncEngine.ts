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
    for (const s of subs) {
        if (!s || s.endMs <= s.startMs) continue;
        const start = Math.max(0, Math.floor(s.startMs / stepMs));
        const end = Math.min(cells - 1, Math.floor((s.endMs - 1) / stepMs));
        for (let i = start; i <= end; i++) map[i] = 1;
    }
    return map;
}

function countActiveCells(map: Uint8Array): number {
    let n = 0;
    for (let i = 0; i < map.length; i++) if (map[i]) n++;
    return n;
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

    const cells = Math.ceil(totalDuration / stepMs) + 1;
    const mainMap = buildActivityMap(mainSubs, cells, stepMs);
    const transMap = buildActivityMap(transSubs, cells, stepMs);

    const mainActive = countActiveCells(mainMap);
    const transActive = countActiveCells(transMap);
    if (mainActive === 0 || transActive === 0) return 0;

    const maxLag = Math.floor(maxShiftMs / stepMs);
    let bestLag = 0;
    let bestScore = -1;
    let zeroScore = 0;

    for (let lag = -maxLag; lag <= maxLag; lag++) {
        let score = 0;
        const iStart = Math.max(0, -lag);
        const iEnd = Math.min(cells, cells - lag);
        for (let i = iStart; i < iEnd; i++) {
            if (mainMap[i] && transMap[i + lag]) score++;
        }
        if (lag === 0) zeroScore = score;
        if (score > bestScore) {
            bestScore = score;
            bestLag = lag;
        }
    }

    const maxPossible = Math.min(mainActive, transActive);
    if (bestScore < minConfidence * maxPossible) return 0;
    if (bestLag !== 0 && bestScore < zeroScore * 1.05) return 0;

    return -bestLag * stepMs;
}

export function shiftTimings(subs: TimedCue[], offsetMs: number): TimedCue[] {
    if (!offsetMs) return subs;
    return subs.map(s => ({
        ...s,
        startMs: s.startMs + offsetMs,
        endMs: s.endMs + offsetMs,
    }));
}

function findDriftAnchors(
    mainSubs: TimedCue[],
    transSubs: TimedCue[],
    anchorThresholdMs: number
): Array<[number, number]> {
    const anchors: Array<[number, number]> = [];
    let j = 0;
    for (const m of mainSubs) {
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
    for (const [x, y] of anchors) {
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

export function applyDriftCorrection(subs: TimedCue[], mapping: DriftCorrection): TimedCue[] {
    const { scale, offset } = mapping;
    return subs.map(s => ({
        ...s,
        startMs: Math.round((s.startMs - offset) / scale),
        endMs: Math.round((s.endMs - offset) / scale),
    }));
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
        const mainSlice = mainSubs.filter(s => s.startMs >= winStart && s.startMs < winEnd);
        const transSlice = transSubs.filter(
            s => s.startMs >= winStart - maxSegmentShiftMs &&
                 s.startMs < winEnd + maxSegmentShiftMs
        );
        if (mainSlice.length < minCuesPerWindow || transSlice.length < minCuesPerWindow) {
            continue;
        }

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

export function interpolateSegmentShifts(
    subs: TimedCue[],
    anchors: SegmentAnchor[]
): TimedCue[] {
    if (!anchors || anchors.length === 0) return subs;
    const sorted = [...anchors].sort((a, b) => a.centerMs - b.centerMs);

    function shiftAtTime(t: number): number {
        if (t <= sorted[0].centerMs) return sorted[0].shiftMs;
        if (t >= sorted[sorted.length - 1].centerMs) return sorted[sorted.length - 1].shiftMs;
        for (let i = 0; i < sorted.length - 1; i++) {
            const a = sorted[i];
            const b = sorted[i + 1];
            if (t >= a.centerMs && t <= b.centerMs) {
                const ratio = (t - a.centerMs) / (b.centerMs - a.centerMs);
                return Math.round(a.shiftMs + ratio * (b.shiftMs - a.shiftMs));
            }
        }
        return 0;
    }

    return subs.map(s => {
        const o = shiftAtTime(s.startMs);
        return { ...s, startMs: s.startMs + o, endMs: s.endMs + o };
    });
}

export function computeJaccardOverlap(m: TimedCue, t: TimedCue): number {
    const overlapStart = Math.max(m.startMs, t.startMs);
    const overlapEnd = Math.min(m.endMs, t.endMs);
    const overlap = overlapEnd - overlapStart;
    if (overlap <= 0) return 0;
    const unionStart = Math.min(m.startMs, t.startMs);
    const unionEnd = Math.max(m.endMs, t.endMs);
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
    for (const p of pairs) {
        if (usedMain.has(p.mi) || usedTrans.has(p.ti)) continue;
        usedMain.add(p.mi);
        usedTrans.add(p.ti);
        matches.set(p.mi, [p.ti]);
    }

    if (!allowManyTranslations) return matches;

    for (const [mi, picked] of matches) {
        if (picked.length >= maxTranslationsPerMain) continue;
        const m = mainSubs[mi];
        const anchor = picked[0];

        for (const dir of [1, -1]) {
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
    }

    return matches;
}

export function synchronizeTracks(
    mainSubs: TimedCue[],
    transSubs: TimedCue[],
    opts: SyncOptions = {}
): SyncResult {
    const o = mergeOptions(opts);
    let trans = [...transSubs];
    let globalShiftMs = 0;
    let drift: DriftCorrection | null = null;
    let segmentAnchors: SegmentAnchor[] = [];

    if (o.enableGlobalShift && trans.length > 0 && mainSubs.length > 0) {
        globalShiftMs = computeGlobalShift(mainSubs, trans);
        if (globalShiftMs !== 0) {
            trans = shiftTimings(trans, globalShiftMs);
            o.log(`Alignment: applied global shift ${globalShiftMs}ms`);
        }
    }

    if (o.enableDriftCorrection && trans.length >= 8 && mainSubs.length >= 8) {
        drift = computeAffineDrift(mainSubs, trans);
        if (drift && Math.abs(drift.scale - 1) > 0.001) {
            trans = applyDriftCorrection(trans, drift);
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
            const range = segmentAnchors.reduce(
                (acc, a) => ({
                    min: Math.min(acc.min, a.shiftMs),
                    max: Math.max(acc.max, a.shiftMs),
                }),
                { min: Infinity, max: -Infinity }
            );
            if (range.max - range.min >= 500) {
                trans = interpolateSegmentShifts(trans, segmentAnchors);
                o.log(
                    `Alignment: applied ${segmentAnchors.length} segment anchors ` +
                    `(spread ${range.min}..${range.max} ms)`
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