#!/usr/bin/env node

// Load .env file for local development (optional - containers set env vars directly)
try { require('dotenv').config(); } catch (e) { /* dotenv not needed in production */ }

const { addonBuilder, serveHTTP } = require('stremio-addon-sdk');
const axios = require('axios');
const { Buffer } = require('buffer');
const pako = require('pako');
const chardet = require('chardet');
const iconv = require('iconv-lite');
const { put } = require('@vercel/blob');
const { createClient } = require('@supabase/supabase-js');
const { convert: convertWithSubtitleConverter } = require('subtitle-converter');
const subsrt = require('subsrt');
const sanitize = require('sanitize-html');
const fs = require('fs').promises;
const path = require('path');

const languageMap = {
    'abk': 'Abkhazian', 'afr': 'Afrikaans', 'alb': 'Albanian', 'amh': 'Amharic', 'ara': 'Arabic',
    'arg': 'Aragonese', 'arm': 'Armenian', 'asm': 'Assamese', 'ast': 'Asturian', 'azb': 'South Azerbaijani',
    'aze': 'Azerbaijani', 'baq': 'Basque', 'bel': 'Belarusian', 'ben': 'Bengali', 'bos': 'Bosnian',
    'bre': 'Breton', 'bul': 'Bulgarian', 'bur': 'Burmese', 'cat': 'Catalan', 'chi': 'Chinese (simplified)',
    'cze': 'Czech', 'dan': 'Danish', 'dut': 'Dutch', 'ell': 'Greek', 'eng': 'English', 'epo': 'Esperanto',
    'est': 'Estonian', 'ext': 'Extremaduran', 'fin': 'Finnish', 'fre': 'French', 'geo': 'Georgian',
    'ger': 'German', 'gla': 'Gaelic', 'gle': 'Irish', 'glg': 'Galician', 'heb': 'Hebrew', 'hin': 'Hindi',
    'hrv': 'Croatian', 'hun': 'Hungarian', 'ibo': 'Igbo', 'ice': 'Icelandic', 'ina': 'Interlingua',
    'ind': 'Indonesian', 'ita': 'Italian', 'jpn': 'Japanese', 'kan': 'Kannada', 'kaz': 'Kazakh',
    'khm': 'Khmer', 'kir': 'Kyrgyz', 'kor': 'Korean', 'kur': 'Kurdish', 'lav': 'Latvian',
    'lit': 'Lithuanian', 'ltz': 'Luxembourgish', 'mac': 'Macedonian', 'mal': 'Malayalam', 'mar': 'Marathi',
    'may': 'Malay', 'mne': 'Montenegrin', 'mni': 'Manipuri', 'mon': 'Mongolian', 'nav': 'Navajo',
    'nep': 'Nepali', 'nor': 'Norwegian', 'oci': 'Occitan', 'ori': 'Odia', 'per': 'Persian',
    'pob': 'Portuguese (BR)', 'pol': 'Polish', 'pom': 'Portuguese (MZ)', 'por': 'Portuguese',
    'prs': 'Dari', 'pus': 'Pushto', 'rum': 'Romanian', 'rus': 'Russian', 'sat': 'Santali', 'scc': 'Serbian',
    'sin': 'Sinhalese', 'slo': 'Slovak', 'slv': 'Slovenian', 'sme': 'Northern Sami', 'snd': 'Sindhi',
    'som': 'Somali', 'spa': 'Spanish', 'spl': 'Spanish (LA)', 'spn': 'Spanish (EU)', 'swa': 'Swahili',
    'swe': 'Swedish', 'syr': 'Syriac', 'tam': 'Tamil', 'tat': 'Tatar', 'tel': 'Telugu', 'tet': 'Tetum',
    'tgl': 'Tagalog', 'tha': 'Thai', 'tok': 'Toki Pona', 'tur': 'Turkish', 'tuk': 'Turkmen', 'ukr': 'Ukrainian',
    'urd': 'Urdu', 'uzb': 'Uzbek', 'vie': 'Vietnamese', 'wel': 'Welsh', 'wen': 'Sorbian languages',
    'zhc': 'Chinese (Cantonese)', 'zhe': 'Chinese bilingual', 'zht': 'Chinese (traditional)'
};

// Map ISO 639-1 (browser) language codes to ISO 639-3 (our system) language codes
const browserLanguageMap = {
    'en': 'eng', 'es': 'spa', 'fr': 'fre', 'de': 'ger', 'it': 'ita',
    'pt': 'por', 'pt-br': 'pob', 'ru': 'rus', 'ja': 'jpn', 'ko': 'kor',
    'zh': 'chi', 'zh-cn': 'chi', 'zh-tw': 'zht', 'ar': 'ara', 'hi': 'hin',
    'bn': 'ben', 'pa': 'pan', 'te': 'tel', 'mr': 'mar', 'ta': 'tam',
    'gu': 'guj', 'kn': 'kan', 'ml': 'mal', 'or': 'ori', 'pl': 'pol',
    'uk': 'ukr', 'tr': 'tur', 'hu': 'hun', 'cs': 'cze', 'ro': 'rum',
    'nl': 'dut', 'sv': 'swe', 'da': 'dan', 'no': 'nor', 'fi': 'fin',
    'el': 'ell', 'th': 'tha', 'vi': 'vie', 'id': 'ind', 'ms': 'may',
    'fil': 'tgl', 'he': 'heb', 'fa': 'per', 'ur': 'urd', 'sq': 'alb',
    'hr': 'hrv', 'sr': 'scc', 'bg': 'bul', 'sk': 'slo', 'sl': 'slv',
    'et': 'est', 'lv': 'lav', 'lt': 'lit', 'ca': 'cat', 'eu': 'baq',
    'gl': 'glg', 'mk': 'mac', 'is': 'ice', 'cy': 'wel', 'ga': 'gle'
};

// Function to extract browser language from Accept-Language header
function extractBrowserLanguageFromHeader(acceptLanguageHeader) {
    if (!acceptLanguageHeader) {
        return 'eng';
    }
    
    // Parse Accept-Language header (e.g., "en-US,en;q=0.9,fr;q=0.8")
    const languages = acceptLanguageHeader
        .split(',')
        .map(lang => lang.trim().split(';')[0])
        .map(lang => lang.split('-')[0].toLowerCase())
        .filter(lang => lang.length > 0);
    
    if (languages.length === 0) {
        return 'eng';
    }
    
    // Try to find a match in our supported languages
    for (const lang of languages) {
        const iso639_3Code = browserLanguageMap[lang];
        if (iso639_3Code) {
            return iso639_3Code;
        }
    }
    
    // Default to English if no match found
    return 'eng';
}


