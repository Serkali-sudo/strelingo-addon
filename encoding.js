/**
 * Subtitle encoding detection and fixing utilities.
 * Handles various encodings including UTF-8, UTF-16, legacy codepages, and double-encoded text.
 */

const chardet = require('chardet');

// Check if we are in Cloudflare Workers environment
const isWorkers = (typeof process !== 'undefined' && process.env && process.env.IS_CLOUDFLARE_WORKERS);

let iconv;
if (!isWorkers) {
    iconv = require('iconv-lite');
} else {
    // In Workers, we might need a polyfill or just fallback to UTF-8/TextDecoder
    // For now, we'll implement a minimal mock that handles what we can with TextDecoder
    console.log("Running in Workers: Using limited TextDecoder fallback for iconv-lite");
    iconv = {
        decode: (buffer, encoding) => {
             try {
                const decoder = new TextDecoder(encoding);
                return decoder.decode(buffer);
             } catch (e) {
                 console.warn(`TextDecoder does not support ${encoding}, falling back to utf-8`);
                 const utf8Decoder = new TextDecoder('utf-8');
                 return utf8Decoder.decode(buffer);
             }
        },
        encodingExists: (encoding) => {
             // TextDecoder supports many encodings, but not all that iconv-lite does
             // We can be optimistic here or check a list
             try {
                 new TextDecoder(encoding);
                 return true;
             } catch (e) {
                 return false;
             }
        }
    };
}

// Sample size for chardet detection (1KB is enough for accurate detection)
const CHARDET_SAMPLE_SIZE = 1024;

/**
 * Map OpenSubtitles 3-letter codes to ISO 639-1 2-letter codes.
 * Used for encoding detection - maps API language codes to script detection codes.
 * Note: This is separate from browserLanguageMap which maps browser locales to API codes.
 */
const ISO639_3_TO_1 = {
    // Major world languages
    'ara': 'ar', 'chi': 'zh', 'eng': 'en', 'fre': 'fr', 'ger': 'de',
    'hin': 'hi', 'ita': 'it', 'jpn': 'ja', 'kor': 'ko', 'por': 'pt',
    'rus': 'ru', 'spa': 'es',
    // European languages
    'alb': 'sq', 'arm': 'hy', 'aze': 'az', 'baq': 'eu', 'bel': 'be',
    'bos': 'bs', 'bul': 'bg', 'cat': 'ca', 'cze': 'cs', 'dan': 'da',
    'dut': 'nl', 'ell': 'el', 'est': 'et', 'fin': 'fi', 'geo': 'ka',
    'gla': 'gd', 'gle': 'ga', 'glg': 'gl', 'hrv': 'hr', 'hun': 'hu',
    'ice': 'is', 'lav': 'lv', 'lit': 'lt', 'mac': 'mk', 'mne': 'me',
    'nor': 'no', 'pol': 'pl', 'rum': 'ro', 'scc': 'sr', 'slo': 'sk',
    'slv': 'sl', 'swe': 'sv', 'tur': 'tr', 'ukr': 'uk', 'wel': 'cy',
    // Middle Eastern / Arabic script
    'heb': 'he', 'per': 'fa', 'prs': 'fa', 'pus': 'ps', 'syr': 'sy',
    'urd': 'ur', 'kur': 'ku',
    // South Asian languages
    'asm': 'as', 'ben': 'bn', 'guj': 'gu', 'kan': 'kn', 'mal': 'ml',
    'mar': 'mr', 'nep': 'ne', 'ori': 'or', 'pan': 'pa', 'sin': 'si',
    'tam': 'ta', 'tel': 'te',
    // Southeast Asian languages
    'bur': 'my', 'ind': 'id', 'khm': 'km', 'lao': 'lo', 'may': 'ms',
    'tgl': 'tl', 'tha': 'th', 'vie': 'vi',
    // East Asian variants
    'zht': 'zh', 'zhc': 'zh', 'zhe': 'zh',
    // Central Asian languages
    'kaz': 'kk', 'kir': 'ky', 'mon': 'mn', 'tuk': 'tk', 'uzb': 'uz',
    // African languages
    'afr': 'af', 'amh': 'am', 'hau': 'ha', 'ibo': 'ig', 'som': 'so',
    'swa': 'sw', 'yor': 'yo', 'zul': 'zu',
    // Variants
    'pob': 'pt', 'pom': 'pt', 'spl': 'es', 'spn': 'es',
};

