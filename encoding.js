/**
 * Subtitle encoding detection and fixing utilities.
 * Handles various encodings including UTF-8, UTF-16, legacy codepages, and double-encoded text.
 */

const chardet = require('chardet');
const iconv = require('iconv-lite');
const { francAll } = require('franc-all');
const { iso6393To1 } = require('iso-639-3');

// Sample size for chardet detection (1KB is enough for accurate detection)
const CHARDET_SAMPLE_SIZE = 1024;

/**
 * Map OpenSubtitles 3-letter codes to ISO 639-1 2-letter codes.
 * Used for encoding detection - maps API language codes to script detection codes.
 *
 * Includes BOTH ISO 639-2/B (bibliographic, e.g., 'fre', 'ger') AND
 * ISO 639-2/T (terminological, e.g., 'fra', 'deu') codes since OpenSubtitles
 * uses both depending on the source/API.
 */
const ISO639_3_TO_1 = {
    // Major world languages - both B and T codes where they differ
    'ara': 'ar', 'chi': 'zh', 'zho': 'zh',  // Chinese: chi (B) / zho (T)
    'eng': 'en',
    'fre': 'fr', 'fra': 'fr',  // French: fre (B) / fra (T)
    'ger': 'de', 'deu': 'de',  // German: ger (B) / deu (T)
    'hin': 'hi', 'ita': 'it', 'jpn': 'ja', 'kor': 'ko',
    'por': 'pt', 'rus': 'ru', 'spa': 'es',

    // European languages - both B and T codes
    'alb': 'sq', 'sqi': 'sq',  // Albanian: alb (B) / sqi (T)
    'arm': 'hy', 'hye': 'hy',  // Armenian: arm (B) / hye (T)
    'aze': 'az',
    'baq': 'eu', 'eus': 'eu',  // Basque: baq (B) / eus (T)
    'bel': 'be', 'bos': 'bs', 'bul': 'bg', 'cat': 'ca',
    'cze': 'cs', 'ces': 'cs',  // Czech: cze (B) / ces (T)
    'dan': 'da',
    'dut': 'nl', 'nld': 'nl',  // Dutch: dut (B) / nld (T)
    'ell': 'el', 'gre': 'el',  // Greek: gre (B) / ell (T)
    'est': 'et', 'fin': 'fi',
    'geo': 'ka', 'kat': 'ka',  // Georgian: geo (B) / kat (T)
    'gla': 'gd', 'gle': 'ga', 'glg': 'gl',
    'hrv': 'hr', 'hun': 'hu',
    'ice': 'is', 'isl': 'is',  // Icelandic: ice (B) / isl (T)
    'lav': 'lv', 'lit': 'lt',
    'mac': 'mk', 'mkd': 'mk',  // Macedonian: mac (B) / mkd (T)
    'mne': 'me',
    'nor': 'no', 'nob': 'no',  // Norwegian Bokmål
    'pol': 'pl',
    'rum': 'ro', 'ron': 'ro',  // Romanian: rum (B) / ron (T)
    'scc': 'sr', 'srp': 'sr',  // Serbian: scc (deprecated) / srp (T)
    'slo': 'sk', 'slk': 'sk',  // Slovak: slo (B) / slk (T)
    'slv': 'sl',               // Slovenian
    'swe': 'sv', 'tur': 'tr', 'ukr': 'uk',
    'wel': 'cy', 'cym': 'cy',  // Welsh: wel (B) / cym (T)

    // Middle Eastern / Arabic script
    'heb': 'he',
    'per': 'fa', 'fas': 'fa',  // Persian: per (B) / fas (T)
    'prs': 'fa',               // Dari (Afghan Persian)
    'pus': 'ps', 'syr': 'sy', 'urd': 'ur', 'kur': 'ku',

    // South Asian languages
    'asm': 'as', 'ben': 'bn', 'guj': 'gu', 'kan': 'kn', 'mal': 'ml',
    'mar': 'mr', 'nep': 'ne', 'ori': 'or', 'pan': 'pa', 'sin': 'si',
    'tam': 'ta', 'tel': 'te',

    // Southeast Asian languages
    'bur': 'my', 'mya': 'my',  // Burmese: bur (B) / mya (T)
    'ind': 'id', 'khm': 'km', 'lao': 'lo',
    'may': 'ms', 'msa': 'ms',  // Malay: may (B) / msa (T)
    'tgl': 'tl', 'tha': 'th', 'vie': 'vi',

    // East Asian variants
    'zht': 'zh', 'zhc': 'zh', 'zhe': 'zh',
    // Central Asian languages
    'kaz': 'kk', 'kir': 'ky', 'mon': 'mn', 'tuk': 'tk', 'uzb': 'uz',

    // African languages
    'afr': 'af', 'amh': 'am', 'hau': 'ha', 'ibo': 'ig', 'som': 'so',
    'swa': 'sw', 'yor': 'yo', 'zul': 'zu',

    // Other languages
    'mao': 'mi', 'mri': 'mi',  // Maori: mao (B) / mri (T)
    'tib': 'bo', 'bod': 'bo',  // Tibetan: tib (B) / bod (T)

    // Variants / special codes used by OpenSubtitles
    'pob': 'pt', 'pom': 'pt',  // Brazilian Portuguese variants
    'spl': 'es', 'spn': 'es',  // Spanish variants
};

