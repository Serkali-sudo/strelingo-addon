import { getLanguageAliases } from './encoding';

export interface CandidatePair {
    main: SubtitleCandidate;
    trans: SubtitleCandidate;
    sameGroup: boolean;
    group: string | null;
    source: 'group' | 'fallback' | 'requested';
}

export interface SubtitleCandidate {
    id: string | number;
    url: string;
    lang: string;
    langName: string;
    downloads: number;
    g?: string | null;
    SubEncoding?: string | null;
    m?: string | null;
    [key: string]: unknown;
}

function filterCandidatesForLanguage(
    allSubtitles: any[],
    languageId: string
): SubtitleCandidate[] {
    if (!Array.isArray(allSubtitles) || !languageId) return [];
    const aliases = getLanguageAliases(languageId);
    return allSubtitles.filter(s => s && aliases.includes(s.lang));
}

function scoreCandidateQuality(sub: SubtitleCandidate): number {
    if (!sub) return 0;
    let s = 0;
    if (sub.m === 'i') s += 10;
    if (sub.SubEncoding === 'UTF-8') s += 5;
    else if (sub.SubEncoding === 'CP1254' || sub.SubEncoding === 'CP1251') s += 2;
    return s;
}

function rankCandidatesForLanguage(
    allSubtitles: any[],
    languageId: string
): SubtitleCandidate[] {
    const list = filterCandidatesForLanguage(allSubtitles, languageId);
    return list
        .map((sub, idx) => ({ sub, idx }))
        .sort((a, b) => {
            const ds = scoreCandidateQuality(b.sub) - scoreCandidateQuality(a.sub);
            if (ds !== 0) return ds;
            return a.idx - b.idx;
        })
        .map(x => x.sub);
}

export function buildCandidatePairs(
    allSubtitles: any[],
    mainLang: string,
    transLang: string,
    opts: { maxPairs?: number; maxPerGroup?: number } = {}
): CandidatePair[] {
    const { maxPairs = 6, maxPerGroup = 2 } = opts;

    const mainList = rankCandidatesForLanguage(allSubtitles, mainLang);
    const transList = rankCandidatesForLanguage(allSubtitles, transLang);
    if (mainList.length === 0 || transList.length === 0) return [];

    const seen = new Set<string>();
    const pairKey = (m: SubtitleCandidate, t: SubtitleCandidate) => `${m.id}:${t.id}`;

    const transByG = new Map<string, SubtitleCandidate[]>();
    for (const t of transList) {
        const g = t.g;
        if (g == null || g === '') continue;
        if (!transByG.has(g)) transByG.set(g, []);
        transByG.get(g)!.push(t);
    }

    const groupQueue: CandidatePair[] = [];
    for (const m of mainList) {
        const peers = transByG.get(m.g || '');
        if (!peers || peers.length === 0) continue;
        let emittedForThisMain = 0;
        for (const t of peers) {
            const key = pairKey(m, t);
            if (seen.has(key)) continue;
            groupQueue.push({
                main: m,
                trans: t,
                sameGroup: true,
                group: m.g || null,
                source: 'group',
            });
            seen.add(key);
            emittedForThisMain++;
            if (emittedForThisMain >= maxPerGroup) break;
        }
    }

    const zipQueue: CandidatePair[] = [];
    const zipLen = Math.min(mainList.length, transList.length);
    for (let i = 0; i < zipLen; i++) {
        const key = pairKey(mainList[i], transList[i]);
        if (seen.has(key)) continue;
        zipQueue.push({
            main: mainList[i],
            trans: transList[i],
            sameGroup: mainList[i].g === transList[i].g && mainList[i].g != null,
            group: mainList[i].g === transList[i].g ? mainList[i].g : null,
            source: 'fallback',
        });
        seen.add(key);
    }

    const pairs: CandidatePair[] = [];
    const order = [groupQueue, zipQueue, groupQueue, zipQueue, groupQueue, zipQueue];
    for (const queue of order) {
        if (pairs.length >= maxPairs) break;
        if (queue.length > 0) pairs.push(queue.shift()!);
    }
    while (pairs.length < maxPairs && (groupQueue.length > 0 || zipQueue.length > 0)) {
        if (groupQueue.length > 0) pairs.push(groupQueue.shift()!);
        if (pairs.length >= maxPairs) break;
        if (zipQueue.length > 0) pairs.push(zipQueue.shift()!);
    }

    for (let i = 1; i < transList.length && pairs.length < maxPairs; i++) {
        const key = pairKey(mainList[0], transList[i]);
        if (seen.has(key)) continue;
        pairs.push({
            main: mainList[0],
            trans: transList[i],
            sameGroup: mainList[0].g === transList[i].g && mainList[0].g != null,
            group: null,
            source: 'fallback',
        });
        seen.add(key);
    }
    for (let i = 1; i < mainList.length && pairs.length < maxPairs; i++) {
        const key = pairKey(mainList[i], transList[0]);
        if (seen.has(key)) continue;
        pairs.push({
            main: mainList[i],
            trans: transList[0],
            sameGroup: mainList[i].g === transList[0].g && mainList[i].g != null,
            group: null,
            source: 'fallback',
        });
        seen.add(key);
    }

    return pairs;
}