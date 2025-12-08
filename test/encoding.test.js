/**
 * Encoding tests for subtitle decoding.
 * Tests against real subtitles to verify encoding detection and fixing.
 *
 * Usage:
 *   node test/encoding.test.js              # Run tests
 *   node test/encoding.test.js --output     # Run tests and save decoded files
 *   node test/encoding.test.js -o           # Same as --output
 *
 * If inputs don't exist, they will be downloaded automatically.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { decodeSubtitleBuffer } = require('../encoding');
const movies = require('./movies');
const { checkMojibake, checkExpectedStrings, getExpectedStringsForLanguage, hasReplacementChars } = require('./validators');
const ensureInputs = require('./ensure-inputs');

const INPUTS_DIR = path.join(__dirname, 'inputs');
const OUTPUT_DIR = path.join(__dirname, 'output');

// === Known Bad Inputs ===
// IMPORTANT: Files should ONLY be added to known-bad-inputs.json after thorough 
// investigation proving the input file is genuinely corrupt or unfixable (and 
// not a bug in encoding detection).
const KNOWN_BAD_FILE = path.join(__dirname, 'known-bad-inputs.json');
let knownBadData = null;
function loadKnownBad() {
    if (knownBadData !== null) return knownBadData;
    if (fs.existsSync(KNOWN_BAD_FILE)) {
        knownBadData = JSON.parse(fs.readFileSync(KNOWN_BAD_FILE, 'utf8'));
    } else {
        knownBadData = { hashes: {} };
    }
    return knownBadData;
}

function hashFile(filepath) {
    const buffer = fs.readFileSync(filepath);
    return crypto.createHash('sha256').update(buffer).digest('hex');
}

/**
 * Check if a file is a known bad/corrupt input by its hash.
 * Returns the entry if known bad, null otherwise.
 */
function isKnownBad(filepath) {
    const data = loadKnownBad();
    const hash = hashFile(filepath);
    return data.hashes[hash] || null;
}

const args = process.argv.slice(2);
const shouldOutput = args.includes('--output') || args.includes('-o');

async function runTests() {
    console.log('Running encoding tests...\n');

    // Ensure all test inputs exist (downloads if missing)
    await ensureInputs();

    let totalPassed = 0;
    let totalFailed = 0;
    let totalSkipped = 0;
    let totalKnownBad = 0;

    for (const movie of movies) {
        console.log(`\n${'='.repeat(50)}`);
        console.log(`${movie.name} (${movie.id})`);
        console.log('='.repeat(50));

        const movieDir = path.join(INPUTS_DIR, movie.id);
        const manifestPath = path.join(movieDir, 'manifest.json');

        // Skip if manifest doesn't exist (download may have failed)
        if (!fs.existsSync(manifestPath)) {
            console.log(`  SKIP: No manifest for ${movie.id}`);
            totalSkipped++;
            continue;
        }

        const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

        // Create output dir if needed
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

            // Extract language code from filename (e.g., "th_2_subf2m.raw" → "th")
            const languageMatch = sub.filename.match(/^([a-z]{2})_/);
            const languageHint = languageMatch ? languageMatch[1] : null;

            const decoded = decodeSubtitleBuffer(buffer, languageHint, true);

            // Encoding quality checks using shared validators
            const mojibakeCheck = checkMojibake(decoded);
            const hasSuspiciousDensity = mojibakeCheck.hasMojibake;
            const hasReplacementCharacters = hasReplacementChars(decoded);

            // Save decoded output if requested
            if (shouldOutput) {
                const outputFilename = sub.filename.replace('.raw', '.srt');
                const outputPath = path.join(movieOutputDir, outputFilename);
                fs.writeFileSync(outputPath, decoded, 'utf8');
            }

            // Check expected strings using shared validator
            // Look up from movies.js by language code (more flexible than manifest)
            const expectedStrings = getExpectedStringsForLanguage(movie, languageHint);
            const stringCheck = checkExpectedStrings(decoded, expectedStrings);
            const success = stringCheck.success;

            // File identifier for output (includes movie ID for clarity)
            const fileId = `${movie.id}/${sub.filename}`;

            // Build warning flags
            const warnings = [];
            if (hasSuspiciousDensity) {
                warnings.push(`HIGH LATIN-EXT: ${(mojibakeCheck.density * 100).toFixed(1)}%`);
            }
            if (hasReplacementCharacters) {
                warnings.push('HAS REPLACEMENT CHARS (U+FFFD)');
            }
            const warningStr = warnings.length > 0 ? ` ⚠️  ${warnings.join(', ')}` : '';

            if (success && !hasReplacementCharacters) {
                // Pass: expected strings found and no hard encoding errors
                console.log(`  PASS: ${fileId} (${sub.language})${warningStr}`);
                if (stringCheck.found.length > 0) {
                    console.log(`        Found: ${stringCheck.found.join(', ')}`);
                }
                totalPassed++;
            } else {
                // Check if this is a known bad input (by hash)
                const knownBadEntry = isKnownBad(filepath);
                if (knownBadEntry) {
                    console.log(`  KNOWN BAD: ${fileId} (${sub.language}) - ${knownBadEntry.reason}`);
                    totalKnownBad++;
                } else {
                    // Fail: missing expected strings OR has replacement characters
                    const failReasons = [];
                    if (!success) failReasons.push('expected strings not found');
                    if (hasReplacementCharacters) failReasons.push('encoding errors (U+FFFD)');

                    console.log(`  FAIL: ${fileId} (${sub.language})${warningStr}`);
                    console.log(`        Reason: ${failReasons.join(', ')}`);
                    if (!success) {
                        console.log(`        Expected: ${expectedStrings.join(', ')}`);
                    }
                    console.log(`        Preview: ${decoded.slice(0, 150).replace(/\n/g, ' ')}`);
                    totalFailed++;
                }
            }
        }
    }

    console.log(`\n${'='.repeat(50)}`);
    let resultsLine = `Results: ${totalPassed} passed, ${totalFailed} failed`;
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