/**
 * Language code aliases - maps between ISO 639-2/B (bibliographic) and
 * ISO 639-2/T (terminological) codes. Used when searching for subtitles
 * to match either code variant.
 * 
 * Also include deprecated codes and codes used for subtitles only.
 *
 * Format: { code: [all equivalent codes] }
 * Each code maps to an array of ALL its equivalents (including itself).
 */
const LANGUAGE_ALIASES = {
    'aka': ['aka', 'fat', 'twi'],         // Akan (with fallbacks)
    'fat': ['fat', 'aka', 'twi'],         // Akan-Fanti (with fallbacks)
    'twi': ['twi', 'aka', 'fat'],         // Akan-Twi (with fallbacks)
    'alb': ['alb', 'sqi'],                // Albanian (with fallback)
    'sqi': ['sqi', 'alb'],                // Albanian (with fallback)
    'ara': ['ara', 'arb'],                // Arabic (with fallback)
    'arb': ['arb', 'ara'],                // Arabic (with fallback)
    'arm': ['arm', 'xcl', 'hye', 'hyw'],  // Armenian (with fallbacks)
    'xcl': ['xcl', 'arm', 'hye', 'hyw'],  // Armanian-Classical (with fallbacks)
    'hye': ['hye', 'arm', 'hyw', 'xcl'],  // Armenian-Eastern (with fallbacks)
    'hyw': ['hyw', 'arm', 'hye', 'xcl'],  // Armenian-Western (with fallbacks)
    'baq': ['baq', 'eus'],                // Basque (with fallback)
    'eus': ['eus', 'baq'],                // Basque (with fallback)
    'bur': ['bur', 'mya'],                // Burmese (with fallback)
    'mya': ['mya', 'bur'],                // Burmese (with fallback)
    'chi': ['chi', 'zho'],                // Chinese (with fallback)
    'zho': ['zho', 'chi'],                // Chinese (with fallback)
    'ces': ['ces', 'cze'],                // Czech (with fallback)
    'cze': ['cze', 'ces'],                // Czech (with fallback)
    'dut': ['dut', 'nld'],                // Dutch (with fallback)
    'nld': ['nld', 'dut'],                // Dutch (with fallback)
    'fil': ['fil', 'tgl'],                // Filipino (Pilipino) (with fallback)
    'tgl': ['tgl', 'fil'],                // Filipino-Tagalog (with fallback)
    'fra': ['fra', 'fre'],                // French (with fallback)
    'fre': ['fre', 'fra'],                // French (with fallback)
    'geo': ['geo', 'kat'],                // Georgian (with fallback)
    'kat': ['kat', 'geo'],                // Georgian (with fallback)
    'deu': ['deu', 'ger'],                // German (with fallback)
    'ger': ['ger', 'deu'],                // German (with fallback)
    'ell': ['ell', 'gre'],                // Greek (with fallback)
    'gre': ['gre', 'ell'],                // Greek (with fallback)
    'ice': ['ice', 'isl'],                // Icelandic (with fallback)
    'isl': ['isl', 'ice'],                // Icelandic (with fallback)
    'ind': ['ind', 'msa', 'may'],         // Indonesian (with fallback)
    'mac': ['mac', 'mkd'],                // Macedonian (with fallback)
    'mkd': ['mkd', 'mac'],                // Macedonian (with fallback)
    'msa': ['msa', 'ind', 'may'],         // Malay (with fallback)
    'may': ['may', 'ind', 'msa'],         // Malay (with fallback)
    'mao': ['mao', 'mri'],                // Maori (with fallback)
    'mri': ['mri', 'mao'],                // Maori (with fallback)
    'nor': ['nor', 'nob', 'nno'],         // Norwegian (with fallbacks)
    'nob': ['nob', 'nor', 'nno'],         // Norwegian-Bokmål (with fallbacks)
    'nno': ['nno', 'nor', 'nob'],         // Norwegian-Nynorsk (with fallbacks)
    'osd': ['osd', 'oss'],                // Ossetian-Digor (with fallback)
    'oss': ['oss', 'osd'],                // Ossetian-Ossetic (with fallback)
    'fas': ['fas', 'per'],                // Persian (with fallback)
    'per': ['per', 'fas'],                // Persian (with fallback)
    'ron': ['ron', 'rum', 'mol'],         // Romanian (with fallback)
    'rum': ['rum', 'ron', 'mol'],         // Romanian (with fallback)
    'mol': ['mol', 'rum', 'ron'],         // Romanian-Moldavian (with fallback)
    'scc': ['scc', 'srp'],                // Serbian (with fallback)
    'srp': ['srp', 'scc'],                // Serbian (with fallback)
    'slk': ['slk', 'slo'],                // Slovak (with fallback)
    'slo': ['slo', 'slk'],                // Slovak (with fallback)
    'bod': ['bod', 'tib'],                // Tibetan (with fallback)
    'tib': ['tib', 'bod'],                // Tibetan (with fallback)
    'cym': ['cym', 'wel'],                // Welsh (with fallback)
    'wel': ['wel', 'cym'],                // Welsh (with fallback)
    'zhe': ['chi', 'zho']                 // ZHE used to mean misc Chinese + English bilingual → fetch simplified Chinese instead
};

