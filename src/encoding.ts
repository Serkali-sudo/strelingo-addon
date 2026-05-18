import chardet from 'chardet';
import iconv from 'iconv-lite';
import { francAll } from 'franc-all';
import { iso6393To1 } from 'iso-639-3';
import { Buffer } from 'node:buffer';

// Sample size for chardet detection (1KB is enough for accurate detection)
const CHARDET_SAMPLE_SIZE = 1024;

/**
 * Map OpenSubtitles 3-letter codes to ISO 639-1 2-letter codes.
 * Used for encoding detection - maps API language codes to script detection codes.
 */
export const ISO639_3_TO_1: Record<string, string> = {
    // Major world languages
    'ara': 'ar', 'chi': 'zh', 'zho': 'zh',
    'eng': 'en',
    'fre': 'fr', 'fra': 'fr',
    'ger': 'de', 'deu': 'de',
    'hin': 'hi', 'ita': 'it', 'jpn': 'ja', 'kor': 'ko',
    'por': 'pt', 'rus': 'ru', 'spa': 'es',

    // European languages
    'alb': 'sq', 'sqi': 'sq',
    'arm': 'hy', 'hye': 'hy',
    'aze': 'az',
    'baq': 'eu', 'eus': 'eu',
    'bel': 'be', 'bos': 'bs', 'bul': 'bg', 'cat': 'ca',
    'cze': 'cs', 'ces': 'cs',
    'dan': 'da',
    'dut': 'nl', 'nld': 'nl',
    'ell': 'el', 'gre': 'el',
    'est': 'et', 'fin': 'fi',
    'geo': 'ka', 'kat': 'ka',
    'gla': 'gd', 'gle': 'ga', 'glg': 'gl',
    'hrv': 'hr', 'hat': 'ht', 'hun': 'hu',
    'ice': 'is', 'isl': 'is',
    'lav': 'lv', 'lit': 'lt',
    'mac': 'mk', 'mkd': 'mk',
    'mne': 'me',
    'nor': 'no', 'nob': 'no',
    'pol': 'pl',
    'rum': 'ro', 'ron': 'ro',
    'scc': 'sr', 'srp': 'sr',
    'slo': 'sk', 'slk': 'sk',
    'slv': 'sl',
    'swe': 'sv', 'tur': 'tr', 'ukr': 'uk',
    'wel': 'cy', 'cym': 'cy',

    // Middle Eastern / Arabic script
    'heb': 'he',
    'per': 'fa', 'fas': 'fa',
    'prs': 'fa',
    'pus': 'ps', 'syr': 'sy', 'urd': 'ur', 'kur': 'ku',

    // South Asian languages
    'asm': 'as', 'ben': 'bn', 'guj': 'gu', 'kan': 'kn', 'mal': 'ml',
    'mar': 'mr', 'nep': 'ne', 'ori': 'or', 'pan': 'pa', 'sin': 'si',
    'tam': 'ta', 'tel': 'te',

    // Southeast Asian languages
    'bur': 'my', 'mya': 'my',
    'ind': 'id', 'khm': 'km', 'lao': 'lo',
    'may': 'ms', 'msa': 'ms',
    'tgl': 'tl', 'tha': 'th', 'vie': 'vi',

    // East Asian variants
    'zht': 'zh', 'zhc': 'zh',

    // Central Asian languages
    'kaz': 'kk', 'kir': 'ky', 'mon': 'mn', 'tuk': 'tk', 'uzb': 'uz',

    // African languages
    'afr': 'af', 'amh': 'am', 'hau': 'ha', 'ibo': 'ig', 'som': 'so',
    'swa': 'sw', 'yor': 'yo', 'zul': 'zu',

    // Other languages
    'mao': 'mi', 'mri': 'mi',
    'tib': 'bo', 'bod': 'bo',

    // Variants / special codes used by OpenSubtitles
    'pob': 'pt', 'pom': 'pt',
    'spl': 'es', 'spn': 'es',
};

/**
 * Language code aliases - maps between ISO 639-2/B (bibliographic) and
 * ISO 639-2/T (terminological) codes.
 */
