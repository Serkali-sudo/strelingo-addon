#!/usr/bin/env node

const { addonBuilder, serveHTTP } = require('stremio-addon-sdk');
const axios = require('axios');
const pako = require('pako');
const { Buffer } = require('buffer');
const chardet = require('chardet');
const iconv = require('iconv-lite');
const { put } = require('@vercel/blob');

// OpenSubtitles API base URL
const OPENSUBS_API_URL = 'https://rest.opensubtitles.org';

// Configuration
const ADDON_PORT = process.env.PORT || 7000;

// Rate limiting
const requestQueue = [];
const MAX_REQUESTS_PER_MINUTE = 40; // OpenSubtitles limit
let requestsThisMinute = 0;
let requestTimer = null;

// Create a new addon builder
const builder = new addonBuilder({
    id: 'com.serhat.strelingo',
    version: '0.1.1',
    name: 'Strelingo - Dual Language Subtitles',
    description: 'Provides dual subtitles (main + translation) from OpenSubtitles for language learning.',
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
    config: [
        {
            key: 'mainLang',
            type: 'select',
            title: 'Main Language (Audio Language)',
            options: ['ara', 'chi', 'dut', 'eng', 'fra', 'deu', 'hin', 'ita', 'jpn', 'kor', 'nor', 'pol', 'por', 'rus', 'spa', 'swe', 'tur'],
            required: true,
            default: 'eng'
        },
        {
            key: 'transLang',
            type: 'select',
            title: 'Translation Language (Your Language)',
            options: ['ara', 'chi', 'dut', 'eng', 'fra', 'deu', 'hin', 'ita', 'jpn', 'kor', 'nor', 'pol', 'por', 'rus', 'spa', 'swe', 'tur'],
            required: true,
            default: 'tur'
        }
    ]
});

// Reset the rate limit counter every minute
function setupRateLimitReset() {
    requestTimer = setInterval(() => {
        requestsThisMinute = 0;
        
        // Process any queued requests
        while (requestsThisMinute < MAX_REQUESTS_PER_MINUTE && requestQueue.length > 0) {
            const { resolve, reject, fn } = requestQueue.shift();
            executeWithRateLimit(fn, resolve, reject);
        }
    }, 60 * 1000);
    
    // Prevent the timer from keeping the process alive
    requestTimer.unref();
}

// Execute a function with rate limiting
function executeWithRateLimit(fn, resolve, reject) {
    if (requestsThisMinute < MAX_REQUESTS_PER_MINUTE) {
        requestsThisMinute++;
        
        Promise.resolve()
            .then(fn)
            .then(resolve)
            .catch(reject);
    } else {
        // Queue the request for the next minute
        requestQueue.push({ resolve, reject, fn });
        console.log(`Rate limit reached. Queued request. Queue size: ${requestQueue.length}`);
    }
}

// Wrap a function with rate limiting
function withRateLimit(fn) {
    // Initialize the rate limit timer if not already done
    if (!requestTimer) {
        setupRateLimitReset();
    }
    
    return new Promise((resolve, reject) => {
        executeWithRateLimit(fn, resolve, reject);
    });
}

// --- Helper Function to Fetch and Select Subtitle ---
async function fetchAndSelectSubtitle(languageId, baseSearchParams) {
    const searchParams = { ...baseSearchParams, sublanguageid: languageId };
    const searchUrl = buildSearchUrl(searchParams);
    console.log(`Searching ${languageId} subtitles at: ${searchUrl}`);

    try {
        const response = await withRateLimit(() =>
            axios.get(searchUrl, {
                headers: { 'User-Agent': 'TemporaryUserAgent' },
                timeout: 10000
            })
        );

        if (!response.data || !Array.isArray(response.data) || response.data.length === 0) {
            console.log(`No ${languageId} subtitles found or invalid API response.`);
            return null;
        }

        // Filter for valid subtitle formats first
        const validFormatSubs = response.data.filter(subtitle =>
            subtitle.SubDownloadLink &&
            subtitle.SubFormat &&
            ['srt', 'vtt', 'sub', 'ass'].includes(subtitle.SubFormat.toLowerCase())
        );

        if (validFormatSubs.length === 0) {
             console.log(`No suitable subtitle format found for ${languageId}.`);
             return null;
        }

        // Sort the valid subtitles by download count (descending)
        validFormatSubs.sort((a, b) => {
            const downloadsA = parseInt(a.SubDownloadsCnt, 10) || 0;
            const downloadsB = parseInt(b.SubDownloadsCnt, 10) || 0;
            return downloadsB - downloadsA; // Sort descending
        });

        // Map to the desired return format
        const subtitleList = validFormatSubs.map(sub => {
             const directUrl = sub.SubDownloadLink;
             let subtitleUrl = directUrl;
             // Note: No special handling for .gz here anymore, assuming fetchSubtitleContent handles it
             if (directUrl.endsWith('.gz')) {
                console.log(`Found gzipped subtitle for ${languageId} (ID: ${sub.IDSubtitleFile}). Fetch function will handle decompression.`);
             }

            return {
                id: sub.IDSubtitleFile,
                url: subtitleUrl, // This URL will be used to *fetch* the content later
                lang: sub.SubLanguageID,
                format: sub.SubFormat,
                langName: sub.LanguageName,
                releaseName: sub.MovieReleaseName || sub.MovieName || 'Unknown',
                rating: parseFloat(sub.SubRating) || 0,
                downloads: parseInt(sub.SubDownloadsCnt, 10) || 0
            };
        });

        console.log(`Found ${subtitleList.length} valid subtitles for ${languageId}, sorted by downloads.`);
        return subtitleList; // Return the whole sorted list

    } catch (error) {
        console.error(`Error fetching ${languageId} subtitles:`, error.message);
        if (error.response && error.response.status === 429) {
            console.log(`Rate limit exceeded from OpenSubtitles API while fetching ${languageId}`);
        }
        return null; // Return null on error
    }
}
// --- End Helper Function ---

