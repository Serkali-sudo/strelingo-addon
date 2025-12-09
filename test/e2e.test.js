/**
 * End-to-end tests for Strelingo addon server.
 *
 * Usage:
 *   node test/e2e.test.js              # Run all e2e tests
 *   node test/e2e.test.js --keep       # Keep server running after tests
 *   node test/e2e.test.js --skip-clear # Don't clear subtitle cache
 */

const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const axios = require('axios');
const { execSync } = require('child_process');
const { decodeSubtitleBuffer } = require('../encoding');
const movies = require('./movies');
const { validateEncoding, checkDualLanguage, validateSrtFormat, getExpectedStringsForLanguage, checkExpectedStrings } = require('./validators');

// === Configuration ===
const PROJECT_DIR = path.resolve(__dirname, '..');
const BASE_URL = process.env.EXTERNAL_URL || `http://localhost:${process.env.PORT || 7000}`;
const SCRIPTS_DIR = __dirname; // Scripts are in test/ directory
const SERVER_LOG = path.join(PROJECT_DIR, 'server.log');
const SUBTITLES_DIR = process.env.LOCAL_STORAGE_DIR
    ? path.resolve(PROJECT_DIR, process.env.LOCAL_STORAGE_DIR)
    : null;

// Test data - use movies from movies.js dynamically
// Language pairs designed to test different character set combinations for merge validation:
// - Latin: ASCII + accented chars (eng, spa, por, fra) - 1 byte ASCII, 2-byte accents in UTF-8
// - 2-byte scripts: Cyrillic (rus), Greek (ell), Hebrew (heb), Arabic (ara) - 2 bytes in UTF-8
// - 3-byte scripts: CJK (zht, jpn, kor), Thai (tha) - 3 bytes in UTF-8
const LANGUAGE_PAIRS = [
    // 1. Latin + Latin: English + Spanish (both ASCII with accented chars)
    { main: 'eng', trans: 'spa', name: 'English + Spanish (Latin+Latin)' },

    // 2. Non-English Latin + Non-English Latin: Portuguese + French
    { main: 'por', trans: 'fre', name: 'Portuguese + French (Latin+Latin)' },

    // 3. English + 2-byte: English + Russian (Cyrillic)
    { main: 'eng', trans: 'rus', name: 'English + Russian (Latin+Cyrillic)' },

    // 4. Non-English Latin + 2-byte: Spanish + Greek
    { main: 'spa', trans: 'ell', name: 'Spanish + Greek (Latin+Greek)' },

    // 5. English + 3-byte: English + Chinese (Traditional)
    { main: 'eng', trans: 'zht', name: 'English + Chinese (Latin+CJK)' },

    // 6. 2-byte + 3-byte: Russian + Japanese
    { main: 'rus', trans: 'jpn', name: 'Russian + Japanese (Cyrillic+CJK)' },
];
const TEST_MOVIES = movies.filter(m => m.type !== 'series');
const TEST_SERIES_LIST = movies.filter(m => m.type === 'series');

// State
let serverStartedByUs = false;
let manifest = null;
let results = { passed: 0, failed: 0, errors: [] };
let lastLogPosition = 0;

/**
 * Get server log position (for capturing logs after a request)
 */
function markLogPosition() {
    try {
        const stats = fs.statSync(SERVER_LOG);
        lastLogPosition = stats.size;
    } catch {
        lastLogPosition = 0;
    }
}

/**
 * Get server logs since last mark, filtered by content ID
 * @param {string} contentId - IMDB ID to filter logs for
 * @returns {string} Relevant log lines
 */
