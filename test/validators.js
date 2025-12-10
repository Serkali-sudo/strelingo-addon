/**
 * Shared validation utilities for subtitle testing.
 * Used by both encoding.test.js and e2e.test.js.
 */

const { normalizeLanguageCode } = require('../encoding');

/**
 * Check for mojibake (misencoded text) using Latin Extended density.
 * High density (>10%) of chars in U+0080-U+00FF range suggests mojibake.
 *
 * @param {string} content - Decoded text content
 * @returns {{ hasMojibake: boolean, density: number, matches: number }}
 */
function checkMojibake(content) {
    const legacyMojibake = /[\u0080-\u00FF]/g;
    const matches = (content.match(legacyMojibake) || []).length;
    const density = content.length > 0 ? matches / content.length : 0;
    const hasMojibake = density > 0.10 && matches > 50;

    return { hasMojibake, density, matches };
}

/**
 * Check for replacement characters (encoding failures).
 * The Unicode replacement character U+FFFD indicates failed decoding.
 *
 * @param {string} content - Decoded text content
 * @returns {boolean} True if replacement characters found
 */
function hasReplacementChars(content) {
    return content.includes('\uFFFD');
}

/**
 * Check if expected strings are found in content.
 * Uses expectedStrings from movies.js to verify proper decoding.
 *
 * @param {string} content - Decoded text content
 * @param {string[]} expectedStrings - Array of strings that should be found
 * @returns {{ found: string[], missing: string[], success: boolean }}
 */
function checkExpectedStrings(content, expectedStrings) {
    if (!expectedStrings || expectedStrings.length === 0) {
        return { found: [], missing: [], success: true };
    }

    const found = expectedStrings.filter(s => content.includes(s));
    const missing = expectedStrings.filter(s => !content.includes(s));
    const success = found.length > 0;

    return { found, missing, success };
}

/**
 * Get expected strings for a language from movie config.
 * Handles both 2-letter and 3-letter language codes.
 *
 * @param {Object} movieConfig - Movie config object with expectedStrings
 * @param {string} langCode - Language code (2 or 3 letter)
 * @returns {string[]} Expected strings for the language, or empty array
 */
function getExpectedStringsForLanguage(movieConfig, langCode) {
    if (!movieConfig || !movieConfig.expectedStrings) {
        return [];
    }

    // Convert to 2-letter code (normalizeLanguageCode handles both 2 and 3 letter codes)
    const lang2 = normalizeLanguageCode(langCode) || langCode;

    return movieConfig.expectedStrings[lang2] || [];
}

/**
 * Validate subtitle content encoding.
 * Combines all encoding validation checks.
 *
 * @param {string} content - Decoded subtitle content
 * @param {Object} options - Validation options
 * @param {Object} options.movieConfig - Movie config from movies.js (has expectedStrings)
 * @param {string} options.mainLang - Main language code (2 or 3 letter)
 * @param {string} options.transLang - Translation language code (2 or 3 letter)
 * @returns {{ valid: boolean, errors: string[], warnings: string[] }}
 */
function validateEncoding(content, options = {}) {
    const { movieConfig, mainLang, transLang } = options;
    const errors = [];
    const warnings = [];

    // 1. Check for replacement characters (hard error)
    if (hasReplacementChars(content)) {
        errors.push('Contains replacement characters (encoding error)');
    }

    // 2. Check for mojibake (warning - may be legitimate accented text)
    const mojibake = checkMojibake(content);
    if (mojibake.hasMojibake) {
        warnings.push(`High Latin Extended density: ${(mojibake.density * 100).toFixed(1)}% (possible mojibake)`);
    }

    // 3. Check expected strings for main language
    if (mainLang) {
        const mainExpected = getExpectedStringsForLanguage(movieConfig, mainLang);
        if (mainExpected.length > 0) {
            const mainCheck = checkExpectedStrings(content, mainExpected);
            if (!mainCheck.success) {
                warnings.push(`No ${mainLang} expected strings found (expected: ${mainExpected.slice(0, 3).join(', ')}...)`);
            }
        }
    }

    // 4. Check expected strings for translation language
    if (transLang) {
        const transExpected = getExpectedStringsForLanguage(movieConfig, transLang);
        if (transExpected.length > 0) {
            const transCheck = checkExpectedStrings(content, transExpected);
            if (!transCheck.success) {
                warnings.push(`No ${transLang} expected strings found (expected: ${transExpected.slice(0, 3).join(', ')}...)`);
            }
        }
    }

    // 5. Basic sanity check - should have substantial content
    if (content.length < 1000) {
        errors.push(`Content too short (${content.length} chars)`);
    }

    return { valid: errors.length === 0, errors, warnings };
}

