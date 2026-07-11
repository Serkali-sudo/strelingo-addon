/**
 * Extract common words/phrases from decoded subtitle outputs.
 * This helps find expected strings for each language in movies.ts.
 *
 * Usage: npx tsx test/extract-expected.ts tt4154796
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const OUTPUT_DIR = path.join(__dirname, 'output');
const movieId = process.argv[2];

if (!movieId) {
    console.log('Usage: npx tsx test/extract-expected.ts <imdb-id>');
    console.log('Example: npx tsx test/extract-expected.ts tt4154796');
    process.exit(1);
}

const movieDir = path.join(OUTPUT_DIR, movieId);
if (!fs.existsSync(movieDir)) {
    console.error(`Directory not found: ${movieDir}`);
    process.exit(1);
}

const files = fs.readdirSync(movieDir).filter(f => f.endsWith('.srt'));
const byLang: Record<string, string[]> = {};

for (const file of files) {
    const lang = file.split('_')[0];
    if (!byLang[lang]) byLang[lang] = [];
    byLang[lang].push(file);
}

console.log(`\nExtracted expected strings for ${movieId}:\n`);
console.log('expectedStrings: {');

for (const [lang, langFiles] of Object.entries(byLang).sort()) {
    const filepath = path.join(movieDir, langFiles[0]);
    const content = fs.readFileSync(filepath, 'utf8');

    const words = content
        .replace(/\d{2}:\d{2}:\d{2},\d{3}/g, '')
        .replace(/-->/g, '')
        .replace(/<[^>]+>/g, '')
        .replace(/[^\p{L}\p{M}\s]/gu, ' ')
        .split(/\s+/)
        .filter(w => w.length >= 3);

    const freq: Record<string, number> = {};
    for (const word of words) {
        freq[word] = (freq[word] || 0) + 1;
    }

    const topWords = Object.entries(freq)
        .filter(([word, count]) => count > 5 && word.length >= 4)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([word]) => word);

    if (topWords.length > 0) {
        console.log(`    '${lang}': [${topWords.map(w => `'${w}'`).join(', ')}],`);
    }
}

console.log('},');

