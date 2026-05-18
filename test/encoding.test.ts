/**
 * Encoding tests for subtitle decoding.
 * Tests against real subtitles to verify encoding detection and fixing.
 *
 * Usage:
 *   npx tsx test/encoding.test.ts              # Run tests
 *   npx tsx test/encoding.test.ts --output     # Run tests and save decoded files
 *   npx tsx test/encoding.test.ts -o           # Same as --output
 *
 * If inputs don't exist, they will be downloaded automatically.
 */

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import { decodeSubtitleBuffer, detectLanguage, validateLanguage, SKIP_LANGUAGE_CODES } from '../src/encoding';
import movies from './movies';
import { checkMojibake, hasReplacementChars } from './validators';
import ensureInputs from './ensure-inputs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const INPUTS_DIR = path.join(__dirname, 'inputs');
const OUTPUT_DIR = path.join(__dirname, 'output');

interface KnownBadEntry {
    reason: string;
    markedAt: string;
    originalFile: string;
}

interface KnownBadData {
    hashes: Record<string, KnownBadEntry>;
}

const KNOWN_BAD_FILE = path.join(__dirname, 'known-bad-inputs.json');
let knownBadData: KnownBadData | null = null;
function loadKnownBad(): KnownBadData {
    if (knownBadData !== null) return knownBadData;
    if (fs.existsSync(KNOWN_BAD_FILE)) {
        knownBadData = JSON.parse(fs.readFileSync(KNOWN_BAD_FILE, 'utf8'));
    } else {
        knownBadData = { hashes: {} };
    }
    return knownBadData;
}

function hashFile(filepath: string): string {
    const buffer = fs.readFileSync(filepath);
    return crypto.createHash('sha256').update(buffer).digest('hex');
}

function isKnownBad(filepath: string): KnownBadEntry | null {
    const data = loadKnownBad();
    const hash = hashFile(filepath);
    return data.hashes[hash] || null;
}

const args = process.argv.slice(2);
const shouldOutput = args.includes('--output') || args.includes('-o');

async function runTests(): Promise<void> {
    console.log('Running encoding tests...\n');

    await ensureInputs();

    let totalPassed = 0;
    let totalFailed = 0;
    let totalSkipped = 0;
    let totalKnownBad = 0;
    let totalMislabeled = 0;

    for (const movie of movies) {
        console.log(`\n${'='.repeat(50)}`);
        console.log(`${movie.name} (${movie.id})`);
        console.log('='.repeat(50));

        const movieDir = path.join(INPUTS_DIR, movie.id);
        const manifestPath = path.join(movieDir, 'manifest.json');

        if (!fs.existsSync(manifestPath)) {
            console.log(`  SKIP: No manifest for ${movie.id}`);
            totalSkipped++;
            continue;
        }

        const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

        const movieOutputDir = path.join(OUTPUT_DIR, movie.id);
        if (shouldOutput && !fs.existsSync(movieOutputDir)) {
            fs.mkdirSync(movieOutputDir, { recursive: true });
        }

        for (const sub of manifest.subtitles) {
            const filepath = path.join(movieDir, sub.filename);
            if (!fs.existsSync(filepath)) {
                console.log(`  SKIP: ${sub.filename} (file not found)`);
                totalSkipped++;
                continue;
            }

            const buffer = fs.readFileSync(filepath);

            const languageMatch = sub.filename.match(/^([a-z]{2,3})_/);
            const languageHint: string | null = languageMatch ? languageMatch[1] : null;

            const fileId = `${movie.id}/${sub.filename}`;

            if (languageHint && SKIP_LANGUAGE_CODES.includes(languageHint.toLowerCase())) {
                console.log(`  SKIPPED: ${fileId} (${sub.language}) - language code '${languageHint}' in skip list`);
                totalSkipped++;
                continue;
            }

            const decoded = await decodeSubtitleBuffer(buffer, languageHint, { skipLanguageValidation: true });

            const knownBadEntry = isKnownBad(filepath);
            if (knownBadEntry) {
                console.log(`  KNOWN BAD: ${fileId} (${sub.language}) - ${knownBadEntry.reason}`);
                totalKnownBad++;
                continue;
            }

            if (!decoded) {
                console.log(`  FAIL: ${fileId} (${sub.language}) - decode returned null`);
                totalFailed++;
                continue;
            }

            const mojibakeCheck = checkMojibake(decoded);
            const hasSuspiciousDensity = mojibakeCheck.hasMojibake;
            const hasReplacementCharacters = hasReplacementChars(decoded);

            if (hasReplacementCharacters) {
                console.log(`  FAIL: ${fileId} (${sub.language}) - encoding error (U+FFFD replacement chars)`);
                console.log(`        Preview: ${decoded.slice(0, 150).replace(/\n/g, ' ')}`);
                totalFailed++;
                continue;
            }

            if (shouldOutput) {
                const outputFilename = sub.filename.replace('.raw', '.srt');
                const outputPath = path.join(movieOutputDir, outputFilename);
                fs.writeFileSync(outputPath, decoded, 'utf8');
            }

            const detection = await detectLanguage(decoded, languageHint);

            const languageMatches = languageHint
                ? await validateLanguage(decoded, languageHint, { skipCorruptionCheck: true })
                : true;

            const warnings: string[] = [];
            if (hasSuspiciousDensity) {
                warnings.push(`HIGH LATIN-EXT: ${(mojibakeCheck.density * 100).toFixed(1)}%`);
            }
            const warningStr = warnings.length > 0 ? ` ⚠️  ${warnings.join(', ')}` : '';

            if (!detection.detected) {
                console.log(`  FAIL: ${fileId} (${sub.language}) - language undetectable (franc returned 'und')${warningStr}`);
                console.log(`        Preview: ${decoded.slice(2000, 2150).replace(/\n/g, ' ')}`);
                totalFailed++;
                continue;
            }

            if (languageMatches) {
                console.log(`  PASS: ${fileId} (${sub.language}) - detected ${detection.detected}${warningStr}`);
                totalPassed++;
            } else {
                console.log(`  MISLABELED: ${fileId} - expected ${sub.language}, detected ${detection.detected} (${detection.detected3})${warningStr}`);
                console.log(`        Preview: ${decoded.slice(2000, 2150).replace(/\n/g, ' ')}`);
                totalMislabeled++;
            }
        }
    }

    console.log(`\n${'='.repeat(50)}`);
    let resultsLine = `Results: ${totalPassed} passed, ${totalFailed} failed`;
    if (totalMislabeled > 0) {
        resultsLine += `, ${totalMislabeled} mislabeled`;
    }
    if (totalKnownBad > 0) {
        resultsLine += `, ${totalKnownBad} known bad`;
    }
    if (totalSkipped > 0) {
        resultsLine += `, ${totalSkipped} skipped`;
    }
    console.log(resultsLine);

    if (shouldOutput) {
        console.log(`\nDecoded files saved to: ${OUTPUT_DIR}`);
    }

    process.exit(totalFailed > 0 ? 1 : 0);
}

runTests().catch(err => {
    console.error('Test error:', err);
    process.exit(1);
});
