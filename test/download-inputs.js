/**
 * Download subtitle test inputs from Wyzie.
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

const INPUTS_DIR = path.join(__dirname, 'inputs');
const MAX_PER_LANG = 3;  // Max subtitles per language
const DOWNLOAD_TIMEOUT = 10000;  // 10s timeout per download
const MAX_RETRIES = 2;  // Max retries per subtitle

// Parse command line for specific movie ID
const targetId = process.argv[2];

function detectBOM(buffer) {
    if (buffer.length < 2) return 'none';
    if (buffer.length >= 4 && buffer[0] === 0xC3 && buffer[1] === 0xBF && buffer[2] === 0xC3 && buffer[3] === 0xBE) return 'double-encoded-utf16le';
    if (buffer.length >= 4 && buffer[0] === 0xC3 && buffer[1] === 0xBE && buffer[2] === 0xC3 && buffer[3] === 0xBF) return 'double-encoded-utf16be';
    if (buffer[0] === 0xFF && buffer[1] === 0xFE) return 'utf16le';
    if (buffer[0] === 0xFE && buffer[1] === 0xFF) return 'utf16be';
    if (buffer.length >= 3 && buffer[0] === 0xEF && buffer[1] === 0xBB && buffer[2] === 0xBF) return 'utf8-bom';
    if (buffer.length >= 6 && buffer[0] === 0xC3 && buffer[1] === 0xAF && buffer[2] === 0xC2 && buffer[3] === 0xBB) return 'double-encoded-utf8-bom';
    return 'none';
}

async function downloadMovie(movie) {
    console.log(`\n${'='.repeat(60)}`);
    console.log(`Downloading: ${movie.name} (${movie.id})`);
    console.log('='.repeat(60));

    const movieDir = path.join(INPUTS_DIR, movie.id);
    if (!fs.existsSync(movieDir)) {
        fs.mkdirSync(movieDir, { recursive: true });
    }

    // Fetch ALL subtitles at once (no language filter)
    console.log(`\nFetching all available subtitles...`);
    const searchUrl = `https://sub.wyzie.ru/search?id=${movie.id}&source=all`;

    let allSubs;
    try {
        const response = await axios.get(searchUrl, { timeout: 120000 });
        allSubs = response.data;
        console.log(`Found ${allSubs.length} total subtitles`);
    } catch (err) {
        console.error(`Search failed: ${err.message}`);
        return;
    }

    if (!allSubs || allSubs.length === 0) {
        console.log('No subtitles found');
        return;
    }

    // Group by language
    const byLang = {};
    for (const sub of allSubs) {
        const lang = sub.language || 'unknown';
        if (!byLang[lang]) byLang[lang] = [];
        byLang[lang].push(sub);
    }

    console.log(`Languages available: ${Object.keys(byLang).join(', ')}\n`);

    const manifest = {
        imdbId: movie.id,
        name: movie.name,
        downloadedAt: new Date().toISOString(),
        subtitles: []
    };

    // Build download queue with all subtitles to download
    const downloadQueue = [];
    for (const [lang, subs] of Object.entries(byLang)) {
        const toDownload = subs.slice(0, MAX_PER_LANG);
        for (let i = 0; i < toDownload.length; i++) {
            const subInfo = toDownload[i];
            const safeLang = lang.replace(/[\/\\]/g, '-');
            const filename = `${safeLang}_${i + 1}_${subInfo.source || 'unknown'}.raw`;
            downloadQueue.push({
                lang,
                safeLang,
                filename,
                filepath: path.join(movieDir, filename),
                url: subInfo.url,
                source: subInfo.source,
                retries: 0
            });
        }
    }

    console.log(`Downloading ${downloadQueue.length} subtitles...\n`);

    // Process queue with retry logic
    let successCount = 0;
    let failCount = 0;

    while (downloadQueue.length > 0) {
        const item = downloadQueue.shift();

        try {
            const response = await axios.get(item.url, {
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
                bom: detectBOM(buffer),
                expectedStrings: movie.expectedStrings[item.lang] || []
            });

            console.log(`  ✓ ${item.lang}: ${item.filename} (${buffer.length} bytes)`);
            successCount++;
        } catch (err) {
            if (item.retries < MAX_RETRIES) {
                item.retries++;
                console.log(`  ⟳ ${item.lang}: ${item.filename} - ${err.message} (retry ${item.retries}/${MAX_RETRIES})`);
                // Add back to end of queue for retry
                downloadQueue.push(item);
            } else {
                console.log(`  ✗ ${item.lang}: ${item.filename} - ${err.message} (gave up after ${MAX_RETRIES} retries)`);
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
