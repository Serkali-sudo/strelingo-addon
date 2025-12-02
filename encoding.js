/**
 * Subtitle encoding detection and fixing utilities.
 * Handles various encodings including UTF-8, UTF-16, legacy codepages, and double-encoded text.
 */

const chardet = require('chardet');
const iconv = require('iconv-lite');

// Sample size for chardet detection (1KB is enough for accurate detection)
const CHARDET_SAMPLE_SIZE = 1024;

/**
 * Detect and fix character encoding issues in decoded text.
 * Handles two types of misencoding:
 *
 * 1. Double-encoded UTF-8: UTF-8 bytes incorrectly treated as Latin-1 and re-encoded.
 *    Example: Thai ก (U+0E01) = E0 B8 81 in UTF-8
 *             Double-encoded: E0→C3 A0, B8→C2 B8, 81→C2 81
 *             Fix: Latin-1 bytes → UTF-8
 *
 * 2. Misencoded legacy codepage: Windows-125x bytes treated as Latin-1 and UTF-8 encoded.
 *    Example: Russian Всё (Windows-1251: C2 F1 B8) → Latin-1 chars → UTF-8 → Âñ¸
 *             Fix: Latin-1 bytes → Windows-1251
 *
 * @param {string} text - The text to check and potentially fix
 * @param {boolean} silent - If true, don't log messages (for testing)
 * @returns {string} The fixed text, or original if no fix needed
 */
