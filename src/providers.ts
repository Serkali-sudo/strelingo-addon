import { normalizeLanguageCode } from './encoding';
import { cloudscraperFetch, describeCloudflareBlock } from './cloudscraper';

// ---------------------------------------------------------------------------
// Optional, API-key-gated subtitle providers (SubDL, Wyzie, SubSource).
//
// These are layered ON TOP of the addon's two built-in, key-less sources
// (OpenSubtitles + Buta-no-subs) which live in src/index.ts and are NOT touched
// here. Each provider only runs when the user supplies its API key in the addon
// config. Every provider call is isolated (try/catch + timeout) so a failing or
// slow provider can never break a subtitle request.
// ---------------------------------------------------------------------------

const PROVIDER_TIMEOUT_MS = 12000;
const MAX_RESULTS_PER_PROVIDER = 20;

// Provider hosts (SubDL, dl.subdl.com) sit behind Cloudflare, whose WAF 403s
// requests that don't look like a real browser. All provider HTTP traffic goes
// through cloudscraperFetch(), which supplies a rotating browser header profile.

// A resolved language the caller wants, in the three forms the providers need.
export interface RequestedLang {
    code3: string;   // addon-internal 3-letter code, e.g. 'eng', 'pob'
    code2: string;   // ISO 639-1 2-letter, e.g. 'en'   (Wyzie / SubDL)
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
    subdlKey: string;
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
    subdl: {
        key: 'subdlApiKey',
        title: 'SubDL API key',
        help: 'Optional. Free tier: 2,000 searches/day, 50 downloads/day.',
        getKeyUrl: 'https://subdl.com/panel/api'
    },
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
        options: ['Parallel (always query) [parallel]', 'Fallback (only if defaults empty) [fallback]'],
        help: 'Parallel pools provider results with the defaults every time (best matches). Fallback only queries them when the built-in sources find nothing.'
    }
} as const;

function parseModeValue(raw: unknown): 'parallel' | 'fallback' {
    const s = String(raw || '').toLowerCase();
    return s.includes('fallback') ? 'fallback' : 'parallel';
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
        subdlKey: String(configObj?.[OPTIONAL_PROVIDERS.subdl.key] || '').trim(),
        wyzieKey: String(configObj?.[OPTIONAL_PROVIDERS.wyzie.key] || '').trim(),
        wyzieSources,
        subsourceKey: String(configObj?.[OPTIONAL_PROVIDERS.subsource.key] || '').trim(),
        mode: parseModeValue(configObj?.[OPTIONAL_PROVIDERS.mode.key])
    };
}

export function hasAnyOptionalProvider(cfg: OptionalProviderConfig): boolean {
    return Boolean(cfg.subdlKey || cfg.wyzieKey || cfg.subsourceKey);
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

async function fetchJson(url: string, headers: Record<string, string> = {}): Promise<any> {
    // cloudscraperFetch supplies the rotating browser header profile; we only add
    // caller-specific headers (e.g. SubSource's X-API-Key).
    const res = await cloudscraperFetch(url, {
        headers,
        signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS)
    });
    if (!res.ok) {
        // Surface *what kind* of block this is so we know if it's bypassable.
        let detail = '';
        try {
            const body = await res.text();
            const kind = describeCloudflareBlock(res.status, body);
            if (kind) detail = ` [Cloudflare: ${kind}]`;
        } catch { /* ignore body read errors */ }
        throw new Error(`${url} responded with ${res.status}${detail}`);
    }
    return await res.json();
}