const languageOptions = Object.entries(languageMap).map(([code, name]) => `${name} [${code}]`);

// OpenSubtitles REST API base URL (for fallback)
const OPENSUBS_API_URL = 'https://rest.opensubtitles.org';

// Configuration
const ADDON_PORT = process.env.PORT || 7000;
const LOCAL_STORAGE_DIR = process.env.LOCAL_STORAGE_DIR; // If set, enables local file storage
const EXTERNAL_URL = process.env.EXTERNAL_URL || `http://localhost:${ADDON_PORT}`; // External URL for subtitle access

// Rate limiting fully removed

// Create a new addon builder
const builder = new addonBuilder({
    id: 'com.serhat.strelingo',
    version: '0.1.2',
    name: 'Strelingo - Dual Language Subtitles',
    description: 'Provides dual subtitles (main + translation) from OpenSubtitles for language learning. <br><a href="https://github.com/Serkali-sudo/strelingo-addon" style="color: #1E90FF;">GitHub</a>',
    resources: ['subtitles'],
    types: ['movie', 'series'],
    idPrefixes: ['tt'],
    logo: 'https://raw.githubusercontent.com/Serkali-sudo/strelingo-addon/refs/heads/main/assets/strelingo_icon.jpg',
    background: 'https://raw.githubusercontent.com/Serkali-sudo/strelingo-addon/refs/heads/main/assets/strelingo_back.jpg',
    catalogs: [],
    behaviorHints: {
        configurable: true,
        configurationRequired: true
    },
    stremioAddonsConfig: {
        issuer: "https://stremio-addons.net",
        signature: "eyJhbGciOiJkaXIiLCJlbmMiOiJBMTI4Q0JDLUhTMjU2In0..lXnuMnJQRfJhhvSjtCRgEA.Pkd-2sawfsFx8_aNwVoXJyUP8nVoOQj2oU_UiHnv0u8vFcCZQiXbFfZoPCpiXSxOK6YCadj4xw_k034_Scj-pCrwtw96gAf2zmtXT0c2K4qqLuB42kCuokwvhBkoQDix.QOZAdelTEd338sxgF4OeBQ"
    },
    config: [
        {
            key: 'mainLang',
            type: 'select',
            title: 'Main Language (Audio Language)',
            options: languageOptions,
            required: true,
            default: 'English [eng]'
        },
        {
            key: 'transLang',
            type: 'select',
            title: 'Translation Language (Your Language)',
            options: languageOptions,
            required: true,
            default: 'English [eng]' // Will be auto-detected based on browser language on first config
        }
    ]
});

function parseLangCode(lang) {
    if (!lang) {
        return lang;
    }

    let match = lang.match(/\[([^\]]+)\]$/);
    if (match) {
        return match[1];
    }


    return lang;
}

// (All previous queue/timer logic has been removed intentionally)

// --- Helper Function to Fetch All Subtitles ---
async function fetchAllSubtitles(baseSearchParams, type, videoParams = {}, needsJapanese = false) {
    // Build the new API URL
    const imdbId = `tt${baseSearchParams.imdbid}`;
    let apiUrl = `https://opensubtitles-v3.strem.io/subtitles/${type}/${imdbId}`;
    
    // Add series parameters if available
    if (type === 'series' && baseSearchParams.season && baseSearchParams.episode) {
        apiUrl += `:${baseSearchParams.season}:${baseSearchParams.episode}`;
    }
    
    // Build query parameters for better subtitle matching
    const queryParams = [];
    if (videoParams.filename) {
        queryParams.push(`filename=${encodeURIComponent(videoParams.filename)}`);
    }
    if (videoParams.videoSize) {
        queryParams.push(`videoSize=${videoParams.videoSize}`);
    }
    if (videoParams.videoHash) {
        queryParams.push(`videoHash=${videoParams.videoHash}`);
    }
    
    // Add query parameters if any exist
    if (queryParams.length > 0) {
        apiUrl += `/${queryParams.join('&')}`;
    }
    
    apiUrl += '.json';
    
    console.log(`Fetching all subtitles from: ${apiUrl}`);

    try {
        // Fetch from OpenSubtitles
        const opensubsResponse = axios.get(apiUrl, {
            timeout: 10000
        });
        
        const promises = [opensubsResponse];
        
        // Only fetch from Buta no Subs if one of the languages is Japanese
        if (needsJapanese) {
            const butaNoSubsUrl = `https://buta-no-subs-stremio-addon.onrender.com/subtitles/${type}/tt${baseSearchParams.imdbid}${(baseSearchParams.season) ? ":" + baseSearchParams.season + ":" + baseSearchParams.episode : ""}.json`;
            console.log(`Also fetching Japanese subtitles from: ${butaNoSubsUrl}`);
            
            const butaNoSubsResponse = axios.get(butaNoSubsUrl, {
                timeout: 10000
            }).then((res) => {
                // Adapt response to expected format
                if (!res.data || !Array.isArray(res.data.subtitles)) {
                    return { subtitles: [] };
                }
                const subtitles = res.data.subtitles.map((sub, idx) => ({
                    id: sub.id,
                    url: sub.url,
                    lang: sub.lang || 'jpn',
                    downloads: res.data.subtitles.length - idx // Preserve order
                }));
                return { subtitles };
            }).catch(() => {
                // If Buta no Subs fails, just return empty
                return { subtitles: [] };
            });
            
            promises.push(butaNoSubsResponse);
        }
        
        // Wait for all requests
        const results = await Promise.allSettled(promises);
        
        // Check if all requests failed
        if (results.every(result => result.status === 'rejected')) {
            throw results[0].reason;
        }
        
        let allSubtitles = [];
        
        // Add OpenSubtitles results (all languages)
        if (results[0].status === 'fulfilled' && results[0].value.data && results[0].value.data.subtitles) {
            allSubtitles = allSubtitles.concat(results[0].value.data.subtitles);
        }
        
        // Add Buta no Subs results (Japanese) if we requested it
        if (needsJapanese && results[1] && results[1].status === 'fulfilled' && results[1].value.subtitles) {
            allSubtitles = allSubtitles.concat(results[1].value.subtitles);
        }

        if (allSubtitles.length === 0) {
            console.log('No subtitles found from any source.');
            return null;
        }

        console.log(`Found ${allSubtitles.length} total subtitles from all sources.`);
        
        // Return all subtitles grouped by language
        return allSubtitles;

    } catch (error) {
        console.error('Error fetching subtitles:', error.message);
        return null;
    }
}