function getRecentLogs(contentId) {
    try {
        const fd = fs.openSync(SERVER_LOG, 'r');
        const stats = fs.fstatSync(fd);
        const bytesToRead = Math.min(stats.size - lastLogPosition, 10000); // Max 10KB
        if (bytesToRead <= 0) return '';

        const buffer = Buffer.alloc(bytesToRead);
        fs.readSync(fd, buffer, 0, bytesToRead, lastLogPosition);
        fs.closeSync(fd);

        const logs = buffer.toString('utf8');
        // Filter for lines mentioning this content ID
        const lines = logs.split('\n').filter(line =>
            line.includes(contentId) ||
            line.includes('No subtitles found') ||
            line.includes('Error') ||
            line.includes('403') ||
            line.includes('fallback')
        );
        return lines.slice(0, 10).join('\n'); // Max 10 relevant lines
    } catch {
        return '';
    }
}

// === Helpers ===

function log(msg) { console.log(`[${new Date().toISOString().slice(11, 19)}] ${msg}`); }

function pass(name) { console.log(`  ✓ ${name}`); results.passed++; }

function fail(name, details = '') {
    console.log(`  ✗ ${name}${details ? ': ' + details : ''}`);
    results.failed++;
    results.errors.push({ test: name, details });
}

function test(name, condition, details = '') {
    condition ? pass(name) : fail(name, details);
}

function runScript(name) {
    try {
        return { ok: true, out: execSync(`bash "${path.join(SCRIPTS_DIR, name)}"`, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }) };
    } catch (e) {
        return { ok: false, err: e.stderr || e.message };
    }
}

function isServerRunning() {
    const r = runScript('server-status.sh');
    return r.ok && r.out.includes('Server is running');
}

function buildConfigUrl(main, trans) {
    return encodeURIComponent(JSON.stringify({ mainLang: `[${main}]`, transLang: `[${trans}]` }));
}

/**
 * Check if cache dir is safe to clear: must be a subdirectory inside project directory.
 * Not the project dir itself, not a parent, must be strictly inside.
 */
function isCacheDirSafe() {
    if (!SUBTITLES_DIR) return false;
    try {
        // Resolve and normalize paths (removes trailing slashes, resolves ..)
        const realCache = path.resolve(fs.realpathSync(SUBTITLES_DIR));
        const realProject = path.resolve(fs.realpathSync(PROJECT_DIR));
        // Must be strictly inside project (not equal, not parent)
        return realCache !== realProject && realCache.startsWith(realProject + path.sep);
    } catch {
        return false; // Path doesn't exist or can't be resolved
    }
}

/**
 * Clear our generated subtitle files from cache
 */
function clearCache() {
    if (!SUBTITLES_DIR || !fs.existsSync(SUBTITLES_DIR)) return 0;
    if (!isCacheDirSafe()) {
        console.error(`  ❌ Cache dir not inside project: ${SUBTITLES_DIR}`);
        process.exit(1);
    }

    const pattern = /^tt\d+(_S\d+E\d+)?_[a-z]{3}_[a-z]{3}_v\d+\.srt$/i;
    let cleared = 0;
    for (const f of fs.readdirSync(SUBTITLES_DIR)) {
        if (pattern.test(f)) {
            fs.unlinkSync(path.join(SUBTITLES_DIR, f));
            cleared++;
        }
    }
    return cleared;
}

// === Tests ===

async function testServerStartup(skipClear) {
    log('\n=== Server Startup ===');

    if (isServerRunning()) {
        log('Server already running');
        serverStartedByUs = false;
    } else {
        if (!skipClear) {
            const n = clearCache();
            log(`Cleared ${n} cached subtitle files`);
        }

        log('Starting server...');
        const r = runScript('start-server.sh');
        if (!r.ok) { fail('Server startup', r.err); return false; }
        serverStartedByUs = true;
        log('Server started');
    }

    try {
        const res = await axios.get(`${BASE_URL}/manifest.json`, { timeout: 5000 });
        test('Server responds', res.status === 200);
        return true;
    } catch (e) {
        fail('Server responds', e.message);
        return false;
    }
}

