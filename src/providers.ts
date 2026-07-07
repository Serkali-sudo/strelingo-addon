import { normalizeLanguageCode } from './encoding';

// ---------------------------------------------------------------------------
// Optional, API-key-gated subtitle providers (Wyzie, SubSource).
//
// A direct SubDL provider was dropped: SubDL's free API hard-403s server-side
// requests behind Cloudflare. SubDL is still reachable via Wyzie's `subdl` source.
//
// These are layered ON TOP of the addon's two built-in, key-less sources
// (OpenSubtitles + Buta-no-subs) which live in src/index.ts and are NOT touched
// here. Each provider only runs when the user supplies its API key in the addon
// config. Every provider call is isolated (try/catch + timeout) so a failing or
// slow provider can never break a subtitle request.
// ---------------------------------------------------------------------------

const PROVIDER_TIMEOUT_MS = 12000;
const MAX_RESULTS_PER_PROVIDER = 20;

// A resolved language the caller wants, in the three forms the providers need.
export interface RequestedLang {
    code3: string;   // addon-internal 3-letter code, e.g. 'eng', 'pob'
    code2: string;   // ISO 639-1 2-letter, e.g. 'en'   (Wyzie)
    name: string;    // English language name lowercased, e.g. 'english' (SubSource)
}

// Flat subtitle shape that merges into the same `allSubtitles` array the
// built-in OpenSubtitles fetch produces. `lang` is always a 3-letter addon code
// so the existing filterSubtitlesByLanguage() matches it. The optional
// provider/apiKey/season/episode fields are carried through to download time so
// fetchSubtitleContent() can add auth headers and extract the right zip entry.
export interface ProviderSub {
    id: string;
    url: string;
    lang: string;
    g: number;
    format?: string;
    releaseName?: string;
    provider?: string;
    apiKey?: string;
    season?: string;
    episode?: string;
}

export interface OptionalProviderConfig {
    wyzieKey: string;
    wyzieSources: string[];
    subsourceKey: string;
    mode: 'parallel' | 'fallback';
}

export interface ProviderSearchParams {
    imdbId: string;            // 'tt0111161'
    type: string;             // 'movie' | 'series'
    season?: string;
    episode?: string;
    langs: RequestedLang[];
}

// Wyzie aggregates many upstream sources; the user picks which ones to query.
// Tier labels mirror the Wyzie docs ("free" sources any key can use, the rest
// need a Pro key) but actual availability depends on the user's key.
export const WYZIE_SOURCES: Array<{ value: string; label: string }> = [
    { value: 'opensubtitles', label: 'OpenSubtitles (free)' },
    { value: 'tvsubtitles', label: 'TVSubtitles (free)' },
    { value: 'subdl', label: 'SubDL (pro)' },
    { value: 'subf2m', label: 'Subf2m (pro)' },
    { value: 'podnapisi', label: 'Podnapisi (pro)' },
    { value: 'gestdown', label: 'Gestdown — TV only (pro)' },
    { value: 'yify', label: 'YIFY — movies only (pro)' },
    { value: 'animetosho', label: 'AnimeTosho — anime (pro)' },
    { value: 'jimaku', label: 'Jimaku — anime (pro)' },
    { value: 'kitsunekko', label: 'Kitsunekko — anime (pro)' },
    { value: 'ajatttools', label: 'Ajatt-Tools — anime/drama (pro)' },
    { value: 'ai', label: 'AI translation (on-demand, lower quality)' }
];

// Single source of truth describing the optional providers, consumed by the
// manifest/config builder in src/index.ts so the install form and the fetch
// logic stay in sync.
export const OPTIONAL_PROVIDERS = {
    wyzie: {
        key: 'wyzieApiKey',
        sourcesKey: 'wyzieSources',
        title: 'Wyzie Subs API key',
        sourcesTitle: 'Wyzie sources',
        help: 'Optional. Free key works for free sources; a Pro key unlocks the rest.',
        sourcesHelp: 'Pick which Wyzie upstream sources to query. Leave all unchecked to use Wyzie\'s default (OpenSubtitles).',
        getKeyUrl: 'https://store.wyzie.io/redeem'
    },
    subsource: {
        key: 'subsourceApiKey',
        title: 'SubSource API key',
        help: 'Optional. Limits: 60 requests/min, 1,800/hour, 7,200/day. Generate a key from your SubSource profile.',
        getKeyUrl: 'https://subsource.net/'
    },
    mode: {
        key: 'optionalProviderMode',
        title: 'Optional providers mode',
        options: ['Fallback (only if defaults empty) [fallback]', 'Parallel (always query) [parallel]'],
        help: 'Fallback (default) only queries your provider keys when the built-in sources find nothing — saves API credit. Parallel pools provider results with the defaults every time for the best matches.'
    }
} as const;

