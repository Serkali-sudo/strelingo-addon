/**
 * Ensures test input files exist by downloading them if missing.
 * This module can be required by any test that needs input files.
 *
 * Usage:
 *   const ensureInputs = require('./ensure-inputs');
 *   await ensureInputs();  // Downloads if missing
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const movies = require('./movies');

const INPUTS_DIR = path.join(__dirname, 'inputs');

/**
 * Checks if all required input files exist for a given movie.
 * @param {Object} movie - Movie configuration from movies.js
 * @returns {boolean} True if all inputs exist
 */
function hasInputs(movie) {
    const movieDir = path.join(INPUTS_DIR, movie.id);
    const manifestPath = path.join(movieDir, 'manifest.json');

    // Check if manifest exists (indicates the movie was downloaded)
    if (!fs.existsSync(manifestPath)) {
        return false;
    }

    // Check if manifest has subtitles listed
    try {
        const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
        return manifest.subtitles && manifest.subtitles.length > 0;
    } catch (error) {
        return false;
    }
}

/**
 * Downloads input files for a specific movie.
 * @param {Object} movie - Movie configuration from movies.js
 * @returns {Promise<void>}
 */
async function downloadMovie(movie) {
    console.log(`Downloading inputs for: ${movie.name} (${movie.id})`);

    const downloadScript = path.join(__dirname, 'download-inputs.js');

    try {
        // Run download-inputs.js for this specific movie
        execSync(`node "${downloadScript}" ${movie.id}`, {
            stdio: 'inherit',
            cwd: path.dirname(__dirname)
        });
    } catch (error) {
        console.error(`Failed to download inputs for ${movie.id}: ${error.message}`);
        throw error;
    }
}

/**
 * Ensures all test inputs exist, downloading any that are missing.
 * @returns {Promise<void>}
 */
async function ensureInputs() {
    console.log('Checking test input files...');

    // Create inputs directory if it doesn't exist
    if (!fs.existsSync(INPUTS_DIR)) {
        fs.mkdirSync(INPUTS_DIR, { recursive: true });
    }

    const missingMovies = movies.filter(movie => !hasInputs(movie));

    if (missingMovies.length === 0) {
        console.log('✓ All test input files present');
        return;
    }

    console.log(`\nMissing inputs for ${missingMovies.length} movie(s):`);
    missingMovies.forEach(m => console.log(`  - ${m.name} (${m.id})`));
    console.log('\nDownloading missing inputs...\n');

    // Download missing movies sequentially
    for (const movie of missingMovies) {
        await downloadMovie(movie);
    }

    console.log('\n✓ All test inputs ready\n');
}

module.exports = ensureInputs;
