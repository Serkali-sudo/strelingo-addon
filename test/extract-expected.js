/**
 * Extract common words/phrases from decoded subtitle outputs.
 * This helps find expected strings for each language in movies.js.
 *
 * Usage: node test/extract-expected.js tt4154796
 */

const fs = require('fs');
const path = require('path');

const OUTPUT_DIR = path.join(__dirname, 'output');
const movieId = process.argv[2];

if (!movieId) {
    console.log('Usage: node test/extract-expected.js <imdb-id>');
    console.log('Example: node test/extract-expected.js tt4154796');
    process.exit(1);
}

const movieDir = path.join(OUTPUT_DIR, movieId);
if (!fs.existsSync(movieDir)) {
    console.error(`Directory not found: ${movieDir}`);
    process.exit(1);
}

// Get all .srt files grouped by language
const files = fs.readdirSync(movieDir).filter(f => f.endsWith('.srt'));
const byLang = {};

for (const file of files) {
    const lang = file.split('_')[0];
    if (!byLang[lang]) byLang[lang] = [];
    byLang[lang].push(file);
}

console.log(`\nExtracted expected strings for ${movieId}:\n`);
console.log('expectedStrings: {');

for (const [lang, langFiles] of Object.entries(byLang).sort()) {
    // Read first file for this language
    const filepath = path.join(movieDir, langFiles[0]);
    const content = fs.readFileSync(filepath, 'utf8');

    // Extract words (3+ chars, non-numeric, non-timing)
    const words = content
        .replace(/\d{2}:\d{2}:\d{2},\d{3}/g, '')  // Remove timestamps
        .replace(/-->/g, '')
        .replace(/<[^>]+>/g, '')  // Remove HTML tags
        .replace(/[^\p{L}\p{M}\s]/gu, ' ')  // Keep only letters
        .split(/\s+/)
        .filter(w => w.length >= 3);

    // Count word frequency
    const freq = {};
    for (const word of words) {
        freq[word] = (freq[word] || 0) + 1;
    }

    // Get top words (frequency > 5, length >= 4)
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