export const LANGUAGE_ALIASES: Record<string, string[]> = {
    'aka': ['aka', 'fat', 'twi'],
    'fat': ['fat', 'aka', 'twi'],
    'twi': ['twi', 'aka', 'fat'],
    'alb': ['alb', 'sqi'],
    'sqi': ['sqi', 'alb'],
    'ara': ['ara', 'arb'],
    'arb': ['arb', 'ara'],
    'arm': ['arm', 'xcl', 'hye', 'hyw'],
    'xcl': ['xcl', 'arm', 'hye', 'hyw'],
    'hye': ['hye', 'arm', 'hyw', 'xcl'],
    'hyw': ['hyw', 'arm', 'hye', 'xcl'],
    'baq': ['baq', 'eus'],
    'eus': ['eus', 'baq'],
    'bur': ['bur', 'mya'],
    'mya': ['mya', 'bur'],
    'chi': ['chi', 'zho'],
    'zho': ['zho', 'chi'],
    'ces': ['ces', 'cze'],
    'cze': ['cze', 'ces'],
    'dut': ['dut', 'nld'],
    'nld': ['nld', 'dut'],
    'fil': ['fil', 'tgl'],
    'tgl': ['tgl', 'fil'],
    'fra': ['fra', 'fre'],
    'fre': ['fre', 'fra'],
    'geo': ['geo', 'kat'],
    'kat': ['kat', 'geo'],
    'deu': ['deu', 'ger'],
    'ger': ['ger', 'deu'],
    'ell': ['ell', 'gre'],
    'gre': ['gre', 'ell'],
    'ice': ['ice', 'isl'],
    'isl': ['isl', 'ice'],
    'ind': ['ind', 'msa', 'may'],
    'mac': ['mac', 'mkd'],
    'mkd': ['mkd', 'mac'],
    'msa': ['msa', 'ind', 'may'],
    'may': ['may', 'ind', 'msa'],
    'mao': ['mao', 'mri'],
    'mri': ['mri', 'mao'],
    'nor': ['nor', 'nob', 'nno'],
    'nob': ['nob', 'nor', 'nno'],
    'nno': ['nno', 'nor', 'nob'],
    'osd': ['osd', 'oss'],
    'oss': ['oss', 'osd'],
    'fas': ['fas', 'per'],
    'per': ['per', 'fas'],
    'ron': ['ron', 'rum', 'mol'],
    'rum': ['rum', 'ron', 'mol'],
    'mol': ['mol', 'rum', 'ron'],
    'scc': ['scc', 'srp'],
    'srp': ['srp', 'scc'],
    'slk': ['slk', 'slo'],
    'slo': ['slo', 'slk'],
    'bod': ['bod', 'tib'],
    'tib': ['tib', 'bod'],
    'cym': ['cym', 'wel'],
    'wel': ['wel', 'cym'],
    'zhe': ['chi', 'zho']
};

/**
 * Get all equivalent language codes for a given code.
 */
export function getLanguageAliases(languageCode: string): string[] {
    return LANGUAGE_ALIASES[languageCode] || [languageCode];
}

/**
 * Language codes that should be skipped entirely.
 */
export const SKIP_LANGUAGE_CODES = ['zhe'];

/**
 * Convert language code to 2-letter ISO 639-1 format for encoding hints.
 */
export async function normalizeLanguageCode(lang: string | null): Promise<string | null> {
    if (!lang) return null;
    const lower = lang.toLowerCase();
    if (lower.length === 2) return lower;
    return ISO639_3_TO_1[lower] || iso6393To1[lower] || null;
}

// Skip first N chars to avoid header/metadata poisoning when validating
const VALIDATION_SKIP_CHARS = 2000;
const VALIDATION_SAMPLE_SIZE = 30000;

function getValidationSkipPos(textLength: number): number {
    return Math.min(VALIDATION_SKIP_CHARS, Math.max(textLength - VALIDATION_SAMPLE_SIZE, 0));
}