// Helper to filter and format subtitles by language
function filterSubtitlesByLanguage(allSubtitles, languageId) {
    if (!allSubtitles) return null;
    
    const langSubs = allSubtitles.filter(sub => sub.lang === languageId);
    
    if (langSubs.length === 0) {
        console.log(`No subtitles found for language ${languageId}.`);
        return null;
    }

    // Map to the desired return format
    const subtitleList = langSubs.map((sub, idx) => {
        return {
            id: sub.id,
            url: sub.url, // Direct URL to SRT file
            lang: sub.lang,
            format: 'srt', // Always SRT format
            langName: languageMap[sub.lang] || sub.lang,
            releaseName: 'OpenSubtitles',
            rating: 0,
            downloads: sub.downloads || (langSubs.length - idx) // Preserve order
        };
    });

    console.log(`Found ${subtitleList.length} valid subtitles for ${languageId}.`);
    return subtitleList;
}

// --- OLD API Fallback Functions ---

// Helper function to build the OLD OpenSubtitles search URL
function buildSearchUrl(params) {
    if (params.episode) {
        const parts = [];
        if (params.episode) parts.push(`episode-${params.episode}`);
        if (params.imdbid) parts.push(`imdbid-${params.imdbid}`);
        if (params.season) parts.push(`season-${params.season}`);
        if (params.sublanguageid) parts.push(`sublanguageid-${params.sublanguageid}`);
        return `${OPENSUBS_API_URL}/search/${parts.join('/')}`;
    }
    
    const searchPath = Object.entries(params)
        .map(([key, value]) => `${key}-${value}`)
        .join('/');
    
    return `${OPENSUBS_API_URL}/search/${searchPath}`;
}

// Fetch subtitles using OLD REST API
async function fetchSubtitlesOldAPI(languageId, baseSearchParams, type) {
    const supportedFormats = ['dfxp', 'scc', 'srt', 'ttml', 'vtt', 'ssa', 'ass', 'sub', 'sbv', 'smi', 'lrc', 'json'];
    const searchParams = { ...baseSearchParams, sublanguageid: languageId };
    const searchUrl = buildSearchUrl(searchParams);
    console.log(`[OLD API] Searching ${languageId} subtitles at: ${searchUrl}`);

    try {
        const response = await axios.get(searchUrl, {
            headers: { 'User-Agent': 'TemporaryUserAgent' },
            timeout: 10000
        });

        if (!response.data || !Array.isArray(response.data) || response.data.length === 0) {
            console.log(`[OLD API] No ${languageId} subtitles found or invalid API response.`);
            return null;
        }
        
        // Filter for valid subtitle formats
        const validFormatSubs = response.data.filter(subtitle =>
            subtitle.SubDownloadLink &&
            subtitle.SubFormat &&
            supportedFormats.includes(subtitle.SubFormat.toLowerCase())
        );

        if (validFormatSubs.length === 0) {
            console.log(`[OLD API] No suitable subtitle format found for ${languageId}.`);
            return null;
        }

        // Sort by download count
        validFormatSubs.sort((a, b) => {
            const downloadsA = parseInt(a.SubDownloadsCnt, 10) || 0;
            const downloadsB = parseInt(b.SubDownloadsCnt, 10) || 0;
            return downloadsB - downloadsA;
        });

        // Map to the desired return format
        const subtitleList = validFormatSubs.map(sub => {
            const directUrl = sub.SubDownloadLink;
            return {
                id: sub.IDSubtitleFile,
                url: directUrl,
                lang: sub.SubLanguageID,
                format: sub.SubFormat,
                langName: sub.LanguageName,
                releaseName: sub.MovieReleaseName || sub.MovieName || 'Unknown',
                rating: parseFloat(sub.SubRating) || 0,
                downloads: parseInt(sub.SubDownloadsCnt, 10) || 0
            };
        });

        console.log(`[OLD API] Found ${subtitleList.length} valid subtitles for ${languageId}.`);
        return subtitleList;

    } catch (error) {
        console.error(`[OLD API] Error fetching ${languageId} subtitles:`, error.message);
        return null;
    }
}

// --- End Helper Function ---

// --- Cookie Management for Old API ---

let openSubtitlesCookie = null; // Cache for the cookie to be used across requests

// Fetches a session cookie from opensubtitles.org to help with Cloudflare
async function refreshOpensubtitlesCookie(force = false) {
    if (openSubtitlesCookie && !force) {
        console.log('[OLD API] Using cached OpenSubtitles cookie.');
        return openSubtitlesCookie;
    }

    console.log(force ? '[OLD API] Forcing cookie refresh...' : '[OLD API] Attempting to fetch fresh cookies from OpenSubtitles...');
    try {
        const response = await axios.get('https://www.opensubtitles.org/en/search/subs', {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:140.0) Gecko/20100101 Firefox/140.0',
            },
            timeout: 10000
        });

        const cookies = response.headers['set-cookie'];
        if (cookies && cookies.length > 0) {
            const cookieString = cookies.map(c => c.split(';')[0]).join('; ');
            openSubtitlesCookie = cookieString;
            console.log('[OLD API] Successfully refreshed OpenSubtitles cookie.');
            console.log('[OLD API] Cookie:', cookieString);
        } else {
            console.warn('[OLD API] Did not receive any set-cookie header from opensubtitles.org.');
        }
    } catch (error) {
        console.error('[OLD API] Failed to fetch cookies from OpenSubtitles:', error.message);
    }
    return openSubtitlesCookie;
}

// --- SRT Parsing and Merging Helpers ---

// Fetches subtitle content from URL (always UTF-8 SRT format from new API)
async function fetchSubtitleContent(url, sourceFormat = 'srt') {
    console.log(`Fetching subtitle content from: ${url}`);
    try {
        const response = await axios.get(url, {
            responseType: 'text',
            timeout: 15000,
            maxContentLength: 5 * 1024 * 1024  // 5 MB limit
        });

        const subtitleText = response.data;
        console.log(`Successfully fetched subtitle: ${url}`);
        return subtitleText;

    } catch (error) {
        console.error(`Error fetching subtitle content from ${url}:`, error.message);
        if (error.response) {
            console.error(`Status: ${error.response.status}`);
        }
        return null;
    }
}