function parseModeValue(raw: unknown): 'parallel' | 'fallback' {
    // Default to fallback (only query provider keys when the defaults come up empty)
    // to conserve the user's API credit; parallel must be chosen explicitly.
    const s = String(raw || '').toLowerCase();
    return s.includes('parallel') ? 'parallel' : 'fallback';
}

// Pull the optional-provider settings out of the decoded config object.
export function parseOptionalProviderConfig(configObj: any): OptionalProviderConfig {
    const wyzieSourcesRaw = configObj?.[OPTIONAL_PROVIDERS.wyzie.sourcesKey];
    const wyzieSources = typeof wyzieSourcesRaw === 'string'
        ? wyzieSourcesRaw.split(',').map((s: string) => s.trim().toLowerCase()).filter(Boolean)
        : Array.isArray(wyzieSourcesRaw)
            ? wyzieSourcesRaw.map((s: any) => String(s).trim().toLowerCase()).filter(Boolean)
            : [];

    return {
        wyzieKey: String(configObj?.[OPTIONAL_PROVIDERS.wyzie.key] || '').trim(),
        wyzieSources,
        subsourceKey: String(configObj?.[OPTIONAL_PROVIDERS.subsource.key] || '').trim(),
        mode: parseModeValue(configObj?.[OPTIONAL_PROVIDERS.mode.key])
    };
}

export function hasAnyOptionalProvider(cfg: OptionalProviderConfig): boolean {
    return Boolean(cfg.wyzieKey || cfg.subsourceKey);
}

// Build the {code3, code2, name} triples the providers need from the addon's
// 3-letter codes + English names. Caller supplies the English-name lookup so
// this module stays decoupled from index.ts's languageMap.
export async function resolveRequestedLangs(
    codes3: string[],
    nameOf: (code3: string) => string
): Promise<RequestedLang[]> {
    const seen = new Set<string>();
    const out: RequestedLang[] = [];
    for (const code3 of codes3) {
        if (!code3 || seen.has(code3)) continue;
        seen.add(code3);
        const code2 = (await normalizeLanguageCode(code3)) || code3.toLowerCase();
        out.push({ code3, code2, name: (nameOf(code3) || code3).toLowerCase() });
    }
    return out;
}

// `emptyStatuses` lets a caller treat certain non-2xx codes as "no results"
// (returns null) rather than an error — some providers (Wyzie) return HTTP 400/404
// with a "No subtitles found" body instead of an empty list.
async function fetchJson(url: string, headers: Record<string, string> = {}, emptyStatuses: number[] = []): Promise<any> {
    const res = await fetch(url, {
        headers: { 'Accept': 'application/json', ...headers },
        signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS)
    });
    if (!res.ok) {
        if (emptyStatuses.includes(res.status)) return null;
        // Redact the API key before it reaches the logs.
        throw new Error(`${redactUrlForLog(url)} responded with ${res.status}`);
    }
    return await res.json();
}