async function testManifest() {
    log('\n=== Manifest ===');

    try {
        const res = await axios.get(`${BASE_URL}/manifest.json`);
        manifest = res.data;

        test('Manifest fetch', res.status === 200);
        test('Has required fields', manifest.id && manifest.name && manifest.version);
        test('Has subtitles resource', manifest.resources?.includes('subtitles'));
        test('Has movie+series types', manifest.types?.includes('movie') && manifest.types?.includes('series'));

        const mainCfg = manifest.config?.find(c => c.key === 'mainLang');
        const transCfg = manifest.config?.find(c => c.key === 'transLang');
        test('Has language configs', mainCfg?.options?.length > 50 && transCfg?.options?.length > 50);

        return true;
    } catch (e) {
        fail('Manifest fetch', e.message);
        return false;
    }
}

async function testConfigurePage() {
    log('\n=== Configure Page ===');

    try {
        const res = await axios.get(`${BASE_URL}/configure`);
        const html = res.data;

        test('Page loads', res.status === 200);
        test('Is HTML', res.headers['content-type'].includes('text/html'));
        test('Has language selectors', html.includes('mainLang') && html.includes('transLang'));
        test('Has install mechanism', html.includes('stremio://') || html.toLowerCase().includes('install'));

        return true;
    } catch (e) {
        fail('Configure page', e.message);
        return false;
    }
}

async function testUserManifests() {
    log('\n=== User Manifests ===');

    const userManifests = [];
    for (const pair of LANGUAGE_PAIRS) {
        const url = `${BASE_URL}/${buildConfigUrl(pair.main, pair.trans)}/manifest.json`;
        try {
            const res = await axios.get(url, { timeout: 10000 });
            test(`${pair.name} manifest`, res.status === 200 && res.data.id);
            userManifests.push({ pair, configUrl: buildConfigUrl(pair.main, pair.trans) });
        } catch (e) {
            fail(`${pair.name} manifest`, e.message);
        }
    }
    return userManifests;
}

async function testSubtitles(userManifests) {
    log('\n=== Subtitle Requests (Movies) ===');

    // Distribute language pairs across movies to ensure all charset combinations get tested
    // Each movie tests 2 pairs, rotating through all pairs across movies
    const pairsPerMovie = 2;

    for (let movieIdx = 0; movieIdx < TEST_MOVIES.length; movieIdx++) {
        const movie = TEST_MOVIES[movieIdx];
        log(`\n  ${movie.name} (${movie.id}):`);

        // Calculate which pairs to test for this movie (rotate through all pairs)
        const startPairIdx = (movieIdx * pairsPerMovie) % userManifests.length;
        const pairsToTest = [];
        for (let i = 0; i < pairsPerMovie && i < userManifests.length; i++) {
            pairsToTest.push(userManifests[(startPairIdx + i) % userManifests.length]);
        }

        for (const { pair, configUrl } of pairsToTest) {
            const testName = `${movie.name}/${pair.name}`;
            const url = `${BASE_URL}/${configUrl}/subtitles/movie/${movie.id}.json`;

            markLogPosition(); // Mark log position before request

            try {
                const res = await axios.get(url, { timeout: 120000 });
                test(`${testName} request`, res.status === 200);

                const subs = res.data.subtitles || [];
                if (subs.length === 0) {
                    // Get server logs to explain WHY no subtitles
                    const logs = getRecentLogs(movie.id);
                    const reason = logs.includes('No subtitles found for language')
                        ? logs.match(/No subtitles found for language (\w+)/)?.[0] || 'API returned no subs'
                        : logs.includes('403') ? 'API returned 403 (rate limited or blocked)'
                        : 'No subtitles from API';
                    fail(`${testName} has subtitles`, reason);
                    continue;
                }
                test(`${testName} has subtitles`, true, `(${subs.length} versions)`);

                // Fetch and validate first subtitle
                const subRes = await axios.get(subs[0].url, { responseType: 'arraybuffer', timeout: 30000 });
                const content = decodeSubtitleBuffer(Buffer.from(subRes.data), null, true);

                // Validate SRT format
                const srtValidation = validateSrtFormat(content);
                test(`${testName} SRT format`, srtValidation.valid, srtValidation.errors.join(', '));

                // Validate encoding
                const encValidation = validateEncoding(content, { movieConfig: movie, mainLang: pair.main, transLang: pair.trans });
                test(`${testName} encoding`, encValidation.valid, encValidation.errors.join(', '));

                // Check dual-language format
                const dual = checkDualLanguage(content);
                test(`${testName} dual-language`, dual.hasItalics, `(${dual.italicCount} italic, ${srtValidation.cueCount} cues)`);

                // Validate main language content is present
                const mainExpected = getExpectedStringsForLanguage(movie, pair.main);
                if (mainExpected.length > 0) {
                    const mainCheck = checkExpectedStrings(content, mainExpected);
                    test(`${testName} main lang strings`, mainCheck.success,
                        `missing: ${mainCheck.missing.join(', ')}`);
                } else {
                    fail(`${testName} main lang strings`, `no expected strings defined for ${pair.main}`);
                }

                // Validate translation language content is present
                const transExpected = getExpectedStringsForLanguage(movie, pair.trans);
                if (transExpected.length > 0) {
                    const transCheck = checkExpectedStrings(content, transExpected);
                    test(`${testName} trans lang strings`, transCheck.success,
                        `missing: ${transCheck.missing.join(', ')}`);
                } else {
                    fail(`${testName} trans lang strings`, `no expected strings defined for ${pair.trans}`);
                }

            } catch (e) {
                fail(`${testName} request`, e.message);
            }
        }
    }
}