function fixCharacterEncodings(text, silent = false) {
    const log = silent ? () => {} : console.log.bind(console);

    // Look for patterns that indicate misencoded text:
    // When text is incorrectly treated as Latin-1 and re-encoded to UTF-8,
    // certain byte ranges become specific Latin-1 characters.
    //
    // UTF-8 lead byte ranges (for double-encoded UTF-8):
    // - C2-C3: Latin Extended (accented chars, special symbols)
    // - C4-C5: Extended Latin (Lithuanian, Latvian, Polish, etc.)
    // - D0-D4: Cyrillic (Russian, Ukrainian, Bulgarian, etc.)
    // - D7: Hebrew
    // - D8-DB: Arabic, Syriac
    // - E0-EF: 3-byte sequences (Thai, CJK, etc.)
    //
    // Windows codepage ranges (for misencoded legacy text):
    // - Windows-1251 (Cyrillic): 0x80-0xFF → Latin Extended chars when UTF-8 encoded
    // - Windows-1253 (Greek): 0x80-0xFF → Latin Extended chars when UTF-8 encoded
    //
    // Pattern: lead byte (as Latin-1 char) followed by continuation byte (0x80-0xBF)
    const patterns = {
        thaiCjk: /[\u00E0-\u00EF][\u0080-\u00BF]/g,      // 3-byte sequences
        accented: /\u00C3[\u0080-\u00BF]/g,              // Latin accented (á, é, ñ, etc.)
        special: /\u00C2[\u0080-\u00BF]/g,              // Latin special (©, ®, etc.)
        extLatin: /[\u00C4-\u00C5][\u0080-\u00BF]/g,     // Lithuanian, Latvian, etc.
        cyrillic: /[\u00D0-\u00D4][\u0080-\u00BF]/g,     // Russian, Ukrainian, etc.
        hebrew: /\u00D7[\u0080-\u00BF]/g,                // Hebrew (×)
        arabic: /[\u00D8-\u00DB][\u0080-\u00BF]/g,       // Arabic, Syriac (Ø, Ù, Ú, Û)
    };

    // Additional pattern for misencoded legacy codepages (Win-1251/1253/etc):
    // When Windows codepage bytes are interpreted as Latin-1 and UTF-8 encoded,
    // then decoded as UTF-8, you get scattered Latin Extended chars (U+0080-U+00FF).
    // Look for high density of these chars that don't form valid UTF-8 patterns.
    const legacyMojibake = /[\u0080-\u00FF]/g;

    const matches = {};
    let totalMatches = 0;
    for (const [name, pattern] of Object.entries(patterns)) {
        matches[name] = (text.match(pattern) || []).length;
        totalMatches += matches[name];
    }

    // Also check for legacy mojibake (scattered Latin Extended chars without UTF-8 patterns)
    const legacyMatches = (text.match(legacyMojibake) || []).length;
    const textLength = text.length;
    const legacyDensity = textLength > 0 ? legacyMatches / textLength : 0;

    // If there are many double-encoding patterns, it's likely misencoded
    if (totalMatches > 10) {
        const breakdown = Object.entries(matches).filter(([,v]) => v > 0).map(([k,v]) => `${v} ${k}`).join(', ');
        log(`[ENCODING] Detected likely misencoded text (${totalMatches} patterns: ${breakdown})`);

        // Convert from UTF-8 string to Latin-1 bytes for further processing
        const bytes = Buffer.from(text, 'latin1');

        // Try UTF-8 first (double-encoded UTF-8)
        const utf8Fixed = bytes.toString('utf8');
        if (!utf8Fixed.includes('\uFFFD')) {
            let fixedTotal = 0;
            for (const pattern of Object.values(patterns)) {
                fixedTotal += (utf8Fixed.match(pattern) || []).length;
            }
            if (fixedTotal < totalMatches * 0.2) {
                log(`[ENCODING] Fixed as double-encoded UTF-8 (patterns: ${totalMatches} → ${fixedTotal})`);
                return utf8Fixed;
            }
        }

        // UTF-8 didn't work - try Windows codepages
        // These are legacy encodings where bytes 0x80-0xFF encode language-specific chars
        const codepages = [
            { name: 'win1251', desc: 'Windows-1251 (Cyrillic)' },
            { name: 'win1253', desc: 'Windows-1253 (Greek)' },
            { name: 'win1252', desc: 'Windows-1252 (Western)' },
            { name: 'win1254', desc: 'Windows-1254 (Turkish)' },
            { name: 'win1255', desc: 'Windows-1255 (Hebrew)' },
            { name: 'win1256', desc: 'Windows-1256 (Arabic)' },
        ];

        for (const { name, desc } of codepages) {
            try {
                const fixed = iconv.decode(bytes, name);

                // Check if this produces valid-looking text:
                // 1. No replacement characters
                // 2. Dramatically reduces mojibake patterns
                if (fixed.includes('\uFFFD')) continue;

                let fixedTotal = 0;
                for (const pattern of Object.values(patterns)) {
                    fixedTotal += (fixed.match(pattern) || []).length;
                }

                if (fixedTotal < totalMatches * 0.2) {
                    log(`[ENCODING] Fixed as ${desc} (patterns: ${totalMatches} → ${fixedTotal})`);
                    return fixed;
                }
            } catch (e) {
                // Codepage not supported or decode failed
            }
        }

        log(`[ENCODING] Could not find valid encoding, keeping original`);
    }
    // Fallback: high density of Latin Extended chars without UTF-8 patterns
    // This catches cases like Windows-1253 Greek where bytes were interpreted as Latin-1
    // Threshold: >10% Latin Extended chars suggests misencoded legacy text
    else if (legacyDensity > 0.10 && legacyMatches > 50) {
        log(`[ENCODING] High Latin Extended density (${(legacyDensity * 100).toFixed(1)}%, ${legacyMatches} chars) - trying legacy codepages`);

        const bytes = Buffer.from(text, 'latin1');
        const codepages = [
            { name: 'win1253', desc: 'Windows-1253 (Greek)' },
            { name: 'win1251', desc: 'Windows-1251 (Cyrillic)' },
            { name: 'win1252', desc: 'Windows-1252 (Western)' },
            { name: 'win1254', desc: 'Windows-1254 (Turkish)' },
            { name: 'win1255', desc: 'Windows-1255 (Hebrew)' },
            { name: 'win1256', desc: 'Windows-1256 (Arabic)' },
        ];

        for (const { name, desc } of codepages) {
            try {
                const fixed = iconv.decode(bytes, name);
                if (fixed.includes('\uFFFD')) continue;

                // Check if Latin Extended density dropped significantly
                const fixedLegacy = (fixed.match(legacyMojibake) || []).length;
                const fixedDensity = fixed.length > 0 ? fixedLegacy / fixed.length : 0;

                if (fixedDensity < legacyDensity * 0.3) {
                    log(`[ENCODING] Fixed as ${desc} (Latin Ext: ${(legacyDensity * 100).toFixed(1)}% → ${(fixedDensity * 100).toFixed(1)}%)`);
                    return fixed;
                }
            } catch (e) {
                // Codepage not supported
            }
        }
        log(`[ENCODING] Legacy codepage fix failed, keeping original`);
    }

    return text;
}

/**
 * Normalize encoding name from chardet to iconv-lite compatible name.
 * @param {string} encoding - The encoding name from chardet
 * @returns {string} The normalized encoding name for iconv-lite
 */
function normalizeEncoding(encoding) {
    if (!encoding) return 'utf8';

    const normalized = encoding.toLowerCase();
    switch (normalized) {
        case 'windows-1254':
            return 'win1254';
        case 'windows-1251':
            return 'win1251';
        case 'windows-1252':
            return 'win1252';
        case 'iso-8859-9':
            return 'iso88599';
        case 'utf-16le':
            return 'utf16le';
        case 'utf-16be':
            return 'utf16be';
        case 'ascii':
        case 'us-ascii':
        case 'utf-8':
            return 'utf8';
        default:
            // Check if iconv-lite supports it directly
            if (iconv.encodingExists(normalized)) {
                return normalized;
            }
            return 'utf8';
    }
}

/**
 * Decode a subtitle buffer, handling various encodings:
 * - UTF-16 LE/BE (with BOM)
 * - Double-encoded UTF-16 (when UTF-16 BOM is double-encoded to UTF-8)
 * - UTF-8 (with or without BOM)
 * - Legacy encodings via chardet (Windows-1251, ISO-8859-x, etc.)
 * - Double-encoded UTF-8 text
 *
 * @param {Buffer} buffer - The raw subtitle file buffer
 * @param {boolean} silent - If true, don't log messages (for testing)
 * @returns {string} The decoded subtitle text
 */