/**
 * Check for dual-language format (main text + italic translation).
 * Strelingo adds translations in <i> tags.
 *
 * @param {string} content - Subtitle content
 * @returns {{ hasItalics: boolean, italicCount: number, dualCueCount: number }}
 */
function checkDualLanguage(content) {
    // Look for italic tags indicating translation
    const italicPattern = /<i>.*?<\/i>/gs;
    const italicMatches = content.match(italicPattern) || [];

    // Count cues with both main and italic text
    // Pattern: timestamp line followed by non-italic text, then italic text
    const dualCuePattern = /\d{2}:\d{2}:\d{2},\d{3}\s*-->\s*\d{2}:\d{2}:\d{2},\d{3}\r?\n[^<\r\n]+\r?\n<i>/g;
    const dualCues = content.match(dualCuePattern) || [];

    return {
        hasItalics: italicMatches.length > 0,
        italicCount: italicMatches.length,
        dualCueCount: dualCues.length
    };
}

/**
 * Validate SRT format structure.
 * Checks that content follows SRT specification:
 * - Sequential numeric IDs
 * - Valid timestamps (HH:MM:SS,mmm --> HH:MM:SS,mmm)
 * - Non-empty text content
 *
 * @param {string} content - SRT file content
 * @returns {{ valid: boolean, errors: string[], cueCount: number }}
 */
function validateSrtFormat(content) {
    const errors = [];
    let cueCount = 0;

    // SRT cue pattern: number, timestamp line, text (one or more lines), blank line
    const timestampPattern = /^\d{2}:\d{2}:\d{2},\d{3}\s*-->\s*\d{2}:\d{2}:\d{2},\d{3}/;

    // Split into blocks (separated by blank lines)
    const blocks = content.trim().split(/\n\s*\n/);

    for (let i = 0; i < blocks.length; i++) {
        const block = blocks[i].trim();
        if (!block) continue;

        const lines = block.split(/\r?\n/);
        if (lines.length < 3) {
            // Allow 2-line blocks (ID + timestamp + text on same conceptual unit)
            if (lines.length === 2 && timestampPattern.test(lines[1])) {
                errors.push(`Cue ${i + 1}: Missing text content`);
            }
            continue;
        }

        // Line 1: Should be a number
        const id = parseInt(lines[0], 10);
        if (isNaN(id)) {
            errors.push(`Cue ${i + 1}: Invalid ID "${lines[0].slice(0, 20)}"`);
            continue;
        }

        // Line 2: Should be timestamp
        if (!timestampPattern.test(lines[1])) {
            errors.push(`Cue ${i + 1}: Invalid timestamp "${lines[1].slice(0, 50)}"`);
            continue;
        }

        // Lines 3+: Should have text
        const text = lines.slice(2).join('\n').trim();
        if (!text) {
            errors.push(`Cue ${i + 1}: Empty text content`);
            continue;
        }

        cueCount++;
    }

    // Basic sanity checks
    if (cueCount === 0) {
        errors.push('No valid SRT cues found');
    } else if (cueCount < 10) {
        errors.push(`Very few cues (${cueCount}) - possibly truncated`);
    }

    return {
        valid: errors.length === 0,
        errors: errors.slice(0, 5), // Limit to first 5 errors
        cueCount
    };
}

module.exports = {
    checkMojibake,
    hasReplacementChars,
    checkExpectedStrings,
    getExpectedStringsForLanguage,
    validateEncoding,
    checkDualLanguage,
    validateSrtFormat,
};
