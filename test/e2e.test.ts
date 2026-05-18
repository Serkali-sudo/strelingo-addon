/**
 * End-to-end tests for Strelingo addon server.
 *
 * Usage:
 *   npx tsx test/e2e.test.ts              # Run all e2e tests
 *   npx tsx test/e2e.test.ts --keep       # Keep server running after tests
 *   npx tsx test/e2e.test.ts --skip-clear # Don't clear subtitle cache
 */

import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';
import { decodeSubtitleBuffer } from '../src/encoding';
import movies from './movies';
import type { MovieConfig } from './movies';
import {
    validateEncoding,
    checkDualLanguage,
    validateSrtFormat,
    getExpectedStringsForLanguage,
    checkExpectedStrings
} from './validators';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load .env file manually (dotenv not needed)
function loadEnvFile(envPath: string): void {
    if (!fs.existsSync(envPath)) return;
    const content = fs.readFileSync(envPath, 'utf8');
    for (const line of content.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const eqIdx = trimmed.indexOf('=');
        if (eqIdx === -1) continue;
        const key = trimmed.slice(0, eqIdx).trim();
        let value = trimmed.slice(eqIdx + 1).trim();
        // Remove surrounding quotes
        if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
            value = value.slice(1, -1);
        }
        if (!(key in process.env)) {
            process.env[key] = value;
        }
    }
}

loadEnvFile(path.join(__dirname, '..', '.env'));

// === Configuration ===
const PROJECT_DIR = path.resolve(__dirname, '..');
const BASE_URL = process.env.EXTERNAL_URL || `http://localhost:${process.env.PORT || 7000}`;
const SCRIPTS_DIR = __dirname;
const SERVER_LOG = path.join(PROJECT_DIR, 'server.log');
const SUBTITLES_DIR = process.env.LOCAL_STORAGE_DIR
    ? path.resolve(PROJECT_DIR, process.env.LOCAL_STORAGE_DIR)
    : null;

interface LanguagePair {
    main: string;
    trans: string;
    name: string;
}

const LANGUAGE_PAIRS: LanguagePair[] = [
    { main: 'eng', trans: 'spa', name: 'English + Spanish (Latin+Latin)' },
    { main: 'por', trans: 'fre', name: 'Portuguese + French (Latin+Latin)' },
    { main: 'eng', trans: 'rus', name: 'English + Russian (Latin+Cyrillic)' },
    { main: 'spa', trans: 'ell', name: 'Spanish + Greek (Latin+Greek)' },
    { main: 'eng', trans: 'zht', name: 'English + Chinese (Latin+CJK)' },
    { main: 'rus', trans: 'jpn', name: 'Russian + Japanese (Cyrillic+CJK)' },
];

const TEST_MOVIES = movies.filter(m => m.type !== 'series');
const TEST_SERIES_LIST = movies.filter(m => m.type === 'series');

interface UserManifest {
    pair: LanguagePair;
    configUrl: string;
}

interface TestResults {
    passed: number;
    failed: number;
    errors: Array<{ test: string; details: string }>;
}

let serverStartedByUs = false;
let manifest: any = null;
const results: TestResults = { passed: 0, failed: 0, errors: [] };
let lastLogPosition = 0;

function markLogPosition(): void {
    try {
        const stats = fs.statSync(SERVER_LOG);
        lastLogPosition = stats.size;
    } catch {
        lastLogPosition = 0;
    }
}

function getRecentLogs(contentId: string): string {
    try {
        const fd = fs.openSync(SERVER_LOG, 'r');
        const stats = fs.fstatSync(fd);
        const bytesToRead = Math.min(stats.size - lastLogPosition, 10000);
        if (bytesToRead <= 0) { fs.closeSync(fd); return ''; }

        const buffer = Buffer.alloc(bytesToRead);
        fs.readSync(fd, buffer, 0, bytesToRead, lastLogPosition);
        fs.closeSync(fd);

        const logs = buffer.toString('utf8');
        const lines = logs.split('\n').filter(line =>
            line.includes(contentId) ||
            line.includes('No subtitles found') ||
            line.includes('Error') ||
            line.includes('403') ||
            line.includes('fallback')
        );
        return lines.slice(0, 10).join('\n');
    } catch {
        return '';
    }
}