// Fetches subtitle content from old API (handles encoding detection and format conversion)
async function fetchSubtitleContentOldAPI(url, sourceFormat = 'srt', cookie = null, isRetry = false) {
    console.log(`[OLD API] Fetching subtitle content from: ${url}`);
    try {
        const headers = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:140.0) Gecko/20100101 Firefox/140.0',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            'Accept-Language': 'en-US;q=0.5,en;q=0.3',
            'DNT': '1',
            'Upgrade-Insecure-Requests': '1',
            'Sec-Fetch-Dest': 'document',
            'Sec-Fetch-Mode': 'navigate',
            'Sec-Fetch-Site': 'none',
            'Sec-Fetch-User': '?1'
        };

        if (cookie) {
            headers['Cookie'] = cookie;
            console.log(`[OLD API] Using cookie for subtitle download.`);
        }

        const response = await axios.get(url, {
            responseType: 'arraybuffer', // Get as buffer to handle encoding detection
            timeout: 15000,
            headers: headers,
            maxContentLength: 5 * 1024 * 1024  // 5 MB limit
        });

        let contentBuffer = Buffer.from(response.data);
        let subtitleText;

        // 1. Handle Gzip decompression first
        if (url.endsWith('.gz') || (contentBuffer.length > 2 && contentBuffer[0] === 0x1f && contentBuffer[1] === 0x8b)) {
            console.log(`[OLD API] Decompressing gzipped subtitle: ${url}`);
            try {
                contentBuffer = Buffer.from(pako.ungzip(contentBuffer));
                console.log(`[OLD API] Decompressed size: ${contentBuffer.length}`);
            } catch (unzipError) {
                console.error(`[OLD API] Error decompressing subtitle ${url}: ${unzipError.message}`);
                return null;
            }
        }

        // 2. Detect Encoding using chardet
        let detectedEncoding = 'utf8';
        try {
            const rawDetectedEncoding = chardet.detect(contentBuffer);
            console.log(`[OLD API] chardet detected encoding: ${rawDetectedEncoding}`);

            if (rawDetectedEncoding) {
                const normalizedEncoding = rawDetectedEncoding.toLowerCase();
                switch (normalizedEncoding) {
                    case 'windows-1254':
                        detectedEncoding = 'win1254';
                        break;
                    case 'iso-8859-9':
                        detectedEncoding = 'iso88599';
                        break;
                    case 'windows-1252':
                        detectedEncoding = 'win1252';
                        break;
                    case 'utf-16le':
                        detectedEncoding = 'utf16le';
                        break;
                    case 'utf-16be':
                        detectedEncoding = 'utf16be';
                        break;
                    case 'ascii':
                    case 'us-ascii':
                        detectedEncoding = 'utf8';
                        break;
                    case 'utf-8':
                        detectedEncoding = 'utf8';
                        break;
                    default:
                        if (iconv.encodingExists(normalizedEncoding)) {
                            detectedEncoding = normalizedEncoding;
                        } else {
                            console.warn(`[OLD API] Detected encoding '${rawDetectedEncoding}' not supported. Falling back to UTF-8.`);
                            detectedEncoding = 'utf8';
                        }
                }
                console.log(`[OLD API] Using encoding: ${detectedEncoding}`);
            } else {
                console.log(`[OLD API] Encoding detection failed. Defaulting to UTF-8.`);
            }
        } catch (detectionError) {
            console.warn(`[OLD API] Error during encoding detection: ${detectionError.message}. Defaulting to UTF-8.`);
        }

        // 3. Decode using detected encoding
        try {
            subtitleText = iconv.decode(contentBuffer, detectedEncoding);
            console.log(`[OLD API] Successfully decoded subtitle using ${detectedEncoding}.`);

            // Remove BOM if present
            if (detectedEncoding === 'utf8' && subtitleText.charCodeAt(0) === 0xFEFF) {
                console.log("[OLD API] Found BOM character, removing it.");
                subtitleText = subtitleText.substring(1);
            }
        } catch (decodeError) {
            console.error(`[OLD API] Error decoding with ${detectedEncoding}: ${decodeError.message}`);
            console.warn(`[OLD API] Falling back to latin1 decoding.`);
            try {
                subtitleText = iconv.decode(contentBuffer, 'latin1');
            } catch (fallbackError) {
                console.error(`[OLD API] Fallback decoding failed: ${fallbackError.message}`);
                return null;
            }
        }

        // 4. Convert to SRT if needed
        if (sourceFormat.toLowerCase() !== 'srt') {
            console.log(`[OLD API] Converting subtitle from ${sourceFormat} to srt.`);
            let convertedSrt = null;

            try {
                console.log(`[OLD API] Attempting conversion with 'subsrt'...`);
                const options = { format: 'srt' };
                if (sourceFormat.toLowerCase() === 'sub') {
                    options.fps = 23.976;
                }
                const result = subsrt.convert(subtitleText, options);
                if (result) {
                    convertedSrt = result;
                    console.log("[OLD API] Successfully converted to SRT using 'subsrt'.");
                } else {
                    throw new Error("'subsrt.convert' returned empty result.");
                }
            } catch (subsrtError) {
                console.warn(`[OLD API] 'subsrt' failed to convert from ${sourceFormat}: ${subsrtError.message}`);
                console.log(`[OLD API] Falling back to 'subtitle-converter'...`);
                try {
                    const { subtitle, status } = convertWithSubtitleConverter(subtitleText, '.srt', { removeTextFormatting: true });
                    if (status.success) {
                        convertedSrt = subtitle;
                        console.log("[OLD API] Successfully converted to SRT using 'subtitle-converter'.");
                    } else {
                        console.error(`[OLD API] Fallback 'subtitle-converter' also failed. Status:`, status);
                        return null;
                    }
                } catch (fallbackError) {
                    console.error(`[OLD API] Error during fallback conversion with 'subtitle-converter':`, fallbackError.message);
                    return null;
                }
            }
            subtitleText = convertedSrt;
        }

        console.log(`[OLD API] Successfully fetched and processed subtitle: ${url}`);
        return subtitleText;

    } catch (error) {
        // If we get a 403/404, our cookie might be stale. Try refreshing it and retry once.
        if (error.response && (error.response.status === 403 || error.response.status === 404) && !isRetry) {
            console.warn(`[OLD API] Got ${error.response.status} error for ${url}. Forcing cookie refresh and retrying once...`);
            const newCookie = await refreshOpensubtitlesCookie(true); // Force refresh
            return await fetchSubtitleContentOldAPI(url, sourceFormat, newCookie, true); // Retry
        }

        console.error(`[OLD API] Error fetching subtitle content from ${url}:`, error.message);
        if (error.response) {
            console.error(`[OLD API] Status: ${error.response.status}, Headers: ${JSON.stringify(error.response.headers)}`);
        }
        return null;
    }
}