/**
 * Get all equivalent language codes for a given code.
 * Returns an array of all codes that refer to the same language.
 * @param {string} languageCode - A 3-letter language code
 * @returns {string[]} Array of equivalent codes (including the input code)
 */
function getLanguageAliases(languageCode) {
    return LANGUAGE_ALIASES[languageCode] || [languageCode];
}

/**
 * Language codes that should be skipped entirely.
 * Add codes here with comments explaining why they should not be processed.
 */
const SKIP_LANGUAGE_CODES = [
    'zhe',  // Pre-merged Chinese-English bilingual - conflicts with addon's purpose of merging separate languages
];

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
    // Convert 3-letter to 2-letter using:
    // 1. Our OpenSubtitles-specific codes (ISO639_3_TO_1)
    // 2. The iso-639-3 library's comprehensive mapping (iso6393To1)
    return ISO639_3_TO_1[lower] || iso6393To1[lower] || null;
}

// Skip first N chars to avoid header/metadata poisoning when validating
const VALIDATION_SKIP_CHARS = 2000;
// Sample size after skipping - franc needs larger samples for reliable detection
// "franc supports many languages, which means it's easily confused on small samples"
const VALIDATION_SAMPLE_SIZE = 30000;

/**
 * Calculate optimal skip position for validation sampling.
 * For long files: skip VALIDATION_SKIP_CHARS to avoid headers.
 * For short files: start earlier to ensure we get content.
 * @param {number} textLength - Total text length
 * @returns {number} Position to start sampling from
 */
function getValidationSkipPos(textLength) {
    // For short files, start earlier: max(0, length - sampleSize)
    // For long files, cap at VALIDATION_SKIP_CHARS
    return Math.min(VALIDATION_SKIP_CHARS, Math.max(textLength - VALIDATION_SAMPLE_SIZE, 0));
}

