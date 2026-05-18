/**
 * Ensures test input files exist by downloading them if missing.
 * This module can be imported by any test that needs input files.
 *
 * Usage:
 *   import ensureInputs from './ensure-inputs';
 *   await ensureInputs();  // Downloads if missing
 */

import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';
import movies from './movies';
import type { MovieConfig } from './movies';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const INPUTS_DIR = path.join(__dirname, 'inputs');

/**
 * Checks if all required input files exist for a given movie.
 */
function hasInputs(movie: MovieConfig): boolean {
    const movieDir = path.join(INPUTS_DIR, movie.id);
    const manifestPath = path.join(movieDir, 'manifest.json');

    if (!fs.existsSync(manifestPath)) {
        return false;
    }

    try {
        const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
        return manifest.subtitles && manifest.subtitles.length > 0;
    } catch (error) {
        return false;
    }
}

/**
 * Downloads input files for a specific movie.
 */
async function downloadMovie(movie: MovieConfig): Promise<void> {
    console.log(`Downloading inputs for: ${movie.name} (${movie.id})`);

    const downloadScript = path.join(__dirname, 'download-inputs.ts');

    try {
        execSync(`npx tsx "${downloadScript}" ${movie.id}`, {
            stdio: 'inherit',
            cwd: path.dirname(__dirname)
        });
    } catch (error: any) {
        console.error(`Failed to download inputs for ${movie.id}: ${error.message}`);
        throw error;
    }
}

/**
 * Ensures all test inputs exist, downloading any that are missing.
 */
export default async function ensureInputs(): Promise<void> {
    console.log('Checking test input files...');

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

    for (const movie of missingMovies) {
        await downloadMovie(movie);
    }

    console.log('\n✓ All test inputs ready\n');
}