// Helper to convert SRT time format (HH:MM:SS,ms) to milliseconds
function parseTimeToMs(timeString) {
    // Added validation for the time string format
    if (!timeString || !/\d{2}:\d{2}:\d{2},\d{3}/.test(timeString)) {
        console.error(`Invalid time format encountered: ${timeString}`);
        return 0; // Return 0 or throw error, depending on desired strictness
    }
    const parts = timeString.split(':');
    const secondsParts = parts[2].split(',');
    const hours = parseInt(parts[0], 10);
    const minutes = parseInt(parts[1], 10);
    const seconds = parseInt(secondsParts[0], 10);
    const milliseconds = parseInt(secondsParts[1], 10);
    return (hours * 3600 + minutes * 60 + seconds) * 1000 + milliseconds;
}

// Merges two arrays of parsed subtitles based on time
function mergeSubtitles(mainSubs, transSubs, mergeThresholdMs = 500) {
    console.log(`Merging ${mainSubs.length} main subs with ${transSubs.length} translation subs.`);
    const mergedSubs = [];
    let transIndex = 0;

    for (const mainSub of mainSubs) {
        let foundMatch = false;
        let bestMatchIndex = -1;
        let smallestTimeDiff = Infinity;

        // Ensure mainSub is valid before processing
        if (!mainSub || !mainSub.startTime || !mainSub.endTime) {
            console.warn("Skipping invalid main subtitle entry:", mainSub);
            continue;
        }

        const mainStartTime = parseTimeToMs(mainSub.startTime);
        const mainEndTime = parseTimeToMs(mainSub.endTime);

        // Search for the best matching translation subtitle around the main subtitle's time
        for (let i = transIndex; i < transSubs.length; i++) {
            const transSub = transSubs[i];

            // Ensure transSub is valid
            if (!transSub || !transSub.startTime || !transSub.endTime) {
                console.warn("Skipping invalid translation subtitle entry:", transSub);
                continue;
            }

            const transStartTime = parseTimeToMs(transSub.startTime);
            const transEndTime = parseTimeToMs(transSub.endTime);

            // Check for time overlap or closeness
            const startsOverlap = (transStartTime >= mainStartTime && transStartTime < mainEndTime);
            const endsOverlap = (transEndTime > mainStartTime && transEndTime <= mainEndTime);
            const isWithin = (transStartTime >= mainStartTime && transEndTime <= mainEndTime);
            const contains = (transStartTime < mainStartTime && transEndTime > mainEndTime);
            const timeDiff = Math.abs(mainStartTime - transStartTime); // Proximity of start times

            // Prioritize overlaps, then proximity
            if (startsOverlap || endsOverlap || isWithin || contains || timeDiff < mergeThresholdMs) {
                // This sub is a potential match. Find the *closest* start time.
                if (timeDiff < smallestTimeDiff) {
                    smallestTimeDiff = timeDiff;
                    bestMatchIndex = i;
                    // Don't break yet, keep searching for potentially *better* overlaps nearby
                }
                foundMatch = true; // Mark that we found at least one potential match
            } else if (foundMatch && transStartTime > mainEndTime + mergeThresholdMs) {
                // If we already found a match, and this trans sub starts significantly
                // after the main sub ends, we can stop searching for this main sub.
                break;
            } else if (!foundMatch && transStartTime > mainEndTime + mergeThresholdMs) {
                 // If we haven't found any match yet, and this one is too far after,
                 // we can likely stop searching for this main sub.
                 break;
             }

            // Optimization: If this translation sub ends way before the main sub *starts*,
            // advance the starting point for the *next* main sub's search.
            if (transEndTime < mainStartTime - mergeThresholdMs * 2 && i === transIndex) {
                transIndex = i + 1;
            }
        }

       
        // console.log("Before main sanitize:", mainSub.text.substring(0, 50));
        const cleanMainText = sanitize(mainSub.text, {
            allowedTags: [],      // No tags allowed
            allowedAttributes: {} // No attributes allowed
        });
        // console.log("After main sanitize:", cleanMainText.substring(0, 50));
        // Flatten main text by replacing newlines with spaces
        const flatMainText = cleanMainText.replace(/\r?\n|\r/g, ' ');
        if (bestMatchIndex !== -1) {
            const bestTransSub = transSubs[bestMatchIndex];
            // console.log("Before trans sanitize:", bestTransSub.text.substring(0, 50));
            const cleanTransText = sanitize(bestTransSub.text, {
                allowedTags: [],
                allowedAttributes: {}
            });
            // console.log("After trans sanitize:", cleanTransText.substring(0, 50));
            // Flatten translation text by replacing newlines with spaces
            const flatTransText = cleanTransText.replace(/\r?\n|\r/g, ' ');

            mergedSubs.push({
                ...mainSub, // Keep main timing and ID
                // Combine flattened texts with a newline, keeping translation italic
                text: `${flatMainText}\n<i>${flatTransText}</i>`
            });
        } else {
            // If no suitable translation match found, add the main subtitle as is (also flattened)
            mergedSubs.push({
                 ...mainSub,
                 text: flatMainText
            });
        }
    }
    console.log(`Finished merging. Result has ${mergedSubs.length} entries.`);
    return mergedSubs;
}

// Handle process termination
process.on('SIGINT', () => {
    console.log('Shutting down...');
    process.exit(0);
});