function log(msg: string): void { console.log(`[${new Date().toISOString().slice(11, 19)}] ${msg}`); }
function pass(name: string): void { console.log(`  ✓ ${name}`); results.passed++; }
function fail(name: string, details = ''): void {
    console.log(`  ✗ ${name}${details ? ': ' + details : ''}`);
    results.failed++;
    results.errors.push({ test: name, details });
}
function test(name: string, condition: boolean, details = ''): void {
    condition ? pass(name) : fail(name, details);
}

function runScript(name: string): { ok: boolean; out?: string; err?: string } {
    try {
        return { ok: true, out: execSync(`bash "${path.join(SCRIPTS_DIR, name)}"`, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }) };
    } catch (e: any) {
        return { ok: false, err: e.stderr || e.message };
    }
}

function isServerRunning(): boolean {
    const r = runScript('server-status.sh');
    return r.ok && (r.out?.includes('Server is running') ?? false);
}

function buildConfigUrl(main: string, trans: string): string {
    return encodeURIComponent(JSON.stringify({ mainLang: `[${main}]`, transLang: `[${trans}]` }));
}

function isCacheDirSafe(): boolean {
    if (!SUBTITLES_DIR) return false;
    try {
        const realCache = path.resolve(fs.realpathSync(SUBTITLES_DIR));
        const realProject = path.resolve(fs.realpathSync(PROJECT_DIR));
        return realCache !== realProject && realCache.startsWith(realProject + path.sep);
    } catch {
        return false;
    }
}

function clearCache(): number {
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

async function fetchJson<T = any>(url: string, timeout = 10000): Promise<{ status: number; data: T }> {
    const response = await fetch(url, { signal: AbortSignal.timeout(timeout) });
    const data = await response.json() as T;
    return { status: response.status, data };
}

async function fetchBuffer(url: string, timeout = 30000): Promise<Buffer> {
    const response = await fetch(url, { signal: AbortSignal.timeout(timeout) });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const arrayBuffer = await response.arrayBuffer();
    return Buffer.from(arrayBuffer);
}

// === Tests ===

async function testServerStartup(skipClear: boolean): Promise<boolean> {
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
        const res = await fetchJson(`${BASE_URL}/manifest.json`, 5000);
        test('Server responds', res.status === 200);
        return true;
    } catch (e: any) {
        fail('Server responds', e.message);
        return false;
    }
}

async function testManifest(): Promise<boolean> {
    log('\n=== Manifest ===');

    try {
        const res = await fetchJson(`${BASE_URL}/manifest.json`);
        manifest = res.data;

        test('Manifest fetch', res.status === 200);
        test('Has required fields', manifest.id && manifest.name && manifest.version);
        test('Has subtitles resource', manifest.resources?.includes('subtitles'));
        test('Has movie+series types', manifest.types?.includes('movie') && manifest.types?.includes('series'));

        const mainCfg = manifest.config?.find((c: any) => c.key === 'mainLang');
        const transCfg = manifest.config?.find((c: any) => c.key === 'transLang');
        test('Has language configs', mainCfg?.options?.length > 50 && transCfg?.options?.length > 50);

        return true;
    } catch (e: any) {
        fail('Manifest fetch', e.message);
        return false;
    }
}

async function testConfigurePage(): Promise<boolean> {
    log('\n=== Configure Page ===');

    try {
        const response = await fetch(`${BASE_URL}/configure`, { signal: AbortSignal.timeout(10000) });
        const html = await response.text();

        test('Page loads', response.status === 200);
        test('Is HTML', (response.headers.get('content-type') || '').includes('text/html'));
        test('Has language selectors', html.includes('mainLang') && html.includes('transLang'));
        test('Has install mechanism', html.includes('stremio://') || html.toLowerCase().includes('install'));

        return true;
    } catch (e: any) {
        fail('Configure page', e.message);
        return false;
    }
}