// Comprehensive ISO 639-3 to ISO 639-1 map for franc
const francToIso2Map: Record<string, string> = {
    ...iso6393To1,
    ...ISO639_3_TO_1,
    'khk': 'mn',
    'arb': 'ar',
    'cmn': 'zh',
    'yue': 'zh',
    'nan': 'zh',
    'wuu': 'zh',
    'pes': 'fa',
    'prs': 'fa',
    'zlm': 'ms',
    'zsm': 'ms',
    'ekk': 'et',
    'lvs': 'lv',
    'uzn': 'uz',
    'uzs': 'uz',
    'nno': 'no',
    'nob': 'no',
    'src': 'sr',
    'cnr': 'me',
    'als': 'sq',
    'aln': 'sq',
    'pcm': 'en',
    'sco': 'en',
};

export const RELATED_LANGUAGES: Record<string, string[]> = {
    'bs': ['hr', 'sr', 'sl', 'me'],
    'hr': ['bs', 'sr', 'sl', 'me'],
    'sr': ['bs', 'hr', 'sl', 'me'],
    'sl': ['bs', 'hr', 'sr', 'me'],
    'me': ['bs', 'hr', 'sr', 'sl'],
    'cs': ['sk'],
    'sk': ['cs'],
    'da': ['no', 'sv'],
    'no': ['da', 'sv'],
    'sv': ['da', 'no'],
    'pt': ['gl'],
    'gl': ['pt'],
    'ca': ['oc'],
    'oc': ['ca'],
    'id': ['ms'],
    'ms': ['id']
};

export function getRelatedLanguages(langCode: string): string[] {
    return RELATED_LANGUAGES[langCode] || [];
}

export function isCleanText(text: string, maxReplacementRatio = 0.01): boolean {
    if (!text || text.length < 100) return false;

    const replacementCount = (text.match(/\uFFFD/g) || []).length;
    const controlCount = (text.match(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g) || []).length;
    const total = text.length;

    if (replacementCount / total > maxReplacementRatio) return false;
    if (controlCount / total > maxReplacementRatio) return false;

    const hasHebrewThai = /[\u0590-\u05FF].*[\u0E00-\u0E7F]|[\u0E00-\u0E7F].*[\u0590-\u05FF]/.test(text);
    const hasArabicThai = /[\u0600-\u06FF].*[\u0E00-\u0E7F]|[\u0E00-\u0E7F].*[\u0600-\u06FF]/.test(text);
    const hasCyrillicThai = /[\u0400-\u04FF].*[\u0E00-\u0E7F]|[\u0E00-\u0E7F].*[\u0400-\u04FF]/.test(text);

    if (hasHebrewThai || hasArabicThai || hasCyrillicThai) return false;

    return true;
}

export interface DetectionResult {
    detected: string | null;
    detected3: string;
    isMatch: boolean;
    isRelatedMatch: boolean;
}

export async function detectLanguage(text: string, expectedLang: string | null = null): Promise<DetectionResult> {
    if (!text || text.length < 100) {
        return { detected: null, detected3: 'und', isMatch: false, isRelatedMatch: false };
    }

    const skipPos = getValidationSkipPos(text.length);
    let sample = text.slice(skipPos, skipPos + VALIDATION_SAMPLE_SIZE);

    sample = sample
        .replace(/\d{2}:\d{2}:\d{2}[,\.]\d{3}\s*-->\s*\d{2}:\d{2}:\d{2}[,\.]\d{3}/g, ' ')
        .replace(/^\d+\s*$/gm, '')
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();

    if (sample.length < 100) {
        return { detected: null, detected3: 'und', isMatch: false, isRelatedMatch: false };
    }

    const results = francAll(sample);

    if (!results.length || results[0][0] === 'und') {
        return { detected: null, detected3: 'und', isMatch: false, isRelatedMatch: false };
    }

    const detected3 = results[0][0];
    const detected = francToIso2Map[detected3] || detected3;
    const expected = expectedLang ? (await normalizeLanguageCode(expectedLang) || expectedLang.toLowerCase()) : null;
    const isMatch = expected ? (detected === expected) : false;

    let isRelatedMatch = isMatch;
    if (!isMatch && expected) {
        const relatedToExpected = RELATED_LANGUAGES[expected] || [];
        const relatedToDetected = RELATED_LANGUAGES[detected] || [];
        isRelatedMatch = relatedToExpected.includes(detected) || relatedToDetected.includes(expected);
    }

    return {
        detected,
        detected3,
        isMatch,
        isRelatedMatch
    };
}