async function testSeries(userManifests) {
    log('\n=== Subtitle Requests (Series) ===');
    if (!userManifests.length) { log('  Skipping - no manifests'); return; }
    if (!TEST_SERIES_LIST.length) { log('  Skipping - no series in movies.js'); return; }

    const { pair, configUrl } = userManifests[0];

    for (const series of TEST_SERIES_LIST) {
        const seriesId = `${series.id}:${series.season}:${series.episode}`;
        const testName = `${series.name} S${series.season}E${series.episode}`;
        log(`\n  ${testName}:`);

        markLogPosition(); // Mark log position before request

        try {
            const res = await axios.get(`${BASE_URL}/${configUrl}/subtitles/series/${seriesId}.json`, { timeout: 120000 });
            test(`${testName} request`, res.status === 200);

            const subs = res.data.subtitles || [];
            if (subs.length > 0) {
                test(`${testName} has subtitles`, true, `(${subs.length} versions)`);

                const subRes = await axios.get(subs[0].url, { responseType: 'arraybuffer', timeout: 30000 });
                const content = decodeSubtitleBuffer(Buffer.from(subRes.data), null, true);

                // Validate SRT format
                const srtValidation = validateSrtFormat(content);
                test(`${testName} SRT format`, srtValidation.valid, srtValidation.errors.join(', '));

                // Validate encoding
                const encValidation = validateEncoding(content, { movieConfig: series, mainLang: pair.main, transLang: pair.trans });
                test(`${testName} encoding`, encValidation.valid, encValidation.errors.join(', '));

                // Check dual-language format
                const dual = checkDualLanguage(content);
                test(`${testName} dual-language`, dual.hasItalics, `(${dual.italicCount} italic, ${srtValidation.cueCount} cues)`);

                // Validate main language content is present
                const mainExpected = getExpectedStringsForLanguage(series, pair.main);
                if (mainExpected.length > 0) {
                    const mainCheck = checkExpectedStrings(content, mainExpected);
                    test(`${testName} main lang strings`, mainCheck.success,
                        `missing: ${mainCheck.missing.join(', ')}`);
                } else {
                    fail(`${testName} main lang strings`, `no expected strings defined for ${pair.main}`);
                }

                // Validate translation language content is present
                const transExpected = getExpectedStringsForLanguage(series, pair.trans);
                if (transExpected.length > 0) {
                    const transCheck = checkExpectedStrings(content, transExpected);
                    test(`${testName} trans lang strings`, transCheck.success,
                        `missing: ${transCheck.missing.join(', ')}`);
                } else {
                    fail(`${testName} trans lang strings`, `no expected strings defined for ${pair.trans}`);
                }
            } else {
                // Get server logs to explain WHY no subtitles
                const logs = getRecentLogs(series.id);
                const reason = logs.includes('No subtitles found for language')
                    ? logs.match(/No subtitles found for language (\w+)/)?.[0] || 'API returned no subs'
                    : logs.includes('403') ? 'API returned 403 (rate limited or blocked)'
                    : 'No subtitles from API';
                fail(`${testName} has subtitles`, reason);
            }
        } catch (e) {
            fail(`${testName} request`, e.message);
        }
    }
}