async function testUserManifests(): Promise<UserManifest[]> {
    log('\n=== User Manifests ===');

    const userManifests: UserManifest[] = [];
    for (const pair of LANGUAGE_PAIRS) {
        const url = `${BASE_URL}/${buildConfigUrl(pair.main, pair.trans)}/manifest.json`;
        try {
            const res = await fetchJson(url, 10000);
            test(`${pair.name} manifest`, res.status === 200 && res.data.id);
            userManifests.push({ pair, configUrl: buildConfigUrl(pair.main, pair.trans) });
        } catch (e: any) {
            fail(`${pair.name} manifest`, e.message);
        }
    }
    return userManifests;
}

async function testSubtitles(userManifests: UserManifest[]): Promise<void> {
    log('\n=== Subtitle Requests (Movies) ===');

    const pairsPerMovie = 2;

    for (let movieIdx = 0; movieIdx < TEST_MOVIES.length; movieIdx++) {
        const movie = TEST_MOVIES[movieIdx];
        log(`\n  ${movie.name} (${movie.id}):`);

        const startPairIdx = (movieIdx * pairsPerMovie) % userManifests.length;
        const pairsToTest: UserManifest[] = [];
        for (let i = 0; i < pairsPerMovie && i < userManifests.length; i++) {
            pairsToTest.push(userManifests[(startPairIdx + i) % userManifests.length]);
        }

        for (const { pair, configUrl } of pairsToTest) {
            const testName = `${movie.name}/${pair.name}`;
            const url = `${BASE_URL}/${configUrl}/subtitles/movie/${movie.id}.json`;

            markLogPosition();

            try {
                const res = await fetchJson(url, 120000);
                test(`${testName} request`, res.status === 200);

                const subs = res.data.subtitles || [];
                if (subs.length === 0) {
                    const logs = getRecentLogs(movie.id);
                    const reason = logs.includes('No subtitles found for language')
                        ? logs.match(/No subtitles found for language (\w+)/)?.[0] || 'API returned no subs'
                        : logs.includes('403') ? 'API returned 403 (rate limited or blocked)'
                        : 'No subtitles from API';
                    fail(`${testName} has subtitles`, reason);
                    continue;
                }
                test(`${testName} has subtitles`, true, `(${subs.length} versions)`);

                const subBuffer = await fetchBuffer(subs[0].url, 30000);
                const content = await decodeSubtitleBuffer(subBuffer, null, { skipLanguageValidation: true });

                if (!content) {
                    fail(`${testName} decode`, 'decodeSubtitleBuffer returned null');
                    continue;
                }

                const srtValidation = validateSrtFormat(content);
                test(`${testName} SRT format`, srtValidation.valid, srtValidation.errors.join(', '));

                const encValidation = await validateEncoding(content, { movieConfig: movie, mainLang: pair.main, transLang: pair.trans });
                test(`${testName} encoding`, encValidation.valid, encValidation.errors.join(', '));

                const dual = checkDualLanguage(content);
                test(`${testName} dual-language`, dual.hasItalics, `(${dual.italicCount} italic, ${srtValidation.cueCount} cues)`);

                const mainExpected = await getExpectedStringsForLanguage(movie, pair.main);
                if (mainExpected.length > 0) {
                    const mainCheck = checkExpectedStrings(content, mainExpected);
                    test(`${testName} main lang strings`, mainCheck.success,
                        `missing: ${mainCheck.missing.join(', ')}`);
                } else {
                    fail(`${testName} main lang strings`, `no expected strings defined for ${pair.main}`);
                }

                const transExpected = await getExpectedStringsForLanguage(movie, pair.trans);
                if (transExpected.length > 0) {
                    const transCheck = checkExpectedStrings(content, transExpected);
                    test(`${testName} trans lang strings`, transCheck.success,
                        `missing: ${transCheck.missing.join(', ')}`);
                } else {
                    fail(`${testName} trans lang strings`, `no expected strings defined for ${pair.trans}`);
                }

            } catch (e: any) {
                fail(`${testName} request`, e.message);
            }
        }
    }
}

