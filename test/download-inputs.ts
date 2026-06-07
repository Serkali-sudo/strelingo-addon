/**
 * Download subtitle test inputs from OpenSubtitles v3 API (same source as production).
 * Downloads ALL available languages at once (much faster than one-by-one).
 * Saves raw bytes to preserve encoding issues for testing.
 *
 * Usage:
 *   npx tsx test/download-inputs.ts           # Download all movies in movies.ts
 *   npx tsx test/download-inputs.ts tt1375666 # Download specific movie by IMDB ID
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import movies from './movies';
import type { MovieConfig } from './movies';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const INPUTS_DIR = path.join(__dirname, 'inputs');
const MAX_PER_LANG = 3;
const DOWNLOAD_TIMEOUT = 10000;
const MAX_RETRIES = 2;

const OPENSUBTITLES_API = 'https://opensubtitles-v3.strem.io/subtitles';

const targetId = process.argv[2];

function formatMs(ms: number): string {
    if (ms < 1000) return `${ms}ms`;
    return `${(ms / 1000).toFixed(2)}s`;
}

interface SubtitleApiObject {
    id: string;
    url: string;
    lang: string;
    downloads?: number;
}

interface DownloadQueueItem {
    lang: string;
    safeLang: string;
    filename: string;
    filepath: string;
    url: string;
    source: string;
    apiObject: SubtitleApiObject;
    retries: number;
}

interface Manifest {
    imdbId: string;
    name: string;
    subtitles: ManifestSubtitle[];
}

interface ManifestSubtitle {
    filename: string;
    language: string;
    source: string;
    size: number;
    downloadedAt: string;
    url: string;
    downloadTimeMs: number;
}

async function downloadMovie(movie: MovieConfig): Promise<void> {
    console.log(`\n${'='.repeat(60)}`);
    console.log(`Downloading: ${movie.name} (${movie.id})`);
    console.log('='.repeat(60));

    const movieDir = path.join(INPUTS_DIR, movie.id);
    if (!fs.existsSync(movieDir)) {
        fs.mkdirSync(movieDir, { recursive: true });
    }

    const type = movie.type === 'series' ? 'series' : 'movie';
    let searchUrl: string;

    if (type === 'series' && movie.season && movie.episode) {
        searchUrl = `${OPENSUBTITLES_API}/${type}/${movie.id}:${movie.season}:${movie.episode}.json`;
    } else {
        searchUrl = `${OPENSUBTITLES_API}/${type}/${movie.id}:0.json`;
    }

    console.log(`\nFetching subtitles from: ${searchUrl}`);

    let allSubs: SubtitleApiObject[];
    try {
        const startTime = Date.now();
        const response = await fetch(searchUrl, {
            signal: AbortSignal.timeout(120000)
        });
        if (!response.ok) throw new Error(`API responded with ${response.status}`);
        const data = await response.json() as { subtitles?: SubtitleApiObject[] };
        allSubs = data.subtitles || [];
        console.log(`Found ${allSubs.length} total subtitles (${formatMs(Date.now() - startTime)})`);
    } catch (err: any) {
        console.error(`Search failed: ${err.message}`);
        return;
    }

    if (!allSubs || allSubs.length === 0) {
        console.log('No subtitles found');
        return;
    }

    const byLang: Record<string, SubtitleApiObject[]> = {};
    for (const sub of allSubs) {
        const lang = sub.lang || 'unknown';
        if (!byLang[lang]) byLang[lang] = [];
        byLang[lang].push(sub);
    }

    console.log(`Languages available: ${Object.keys(byLang).join(', ')}\n`);

    const manifest: Manifest = {
        imdbId: movie.id,
        name: movie.name,
        subtitles: []
    };

    const downloadQueue: DownloadQueueItem[] = [];
    for (const [lang, subs] of Object.entries(byLang)) {
        const toDownload = subs.slice(0, MAX_PER_LANG);
        for (let i = 0; i < toDownload.length; i++) {
            const subInfo = toDownload[i];
            const safeLang = lang.replace(/[\/\\]/g, '-');
            const filename = `${safeLang}_${i + 1}_opensubtitles.raw`;
            downloadQueue.push({
                lang,
                safeLang,
                filename,
                filepath: path.join(movieDir, filename),
                url: subInfo.url,
                source: 'opensubtitles',
                apiObject: subInfo,
                retries: 0
            });
        }
    }

    console.log(`Downloading ${downloadQueue.length} subtitles (limiting results to a max of ${MAX_PER_LANG} subtitles per language)...\n`);

    let successCount = 0;
    let failCount = 0;

    while (downloadQueue.length > 0) {
        const item = downloadQueue.shift()!;

        try {
            const startTime = Date.now();
            const response = await fetch(item.url, {
                signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT)
            });
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            const arrayBuffer = await response.arrayBuffer();
            const buffer = Buffer.from(arrayBuffer);
            const elapsed = Date.now() - startTime;

            fs.writeFileSync(item.filepath, buffer);

            manifest.subtitles.push({
                filename: item.filename,
                language: item.lang,
                source: item.source,
                size: buffer.length,
                downloadedAt: new Date().toISOString(),
                url: item.url,
                downloadTimeMs: elapsed
            });

            console.log(`  ✓ ${item.lang}: ${item.filename} (${buffer.length} bytes, ${formatMs(elapsed)})`);
            successCount++;
        } catch (err: any) {
            if (item.retries < MAX_RETRIES) {
                item.retries++;
                console.log(`  ⟳ ${item.lang}: ${item.filename} - ${err.message} (retry ${item.retries}/${MAX_RETRIES})`);
                downloadQueue.push(item);
            } else {
                console.log(`  ✗ ${item.lang}: ${item.filename} - ${err.message} (gave up after ${MAX_RETRIES} retries)`);
                failCount++;
            }
        }

        await new Promise(r => setTimeout(r, 100));
    }

    const manifestPath = path.join(movieDir, 'manifest.json');
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
    console.log(`\nSaved: ${successCount} subtitles in ${Object.keys(byLang).length} languages`);
    if (failCount > 0) {
        console.log(`Failed: ${failCount} subtitles`);
    }
}

async function main(): Promise<void> {
    console.log('Subtitle Input Downloader\n');

    let moviesToDownload = targetId
        ? movies.filter(m => m.id === targetId)
        : movies;

    if (moviesToDownload.length === 0 && targetId) {
        console.log(`Movie ${targetId} not in movies.ts, downloading anyway...`);
        moviesToDownload = [{ id: targetId, name: targetId }];
    }

    for (const movie of moviesToDownload) {
        await downloadMovie(movie);
    }

    console.log('\n\nDone!');
}

main().catch(console.error);