export async function validateLanguage(text: string, expectedLang: string, options: { skipCorruptionCheck?: boolean } = {}): Promise<boolean> {
    if (!text || !expectedLang) return true;

    const expected = (await normalizeLanguageCode(expectedLang)) || expectedLang.toLowerCase();

    if (!options.skipCorruptionCheck && !isCleanText(text)) {
        return false;
    }

    const detection = await detectLanguage(text, expected);
    return detection.isRelatedMatch;
}

export const LANGUAGE_ENCODINGS: Record<string, string[]> = {
    'ru': ['win1251', 'iso88595', 'koi8-r'],
    'uk': ['win1251', 'koi8-u'],
    'bg': ['win1251', 'iso88595'],
    'sr': ['win1251', 'iso88595'],
    'mk': ['win1251', 'iso88595'],
    'be': ['win1251', 'iso88595'],
    'el': ['win1253', 'iso88597'],
    'tr': ['win1254', 'iso88599'],
    'he': ['win1255', 'iso88598'],
    'ar': ['win1256', 'iso88596'],
    'th': ['win874', 'tis620', 'iso885911'],
    'vi': ['win1258'],
    'pl': ['win1250', 'iso88592'],
    'cs': ['win1250', 'iso88592'],
    'sk': ['win1250', 'iso88592'],
    'hu': ['win1250', 'iso88592'],
    'ro': ['win1250', 'iso88592'],
    'hr': ['win1250', 'iso88592'],
    'sl': ['win1250', 'iso88592'],
    'lt': ['win1257', 'iso885913'],
    'lv': ['win1257', 'iso885913'],
    'et': ['win1257', 'iso885913'],
    'de': ['win1252', 'iso88591'],
    'fr': ['win1252', 'iso88591'],
    'es': ['win1252', 'iso88591'],
    'it': ['win1252', 'iso88591'],
    'pt': ['win1252', 'iso88591'],
    'zh': ['gbk', 'gb2312', 'big5'],
    'ja': ['shift_jis', 'euc-jp', 'iso2022jp'],
    'ko': ['euc-kr', 'cp949'],
    'hi': ['win1252'],
    'bn': ['win1252'],
    'id': ['win1252', 'iso88591'],
    'ms': ['win1252', 'iso88591'],
    'tl': ['win1252', 'iso88591'],
    'ta': ['win1252'],
    'te': ['win1252'],
    'ml': ['win1252'],
    'kn': ['win1252'],
    'mr': ['win1252'],
    'gu': ['win1252'],
    'pa': ['win1252'],
    'ur': ['win1256', 'win1252'],
    'fa': ['win1256', 'iso88596'],
    'km': ['win1252'],
    'my': ['win1252'],
    'si': ['win1252'],
    'sv': ['win1252', 'iso88591'],
    'no': ['win1252', 'iso88591'],
    'da': ['win1252', 'iso88591'],
    'fi': ['win1252', 'iso88591'],
    'is': ['win1252', 'iso88591'],
    'nl': ['win1252', 'iso88591'],
    'ca': ['win1252', 'iso88591'],
    'eu': ['win1252', 'iso88591'],
    'gl': ['win1252', 'iso88591'],
    'sq': ['win1250', 'iso88592'],
    'bs': ['win1250', 'iso88592'],
    'sw': ['win1252', 'iso88591'],
    'am': ['win1252'],
    'ha': ['win1252', 'iso88591'],
    'yo': ['win1252', 'iso88591'],
    'zu': ['win1252', 'iso88591'],
    'xh': ['win1252', 'iso88591'],
    'af': ['win1252', 'iso88591'],
};