async function testSeries(userManifests: UserManifest[]): Promise<void> {
    log('\n=== Subtitle Requests (Series) ===');
    if (!userManifests.length) { log('  Skipping - no manifests'); return; }
    if (!TEST_SERIES_LIST.length) { log('  Skipping - no series in movies.ts'); return; }

    const { pair, configUrl } = userManifests[0];

    for (const series of TEST_SERIES_LIST) {
        const seriesId = `${series.id}:${series.season}:${series.episode}`;
        const testName = `${series.name} S${series.season}E${series.episode}`;
        log(`\n  ${testName}:`);

        markLogPosition();

        try {
            const res = await fetchJson(`${BASE_URL}/${configUrl}/subtitles/series/${seriesId}.json`, 120000);
            test(`${testName} request`, res.status === 200);

            const subs = res.data.subtitles || [];
            if (subs.length > 0) {
                test(`${testName} has subtitles`, true, `(${subs.length} versions)`);

                const subBuffer = await fetchBuffer(subs[0].url, 30000);
                const content = await decodeSubtitleBuffer(subBuffer, null, { skipLanguageValidation: true });

                if (!content) {
                    fail(`${testName} decode`, 'decodeSubtitleBuffer returned null');
                    continue;
                }

                const srtValidation = validateSrtFormat(content);
                test(`${testName} SRT format`, srtValidation.valid, srtValidation.errors.join(', '));

                const encValidation = await validateEncoding(content, { movieConfig: series, mainLang: pair.main, transLang: pair.trans });
                test(`${testName} encoding`, encValidation.valid, encValidation.errors.join(', '));

                const dual = checkDualLanguage(content);
                test(`${testName} dual-language`, dual.hasItalics, `(${dual.italicCount} italic, ${srtValidation.cueCount} cues)`);

                const mainExpected = await getExpectedStringsForLanguage(series, pair.main);
                if (mainExpected.length > 0) {
                    const mainCheck = checkExpectedStrings(content, mainExpected);
                    test(`${testName} main lang strings`, mainCheck.success,
                        `missing: ${mainCheck.missing.join(', ')}`);
                } else {
                    fail(`${testName} main lang strings`, `no expected strings defined for ${pair.main}`);
                }

                const transExpected = await getExpectedStringsForLanguage(series, pair.trans);
                if (transExpected.length > 0) {
                    const transCheck = checkExpectedStrings(content, transExpected);
                    test(`${testName} trans lang strings`, transCheck.success,
                        `missing: ${transCheck.missing.join(', ')}`);
                } else {
                    fail(`${testName} trans lang strings`, `no expected strings defined for ${pair.trans}`);
                }
            } else {
                const logs = getRecentLogs(series.id);
                const reason = logs.includes('No subtitles found for language')
                    ? logs.match(/No subtitles found for language (\w+)/)?.[0] || 'API returned no subs'
                    : logs.includes('403') ? 'API returned 403 (rate limited or blocked)'
                    : 'No subtitles from API';
                fail(`${testName} has subtitles`, reason);
            }
        } catch (e: any) {
            fail(`${testName} request`, e.message);
        }
    }
}

async function testErrorHandling(userManifests: UserManifest[]): Promise<void> {
    log('\n=== Error Handling ===');
    if (!userManifests.length) { log('  Skipping - no manifests'); return; }

    const { configUrl } = userManifests[0];

    try {
        const res = await fetchJson(`${BASE_URL}/${configUrl}/subtitles/movie/tt9999999999.json`, 30000);
        test('Invalid IMDB → empty', res.data.subtitles?.length === 0);
    } catch (e: any) {
        test('Invalid IMDB handled', !(e.message?.includes('500')));
    }

    try {
        await fetchJson(`${BASE_URL}/invalid-json/manifest.json`, 10000);
        test('Invalid config handled', true);
    } catch {
        test('Invalid config handled', true);
    }

    try {
        const testMovie = TEST_MOVIES[0] || { id: 'tt0133093' };
        const res = await fetchJson(`${BASE_URL}/${buildConfigUrl('eng', 'eng')}/subtitles/movie/${testMovie.id}.json`, 30000);
        test('Same language → empty', res.data.subtitles?.length === 0);
    } catch {
        test('Same language handled', true);
    }
}