/**
 * Convert language code to 2-letter ISO 639-1 format for encoding hints.
 * Accepts both 2-letter and 3-letter codes.
 * @param {string} lang - Language code (2 or 3 letter)
 * @returns {string|null} 2-letter code or null if unknown
 */
function normalizeLanguageCode(lang) {
    if (!lang) return null;
    const lower = lang.toLowerCase();
    // Already 2-letter
    if (lower.length === 2) return lower;
    // Convert 3-letter to 2-letter
    return ISO639_3_TO_1[lower] || null;
}

/**
 * Unicode script block ranges for validation.
 * Used to verify that decoded text contains characters from the expected script.
 * Maps 2-letter language codes to regex patterns matching their Unicode script blocks.
 */
const SCRIPT_UNICODE_RANGES = {
    // Greek and Coptic (U+0370-03FF)
    'el': /[\u0370-\u03FF]/g,

    // Cyrillic (U+0400-04FF) - Russian, Ukrainian, Bulgarian, Serbian, etc.
    'ru': /[\u0400-\u04FF]/g,
    'uk': /[\u0400-\u04FF]/g,
    'bg': /[\u0400-\u04FF]/g,
    'sr': /[\u0400-\u04FF]/g,
    'mk': /[\u0400-\u04FF]/g,
    'be': /[\u0400-\u04FF]/g,
    'kk': /[\u0400-\u04FF]/g,  // Kazakh (Cyrillic)
    'mn': /[\u0400-\u04FF]/g,  // Mongolian (Cyrillic)

    // Hebrew (U+0590-05FF)
    'he': /[\u0590-\u05FF]/g,
    'iw': /[\u0590-\u05FF]/g,  // Old ISO 639 code for Hebrew

    // Arabic script (U+0600-06FF) - Arabic, Persian, Urdu, Kurdish, Pashto, etc.
    'ar': /[\u0600-\u06FF]/g,
    'fa': /[\u0600-\u06FF]/g,  // Persian
    'ur': /[\u0600-\u06FF]/g,  // Urdu
    'ku': /[\u0600-\u06FF]/g,  // Kurdish (Arabic script)
    'ps': /[\u0600-\u06FF]/g,  // Pashto
    'sd': /[\u0600-\u06FF]/g,  // Sindhi

    // Syriac (U+0700-074F)
    'sy': /[\u0700-\u074F]/g,

    // Thai (U+0E00-0E7F)
    'th': /[\u0E00-\u0E7F]/g,

    // Georgian (U+10A0-10FF)
    'ka': /[\u10A0-\u10FF]/g,

    // Armenian (U+0530-058F)
    'hy': /[\u0530-\u058F]/g,

    // Devanagari (U+0900-097F) - Hindi, Marathi, Nepali, Sanskrit
    'hi': /[\u0900-\u097F]/g,
    'mr': /[\u0900-\u097F]/g,
    'ne': /[\u0900-\u097F]/g,

    // Bengali (U+0980-09FF)
    'bn': /[\u0980-\u09FF]/g,

    // Gurmukhi/Punjabi (U+0A00-0A7F)
    'pa': /[\u0A00-\u0A7F]/g,

    // Gujarati (U+0A80-0AFF)
    'gu': /[\u0A80-\u0AFF]/g,

    // Tamil (U+0B80-0BFF)
    'ta': /[\u0B80-\u0BFF]/g,

    // Telugu (U+0C00-0C7F)
    'te': /[\u0C00-\u0C7F]/g,

    // Kannada (U+0C80-0CFF)
    'kn': /[\u0C80-\u0CFF]/g,

    // Malayalam (U+0D00-0D7F)
    'ml': /[\u0D00-\u0D7F]/g,

    // Sinhala (U+0D80-0DFF)
    'si': /[\u0D80-\u0DFF]/g,

    // Burmese/Myanmar (U+1000-109F)
    'my': /[\u1000-\u109F]/g,

    // Khmer (U+1780-17FF)
    'km': /[\u1780-\u17FF]/g,

    // Lao (U+0E80-0EFF)
    'lo': /[\u0E80-\u0EFF]/g,

    // Tibetan (U+0F00-0FFF)
    'bo': /[\u0F00-\u0FFF]/g,

    // Ethiopic/Amharic (U+1200-137F)
    'am': /[\u1200-\u137F]/g,

    // CJK Unified Ideographs (U+4E00-9FFF) + extensions - Chinese
    'zh': /[\u4E00-\u9FFF\u3400-\u4DBF]/g,

    // Japanese: Hiragana (3040-309F) + Katakana (30A0-30FF) + CJK
    'ja': /[\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FFF]/g,

    // Korean: Hangul Syllables (AC00-D7AF) + Jamo (1100-11FF)
    'ko': /[\uAC00-\uD7AF\u1100-\u11FF]/g,
};