// --- Main Async IIFE to handle ESM import and setup ---
(async () => {
    try {
        // Dynamically import the ESM module
        const { default: SRTParser2 } = await import('srt-parser-2');
        console.log("Successfully imported srt-parser-2.");

        // Initialize Supabase client
        const supabaseUrl = process.env.SUPABASE_URL;
        const supabaseKey = process.env.SUPABASE_SERVICE_KEY;
        let supabase;
        if (supabaseUrl && supabaseKey) {
            supabase = createClient(supabaseUrl, supabaseKey);
            console.log("Supabase client initialized with Service Role Key.");
        } else {
            console.warn("Supabase URL or Service Role Key not found in environment variables. Supabase fallback disabled.");
        }

        // --- Parser Dependent Helpers (Define inside IIFE) ---

        // Formats an array of subtitle objects back into SRT text
        function formatSrt(subtitleArray) {
            if (!Array.isArray(subtitleArray)) {
                 console.error("Invalid input to formatSrt: not an array.");
                 return null;
            }
            try {
                const parser = new SRTParser2();
                // Ensure IDs are sequential numbers as strings, as required by srt-parser-2
                const sanitizedArray = subtitleArray.map((sub, index) => ({
                     ...sub,
                     id: (index + 1).toString()
                }));
                return parser.toSrt(sanitizedArray);
            } catch (error) {
                console.error('Error formatting SRT:', error.message);
                // Log the problematic structure if possible
                console.error('Problematic data for formatSrt:', JSON.stringify(subtitleArray.slice(0, 5)));
                return null;
            }
        }

        // Parses SRT text into an array of objects
        function parseSrt(srtText) {
            if (!srtText || typeof srtText !== 'string') {
                 console.error("Invalid input to parseSrt: not a string or empty.");
                 return null;
            }
            try {
                const parser = new SRTParser2();
                // Pre-process: remove BOM if present (should be handled by fetch, but double-check)
                if(srtText.charCodeAt(0) === 0xFEFF) {
                     console.log("Found BOM in parseSrt, removing it.");
                     srtText = srtText.substring(1);
                }
                // Pre-process: normalize line endings
                srtText = srtText.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

                let subtitles = parser.fromSrt(srtText);

                if (!Array.isArray(subtitles)) {
                     console.error("Parsing did not return an array.");
                     return null;
                }

                // Adblocker: Filter out subtitles containing ad keywords
                const adKeywords = ["OpenSubtitles.org", "OpenSubtitles.com", "osdb.link"];
                const originalCount = subtitles.length;
                subtitles = subtitles.filter(sub => 
                    !adKeywords.some(keyword => sub.text.includes(keyword))
                );
                
                if (originalCount > subtitles.length) {
                    console.log(`Adblocker: Removed ${originalCount - subtitles.length} subtitle line(s) containing ads.`);
                }

                 if (subtitles.length === 0 && srtText.trim().length > 0) {
                     console.warn("Parsing resulted in an empty array despite non-empty input.");
                     return null; // Treat as parse failure if input wasn't just whitespace
                 }
                 // Log the text of the first parsed subtitle entry, if it exists
                 if (subtitles.length > 0) {
                     console.log(`First parsed subtitle text by SRTParser2: [${subtitles[0].text}]`);
                 } else {
                     console.log("SRTParser2 returned an empty array.");
                 }

                 if (subtitles.length > 0 && (!subtitles[0].startTime || !subtitles[0].text)) {
                     console.warn("Parsed structure seems invalid (missing startTime or text in first entry).");
                     return null;
                 }

                console.log(`Parsed ${subtitles.length} subtitle entries.`);
                return subtitles;
            } catch (error) {
                console.error('Error parsing SRT:', error.message);
                return null;
            }
        }

        // --- Define Addon Handler (Inside IIFE) ---
        builder.defineSubtitlesHandler(async ({ type, id, extra, config }, req, res) => {
            console.log('Strelingo Subtitle request:', { type, id, extra });
            console.log('Config:', config);

            // --- Add Environment Variable for Skipping Vercel ---
            const skipVercelBlob = process.env.SKIP_VERCEL_BLOB === 'true';
            if (skipVercelBlob) {
                console.log("SKIP_VERCEL_BLOB is true, Vercel Blob upload will be skipped.");
            }
            // ---------------------------------------------------

            // Detect browser language from Accept-Language header
            let browserLanguageCode = 'eng'; // Default fallback
            if (req && req.headers && req.headers['accept-language']) {
                browserLanguageCode = extractBrowserLanguageFromHeader(req.headers['accept-language']);
                console.log(`Detected browser language: ${browserLanguageCode}`);
            } else {
                console.log('No Accept-Language header found, using default English');
            }

            // Get selected languages from config, with browser language as fallback for translation
            const mainLangRaw = config?.mainLang || 'English [eng]';
            const transLangRaw = config?.transLang || `${languageMap[browserLanguageCode]} [${browserLanguageCode}]`;

            const mainLang = parseLangCode(mainLangRaw);
            const transLang = parseLangCode(transLangRaw);

            console.log(`Selected Languages: Main=${mainLang}, Translation=${transLang}`);

            // Add check for identical languages
            if (mainLang === transLang) {
                console.log(`Error: Main language (${mainLang}) and Translation language (${transLang}) cannot be the same. Aborting request.`);
                return { subtitles: [], cacheMaxAge: 3600 }; // Return empty, cache for 1 hour
            }

            // Parse the IMDB ID
            let imdbId = extra?.imdbId || id;
            let season = extra?.season;
            let episode = extra?.episode;

            // Handle combined series ID format (e.g., tt12345:1:2)
            if (imdbId.includes(':')) {
                const parts = imdbId.split(':');
                imdbId = parts[0];
                if (parts.length >= 3) {
                    season = season || parts[1];
                    episode = episode || parts[2];
                }
            }

            if (!imdbId || !imdbId.startsWith('tt')) {
                console.log('No valid IMDB ID provided');
                return { subtitles: [] };
            }

            // Prepare base search parameters (without language)
            const baseSearchParams = {
                imdbid: imdbId.replace('tt', '')
            };
            if (type === 'series' && season && episode) {
                baseSearchParams.season = season;
                baseSearchParams.episode = episode;
            }

            try {
                // Get cookie for old API (if needed later)
                const cookie = await refreshOpensubtitlesCookie();
                if (!cookie) {
                    console.warn("[OLD API] Could not obtain a cookie. Old API downloads may fail due to Cloudflare protection.");
                }

                // Extract video parameters from extra for better matching
                const videoParams = {
                    filename: extra?.filename,
                    videoSize: extra?.videoSize,
                    videoHash: extra?.videoHash
                };
                
                if (videoParams.filename || videoParams.videoSize || videoParams.videoHash) {
                    console.log('Video matching parameters:', videoParams);
                }

                // 1. Fetch ALL subtitles once (all languages)
                // Check if we need Japanese subtitles
                const needsJapanese = mainLang === 'jpn' || transLang === 'jpn';
                if (needsJapanese) {
                    console.log('Japanese language detected, will fetch from Buta no Subs too.');
                }
                
                console.log('Fetching all subtitles...');
                const allSubtitles = await fetchAllSubtitles(baseSearchParams, type, videoParams, needsJapanese);
                
                if (!allSubtitles) {
                    console.log('Failed to fetch subtitles.');
                    return { subtitles: [], cacheMaxAge: 60 };
                }
                
                // 2. Filter by languages
                console.log(`Filtering for main language: ${mainLang}`);
                let mainSubInfoList = filterSubtitlesByLanguage(allSubtitles, mainLang);
                
                console.log(`Filtering for translation language: ${transLang}`);
                let transSubInfoList = filterSubtitlesByLanguage(allSubtitles, transLang);

                // FALLBACK: If either language not found, try OLD API
                if (!mainSubInfoList || mainSubInfoList.length === 0 || !transSubInfoList || transSubInfoList.length === 0) {
                    console.warn('⚠️ One or both languages not found in new API. Trying OLD API fallback...');
                    
                    // Try fetching missing language(s) from old API
                    if (!mainSubInfoList || mainSubInfoList.length === 0) {
                        console.log(`[FALLBACK] Fetching main language (${mainLang}) from OLD API...`);
                        mainSubInfoList = await fetchSubtitlesOldAPI(mainLang, baseSearchParams, type);
                    }
                    
                    if (!transSubInfoList || transSubInfoList.length === 0) {
                        console.log(`[FALLBACK] Fetching translation language (${transLang}) from OLD API...`);
                        transSubInfoList = await fetchSubtitlesOldAPI(transLang, baseSearchParams, type);
                    }
                    
                    // Check again after fallback
                    if (!mainSubInfoList || mainSubInfoList.length === 0) {
                        console.log(`No main language (${mainLang}) subtitles found even with fallback.`);
                        return { subtitles: [], cacheMaxAge: 60 };
                    }
                    if (!transSubInfoList || transSubInfoList.length === 0) {
                        console.warn(`No translation language (${transLang}) subtitles found even with fallback.`);
                        return { subtitles: [], cacheMaxAge: 60 };
                    }
                    
                    console.log('✅ Successfully fetched subtitles using OLD API fallback!');
                }
                
                // 2. Select up to 4 unique translation candidates
                const selectedTransSubs = [];
                const usedTransUrls = new Set();
                for (const transSub of transSubInfoList) {
                    if (selectedTransSubs.length >= 4) break; // Stop if we have 4
                    if (!usedTransUrls.has(transSub.url)) {
                        selectedTransSubs.push(transSub);
                        usedTransUrls.add(transSub.url);
                        console.log(`Selected translation candidate #${selectedTransSubs.length}: ID=${transSub.id}, Downloads=${transSub.downloads}, URL=${transSub.url}`);
                    }
                }

                if (selectedTransSubs.length === 0) {
                    console.error("Found translation metadata, but failed to select any unique candidates (this shouldn't happen if list was not empty).");
                    return { subtitles: [], cacheMaxAge: 60 };
                }

                // 3. Find a valid main subtitle by trying each one from the sorted list
                let mainParsed = null;
                let selectedMainSubInfo = null;
                for (const mainSubInfo of mainSubInfoList) {
                    console.log(`Attempting to process main subtitle: ID=${mainSubInfo.id}, Downloads=${mainSubInfo.downloads}`);
                    
                    // Use old API fetch if format is not SRT (indicates old API source)
                    let mainSubContent;
                    if (mainSubInfo.format && mainSubInfo.format.toLowerCase() !== 'srt') {
                        mainSubContent = await fetchSubtitleContentOldAPI(mainSubInfo.url, mainSubInfo.format, cookie);
                    } else {
                        mainSubContent = await fetchSubtitleContent(mainSubInfo.url, mainSubInfo.format);
                    }
                    if (!mainSubContent) {
                        console.warn(`Failed to fetch content for main sub ID ${mainSubInfo.id}. Trying next candidate.`);
                        continue;
                    }

                    console.log("Parsing main subtitle content...");
                    const parsed = parseSrt(mainSubContent);
                    if (!parsed) {
                        console.warn(`Failed to parse content for main sub ID ${mainSubInfo.id}. Trying next candidate.`);
                        continue;
                    }

                    // Success!
                    mainParsed = parsed;
                    selectedMainSubInfo = mainSubInfo;
                    console.log(`Successfully processed main subtitle (ID: ${selectedMainSubInfo.id}). Proceeding with translations.`);
                    break; // Exit loop once a working main sub is found
                }

                if (!mainParsed) {
                    console.error("Failed to fetch and parse any of the available main subtitles. Cannot proceed.");
                    return { subtitles: [], cacheMaxAge: 60 };
                }

                // 4. Process Each Selected Translation Subtitle with the valid main subtitle
                const finalSubtitles = [];
                for (let i = 0; i < selectedTransSubs.length; i++) {
                    const transSubInfo = selectedTransSubs[i];
                    const version = i + 1;
                    console.log(`Processing translation candidate v${version} (ID: ${transSubInfo.id})...`);

                    // Use old API fetch if format is not SRT (indicates old API source)
                    let transSubContent;
                    if (transSubInfo.format && transSubInfo.format.toLowerCase() !== 'srt') {
                        transSubContent = await fetchSubtitleContentOldAPI(transSubInfo.url, transSubInfo.format, cookie);
                    } else {
                        transSubContent = await fetchSubtitleContent(transSubInfo.url, transSubInfo.format);
                    }
                    if (!transSubContent) {
                        console.warn(`Failed to fetch content for translation v${version}. Skipping.`);
                        continue; // Skip to next candidate
                    }

                    // Parse content
                    const transParsed = parseSrt(transSubContent);
                    if (!transParsed) {
                        console.warn(`Failed to parse content for translation v${version}. Skipping.`);
                        continue; // Skip to next candidate
                    }

                    // Merge with main
                    console.log(`Merging main with translation v${version}...`);
                    const mergedParsed = mergeSubtitles([...mainParsed], transParsed); // Use copy of mainParsed
                    if (!mergedParsed || mergedParsed.length === 0) {
                        console.warn(`Merging failed or resulted in empty subtitles for v${version}. Skipping.`);
                        continue; // Skip to next candidate
                    }

                    // Format to SRT
                    console.log(`Formatting merged SRT for v${version}...`);
                    const mergedSrtString = formatSrt(mergedParsed);
                    if (!mergedSrtString) {
                        console.warn(`Failed to format merged SRT for v${version}. Skipping.`);
                        continue; // Skip to next candidate
                    }

                    // --- Conditional Upload Logic --- 
                    let uploadedToVercel = false;
                    let uploadUrl = null;
                    let subtitleEntryId = `merged-${selectedMainSubInfo.id}-${transSubInfo.id}`; // Use the ID of the successfully fetched main sub

                    // Attempt Vercel Blob upload ONLY if not skipped
                    if (!skipVercelBlob) {
                        console.log(`Attempting Vercel Blob upload for v${version}...`);
                        try {
                            const blobFileName = type === 'series' && season && episode 
                                ? `${imdbId}_S${season}E${episode}_${mainLang}_${transLang}_v${version}.srt` 
                                : `${imdbId}_${mainLang}_${transLang}_v${version}.srt`;
                            const { url } = await put(
                                blobFileName,
                                mergedSrtString,
                                { access: 'public', addRandomSuffix: true }
                            );
                            console.log(`Uploaded v${version} to Vercel Blob: ${url}`);
                            uploadUrl = url;
                            uploadedToVercel = true;
                            subtitleEntryId += '-vercel'; 
                        } catch (uploadError) {
                            console.error(`Failed to upload merged SRT for v${version} to Vercel Blob: ${uploadError.message}`);
                            // Do not throw, proceed to check Supabase fallback
                        }
                    }

                    // Attempt Supabase upload if Vercel was skipped OR failed
                    if (!uploadUrl && supabase) {
                        console.log(`Attempting Supabase Storage upload for v${version}...`);
                        try {
                            const supabaseFileName = type === 'series' && season && episode
                                ? `${imdbId}/S${season}E${episode}_${mainLang}_${transLang}_v${version}.srt`
                                : `${imdbId}/${mainLang}_${transLang}_v${version}.srt`;
                            const { error: supabaseError } = await supabase
                                .storage
                                .from('subtitles') // Replace 'subtitles' with your bucket name
                                .upload(supabaseFileName, mergedSrtString, {
                                    cacheControl: '3600',
                                    upsert: true,
                                    contentType: 'text/srt; charset=utf-8'
                                });

                            if (supabaseError) throw supabaseError;

                            const { data: publicUrlData } = supabase
                                .storage
                                .from('subtitles') // Replace 'subtitles' with your bucket name
                                .getPublicUrl(supabaseFileName);

                            if (!publicUrlData || !publicUrlData.publicUrl) {
                                console.error(`Supabase upload successful for v${version}, but failed to get public URL.`);
                            } else {
                                uploadUrl = publicUrlData.publicUrl;
                                console.log(`Uploaded v${version} to Supabase: ${uploadUrl}`);
                                subtitleEntryId += '-supabase'; 
                            }
                        } catch (supabaseUploadError) {
                            console.error(`Supabase Storage upload failed for v${version}: ${supabaseUploadError.message}`);
                             // Log error, don't add to final results if both failed
                        }
                    }

                    // Attempt Local Storage if both Vercel and Supabase failed/skipped
                    if (!uploadUrl && LOCAL_STORAGE_DIR) {
                        console.log(`Attempting Local Storage upload for v${version}...`);
                        try {
                            // Create the local storage directory if it doesn't exist
                            await fs.mkdir(LOCAL_STORAGE_DIR, { recursive: true });

                            const localFileName = type === 'series' && season && episode
                                ? `${imdbId}_S${season}E${episode}_${mainLang}_${transLang}_v${version}.srt`
                                : `${imdbId}_${mainLang}_${transLang}_v${version}.srt`;
                            const localFilePath = path.join(LOCAL_STORAGE_DIR, localFileName);

                            // Write the subtitle file to local storage
                            await fs.writeFile(localFilePath, mergedSrtString, 'utf-8');

                            // Generate URL using external URL (supports remote access)
                            uploadUrl = `${EXTERNAL_URL}/subtitles/${localFileName}`;
                            console.log(`Uploaded v${version} to Local Storage: ${uploadUrl}`);
                            subtitleEntryId += '-local';
                        } catch (localStorageError) {
                            console.error(`Local Storage upload failed for v${version}: ${localStorageError.message}`);
                        }
                    }

                    // Add to results if an upload was successful
                    if (uploadUrl) {
                         finalSubtitles.push({
                             id: subtitleEntryId,
                             url: uploadUrl,
                             lang: `${mainLang}+${transLang}`
                         });
                    } else {
                         console.warn(`Failed to upload v${version} to either Vercel Blob or Supabase Storage.`);
                    }
                    // --- End Conditional Upload Logic ---
                }

                // 5. Return results
                if (finalSubtitles.length === 0) {
                    console.warn("Processed translation candidates, but none resulted in a usable subtitle file. Returning empty.");
                }

                return {
                    subtitles: finalSubtitles,
                    cacheMaxAge: 6 * 3600, // Cache for 6 hours
                    staleRevalidate: 24 * 3600 // Allow stale for 1 day
                };

            } catch (error) {
                console.error('Error in subtitle handler:', error.message, error.stack);
                return { subtitles: [], cacheMaxAge: 60 }; // Cache failure briefly
            }
        });

        // --- Start Server (Inside IIFE) ---
        const addonInterface = builder.getInterface();

        // If local storage is enabled, set up static file serving
        if (LOCAL_STORAGE_DIR) {
            const express = require('express');
            const getRouter = require('stremio-addon-sdk/src/getRouter');
            const landingTemplate = require('stremio-addon-sdk/src/landingTemplate');

            const app = express();

            // Enable CORS for all routes
            app.use((req, res, next) => {
                res.setHeader('Access-Control-Allow-Origin', '*');
                res.setHeader('Access-Control-Allow-Headers', '*');
                next();
            });

            // Serve subtitle files from the local storage directory - BEFORE addon routes
            app.use('/subtitles', express.static(LOCAL_STORAGE_DIR, {
                setHeaders: (res, filepath) => {
                    if (filepath.endsWith('.srt')) {
                        res.setHeader('Content-Type', 'text/srt; charset=utf-8');
                    }
                }
            }));

            // Mount addon router (this handles manifest, resources, etc.)
            app.use(getRouter(addonInterface));

            // Landing page
            const landingHTML = landingTemplate(addonInterface.manifest);
            const hasConfig = !!(addonInterface.manifest.config || []).length;

            app.get('/', (_, res) => {
                if (hasConfig) {
                    res.redirect('/configure');
                } else {
                    res.setHeader('content-type', 'text/html');
                    res.end(landingHTML);
                }
            });

            if (hasConfig) {
                app.get('/configure', (_, res) => {
                    res.setHeader('content-type', 'text/html');
                    res.end(landingHTML);
                });
            }

            // Start server
            app.listen(ADDON_PORT, () => {
                console.log(`HTTP addon accessible at: http://127.0.0.1:${ADDON_PORT}/manifest.json`);
                console.log(`Local storage enabled at: ${LOCAL_STORAGE_DIR}`);
                console.log(`Subtitle files served at: ${EXTERNAL_URL}/subtitles/`);
            });
        } else {
            // Use default serveHTTP if local storage is not enabled
            serveHTTP(addonInterface, { port: ADDON_PORT });
        }

    } catch (err) {
        console.error("Failed to import srt-parser-2 or setup addon:", err);
        process.exit(1); // Exit if essential import fails
    }
})();

console.log("Addon script initialized. Waiting for ESM import and server start..."); // Log outside IIFE 