function extOf(name: string | undefined): string | undefined {
    if (!name) return undefined;
    const m = /\.([a-z0-9]{2,4})(?:\?|#|$)/i.exec(name);
    return m ? m[1].toLowerCase() : undefined;
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

    const data = await fetchJson(`https://sub.wyzie.io/search?${qs.toString()}`);
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

// ---------------------------------------------------------------------------
// SubDL  (https://api.subdl.com/api/v1) — the public API: key goes in the
// `api_key` query param. A subtitle's top-level `url` is a zip
// ("/subtitle/xxx-yyy.zip"); with unpack=1, packed/full-season subtitles also
// expose `unpack_files[]` with direct raw single-file URLs
// ("/subtitle/{n_id}/{file_n_id}") plus per-file language/season/episode/format —
// which we prefer so we can hand back the exact episode without unzipping.
// ---------------------------------------------------------------------------
function subdlDownloadUrl(rawUrl: unknown): string | null {
    if (typeof rawUrl === 'string' && rawUrl) {
        if (/^https?:\/\//i.test(rawUrl)) return rawUrl;
        return `https://dl.subdl.com${rawUrl.startsWith('/') ? '' : '/'}${rawUrl}`;
    }
    return null;
}

async function fetchSubdl(params: ProviderSearchParams, cfg: OptionalProviderConfig): Promise<ProviderSub[]> {
    if (!cfg.subdlKey) return [];

    const qs = new URLSearchParams();
    qs.set('api_key', cfg.subdlKey);
    qs.set('imdb_id', params.imdbId);
    // SubDL v1 expects upper-case 2-letter codes, e.g. EN,TR.
    qs.set('languages', params.langs.map(l => l.code2.toUpperCase()).join(','));
    qs.set('subs_per_page', '30');
    qs.set('unpack', '1');
    if (params.type === 'series' && params.season) {
        qs.set('type', 'tv');
        qs.set('season_number', params.season);
        if (params.episode) qs.set('episode_number', params.episode);
    } else {
        qs.set('type', 'movie');
    }

    const data = await fetchJson(`https://api.subdl.com/api/v1/subtitles?${qs.toString()}`);
    if (data && data.status === false) {
        throw new Error(`SubDL error: ${data.error || 'request rejected'}`);
    }
    const items: any[] = Array.isArray(data?.subtitles) ? data.subtitles : [];

    const wantSeason = params.season ? parseInt(params.season, 10) : null;
    const wantEpisode = params.episode ? parseInt(params.episode, 10) : null;
    // v1 returns `language` as an upper-case code (e.g. "EN") and `lang` as the
    // full name (e.g. "english"); match against whichever a record carries.
    const matchLang = (code: unknown, name?: unknown): RequestedLang | undefined => {
        const up = String(code || '').toUpperCase();
        const low = String(name || '').toLowerCase();
        return params.langs.find(l =>
            (up && l.code2.toUpperCase() === up) || (low && (l.name === low || l.code3 === low)));
    };

    const out: ProviderSub[] = [];
    for (const item of items) {
        const files: any[] | null = Array.isArray(item.unpack_files) ? item.unpack_files : null;

        if (files && files.length) {
            // Packed/full-season subtitle: use the pre-extracted single files.
            for (const f of files) {
                const match = matchLang(f.language, f.lang);
                if (!match) continue;
                // For a specific episode, keep only that episode's file.
                if (params.type === 'series' && wantEpisode != null) {
                    if (Number(f.episode) !== wantEpisode) continue;
                    if (wantSeason != null && f.season != null && Number(f.season) !== wantSeason) continue;
                }
                const url = subdlDownloadUrl(f.url);
                if (!url) continue;
                out.push({
                    id: `subdl-${f.file_n_id ?? out.length}`,
                    url,
                    lang: match.code3,
                    g: 0,
                    format: String(f.format || 'srt').toLowerCase(),
                    releaseName: `SubDL: ${f.release_name || f.name || item.release_name || 'pack'}`,
                    provider: 'subdl'
                    // Direct raw file — no zip/episode hint needed.
                });
                if (out.length >= MAX_RESULTS_PER_PROVIDER) break;
            }
        } else {
            // Single subtitle: the top-level url is a zip. fetchSubtitleContent()
            // auto-unzips it, using the episode hint to pick the file for packs.
            const match = matchLang(item.language, item.lang);
            if (!match) continue;
            const url = subdlDownloadUrl(item.url);
            if (!url) continue;
            out.push({
                id: `subdl-${item.url || out.length}`,
                url,
                lang: match.code3,
                g: Number(item.downloads) || 0,
                format: 'srt',
                releaseName: `SubDL: ${item.release_name || item.name || 'SubDL'}`,
                provider: 'subdl',
                season: params.season,
                episode: params.episode
            });
        }
        if (out.length >= MAX_RESULTS_PER_PROVIDER) break;
    }
    return out.slice(0, MAX_RESULTS_PER_PROVIDER);
}

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

    const data = await fetchJson(
        `https://api.subsource.net/api/v1/movies/search?${qs.toString()}`,
        { 'X-API-Key': apiKey }
    );
    const list: any[] = Array.isArray(data?.data) ? data.data : Array.isArray(data) ? data : [];
    if (list.length === 0) return null;

    if (params.type === 'series' && params.season) {
        const wanted = parseInt(params.season, 10);
        const bySeason = list.find(m => Number(m.season) === wanted);
        if (bySeason?.movieId != null) return Number(bySeason.movieId);
    }
    const first = list.find(m => m?.movieId != null);
    return first ? Number(first.movieId) : null;
}

async function fetchSubsource(params: ProviderSearchParams, cfg: OptionalProviderConfig): Promise<ProviderSub[]> {
    if (!cfg.subsourceKey) return [];

    const movieId = await subsourceMovieId(params, cfg.subsourceKey);
    if (movieId == null) return [];

    const out: ProviderSub[] = [];
    // SubSource's subtitles endpoint takes a single language, so query per lang.
    for (const lang of params.langs) {
        const qs = new URLSearchParams();
        qs.set('movieId', String(movieId));
        qs.set('language', lang.name);
        qs.set('limit', '30');
        qs.set('sort', 'popular');

        let data: any;
        try {
            data = await fetchJson(
                `https://api.subsource.net/api/v1/subtitles?${qs.toString()}`,
                { 'X-API-Key': cfg.subsourceKey }
            );
        } catch {
            continue;
        }

        const items: any[] = Array.isArray(data?.data) ? data.data : Array.isArray(data) ? data : [];
        for (const item of items) {
            const subtitleId = item?.subtitleId ?? item?.id;
            if (subtitleId == null) continue;
            const release = Array.isArray(item.releaseInfo) ? item.releaseInfo.join(' ') : (item.releaseInfo || 'SubSource');
            out.push({
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
    }
    return out.slice(0, MAX_RESULTS_PER_PROVIDER);
}

// Query every enabled optional provider in parallel and pool the results.
// Each provider is isolated: a rejection or timeout yields no subs for that
// provider but never throws.
export async function fetchOptionalProviderSubtitles(
    params: ProviderSearchParams,
    cfg: OptionalProviderConfig
): Promise<ProviderSub[]> {
    if (!hasAnyOptionalProvider(cfg) || params.langs.length === 0) return [];

    const tasks: Array<Promise<ProviderSub[]>> = [];
    if (cfg.wyzieKey) tasks.push(fetchWyzie(params, cfg));
    if (cfg.subdlKey) tasks.push(fetchSubdl(params, cfg));
    if (cfg.subsourceKey) tasks.push(fetchSubsource(params, cfg));

    const settled = await Promise.allSettled(tasks);
    const all: ProviderSub[] = [];
    for (const r of settled) {
        if (r.status === 'fulfilled') {
            all.push(...r.value);
        } else {
            console.warn('Optional provider failed:', r.reason?.message || r.reason);
        }
    }
    console.log(`Optional providers returned ${all.length} subtitle candidate(s).`);
    return all;
}
