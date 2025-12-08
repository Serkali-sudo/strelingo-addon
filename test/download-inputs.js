/**
 * Download subtitle test inputs from OpenSubtitles v3 API (same source as production).
 * Downloads ALL available languages at once (much faster than one-by-one).
 * Saves raw bytes to preserve encoding issues for testing.
 *
 * Usage:
 *   node test/download-inputs.js           # Download all movies in movies.js
 *   node test/download-inputs.js tt1375666 # Download specific movie by IMDB ID
 */

const axios = require('axios');
const fs = require('fs');
const path = require('path');
const movies = require('./movies');

// Create axios instance with timing interceptors
const http = axios.create();

// Add timing data to each request
http.interceptors.request.use((config) => {
    config.metadata = { startTime: Date.now() };
    return config;
});

http.interceptors.response.use(
    (response) => {
        const endTime = Date.now();
        response.timing = {
            totalMs: endTime - response.config.metadata.startTime
        };
        return response;
    },
    (error) => {
        if (error.config?.metadata?.startTime) {
            error.timing = {
                totalMs: Date.now() - error.config.metadata.startTime
            };
        }
        return Promise.reject(error);
    }
);

function formatMs(ms) {
    if (ms < 1000) return `${ms}ms`;
    return `${(ms / 1000).toFixed(2)}s`;
}

const INPUTS_DIR = path.join(__dirname, 'inputs');
const MAX_PER_LANG = 3;  // Max subtitles per language
const DOWNLOAD_TIMEOUT = 10000;  // 10s timeout per download
const MAX_RETRIES = 2;  // Max retries per subtitle

// OpenSubtitles v3 API (same as production)
const OPENSUBTITLES_API = 'https://opensubtitles-v3.strem.io/subtitles';

// Parse command line for specific movie ID
const targetId = process.argv[2];

async function downloadMovie(movie) {
    console.log(`\n${'='.repeat(60)}`);
    console.log(`Downloading: ${movie.name} (${movie.id})`);
    console.log('='.repeat(60));

    const movieDir = path.join(INPUTS_DIR, movie.id);
    if (!fs.existsSync(movieDir)) {
        fs.mkdirSync(movieDir, { recursive: true });
    }

    // Build API URL (same format as production)
    // For movies: add :0 dummy hash to trigger full OpenSubtitles results
    // For series: season:episode already has colons, which triggers full results
    const type = movie.type === 'series' ? 'series' : 'movie';
    let searchUrl;

    if (type === 'series' && movie.season && movie.episode) {
        searchUrl = `${OPENSUBTITLES_API}/${type}/${movie.id}:${movie.season}:${movie.episode}.json`;
    } else {
        // Add :0 dummy hash for movies to get full results
        searchUrl = `${OPENSUBTITLES_API}/${type}/${movie.id}:0.json`;
    }

    console.log(`\nFetching subtitles from: ${searchUrl}`);

    let allSubs;
    try {
        const response = await http.get(searchUrl, { timeout: 120000 });
        allSubs = response.data?.subtitles || [];
        console.log(`Found ${allSubs.length} total subtitles (${formatMs(response.timing.totalMs)})`);
    } catch (err) {
        const timing = err.timing ? ` after ${formatMs(err.timing.totalMs)}` : '';
        console.error(`Search failed${timing}: ${err.message}`);
        return;
    }

    if (!allSubs || allSubs.length === 0) {
        console.log('No subtitles found');
        return;
    }

    // Group by language (API uses 3-letter 'lang' field)
    const byLang = {};
    for (const sub of allSubs) {
        const lang = sub.lang || 'unknown';
        if (!byLang[lang]) byLang[lang] = [];
        byLang[lang].push(sub);
    }

    console.log(`Languages available: ${Object.keys(byLang).join(', ')}\n`);

    const manifest = {
        imdbId: movie.id,
        name: movie.name,
        subtitles: []
    };

    // Build download queue with all subtitles to download
    const downloadQueue = [];
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
                apiObject: subInfo,  // Full API response object for this subtitle
                retries: 0
            });
        }
    }

    console.log(`Downloading ${downloadQueue.length} subtitles (limiting results to a max of ${MAX_PER_LANG} subtitles per language)...\n`);

    // Process queue with retry logic
    let successCount = 0;
    let failCount = 0;

    while (downloadQueue.length > 0) {
        const item = downloadQueue.shift();

        try {
            const response = await http.get(item.url, {
                responseType: 'arraybuffer',
                timeout: DOWNLOAD_TIMEOUT
            });

            const buffer = Buffer.from(response.data);
            fs.writeFileSync(item.filepath, buffer);

            manifest.subtitles.push({
                filename: item.filename,
                language: item.lang,
                source: item.source,
                size: buffer.length,
                downloadedAt: new Date().toISOString(),
                url: item.url,
                responseHeaders: response.headers,
                apiObject: item.apiObject,
                downloadTimeMs: response.timing.totalMs
            });

            console.log(`  ✓ ${item.lang}: ${item.filename} (${buffer.length} bytes, ${formatMs(response.timing.totalMs)})`);
            successCount++;
        } catch (err) {
            const timing = err.timing ? ` in ${formatMs(err.timing.totalMs)}` : '';
            if (item.retries < MAX_RETRIES) {
                item.retries++;
                console.log(`  ⟳ ${item.lang}: ${item.filename} - ${err.message}${timing} (retry ${item.retries}/${MAX_RETRIES})`);
                // Add back to end of queue for retry
                downloadQueue.push(item);
            } else {
                console.log(`  ✗ ${item.lang}: ${item.filename} - ${err.message}${timing} (gave up after ${MAX_RETRIES} retries)`);
                failCount++;
            }
        }

        // Small delay to be nice to the server
        await new Promise(r => setTimeout(r, 100));
    }

    const manifestPath = path.join(movieDir, 'manifest.json');
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
    console.log(`\nSaved: ${successCount} subtitles in ${Object.keys(byLang).length} languages`);
    if (failCount > 0) {
        console.log(`Failed: ${failCount} subtitles`);
    }
}

async function main() {
    console.log('Subtitle Input Downloader\n');

    // Filter movies if specific ID provided
    let moviesToDownload = targetId
        ? movies.filter(m => m.id === targetId)
        : movies;

    // Allow downloading any movie by ID even if not in movies.js
    if (moviesToDownload.length === 0 && targetId) {
        console.log(`Movie ${targetId} not in movies.js, downloading anyway...`);
        moviesToDownload = [{ id: targetId, name: targetId, expectedStrings: {} }];
    }

    for (const movie of moviesToDownload) {
        await downloadMovie(movie);
    }

    console.log('\n\nDone!');
}

main().catch(console.error);