function decodeSubtitleBuffer(buffer, silent = false) {
    const log = silent ? () => {} : console.log.bind(console);
    let subtitleText;

    // Check for double-encoded UTF-16 LE BOM (FF FE → C3 BF C3 BE)
    if (buffer.length >= 4 && buffer[0] === 0xC3 && buffer[1] === 0xBF && buffer[2] === 0xC3 && buffer[3] === 0xBE) {
        log('[ENCODING] Detected double-encoded UTF-16 LE, fixing...');
        // First undo the double-encoding by interpreting as Latin-1
        const undoubled = Buffer.from(buffer.toString('utf8'), 'latin1');
        // UTF-16 LE (skip BOM)
        subtitleText = undoubled.slice(2).toString('utf16le');
    }

    // Check for regular UTF-16 LE BOM (FF FE)
    else if (buffer.length >= 2 && buffer[0] === 0xFF && buffer[1] === 0xFE) {
        log('[ENCODING] Detected UTF-16 LE BOM, decoding...');
        subtitleText = buffer.slice(2).toString('utf16le');
    }

    // Check for double-encoded UTF-16 BE BOM (FE FF → C3 BE C3 BF)
    else if (buffer.length >= 4 && buffer[0] === 0xC3 && buffer[1] === 0xBE && buffer[2] === 0xC3 && buffer[3] === 0xBF) {
        log('[ENCODING] Detected double-encoded UTF-16 BE, fixing...');
        const undoubled = Buffer.from(buffer.toString('utf8'), 'latin1');
        // Swap bytes for BE
        const swapped = Buffer.alloc(undoubled.length - 2);
        for (let i = 2; i < undoubled.length; i += 2) {
            if (i + 1 < undoubled.length) {
                swapped[i - 2] = undoubled[i + 1];
                swapped[i - 1] = undoubled[i];
            }
        }
        subtitleText = swapped.toString('utf16le');
    }

    // Check for regular UTF-16 BE BOM (FE FF)
    else if (buffer.length >= 2 && buffer[0] === 0xFE && buffer[1] === 0xFF) {
        log('[ENCODING] Detected UTF-16 BE BOM, decoding...');
        const swapped = Buffer.alloc(buffer.length - 2);
        for (let i = 2; i < buffer.length; i += 2) {
            if (i + 1 < buffer.length) {
                swapped[i - 2] = buffer[i + 1];
                swapped[i - 1] = buffer[i];
            }
        }
        subtitleText = swapped.toString('utf16le');
    }

    // Check for double-encoded UTF-8 BOM (EF BB BF → C3 AF C2 BB C2 BF)
    else if (buffer.length >= 6 && buffer[0] === 0xC3 && buffer[1] === 0xAF &&
             buffer[2] === 0xC2 && buffer[3] === 0xBB && buffer[4] === 0xC2 && buffer[5] === 0xBF) {
        log('[ENCODING] Detected double-encoded UTF-8 BOM, fixing...');
        // Skip the double-encoded BOM and decode the rest
        subtitleText = buffer.slice(6).toString('utf8');
    }

    // Check for UTF-8 BOM (EF BB BF)
    else if (buffer.length >= 3 && buffer[0] === 0xEF && buffer[1] === 0xBB && buffer[2] === 0xBF) {
        log('[ENCODING] Detected UTF-8 BOM');
        subtitleText = buffer.slice(3).toString('utf8');
    }

    // No BOM - use chardet to detect encoding
    else {
        // Sample first 1KB for faster detection
        const sample = buffer.slice(0, Math.min(buffer.length, CHARDET_SAMPLE_SIZE));
        const detectedEncoding = chardet.detect(sample);
        const encoding = normalizeEncoding(detectedEncoding);

        if (encoding !== 'utf8') {
            log(`[ENCODING] chardet detected: ${detectedEncoding} → using ${encoding}`);
            try {
                subtitleText = iconv.decode(buffer, encoding);
            } catch (e) {
                log(`[ENCODING] iconv decode failed for ${encoding}, falling back to UTF-8`);
                subtitleText = buffer.toString('utf8');
            }
        } else {
            subtitleText = buffer.toString('utf8');
        }
    }

    // Apply text-level encoding fixes (e.g., double-encoded UTF-8)
    subtitleText = fixCharacterEncodings(subtitleText, silent);

    // Final cleanup: strip any BOM that might have survived
    // - U+FEFF (real BOM as character)
    // - "ï»¿" (mojibake BOM that wasn't caught earlier)
    if (subtitleText.startsWith('\uFEFF')) {
        subtitleText = subtitleText.slice(1);
    }
    if (subtitleText.startsWith('ï»¿')) {
        subtitleText = subtitleText.slice(3);
    }

    return subtitleText;
}

module.exports = {
    fixCharacterEncodings,
    decodeSubtitleBuffer
};