/**
 * Language-to-encoding mapping for legacy subtitle files.
 * Maps 2-letter ISO language codes to likely Windows/ISO encodings.
 * Used to prioritize encoding attempts when language hint is available.
 */
const LANGUAGE_ENCODINGS = {
    // Cyrillic languages
    'ru': ['win1251', 'iso88595', 'koi8-r'],        // Russian
    'uk': ['win1251', 'koi8-u'],                     // Ukrainian
    'bg': ['win1251', 'iso88595'],                   // Bulgarian
    'sr': ['win1251', 'iso88595'],                   // Serbian
    'mk': ['win1251', 'iso88595'],                   // Macedonian
    'be': ['win1251', 'iso88595'],                   // Belarusian

    // Greek
    'el': ['win1253', 'iso88597'],                   // Greek

    // Turkish
    'tr': ['win1254', 'iso88599'],                   // Turkish

    // Hebrew
    'he': ['win1255', 'iso88598'],                   // Hebrew

    // Arabic
    'ar': ['win1256', 'iso88596'],                   // Arabic

    // Thai
    'th': ['win874', 'tis620', 'iso885911'],         // Thai

    // Vietnamese
    'vi': ['win1258'],                               // Vietnamese

    // Central/Eastern European
    'pl': ['win1250', 'iso88592'],                   // Polish
    'cs': ['win1250', 'iso88592'],                   // Czech
    'sk': ['win1250', 'iso88592'],                   // Slovak
    'hu': ['win1250', 'iso88592'],                   // Hungarian
    'ro': ['win1250', 'iso88592'],                   // Romanian
    'hr': ['win1250', 'iso88592'],                   // Croatian
    'sl': ['win1250', 'iso88592'],                   // Slovenian

    // Baltic
    'lt': ['win1257', 'iso885913'],                  // Lithuanian
    'lv': ['win1257', 'iso885913'],                  // Latvian
    'et': ['win1257', 'iso885913'],                  // Estonian

    // Western European (rarely needed, usually UTF-8)
    'de': ['win1252', 'iso88591'],                   // German
    'fr': ['win1252', 'iso88591'],                   // French
    'es': ['win1252', 'iso88591'],                   // Spanish
    'it': ['win1252', 'iso88591'],                   // Italian
    'pt': ['win1252', 'iso88591'],                   // Portuguese

    // CJK (usually UTF-8 or native encodings)
    'zh': ['gbk', 'gb2312', 'big5'],                 // Chinese
    'ja': ['shift_jis', 'euc-jp', 'iso2022jp'],      // Japanese
    'ko': ['euc-kr', 'cp949'],                       // Korean

    // South/Southeast Asian (mostly UTF-8, but older files may use legacy encodings)
    'hi': ['win1252'],                               // Hindi (Devanagari in UTF-8, legacy used Western)
    'bn': ['win1252'],                               // Bengali (mostly UTF-8)
    'id': ['win1252', 'iso88591'],                   // Indonesian
    'ms': ['win1252', 'iso88591'],                   // Malay
    'tl': ['win1252', 'iso88591'],                   // Tagalog/Filipino
    'ta': ['win1252'],                               // Tamil (mostly UTF-8)
    'te': ['win1252'],                               // Telugu (mostly UTF-8)
    'ml': ['win1252'],                               // Malayalam (mostly UTF-8)
    'kn': ['win1252'],                               // Kannada (mostly UTF-8)
    'mr': ['win1252'],                               // Marathi (mostly UTF-8)
    'gu': ['win1252'],                               // Gujarati (mostly UTF-8)
    'pa': ['win1252'],                               // Punjabi (mostly UTF-8)
    'ur': ['win1256', 'win1252'],                    // Urdu (Arabic-based script)
    'fa': ['win1256', 'iso88596'],                   // Persian/Farsi
    'km': ['win1252'],                               // Khmer (mostly UTF-8)
    'my': ['win1252'],                               // Burmese (mostly UTF-8)
    'si': ['win1252'],                               // Sinhala (mostly UTF-8)

    // Nordic/Scandinavian
    'sv': ['win1252', 'iso88591'],                   // Swedish
    'no': ['win1252', 'iso88591'],                   // Norwegian
    'da': ['win1252', 'iso88591'],                   // Danish
    'fi': ['win1252', 'iso88591'],                   // Finnish
    'is': ['win1252', 'iso88591'],                   // Icelandic

    // Other European
    'nl': ['win1252', 'iso88591'],                   // Dutch
    'ca': ['win1252', 'iso88591'],                   // Catalan
    'eu': ['win1252', 'iso88591'],                   // Basque
    'gl': ['win1252', 'iso88591'],                   // Galician
    'sq': ['win1250', 'iso88592'],                   // Albanian
    'bs': ['win1250', 'iso88592'],                   // Bosnian

    // African (most use UTF-8, but legacy files exist)
    'sw': ['win1252', 'iso88591'],                   // Swahili
    'am': ['win1252'],                               // Amharic (mostly UTF-8)
    'ha': ['win1252', 'iso88591'],                   // Hausa
    'yo': ['win1252', 'iso88591'],                   // Yoruba
    'zu': ['win1252', 'iso88591'],                   // Zulu
    'xh': ['win1252', 'iso88591'],                   // Xhosa
    'af': ['win1252', 'iso88591'],                   // Afrikaans
};