/**
 * Franc library returns ISO 639-3 codes, often with specific varieties/dialects.
 * We use the iso-639-3 library as the base mapping (ISO 639-3 → ISO 639-1).
 *
 * Additional mappings cover:
 * 1. Individual language codes that map to macrolanguages (khk → mn for Mongolian)
 * 2. Dialect/variety codes that franc uses (arb → ar for Standard Arabic)
 * 3. Our legacy OpenSubtitles 3-letter codes from ISO639_3_TO_1
 *
 * Note: iso6393To1 from iso-639-3 library has 184 entries, covering most standard codes.
 */
const FRANC_TO_ISO2 = {
    // Base: iso-639-3 library's comprehensive ISO 639-3 → ISO 639-1 mapping
    ...iso6393To1,

    // Add our OpenSubtitles-specific codes (bibliographic variants like 'fre' for French)
    ...ISO639_3_TO_1,

    // Individual language → macrolanguage mappings (franc returns these)
    'khk': 'mn',   // Khalkha Mongolian → Mongolian (macrolanguage)
    'arb': 'ar',   // Standard Arabic → Arabic (macrolanguage)
    'cmn': 'zh',   // Mandarin Chinese → Chinese (macrolanguage)
    'yue': 'zh',   // Cantonese → Chinese
    'nan': 'zh',   // Min Nan → Chinese
    'wuu': 'zh',   // Wu Chinese → Chinese
    'pes': 'fa',   // Western Farsi → Persian
    'prs': 'fa',   // Dari → Persian
    'zlm': 'ms',   // Malay (generic) → Malay
    'zsm': 'ms',   // Standard Malay → Malay
    'ekk': 'et',   // Standard Estonian → Estonian
    'lvs': 'lv',   // Standard Latvian → Latvian
    'uzn': 'uz',   // Northern Uzbek → Uzbek
    'uzs': 'uz',   // Southern Uzbek → Uzbek

    // Norwegian varieties
    'nno': 'no',   // Norwegian Nynorsk → Norwegian
    'nob': 'no',   // Norwegian Bokmål → Norwegian

    // Legacy/alternate codes that franc might return
    'src': 'sr',   // Serbian (alternate code)

    // Montenegrin (no ISO 639-1 code, but essentially same as Serbian/Croatian/Bosnian)
    'cnr': 'me',   // Montenegrin → 'me' (unofficial but widely used)

    // Albanian dialects → Albanian
    'als': 'sq',   // Tosk Albanian → Albanian
    'aln': 'sq',   // Gheg Albanian → Albanian

    // English-related varieties (franc sometimes detects these for English text)
    'pcm': 'en',   // Nigerian Pidgin → English (pidgin based on English)
    'sco': 'en',   // Scots → English (closely related, often confused)
};

/**
 * Related language groups - languages that are so similar that a speaker of one can generally 
 * understand the other language. We use this for two reasons:
 * 1. Our language detection isn't always capable of differentiating these, because they're so 
 *    similar, so we want to accept them as interchangeable replacements.
 * 2. If a user requests one and it's not available, we can return one that's very similar so they 
 *    at least get something useful back.
 * Each language maps to an array of its related languages.
 * Do not add items here just because they "look" the same or have the same character set! This is
 * only for nearly interchangeable and bidirectionally understandable languages.
 */
const RELATED_LANGUAGES = {
    // South Slavic (Latin script) - very high mutual intelligibility
    // Includes Montenegrin ('me') which has no ISO 639-1 but is mutually intelligible
    'bs': ['hr', 'sr', 'sl', 'me'],   // Bosnian
    'hr': ['bs', 'sr', 'sl', 'me'],   // Croatian
    'sr': ['bs', 'hr', 'sl', 'me'],   // Serbian (Latin)
    'sl': ['bs', 'hr', 'sr', 'me'],   // Slovenian
    'me': ['bs', 'hr', 'sr', 'sl'],   // Montenegrin

    // West Slavic
    'cs': ['sk', 'pl'],         // Czech
    'sk': ['cs', 'pl'],         // Slovak
    'pl': ['cs', 'sk'],         // Polish

    // Scandinavian
    'da': ['no', 'sv'],         // Danish
    'no': ['da', 'sv'],         // Norwegian
    'sv': ['da', 'no'],         // Swedish

    // Finno-Ugric
    'fi': ['et'],               // Finnish
    'et': ['fi'],               // Estonian

    // Iberian/Romance
    'es': ['pt', 'ca', 'gl'],   // Spanish
    'pt': ['es', 'gl'],         // Portuguese
    'ca': ['es', 'oc'],         // Catalan (related to Occitan)
    'gl': ['es', 'pt'],         // Galician
    'oc': ['ca'],               // Occitan (related to Catalan)

    // Malay-Indonesian
    'id': ['ms'],               // Indonesian
    'ms': ['id'],               // Malay

    // East Slavic (Cyrillic)
    'ru': ['uk', 'be'],         // Russian
    'uk': ['ru', 'be'],         // Ukrainian
    'be': ['ru', 'uk'],         // Belarusian
};