// --- SRT Parsing and Merging Helpers ---

// Fetches subtitle content from URL, handles potential gzip and encoding
async function fetchSubtitleContent(url) {
    console.log(`Fetching subtitle content from: ${url}`);
    try {
        const response = await axios.get(url, {
            responseType: 'arraybuffer', // Important for binary data
            timeout: 15000
        });

        let contentBuffer = Buffer.from(response.data);
        let subtitleText;

        // 1. Handle Gzip decompression first
        if (url.endsWith('.gz') || (contentBuffer.length > 2 && contentBuffer[0] === 0x1f && contentBuffer[1] === 0x8b)) {
            console.log(`Decompressing gzipped subtitle: ${url}`);
            try {
                contentBuffer = Buffer.from(pako.ungzip(contentBuffer)); // Decompress into a new buffer
                console.log(`Decompressed size: ${contentBuffer.length}`);
            } catch (unzipError) {
                console.error(`Error decompressing subtitle ${url}: ${unzipError.message}`);
                return null; // Failed decompression
            }
        }

        // 2. Detect Encoding using chardet
        let detectedEncoding = 'utf8'; // Default
        let rawDetectedEncoding = null;
        let detectionConfidence = 0; // chardet doesn't provide confidence score in the same way
        try {
            // chardet.detect expects a Buffer
            rawDetectedEncoding = chardet.detect(contentBuffer);
            console.log(`chardet raw detection: encoding=${rawDetectedEncoding}`); // Log raw detection

            if (rawDetectedEncoding) {
                const normalizedEncoding = rawDetectedEncoding.toLowerCase();
                // Map common names/aliases if needed - chardet might return different names
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
                        detectedEncoding = 'utf8'; // Treat ASCII as UTF-8
                        break;
                    case 'utf-8':
                         detectedEncoding = 'utf8';
                         break;
                    // Add more mappings if necessary based on chardet results
                    default:
                        // Check if iconv supports the detected encoding directly
                        if (iconv.encodingExists(normalizedEncoding)) {
                            detectedEncoding = normalizedEncoding;
                        } else {
                            console.warn(`Detected encoding '${rawDetectedEncoding}' not directly supported by iconv-lite or mapped. Falling back to UTF-8.`);
                            detectedEncoding = 'utf8'; // Fallback if unknown
                        }
                }
                console.log(`Detected encoding: ${rawDetectedEncoding}, using: ${detectedEncoding}`);
            } else {
                console.log(`Encoding detection failed for ${url}. Defaulting to UTF-8.`);
                // Try to remove potential BOM manually if UTF-8 is assumed
                if(contentBuffer.length > 3 && contentBuffer[0] === 0xEF && contentBuffer[1] === 0xBB && contentBuffer[2] === 0xBF) {
                    console.log("Found UTF-8 BOM, removing it before potential decode.");
                    contentBuffer = contentBuffer.subarray(3);
                }
            }
        } catch (detectionError) {
            console.warn(`Error during encoding detection for ${url}: ${detectionError.message}. Defaulting to UTF-8.`);
        }

        // 3. Decode using detected or default encoding
        try {
            // iconv-lite handles BOMs for UTF-8, UTF-16LE, UTF-16BE automatically
            subtitleText = iconv.decode(contentBuffer, detectedEncoding);
            console.log(`Successfully decoded subtitle ${url} using ${detectedEncoding}.`);

            // Optional: If it was detected as UTF-8, double check for the FEFF char code just in case
            // iconv *should* handle this, but as a safeguard:
            if (detectedEncoding === 'utf8' && subtitleText.charCodeAt(0) === 0xFEFF) {
                 console.log("Found BOM character after UTF-8 decode, removing it.");
                 subtitleText = subtitleText.substring(1);
            }

        } catch (decodeError) {
            console.error(`Error decoding subtitle ${url} with encoding ${detectedEncoding}: ${decodeError.message}`);
            // Fallback attempt: try decoding as Latin1 (ISO-8859-1) if initial decode failed
            console.warn(`Falling back to latin1 decoding for ${url}`);
            try {
                 subtitleText = iconv.decode(contentBuffer, 'latin1');
            } catch (fallbackError) {
                console.error(`Fallback decoding as latin1 also failed for ${url}: ${fallbackError.message}`);
                return null; // Both attempts failed
            }
        }

        console.log(`Successfully fetched and processed subtitle: ${url}`);
        return subtitleText;

    } catch (error) {
        console.error(`Error fetching subtitle content from ${url}:`, error.message);
        if (error.response) {
            console.error(`Status: ${error.response.status}, Headers: ${JSON.stringify(error.response.headers)}`);
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

        // Process the best match found (if any)
        if (bestMatchIndex !== -1) {
            const bestTransSub = transSubs[bestMatchIndex];
            // Flatten both main and translation text by replacing newlines with spaces
            const flatMainText = mainSub.text.replace(/\r?\n|\r/g, ' ');
            const flatTransText = bestTransSub.text.replace(/\r?\n|\r/g, ' ');

            mergedSubs.push({
                ...mainSub, // Keep main timing and ID
                // Combine flattened texts with a newline, keeping translation italic and yellow
                text: `${flatMainText}\n<font color="yellow"><i>${flatTransText}</i></font>`
            });
        } else {
            // If no suitable translation match found, add the main subtitle as is (also flattened)
            mergedSubs.push({
                 ...mainSub,
                 text: mainSub.text.replace(/\r?\n|\r/g, ' ')
            });
        }
    }
    console.log(`Finished merging. Result has ${mergedSubs.length} entries.`);
    return mergedSubs;
}