/**
 * Build a prioritized list of codepage encodings to try.
 * If languageHint is provided, prioritize encodings for that language.
 *
 * @param {string|null} languageHint - Optional 2-letter ISO language code
 * @returns {Array<{name: string, desc: string}>} Prioritized list of codepages to try
 */
function buildCodepageList(languageHint = null) {
    // Default codepage list (ordered by commonality)
    const defaultCodepages = [
        { name: 'win1252', desc: 'Windows-1252 (Western)' },
        { name: 'win1251', desc: 'Windows-1251 (Cyrillic)' },
        { name: 'win1253', desc: 'Windows-1253 (Greek)' },
        { name: 'win1254', desc: 'Windows-1254 (Turkish)' },
        { name: 'win1250', desc: 'Windows-1250 (Central European)' },
        { name: 'win1255', desc: 'Windows-1255 (Hebrew)' },
        { name: 'win1256', desc: 'Windows-1256 (Arabic)' },
        { name: 'win874', desc: 'Windows-874 (Thai)' },
        { name: 'win1258', desc: 'Windows-1258 (Vietnamese)' },
        { name: 'win1257', desc: 'Windows-1257 (Baltic)' },
    ];

    // If no language hint, return default order
    if (!languageHint) {
        return defaultCodepages;
    }

    // Get language-specific encodings
    const langEncodings = LANGUAGE_ENCODINGS[languageHint.toLowerCase()];
    if (!langEncodings || langEncodings.length === 0) {
        return defaultCodepages;
    }

    // Create description mapping for known encodings
    const descMap = {
        'win1250': 'Windows-1250 (Central European)',
        'win1251': 'Windows-1251 (Cyrillic)',
        'win1252': 'Windows-1252 (Western)',
        'win1253': 'Windows-1253 (Greek)',
        'win1254': 'Windows-1254 (Turkish)',
        'win1255': 'Windows-1255 (Hebrew)',
        'win1256': 'Windows-1256 (Arabic)',
        'win1257': 'Windows-1257 (Baltic)',
        'win1258': 'Windows-1258 (Vietnamese)',
        'win874': 'Windows-874 (Thai)',
        'tis620': 'TIS-620 (Thai)',
        'iso88591': 'ISO-8859-1 (Latin-1)',
        'iso88592': 'ISO-8859-2 (Latin-2)',
        'iso88595': 'ISO-8859-5 (Cyrillic)',
        'iso88596': 'ISO-8859-6 (Arabic)',
        'iso88597': 'ISO-8859-7 (Greek)',
        'iso88598': 'ISO-8859-8 (Hebrew)',
        'iso88599': 'ISO-8859-9 (Turkish)',
        'iso885911': 'ISO-8859-11 (Thai)',
        'iso885913': 'ISO-8859-13 (Baltic)',
        'koi8-r': 'KOI8-R (Russian)',
        'koi8-u': 'KOI8-U (Ukrainian)',
        'gbk': 'GBK (Chinese)',
        'gb2312': 'GB2312 (Chinese)',
        'big5': 'Big5 (Traditional Chinese)',
        'shift_jis': 'Shift-JIS (Japanese)',
        'euc-jp': 'EUC-JP (Japanese)',
        'iso2022jp': 'ISO-2022-JP (Japanese)',
        'euc-kr': 'EUC-KR (Korean)',
        'cp949': 'CP949 (Korean)',
    };

    // Build prioritized list: language-specific first, then remaining defaults
    const prioritized = [];
    const usedNames = new Set();

    // Add language-specific encodings first
    for (const encoding of langEncodings) {
        const name = encoding.toLowerCase();
        prioritized.push({
            name,
            desc: descMap[name] || `${encoding.toUpperCase()} (${languageHint.toUpperCase()})`
        });
        usedNames.add(name);
    }

    // Add remaining default encodings
    for (const cp of defaultCodepages) {
        if (!usedNames.has(cp.name)) {
            prioritized.push(cp);
        }
    }

    return prioritized;
}

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
 * @param {string|null} languageHint - Optional language code (2 or 3 letter) for encoding hints
 * @param {boolean} silent - If true, don't log messages (for testing)
 * @returns {string} The fixed text, or original if no fix needed
 */