function buildCodepageList(languageHint: string | null = null): Array<{ name: string; desc: string }> {
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

    if (!languageHint) {
        return defaultCodepages;
    }

    const langEncodings = LANGUAGE_ENCODINGS[languageHint.toLowerCase()];
    if (!langEncodings || langEncodings.length === 0) {
        return defaultCodepages;
    }

    const descMap: Record<string, string> = {
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

    const prioritized: Array<{ name: string; desc: string }> = [];
    const usedNames = new Set<string>();

    for (const encoding of langEncodings) {
        const name = encoding.toLowerCase();
        prioritized.push({
            name,
            desc: descMap[name] || `${encoding.toUpperCase()} (${languageHint.toUpperCase()})`
        });
        usedNames.add(name);
    }

    for (const cp of defaultCodepages) {
        if (!usedNames.has(cp.name)) {
            prioritized.push(cp);
        }
    }

    return prioritized;
}

export async function fixCharacterEncodings(text: string, languageHint: string | null = null, silent = false): Promise<string> {
    const log = silent ? () => {} : console.log.bind(console);
    languageHint = await normalizeLanguageCode(languageHint);

    const patterns: Record<string, RegExp> = {
        thaiCjk: /[\u00E0-\u00EF][\u0080-\u00BF]/g,
        accented: /\u00C3[\u0080-\u00BF]/g,
        special: /\u00C2[\u0080-\u00BF]/g,
        extLatin: /[\u00C4-\u00C5][\u0080-\u00BF]/g,
        ipaModifiers: /[\u00C6-\u00CB][\u0080-\u00BF]/g,
        greek: /[\u00CC-\u00CF][\u0080-\u00BF]/g,
        cyrillic: /[\u00D0-\u00D4][\u0080-\u00BF]/g,
        armenian: /[\u00D5-\u00D6][\u0080-\u00BF]/g,
        hebrew: /\u00D7[\u0080-\u00BF]/g,
        arabic: /[\u00D8-\u00DB][\u0080-\u00BF]/g,
        syriacThaana: /[\u00DC-\u00DF][\u0080-\u00BF]/g,
    };

    const legacyMojibake = /[\u0080-\u00FF]/g;

    const matches: Record<string, number> = {};
    let totalMatches = 0;
    for (const [name, pattern] of Object.entries(patterns)) {
        matches[name] = (text.match(pattern) || []).length;
        totalMatches += matches[name];
    }

    const legacyMatches = (text.match(legacyMojibake) || []).length;
    const textLength = text.length;
    const legacyDensity = textLength > 0 ? legacyMatches / textLength : 0;

    if (totalMatches > 10) {
        const breakdown = Object.entries(matches).filter(([,v]) => v > 0).map(([k,v]) => `${v} ${k}`).join(', ');
        log(`[ENCODING] Detected likely misencoded text (${totalMatches} patterns: ${breakdown})`);

        const bytes = Buffer.from(text, 'latin1');

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

        const codepages = buildCodepageList(languageHint);

        for (const { name, desc } of codepages) {
            try {
                const fixed = iconv.decode(bytes, name);
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
                // Ignore support errors
            }
        }

        log(`[ENCODING] Could not find valid encoding, keeping original`);
    }
    else if (legacyDensity > 0.10 && legacyMatches > 50) {
        log(`[ENCODING] High Latin Extended density (${(legacyDensity * 100).toFixed(1)}%, ${legacyMatches} chars) - trying legacy codepages`);

        const bytes = Buffer.from(text, 'latin1');
        const codepages = buildCodepageList(languageHint);

        for (const { name, desc } of codepages) {
            try {
                const fixed = iconv.decode(bytes, name);
                if (fixed.includes('\uFFFD')) continue;

                const fixedLegacy = (fixed.match(legacyMojibake) || []).length;
                const fixedDensity = fixed.length > 0 ? fixedLegacy / fixed.length : 0;

                if (fixedDensity < legacyDensity * 0.3) {
                    log(`[ENCODING] Fixed as ${desc} (Latin Ext: ${(legacyDensity * 100).toFixed(1)}% → ${(fixedDensity * 100).toFixed(1)}%)`);
                    return fixed;
                }
            } catch (e) {
                // Ignore support errors
            }
        }
        log(`[ENCODING] Legacy codepage fix failed, keeping original`);
    }

    return text;
}

function normalizeEncoding(encoding: string | null): string {
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
            if (iconv.encodingExists(normalized)) {
                return normalized;
            }
            return 'utf8';
    }
}

