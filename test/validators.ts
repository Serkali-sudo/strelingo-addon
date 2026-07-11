/**
 * Shared validation utilities for subtitle testing.
 * Used by both encoding.test.ts and e2e.test.ts.
 */

import { normalizeLanguageCode } from '../src/encoding';
import type { MovieConfig } from './movies';

interface ValidationResult {
    valid: boolean;
    errors: string[];
    warnings: string[];
}

interface ExpectedStringsResult {
    found: string[];
    missing: string[];
    success: boolean;
}

interface DualLanguageResult {
    hasItalics: boolean;
    italicCount: number;
    dualCueCount: number;
}

interface SrtValidationResult {
    valid: boolean;
    errors: string[];
    cueCount: number;
}

/**
 * Check for mojibake (misencoded text) using Latin Extended density.
 * High density (>10%) of chars in U+0080-U+00FF range suggests mojibake.
 */
export function checkMojibake(content: string): { hasMojibake: boolean; density: number; matches: number } {
    const legacyMojibake = /[\u0080-\u00FF]/g;
    const matches = (content.match(legacyMojibake) || []).length;
    const density = content.length > 0 ? matches / content.length : 0;
    const hasMojibake = density > 0.10 && matches > 50;

    return { hasMojibake, density, matches };
}

/**
 * Check for replacement characters (encoding failures).
 * The Unicode replacement character U+FFFD indicates failed decoding.
 */
export function hasReplacementChars(content: string): boolean {
    return content.includes('\uFFFD');
}

/**
 * Check if expected strings are found in content.
 * Uses expectedStrings from movies.ts to verify proper decoding.
 */
export function checkExpectedStrings(content: string, expectedStrings: string[]): ExpectedStringsResult {
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
 */
export async function getExpectedStringsForLanguage(movieConfig: MovieConfig | undefined, langCode: string): Promise<string[]> {
    if (!movieConfig || !movieConfig.expectedStrings) {
        return [];
    }

    const lang2 = await normalizeLanguageCode(langCode) || langCode;

    return movieConfig.expectedStrings[lang2] || [];
}

/**
 * Validate subtitle content encoding.
 * Combines all encoding validation checks.
 */
export async function validateEncoding(content: string, options: { movieConfig?: MovieConfig; mainLang?: string; transLang?: string } = {}): Promise<ValidationResult> {
    const { movieConfig, mainLang, transLang } = options;
    const errors: string[] = [];
    const warnings: string[] = [];

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
        const mainExpected = await getExpectedStringsForLanguage(movieConfig, mainLang);
        if (mainExpected.length > 0) {
            const mainCheck = checkExpectedStrings(content, mainExpected);
            if (!mainCheck.success) {
                warnings.push(`No ${mainLang} expected strings found (expected: ${mainExpected.slice(0, 3).join(', ')}...)`);
            }
        }
    }

    // 4. Check expected strings for translation language
    if (transLang) {
        const transExpected = await getExpectedStringsForLanguage(movieConfig, transLang);
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
 */
export function checkDualLanguage(content: string): DualLanguageResult {
    const italicPattern = /<i>.*?<\/i>/gs;
    const italicMatches = content.match(italicPattern) || [];

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
 */
export function validateSrtFormat(content: string): SrtValidationResult {
    const errors: string[] = [];
    let cueCount = 0;

    const timestampPattern = /^\d{2}:\d{2}:\d{2},\d{3}\s*-->\s*\d{2}:\d{2}:\d{2},\d{3}/;

    const blocks = content.trim().split(/\n\s*\n/);

    for (let i = 0; i < blocks.length; i++) {
        const block = blocks[i].trim();
        if (!block) continue;

        const lines = block.split(/\r?\n/);
        if (lines.length < 3) {
            if (lines.length === 2 && timestampPattern.test(lines[1])) {
                errors.push(`Cue ${i + 1}: Missing text content`);
            }
            continue;
        }

        const id = parseInt(lines[0], 10);
        if (isNaN(id)) {
            errors.push(`Cue ${i + 1}: Invalid ID "${lines[0].slice(0, 20)}"`);
            continue;
        }

        if (!timestampPattern.test(lines[1])) {
            errors.push(`Cue ${i + 1}: Invalid timestamp "${lines[1].slice(0, 50)}"`);
            continue;
        }

        const text = lines.slice(2).join('\n').trim();
        if (!text) {
            errors.push(`Cue ${i + 1}: Empty text content`);
            continue;
        }

        cueCount++;
    }

    if (cueCount === 0) {
        errors.push('No valid SRT cues found');
    } else if (cueCount < 10) {
        errors.push(`Very few cues (${cueCount}) - possibly truncated`);
    }

    return {
        valid: errors.length === 0,
        errors: errors.slice(0, 5),
        cueCount
    };
}