// Helper function to build the OpenSubtitles search URL
function buildSearchUrl(params) {
    // For series, we need a specific order: episode/imdbid/season/sublanguageid
    if (params.episode) {
        const parts = [];
        if (params.episode) parts.push(`episode-${params.episode}`);
        if (params.imdbid) parts.push(`imdbid-${params.imdbid}`);
        if (params.season) parts.push(`season-${params.season}`);
        if (params.sublanguageid) parts.push(`sublanguageid-${params.sublanguageid}`);
        return `${OPENSUBS_API_URL}/search/${parts.join('/')}`;
    }
    
    // For movies, we can use the original order
    const searchPath = Object.entries(params)
        .map(([key, value]) => `${key}-${value}`)
        .join('/');
    
    return `${OPENSUBS_API_URL}/search/${searchPath}`;
}

// Handle process termination
process.on('SIGINT', () => {
    console.log('Shutting down...');
    if (requestTimer) {
        clearInterval(requestTimer);
    }
    process.exit(0);
});

// --- Main Async IIFE to handle ESM import and setup ---
(async () => {
    try {
        // Dynamically import the ESM module
        const { default: SRTParser2 } = await import('srt-parser-2');
        console.log("Successfully imported srt-parser-2.");

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

                const subtitles = parser.fromSrt(srtText);

                if (!Array.isArray(subtitles)) {
                     console.error("Parsing did not return an array.");
                     return null;
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
        builder.defineSubtitlesHandler(async ({ type, id, extra, config }) => {
            console.log('Strelingo Subtitle request:', { type, id, extra });
            console.log('Config:', config);

            // Get selected languages from config, with defaults
            const mainLang = config?.mainLang || 'eng';
            const transLang = config?.transLang || 'tur';

            console.log(`Selected Languages: Main=${mainLang}, Translation=${transLang}`);

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
                // 1. Fetch Main Subtitle Metadata (using the updated function)
                console.log(`Fetching metadata list for main language: ${mainLang}`);
                const mainSubInfoList = await fetchAndSelectSubtitle(mainLang, baseSearchParams);
                if (!mainSubInfoList || mainSubInfoList.length === 0) {
                    console.log(`No main language (${mainLang}) subtitles found.`);
                    return { subtitles: [], cacheMaxAge: 60 };
                }
                // Select the best main subtitle (first in the sorted list)
                const mainSubInfo = mainSubInfoList[0];
                console.log(`Selected Main Subtitle (${mainLang}): ID=${mainSubInfo.id}, Downloads=${mainSubInfo.downloads}`);

                // 2. Fetch Translation Subtitle Metadata List
                console.log(`Fetching metadata list for translation language: ${transLang}`);
                const transSubInfoList = await fetchAndSelectSubtitle(transLang, baseSearchParams);
                if (!transSubInfoList || transSubInfoList.length === 0) {
                    console.warn(`No translation language (${transLang}) subtitles found. Attempting to return only main subtitle.`);
                    // --- Fallback: Return only main subtitle ---
                    const mainContent = await fetchSubtitleContent(mainSubInfo.url);
                    if (!mainContent) {
                        console.error("Failed to fetch main subtitle content for fallback.");
                        return { subtitles: [], cacheMaxAge: 60 };
                    }
                    // Parse is needed if formatSrt doesn't take raw string
                    const mainParsedFallback = parseSrt(mainContent);
                    if(!mainParsedFallback) {
                         console.error("Failed to parse main subtitle content for fallback.");
                         return { subtitles: [], cacheMaxAge: 60 };
                    }
                    const formattedMain = formatSrt(mainParsedFallback); // Format back to ensure clean SRT
                    if (!formattedMain) {
                         console.error("Failed to format main subtitle content for fallback.");
                         return { subtitles: [], cacheMaxAge: 60 };
                    }
                    const { url: mainUrl } = await put(`${imdbId}_${mainLang}_mainOnly.srt`, formattedMain, { access: 'public', addRandomSuffix: true });
                    return {
                        subtitles: [{ id: mainSubInfo.id, url: mainUrl, lang: mainLang }],
                        cacheMaxAge: 3600
                    };
                    // --- End Fallback ---
                }

                // 3. Select up to 4 unique translation candidates
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
                     // Consider fallback to main subtitle here as well?
                    return { subtitles: [], cacheMaxAge: 60 };
                }

                // 4. Fetch and Parse Main Subtitle Content ONCE
                console.log("Fetching main subtitle content...");
                const mainSubContent = await fetchSubtitleContent(mainSubInfo.url);
                if (!mainSubContent) {
                    console.error("Failed to fetch main subtitle content. Cannot proceed.");
                    return { subtitles: [], cacheMaxAge: 60 };
                }
                console.log("Parsing main subtitle content...");
                const mainParsed = parseSrt(mainSubContent);
                if (!mainParsed) {
                    console.error("Failed to parse main subtitle content. Cannot proceed.");
                    return { subtitles: [], cacheMaxAge: 60 };
                }

                // 5. Process Each Selected Translation Subtitle
                const finalSubtitles = [];
                for (let i = 0; i < selectedTransSubs.length; i++) {
                    const transSubInfo = selectedTransSubs[i];
                    const version = i + 1;
                    console.log(`Processing translation candidate v${version} (ID: ${transSubInfo.id})...`);

                    // Fetch content
                    const transSubContent = await fetchSubtitleContent(transSubInfo.url);
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

                    // Upload to Blob
                    console.log(`Uploading merged SRT for v${version} to Blob...`);
                    try {
                        const { url } = await put(
                            `${imdbId}_${mainLang}_${transLang}_v${version}.srt`,
                            mergedSrtString,
                            { access: 'public', addRandomSuffix: true }
                        );
                        console.log(`Uploaded v${version} to: ${url}`);

                        // Add to results
                        finalSubtitles.push({
                            id: `merged-${mainSubInfo.id}-${transSubInfo.id}`,
                            url: url,
                            lang: `${mainLang}+${transLang}` // Use consistent lang code for grouping
                        });
                    } catch (uploadError) {
                        console.error(`Failed to upload merged SRT for v${version}: ${uploadError.message}`);
                        // Don't skip, just log the error, maybe other versions succeed
                    }
                }

                // 6. Return results
                if (finalSubtitles.length === 0) {
                    console.warn("Processed translation candidates, but none resulted in a usable subtitle file. Returning empty.");
                     // Consider fallback to main subtitle one last time?
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
        serveHTTP(builder.getInterface(), { port: ADDON_PORT });

    } catch (err) {
        console.error("Failed to import srt-parser-2 or setup addon:", err);
        process.exit(1); // Exit if essential import fails
    }
})();

console.log("Addon script initialized. Waiting for ESM import and server start..."); // Log outside IIFE 