export async function decodeSubtitleBuffer(
    buffer: Buffer,
    languageHint: string | null = null,
    options: boolean | { verbose?: boolean; skipLanguageValidation?: boolean } = {}
): Promise<string | null> {
    let silent = false;
    let skipLanguageValidation = false;

    if (typeof options === 'boolean') {
        silent = options;
    } else if (typeof options === 'object') {
        silent = !options.verbose;
        skipLanguageValidation = options.skipLanguageValidation || false;
    }

    const log = silent ? () => {} : console.log.bind(console);

    if (languageHint && SKIP_LANGUAGE_CODES.includes(languageHint.toLowerCase())) {
        log(`[ENCODING] Skipping '${languageHint}' - language code is in skip list`);
        return null;
    }

    languageHint = await normalizeLanguageCode(languageHint);
    let subtitleText: string;

    // Check for double-encoded UTF-16 LE BOM (FF FE -> C3 BF C3 BE)
    if (buffer.length >= 4 && buffer[0] === 0xC3 && buffer[1] === 0xBF && buffer[2] === 0xC3 && buffer[3] === 0xBE) {
        log('[ENCODING] Detected double-encoded UTF-16 LE, fixing...');
        const undoubled = Buffer.from(buffer.toString('utf8'), 'latin1');
        subtitleText = undoubled.slice(2).toString('utf16le');
    }
    // Check for regular UTF-16 LE BOM (FF FE)
    else if (buffer.length >= 2 && buffer[0] === 0xFF && buffer[1] === 0xFE) {
        log('[ENCODING] Detected UTF-16 LE BOM, decoding...');
        subtitleText = buffer.slice(2).toString('utf16le');
    }
    // Check for double-encoded UTF-16 BE BOM (FE FF -> C3 BE C3 BF)
    else if (buffer.length >= 4 && buffer[0] === 0xC3 && buffer[1] === 0xBE && buffer[2] === 0xC3 && buffer[3] === 0xBF) {
        log('[ENCODING] Detected double-encoded UTF-16 BE, fixing...');
        const undoubled = Buffer.from(buffer.toString('utf8'), 'latin1');
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
    // Check for double-encoded UTF-8 BOM (EF BB BF -> C3 AF C2 BB C2 BF)
    else if (buffer.length >= 6 && buffer[0] === 0xC3 && buffer[1] === 0xAF &&
             buffer[2] === 0xC2 && buffer[3] === 0xBB && buffer[4] === 0xC2 && buffer[5] === 0xBF) {
        log('[ENCODING] Detected double-encoded UTF-8 BOM, fixing...');
        subtitleText = buffer.slice(6).toString('utf8');
    }
    // Check for UTF-8 BOM (EF BB BF)
    else if (buffer.length >= 3 && buffer[0] === 0xEF && buffer[1] === 0xBB && buffer[2] === 0xBF) {
        log('[ENCODING] Detected UTF-8 BOM');
        subtitleText = buffer.slice(3).toString('utf8');
    }
    // No BOM - use chardet to detect encoding
    else {
        const sample = buffer.slice(0, Math.min(buffer.length, CHARDET_SAMPLE_SIZE));
        const detectedEncoding = chardet.detect(sample);
        const encoding = normalizeEncoding(detectedEncoding);

        if (encoding !== 'utf8') {
            log(`[ENCODING] chardet detected: ${detectedEncoding} -> using ${encoding}`);
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

    subtitleText = await fixCharacterEncodings(subtitleText, languageHint, silent);

    if (subtitleText.startsWith('\uFEFF')) {
        subtitleText = subtitleText.slice(1);
    }
    if (subtitleText.startsWith('ï»¿')) {
        subtitleText = subtitleText.slice(3);
    }

    if (languageHint && !skipLanguageValidation) {
        const langValid = await validateLanguage(subtitleText, languageHint, { skipCorruptionCheck: true });
        if (!langValid) {
            log(`[ENCODING] Final validation failed: detected language doesn't match expected ${languageHint}. Rejecting.`);
            return null;
        }
    }

    return subtitleText;
}
