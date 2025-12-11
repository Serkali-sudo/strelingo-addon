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
const { decodeSubtitleBuffer, detectLanguage, validateLanguage, SKIP_LANGUAGE_CODES } = require('../encoding');
const movies = require('./movies');
const { checkMojibake, hasReplacementChars } = require('./validators');
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
    let totalMislabeled = 0;

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

            // Extract language code from filename (e.g., "th_2_subf2m.raw" → "th" or "hun_1_bulk.raw" → "hun")
            const languageMatch = sub.filename.match(/^([a-z]{2,3})_/);
            const languageHint = languageMatch ? languageMatch[1] : null;

            // File identifier for output (includes movie ID for clarity)
            const fileId = `${movie.id}/${sub.filename}`;

            // Check if this language code should be skipped entirely
            if (languageHint && SKIP_LANGUAGE_CODES.includes(languageHint.toLowerCase())) {
                console.log(`  SKIPPED: ${fileId} (${sub.language}) - language code '${languageHint}' in skip list`);
                totalSkipped++;
                continue;
            }

            // Decode with skipLanguageValidation to always get text (even if wrong language)
            const decoded = await decodeSubtitleBuffer(buffer, languageHint, { skipLanguageValidation: true });

            // Check if this is a known bad input first (by hash)
            const knownBadEntry = isKnownBad(filepath);
            if (knownBadEntry) {
                console.log(`  KNOWN BAD: ${fileId} (${sub.language}) - ${knownBadEntry.reason}`);
                totalKnownBad++;
                continue;
            }

            // Check for encoding failures (null result or garbage)
            if (!decoded) {
                console.log(`  FAIL: ${fileId} (${sub.language}) - decode returned null`);
                totalFailed++;
                continue;
            }

            // Encoding quality checks using shared validators
            const mojibakeCheck = checkMojibake(decoded);
            const hasSuspiciousDensity = mojibakeCheck.hasMojibake;
            const hasReplacementCharacters = hasReplacementChars(decoded);

            // Hard fail: replacement characters indicate encoding failure
            if (hasReplacementCharacters) {
                console.log(`  FAIL: ${fileId} (${sub.language}) - encoding error (U+FFFD replacement chars)`);
                console.log(`        Preview: ${decoded.slice(0, 150).replace(/\n/g, ' ')}`);
                totalFailed++;
                continue;
            }

            // Save decoded output if requested
            if (shouldOutput) {
                const outputFilename = sub.filename.replace('.raw', '.srt');
                const outputPath = path.join(movieOutputDir, outputFilename);
                fs.writeFileSync(outputPath, decoded, 'utf8');
            }

            // Detect the actual language
            const detection = await detectLanguage(decoded, languageHint);

            // Check if content matches expected language using production validation
            const languageMatches = languageHint
                ? await validateLanguage(decoded, languageHint, { skipCorruptionCheck: true })
                : true;  // No language hint = accept

            // Build warning flags
            const warnings = [];
            if (hasSuspiciousDensity) {
                warnings.push(`HIGH LATIN-EXT: ${(mojibakeCheck.density * 100).toFixed(1)}%`);
            }
            const warningStr = warnings.length > 0 ? ` ⚠️  ${warnings.join(', ')}` : '';

            // Check for undetectable language (hard fail - indicates missing mapping)
            if (!detection.detected) {
                console.log(`  FAIL: ${fileId} (${sub.language}) - language undetectable (franc returned 'und')${warningStr}`);
                console.log(`        Preview: ${decoded.slice(2000, 2150).replace(/\n/g, ' ')}`);
                totalFailed++;
                continue;
            }

            if (languageMatches) {
                // PASS: Content matches expected language
                console.log(`  PASS: ${fileId} (${sub.language}) - detected ${detection.detected}${warningStr}`);
                totalPassed++;
            } else {
                // MISLABELED: Content decoded OK but is wrong language
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