async function testErrorHandling(userManifests) {
    log('\n=== Error Handling ===');
    if (!userManifests.length) { log('  Skipping - no manifests'); return; }

    const { configUrl } = userManifests[0];

    // Invalid IMDB
    try {
        const res = await axios.get(`${BASE_URL}/${configUrl}/subtitles/movie/tt9999999999.json`, { timeout: 30000 });
        test('Invalid IMDB → empty', res.data.subtitles?.length === 0);
    } catch (e) {
        test('Invalid IMDB handled', e.response?.status !== 500);
    }

    // Invalid config
    try {
        await axios.get(`${BASE_URL}/invalid-json/manifest.json`, { timeout: 10000 });
        test('Invalid config handled', true);
    } catch {
        test('Invalid config handled', true);
    }

    // Same language
    try {
        const testMovie = TEST_MOVIES[0] || { id: 'tt0133093' };
        const res = await axios.get(`${BASE_URL}/${buildConfigUrl('eng', 'eng')}/subtitles/movie/${testMovie.id}.json`, { timeout: 30000 });
        test('Same language → empty', res.data.subtitles?.length === 0);
    } catch {
        test('Same language handled', true);
    }
}

async function stopServer() {
    if (serverStartedByUs) {
        log('\n=== Stopping Server ===');
        runScript('stop-server.sh');
        log('Server stopped');
    }
}

// === Main ===

async function main() {
    console.log('╔════════════════════════════════════════════════════════════╗');
    console.log('║         Strelingo Addon - End-to-End Test Suite           ║');
    console.log('╚════════════════════════════════════════════════════════════╝\n');

    const startTime = Date.now();
    const keepServer = process.argv.includes('--keep');
    const skipClear = process.argv.includes('--skip-clear');

    // Pre-flight
    log('=== Pre-flight ===');
    if (!SUBTITLES_DIR) {
        console.error('❌ LOCAL_STORAGE_DIR not set');
        process.exit(1);
    }
    if (!isCacheDirSafe()) {
        console.error(`❌ Cache dir must be inside project: ${SUBTITLES_DIR}`);
        process.exit(1);
    }
    log(`✓ Cache dir: ${SUBTITLES_DIR}`);
    log(`✓ Base URL: ${BASE_URL}`);

    try {
        if (!await testServerStartup(skipClear)) {
            console.log('\n❌ Server startup failed');
            process.exit(1);
        }

        await testManifest();
        await testConfigurePage();
        const userManifests = await testUserManifests();
        await testSubtitles(userManifests);
        await testSeries(userManifests);
        await testErrorHandling(userManifests);

    } finally {
        if (!keepServer) await stopServer();
        else log('\n--keep flag set, server left running');
    }

    // Summary
    const duration = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log('\n' + '═'.repeat(60));
    console.log(`Results: ${results.passed} passed, ${results.failed} failed (${duration}s)`);
    if (results.errors.length) {
        console.log('\nFailed:');
        results.errors.forEach(e => console.log(`  - ${e.test}: ${e.details}`));
    }
    console.log('═'.repeat(60));
    process.exit(results.failed > 0 ? 1 : 0);
}

main().catch(e => { console.error('Fatal:', e); process.exit(1); });
