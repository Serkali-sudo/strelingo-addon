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
const { decodeSubtitleBuffer } = require('../encoding');
const movies = require('./movies');

const INPUTS_DIR = path.join(__dirname, 'inputs');
const OUTPUT_DIR = path.join(__dirname, 'output');

const args = process.argv.slice(2);
const shouldOutput = args.includes('--output') || args.includes('-o');

async function ensureInputsExist(movie) {
    const movieDir = path.join(INPUTS_DIR, movie.id);
    const manifestPath = path.join(movieDir, 'manifest.json');

    if (!fs.existsSync(manifestPath)) {
        console.log(`Inputs missing for ${movie.name} (${movie.id}), downloading...`);

        // Dynamically run download
        const { execSync } = require('child_process');
        execSync(`node "${path.join(__dirname, 'download-inputs.js')}" ${movie.id}`, {
            stdio: 'inherit',
            cwd: path.join(__dirname, '..')
        });
    }

    return fs.existsSync(manifestPath);
}

async function runTests() {
    console.log('Running encoding tests...\n');

    let totalPassed = 0;
    let totalFailed = 0;
    let totalSkipped = 0;

    for (const movie of movies) {
        console.log(`\n${'='.repeat(50)}`);
        console.log(`${movie.name} (${movie.id})`);
        console.log('='.repeat(50));

        // Ensure inputs exist (auto-download if not)
        const inputsReady = await ensureInputsExist(movie);
        if (!inputsReady) {
            console.log(`  SKIP: Could not get inputs for ${movie.id}`);
            totalSkipped++;
            continue;
        }

        const movieDir = path.join(INPUTS_DIR, movie.id);
        const manifestPath = path.join(movieDir, 'manifest.json');
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
            const decoded = decodeSubtitleBuffer(buffer, true);

            // Save decoded output if requested
            if (shouldOutput) {
                const outputFilename = sub.filename.replace('.raw', '.srt');
                const outputPath = path.join(movieOutputDir, outputFilename);
                fs.writeFileSync(outputPath, decoded, 'utf8');
            }

            // Check expected strings
            const expectedStrings = sub.expectedStrings || [];
            const foundStrings = expectedStrings.filter(s => decoded.includes(s));
            const success = expectedStrings.length === 0 || foundStrings.length > 0;

            if (success) {
                console.log(`  PASS: ${sub.filename} (${sub.language}) - BOM: ${sub.bom}`);
                if (foundStrings.length > 0) {
                    console.log(`        Found: ${foundStrings.join(', ')}`);
                }
                totalPassed++;
            } else {
                console.log(`  FAIL: ${sub.filename} (${sub.language}) - BOM: ${sub.bom}`);
                console.log(`        Expected: ${expectedStrings.join(', ')}`);
                console.log(`        Preview: ${decoded.slice(0, 150).replace(/\n/g, ' ')}`);
                totalFailed++;
            }
        }
    }

    console.log(`\n${'='.repeat(50)}`);
    console.log(`Results: ${totalPassed} passed, ${totalFailed} failed, ${totalSkipped} skipped`);

    if (shouldOutput) {
        console.log(`\nDecoded files saved to: ${OUTPUT_DIR}`);
    }

    process.exit(totalFailed > 0 ? 1 : 0);
}

runTests().catch(err => {
    console.error('Test error:', err);
    process.exit(1);
});