function fixCharacterEncodings(text, languageHint = null, silent = false) {
    const log = silent ? () => {} : console.log.bind(console);

    // Normalize language hint to 2-letter code
    languageHint = normalizeLanguageCode(languageHint);

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
        thaiCjk: /[\u00E0-\u00EF][\u0080-\u00BF]/g,      // 3-byte sequences (Thai, CJK, etc.)
        accented: /\u00C3[\u0080-\u00BF]/g,              // Latin accented (á, é, ñ, etc.)
        special: /\u00C2[\u0080-\u00BF]/g,               // Latin special (©, ®, etc.)
        extLatin: /[\u00C4-\u00C5][\u0080-\u00BF]/g,     // Extended Latin (Lithuanian, Latvian, etc.)
        ipaModifiers: /[\u00C6-\u00CB][\u0080-\u00BF]/g, // IPA, spacing modifiers, diacriticals
        greek: /[\u00CC-\u00CF][\u0080-\u00BF]/g,        // Greek and Greek Extended (Ì, Í, Î, Ï)
        cyrillic: /[\u00D0-\u00D4][\u0080-\u00BF]/g,     // Cyrillic (Russian, Ukrainian, Bulgarian, etc.)
        armenian: /[\u00D5-\u00D6][\u0080-\u00BF]/g,     // Armenian (Õ, Ö)
        hebrew: /\u00D7[\u0080-\u00BF]/g,                // Hebrew (×)
        arabic: /[\u00D8-\u00DB][\u0080-\u00BF]/g,       // Arabic, Syriac (Ø, Ù, Ú, Û)
        syriacThaana: /[\u00DC-\u00DF][\u0080-\u00BF]/g, // Syriac, Thaana, NKo (Ü, Ý, Þ, ß)
    };

    // Additional pattern for raw legacy codepage files (Win-1253 Greek, etc):
    // These files have high-ASCII bytes (0x80-0xFF) that were read as Latin-1,
    // but without the double-encoding pattern (no UTF-8 lead+continuation bytes).
    // Look for high density of Latin Extended chars that don't form UTF-8 patterns.
    const legacyMojibake = /[\u0080-\u00FF]/g;

    const matches = {};
    let totalMatches = 0;
    for (const [name, pattern] of Object.entries(patterns)) {
        matches[name] = (text.match(pattern) || []).length;
        totalMatches += matches[name];
    }

    // Check for legacy mojibake (scattered Latin Extended chars without UTF-8 patterns)
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

        // UTF-8 didn't work - try Windows codepages using language hint
        const codepages = buildCodepageList(languageHint);

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
    // This catches RAW legacy codepage files (e.g., Windows-1253 Greek) where
    // the bytes were read as Latin-1 but there's no double-encoding.
    // Threshold: >10% Latin Extended chars suggests misencoded legacy text
    else if (legacyDensity > 0.10 && legacyMatches > 50) {
        log(`[ENCODING] High Latin Extended density (${(legacyDensity * 100).toFixed(1)}%, ${legacyMatches} chars) - trying legacy codepages`);

        const bytes = Buffer.from(text, 'latin1');
        const codepages = buildCodepageList(languageHint);

        // Get expected Unicode script pattern for this language (if available)
        const scriptPattern = languageHint ? SCRIPT_UNICODE_RANGES[languageHint.toLowerCase()] : null;

        for (const { name, desc } of codepages) {
            try {
                const fixed = iconv.decode(bytes, name);
                if (fixed.includes('\uFFFD')) continue;

                // Primary validation: if we have a script pattern, check that the decoded
                // text contains significant characters from the expected Unicode script block.
                // This is more reliable than just checking if Latin Extended density dropped.
                if (scriptPattern) {
                    const scriptMatches = (fixed.match(scriptPattern) || []).length;
                    const scriptDensity = fixed.length > 0 ? scriptMatches / fixed.length : 0;

                    // If >15% of decoded text is in expected script, we found the right encoding
                    if (scriptDensity > 0.15) {
                        log(`[ENCODING] Fixed as ${desc} (${(scriptDensity * 100).toFixed(1)}% expected script chars)`);
                        return fixed;
                    }
                }

                // Fallback validation: check if Latin Extended density dropped significantly
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
 * @param {string|null} languageHint - Optional language code (2 or 3 letter) for encoding hints
 * @param {boolean} silent - If true, don't log messages (for testing)
 * @returns {string} The decoded subtitle text
 */
function decodeSubtitleBuffer(buffer, languageHint = null, silent = false) {
    const log = silent ? () => {} : console.log.bind(console);

    // Normalize language hint to 2-letter code (accepts both 2 and 3 letter codes)
    languageHint = normalizeLanguageCode(languageHint);

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
    subtitleText = fixCharacterEncodings(subtitleText, languageHint, silent);

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
    decodeSubtitleBuffer,
    normalizeLanguageCode
};