/**
 * Get related languages for a given language code.
 * @param {string} langCode - 2-letter language code
 * @returns {string[]} Array of related language codes (empty if none)
 */
function getRelatedLanguages(langCode) {
    return RELATED_LANGUAGES[langCode] || [];
}

/**
 * Check if decoded text appears clean (not corrupted/garbage).
 * Used to filter out files with encoding corruption before language detection.
 *
 * @param {string} text - The decoded text to check
 * @param {number} maxReplacementRatio - Max ratio of replacement chars allowed (default 0.01 = 1%)
 * @returns {boolean} true if text appears clean, false if corrupted
 */
function isCleanText(text, maxReplacementRatio = 0.01) {
    if (!text || text.length < 100) return false;

    // Count replacement characters (U+FFFD) - indicates failed UTF-8 decoding
    const replacementCount = (text.match(/\uFFFD/g) || []).length;

    // Count control characters (except newline/tab/carriage return)
    const controlCount = (text.match(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g) || []).length;

    const total = text.length;

    // Reject if too many replacement chars or control chars
    if (replacementCount / total > maxReplacementRatio) return false;
    if (controlCount / total > maxReplacementRatio) return false;

    // Check for impossible script mixing (e.g., Hebrew + Thai in same file)
    // This indicates severe encoding corruption
    const hasHebrewThai = /[\u0590-\u05FF].*[\u0E00-\u0E7F]|[\u0E00-\u0E7F].*[\u0590-\u05FF]/.test(text);
    const hasArabicThai = /[\u0600-\u06FF].*[\u0E00-\u0E7F]|[\u0E00-\u0E7F].*[\u0600-\u06FF]/.test(text);
    const hasCyrillicThai = /[\u0400-\u04FF].*[\u0E00-\u0E7F]|[\u0E00-\u0E7F].*[\u0400-\u04FF]/.test(text);

    if (hasHebrewThai || hasArabicThai || hasCyrillicThai) return false;

    return true;
}

/**
 * Detect language using the franc n-gram library.
 * Franc is ~97%+ accurate on distinguishable languages (and we have the related languages mapping
 * for the rest).
 *
 * @param {string} text - The text to analyze
 * @param {string|null} expectedLang - Optional expected language (2-letter) for comparison
 * @returns {Object} { detected: '2-letter code', detected3: 'ISO 639-3 code', isMatch: boolean, isRelatedMatch: boolean }
 */