function extOf(name: string | undefined): string | undefined {
    if (!name) return undefined;
    const m = /\.([a-z0-9]{2,4})(?:\?|#|$)/i.exec(name);
    return m ? m[1].toLowerCase() : undefined;
}

// Redact API keys carried in the query string (e.g. Wyzie's ?key=) before logging.
function redactUrlForLog(url: string): string {
    return url.replace(/([?&](?:key|api_key)=)[^&]+/gi, '$1***');
}

function logProviderUrl(provider: string, url: string): void {
    console.log(`[${provider}] GET ${redactUrlForLog(url)}`);
}

// ---------------------------------------------------------------------------
// Wyzie  (https://sub.wyzie.io/search) — returns direct, non-zip subtitle URLs.
// ---------------------------------------------------------------------------
async function fetchWyzie(params: ProviderSearchParams, cfg: OptionalProviderConfig): Promise<ProviderSub[]> {
    if (!cfg.wyzieKey) return [];

    const langByCode2 = new Map<string, string[]>();
    for (const l of params.langs) {
        const arr = langByCode2.get(l.code2) || [];
        arr.push(l.code3);
        langByCode2.set(l.code2, arr);
    }

    const qs = new URLSearchParams();
    qs.set('id', params.imdbId);
    qs.set('language', params.langs.map(l => l.code2).join(','));
    if (params.type === 'series' && params.season && params.episode) {
        qs.set('season', params.season);
        qs.set('episode', params.episode);
    }
    const aiEnabled = cfg.wyzieSources.includes('ai');
    if (cfg.wyzieSources.length > 0) {
        qs.set('source', cfg.wyzieSources.join(','));
    }
    qs.set('key', cfg.wyzieKey);

    const wyzieUrl = `https://sub.wyzie.io/search?${qs.toString()}`;
    logProviderUrl('wyzie', wyzieUrl);
    // Wyzie returns 400/404 with "No subtitles found" when there are simply no
    // matches — treat those as an empty result, not a failure.
    const data = await fetchJson(wyzieUrl, {}, [400, 404]);
    const items: any[] = Array.isArray(data) ? data : Array.isArray(data?.subtitles) ? data.subtitles : [];

    const out: ProviderSub[] = [];
    for (const item of items) {
        if (!item?.url) continue;
        if (item.ai === true && !aiEnabled) continue;
        const code2 = String(item.language || '').toLowerCase();
        const code3s = langByCode2.get(code2);
        if (!code3s) continue;
        const release = item.release || item.fileName || item.media || 'Wyzie';
        const format = String(item.format || extOf(item.fileName) || 'srt').toLowerCase();
        for (const code3 of code3s) {
            out.push({
                id: `wyzie-${item.id ?? out.length}`,
                url: item.url,
                lang: code3,
                g: Number(item.downloadCount) || 0,
                format,
                releaseName: `Wyzie/${item.source || '?'}: ${release}`,
                provider: 'wyzie'
            });
        }
    }
    return out.slice(0, MAX_RESULTS_PER_PROVIDER);
}

// Note: a direct SubDL provider used to live here, but SubDL's free API sits
// behind a Cloudflare WAF that hard-403s server-side requests (no solvable
// challenge), so it was removed. SubDL coverage is still available indirectly via
// Wyzie's `subdl` source.

// ---------------------------------------------------------------------------
// SubSource (https://api.subsource.net) — X-API-Key header; downloads are always
// a ZIP, extracted by fetchSubtitleContent() at download time (no proxy route).
// Series are modeled as season packs; the episode hint is carried so the right
// file is picked out of the zip.
// ---------------------------------------------------------------------------
async function subsourceMovieId(params: ProviderSearchParams, apiKey: string): Promise<number | null> {
    const qs = new URLSearchParams();
    qs.set('searchType', 'imdb');
    qs.set('imdb', params.imdbId);
    qs.set('type', params.type === 'series' ? 'series' : 'movie');
    if (params.type === 'series' && params.season) qs.set('season', params.season);

    const movieSearchUrl = `https://api.subsource.net/api/v1/movies/search?${qs.toString()}`;
    logProviderUrl('subsource', movieSearchUrl);
    // 404 = title not on SubSource; treat as "no match" rather than a failure.
    const data = await fetchJson(movieSearchUrl, { 'X-API-Key': apiKey }, [400, 404]);
    const list: any[] = Array.isArray(data?.data) ? data.data : Array.isArray(data) ? data : [];
    if (list.length === 0) return null;

    if (params.type === 'series' && params.season) {
        // A specific season was requested — only use an exact season match.
        // Falling back to "whatever came back first" risks pulling a different
        // season's movieId, which then makes every subtitle/episode lookup below
        // silently mismatched.
        const wanted = parseInt(params.season, 10);
        const bySeason = list.find(m => Number(m.season) === wanted);
        return bySeason?.movieId != null ? Number(bySeason.movieId) : null;
    }
    const first = list.find(m => m?.movieId != null);
    return first ? Number(first.movieId) : null;
}

async function fetchSubsource(params: ProviderSearchParams, cfg: OptionalProviderConfig): Promise<ProviderSub[]> {
    if (!cfg.subsourceKey) return [];

    const movieId = await subsourceMovieId(params, cfg.subsourceKey);
    if (movieId == null) return [];

    const out: ProviderSub[] = [];
    // The API has no per-episode filter — a series movieId is a whole season,
    // so subtitles for it are season packs we later pick an episode's file out
    // of (see extractSubtitleFromZip). Fetch the max page size for series so
    // that episode-matching at download time has enough candidates to search
    // through instead of getting starved by a handful of "popular" results
    // that happen not to contain the requested episode.
    const isEpisodeLookup = params.type === 'series' && Boolean(params.season && params.episode);
    const perLangLimit = isEpisodeLookup ? 100 : 30;
    // Season-pack candidates are only metadata until one is actually chosen for
    // download, so it's cheap to keep more of them around for episode-matching;
    // non-episode lookups keep the normal provider cap.
    const perLangOutputCap = isEpisodeLookup ? 50 : MAX_RESULTS_PER_PROVIDER;

    // SubSource's subtitles endpoint takes a single language, so query per lang.
    // Cap results per-language (not on the combined list) so a language with
    // lots of hits can't crowd out a second language's results entirely.
    for (const lang of params.langs) {
        const qs = new URLSearchParams();
        qs.set('movieId', String(movieId));
        qs.set('language', lang.name);
        qs.set('limit', String(perLangLimit));
        qs.set('sort', 'popular');

        const subtitlesUrl = `https://api.subsource.net/api/v1/subtitles?${qs.toString()}`;
        logProviderUrl('subsource', subtitlesUrl);

        let data: any;
        try {
            data = await fetchJson(subtitlesUrl, { 'X-API-Key': cfg.subsourceKey });
        } catch {
            continue;
        }

        const items: any[] = Array.isArray(data?.data) ? data.data : Array.isArray(data) ? data : [];
        const langOut: ProviderSub[] = [];
        for (const item of items) {
            const subtitleId = item?.subtitleId ?? item?.id;
            if (subtitleId == null) continue;
            const release = Array.isArray(item.releaseInfo) ? item.releaseInfo.join(' ') : (item.releaseInfo || 'SubSource');
            langOut.push({
                id: `subsource-${subtitleId}`,
                url: `https://api.subsource.net/api/v1/subtitles/${encodeURIComponent(String(subtitleId))}/download`,
                lang: lang.code3,
                g: Number(item.downloads) || 0,
                format: 'srt',
                releaseName: `SubSource: ${release}`,
                provider: 'subsource',
                apiKey: cfg.subsourceKey,
                season: params.season,
                episode: params.episode
            });
        }
        out.push(...langOut.slice(0, perLangOutputCap));
    }
    return out;
}

// Query every enabled optional provider in parallel and pool the results.
// Each provider is isolated: a rejection or timeout yields no subs for that
// provider but never throws.
export async function fetchOptionalProviderSubtitles(
    params: ProviderSearchParams,
    cfg: OptionalProviderConfig
): Promise<ProviderSub[]> {
    if (!hasAnyOptionalProvider(cfg) || params.langs.length === 0) return [];

    const tasks: Array<{ name: string; promise: Promise<ProviderSub[]> }> = [];
    if (cfg.wyzieKey) tasks.push({ name: 'Wyzie', promise: fetchWyzie(params, cfg) });
    if (cfg.subsourceKey) tasks.push({ name: 'SubSource', promise: fetchSubsource(params, cfg) });

    const settled = await Promise.allSettled(tasks.map(t => t.promise));
    const all: ProviderSub[] = [];
    const summary: string[] = [];
    settled.forEach((r, i) => {
        const name = tasks[i].name;
        if (r.status === 'fulfilled') {
            all.push(...r.value);
            summary.push(`${name}: ${r.value.length}`);
        } else {
            summary.push(`${name}: failed (${r.reason?.message || r.reason})`);
        }
    });
    console.log(`[optional] ${summary.join(', ')} — ${all.length} total`);
    return all;
}
