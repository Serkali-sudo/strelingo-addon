import imdbMappingData from './data/imdb_mapping.json';

// One entry of static/data/imdb_mapping.json (sourced from the Anime Kitsu addon).
interface RawMappingEntry {
    kitsu_id: number | string;
    imdb_id?: string;
    title?: string;
    fromSeason?: number;
    fromEpisode?: number;
    nonImdbEpisodes?: number[];
}

export interface KitsuImdbResult {
    imdbid: string;   // numeric IMDb id, without the leading "tt"
    season?: string;
    episode?: string;
}

// Build a kitsu_id -> mapping entry lookup once at module load.
const kitsuToImdb = new Map<string, RawMappingEntry>();
for (const entry of imdbMappingData as RawMappingEntry[]) {
    if (entry && entry.imdb_id) {
        kitsuToImdb.set(String(entry.kitsu_id), entry);
    }
}

// Resolves a Kitsu numeric id (+ absolute episode number for series) to an IMDb id/season/episode.
// Mirrors the Anime Kitsu addon's static mapping (its "simple" path):
//   imdbSeason  = fromSeason  (default 1)
//   imdbEpisode = fromEpisode (default 1) - 1 + kitsuEpisode
// The upstream addon additionally re-splits absolute episodes across multiple IMDb seasons using
// live Cinemeta episode counts; we intentionally skip that (and the lone nonImdbEpisodes entry) to
// stay dependency-free. This is correct for the common case where each Kitsu entry maps to a single
// IMDb season, which is how the dataset is structured (sequels get their own entry + fromSeason).
export function resolveKitsuToImdb(kitsuNumericId: string, kitsuEpisode?: number): KitsuImdbResult | null {
    const entry = kitsuToImdb.get(String(kitsuNumericId));
    if (!entry || !entry.imdb_id) return null;

    const imdbid = entry.imdb_id.replace(/^tt/, '');

    if (!Number.isInteger(kitsuEpisode)) {
        return { imdbid };
    }

    const fromSeason = Number.isInteger(entry.fromSeason) ? (entry.fromSeason as number) : 1;
    const fromEpisode = Number.isInteger(entry.fromEpisode) ? (entry.fromEpisode as number) : 1;

    return {
        imdbid,
        season: String(fromSeason),
        episode: String(fromEpisode - 1 + (kitsuEpisode as number))
    };
}