function detectLanguage(text, expectedLang = null) {
    if (!text || text.length < 100) {
        return { detected: null, detected3: 'und', isMatch: false, isRelatedMatch: false };
    }

    // Sample the text (skip headers, take reasonable chunk for analysis)
    const skipPos = getValidationSkipPos(text.length);
    let sample = text.slice(skipPos, skipPos + VALIDATION_SAMPLE_SIZE);

    // Clean the sample for language detection:
    // - Remove SRT timestamps (00:01:23,456 --> 00:01:25,789)
    // - Remove cue numbers
    // - Remove HTML tags
    // This leaves just the dialogue text for franc to analyze
    sample = sample
        .replace(/\d{2}:\d{2}:\d{2}[,\.]\d{3}\s*-->\s*\d{2}:\d{2}:\d{2}[,\.]\d{3}/g, ' ')  // Timestamps
        .replace(/^\d+\s*$/gm, '')  // Cue numbers on their own line
        .replace(/<[^>]+>/g, ' ')   // HTML tags
        .replace(/\s+/g, ' ')       // Collapse whitespace
        .trim();

    if (sample.length < 100) {
        return { detected: null, detected3: 'und', isMatch: false, isRelatedMatch: false };
    }

    // Run franc-all detection (returns array of [lang, confidence] sorted by confidence)
    const results = francAll(sample);

    // francAll returns empty array or [['und', 1]] when it can't detect
    if (!results.length || results[0][0] === 'und') {
        return { detected: null, detected3: 'und', isMatch: false, isRelatedMatch: false };
    }

    const detected3 = results[0][0];  // Top result's ISO 639-3 code

    // Convert to 2-letter code using our comprehensive mapping
    const detected = FRANC_TO_ISO2[detected3] || detected3;

    // Normalize expected language if provided
    const expected = expectedLang ? (normalizeLanguageCode(expectedLang) || expectedLang.toLowerCase()) : null;

    // Check for exact match
    const isMatch = expected ? (detected === expected) : false;

    // Check for related language match (South Slavic, Malay-Indonesian, etc.)
    let isRelatedMatch = isMatch;
    if (!isMatch && expected) {
        const relatedToExpected = RELATED_LANGUAGES[expected] || [];
        const relatedToDetected = RELATED_LANGUAGES[detected] || [];

        // Match if detected is in expected's related list, or vice versa
        isRelatedMatch = relatedToExpected.includes(detected) || relatedToDetected.includes(expected);
    }

    return {
        detected,
        detected3,
        isMatch,
        isRelatedMatch
    };
}

/**
 * Validate that text contains the expected language.
 * Uses franc n-gram detection with related language matching.
 *
 * @param {string} text - The text to validate
 * @param {string} expectedLang - Expected language code (2 or 3 letter)
 * @param {Object} options - Optional settings
 * @param {boolean} options.skipCorruptionCheck - Skip the corruption check (for already-validated text)
 * @returns {boolean} true if text appears to be in the expected language
 */
function validateLanguage(text, expectedLang, options = {}) {
    if (!text || !expectedLang) return true;  // No validation possible

    const expected = normalizeLanguageCode(expectedLang) || expectedLang.toLowerCase();

    // Check for corruption/garbage first (unless already validated)
    if (!options.skipCorruptionCheck && !isCleanText(text)) {
        return false;  // Text is corrupted/garbage
    }

    // Detect language using franc
    const detection = detectLanguage(text, expected);

    // Accept if detection says it matches (exact or related language)
    return detection.isRelatedMatch;
}

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
                // 3. Contains expected script characters OR expected common words
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
 * @param {string|null} languageHint - Optional language code (2 or 3 letter) for encoding hints
 * @param {boolean|Object} options - If boolean: silent mode. If object: { verbose, skipLanguageValidation }
 * @returns {string|null} The decoded subtitle text, or null if validation fails
 */
function decodeSubtitleBuffer(buffer, languageHint = null, options = {}) {
    // Handle legacy boolean argument (silent = true)
    let silent = false;
    let skipLanguageValidation = false;

    if (typeof options === 'boolean') {
        silent = options;  // Legacy: 3rd param was `silent`
    } else if (typeof options === 'object') {
        silent = !options.verbose;  // verbose: true → silent: false
        skipLanguageValidation = options.skipLanguageValidation || false;
    }

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

    // Final validation: verify text matches expected language using franc detection
    // Skip this validation if skipLanguageValidation is true (for test analysis)
    if (languageHint && !skipLanguageValidation) {
        const langValid = validateLanguage(subtitleText, languageHint, { skipCorruptionCheck: true });
        if (!langValid) {
            log(`[ENCODING] Final validation failed: detected language doesn't match expected ${languageHint}. Rejecting.`);
            return null;
        }
    }

    return subtitleText;
}

module.exports = {
    fixCharacterEncodings,
    decodeSubtitleBuffer,
    normalizeLanguageCode,
    detectLanguage,
    validateLanguage,
    isCleanText,
    getLanguageAliases,
    getRelatedLanguages,
    SKIP_LANGUAGE_CODES,
    ISO639_3_TO_1,
    LANGUAGE_ALIASES,
    RELATED_LANGUAGES,
    FRANC_TO_ISO2,
};