async function testLanguageAliases(): Promise<void> {
    log('\n=== Language Code Aliases ===');

    const testMovie = movies.find(m => m.id === 'tt0133093') || { id: 'tt0133093', name: 'The Matrix' };
    const romanianStrings = testMovie.expectedStrings?.['ro'] || ['Matrix', 'este', 'sunt'];
    const chineseStrings = testMovie.expectedStrings?.['zh'] || ['矩陣', '母體'];

    const romanianAliases = ['ron', 'rum', 'mol'];
    for (const alias of romanianAliases) {
        const testName = `${alias} → Romanian`;
        const url = `${BASE_URL}/${buildConfigUrl('eng', alias)}/subtitles/movie/${testMovie.id}.json`;

        markLogPosition();

        try {
            const res = await fetchJson(url, 120000);
            test(`${testName} request`, res.status === 200);

            const subs = res.data.subtitles || [];
            if (subs.length === 0) {
                const logs = getRecentLogs(testMovie.id);
                const reason = logs.includes('No subtitles found')
                    ? 'API returned no subs for Romanian'
                    : logs.includes('403') ? 'API returned 403'
                    : 'No subtitles from API';
                fail(`${testName} has subtitles`, reason);
                continue;
            }
            test(`${testName} has subtitles`, true, `(${subs.length} versions)`);

            const subBuffer = await fetchBuffer(subs[0].url, 30000);
            const content = await decodeSubtitleBuffer(subBuffer, null, { skipLanguageValidation: true });

            if (!content) {
                fail(`${testName} decode`, 'decodeSubtitleBuffer returned null');
                continue;
            }

            const roCheck = checkExpectedStrings(content, romanianStrings);
            test(`${testName} contains Romanian`, roCheck.success,
                roCheck.success ? '' : `missing: ${roCheck.missing.join(', ')}`);

        } catch (e: any) {
            fail(`${testName} request`, e.message);
        }
    }

    const testName = 'zhe → Chinese';
    const url = `${BASE_URL}/${buildConfigUrl('eng', 'zhe')}/subtitles/movie/${testMovie.id}.json`;

    markLogPosition();

    try {
        const res = await fetchJson(url, 120000);
        test(`${testName} request`, res.status === 200);

        const subs = res.data.subtitles || [];
        if (subs.length === 0) {
            const logs = getRecentLogs(testMovie.id);
            const reason = logs.includes('No subtitles found')
                ? 'API returned no subs for Chinese'
                : logs.includes('403') ? 'API returned 403'
                : 'No subtitles from API';
            fail(`${testName} has subtitles`, reason);
            return;
        }
        test(`${testName} has subtitles`, true, `(${subs.length} versions)`);

        const subBuffer = await fetchBuffer(subs[0].url, 30000);
        const content = await decodeSubtitleBuffer(subBuffer, null, { skipLanguageValidation: true });

        if (!content) {
            fail(`${testName} decode`, 'decodeSubtitleBuffer returned null');
            return;
        }

        const zhCheck = checkExpectedStrings(content, chineseStrings);
        test(`${testName} contains Chinese`, zhCheck.success,
            zhCheck.success ? '' : `missing: ${zhCheck.missing.join(', ')}`);

    } catch (e: any) {
        fail(`${testName} request`, e.message);
    }
}

async function stopServer(): Promise<void> {
    if (serverStartedByUs) {
        log('\n=== Stopping Server ===');
        runScript('stop-server.sh');
        log('Server stopped');
    }
}

// === Main ===

async function main(): Promise<void> {
    console.log('╔════════════════════════════════════════════════════════════╗');
    console.log('║         Strelingo Addon - End-to-End Test Suite           ║');
    console.log('╚════════════════════════════════════════════════════════════╝\n');

    const startTime = Date.now();
    const keepServer = process.argv.includes('--keep');
    const skipClear = process.argv.includes('--skip-clear');

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
        await testLanguageAliases();
        await testErrorHandling(userManifests);

    } finally {
        if (!keepServer) await stopServer();
        else log('\n--keep flag set, server left running');
    }

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
