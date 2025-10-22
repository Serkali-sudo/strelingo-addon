#!/usr/bin/env node

const { addonBuilder, serveHTTP } = require('stremio-addon-sdk');
const axios = require('axios');
const { Buffer } = require('buffer');
const { put } = require('@vercel/blob');
const { createClient } = require('@supabase/supabase-js');
const sanitize = require('sanitize-html');

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


const languageOptions = Object.entries(languageMap).map(([code, name]) => `${name} [${code}]`);

// Configuration
const ADDON_PORT = process.env.PORT || 7000;

// Rate limiting fully removed

// Create a new addon builder
const builder = new addonBuilder({
    id: 'com.serhat.strelingo',
    version: '0.1.1',
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
            default: 'Turkish [tur]'
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

// --- Helper Function to Fetch and Select Subtitle ---
async function fetchAndSelectSubtitle(languageId, baseSearchParams, type, videoParams = {}) {
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
    
    console.log(`Searching ${languageId} subtitles at: ${apiUrl}`);

    try {
        const response = await (async () => {
            const opensubsResponse = axios.get(apiUrl, {
                timeout: 10000
            });
            
            if (languageId !== "jpn") {
                return opensubsResponse;
            } else {
                // Also request Buta no Subs for Japanese and wait for both promises
                const butaNoSubsUrl = `https://buta-no-subs-stremio-addon.onrender.com/subtitles/${type}/tt${baseSearchParams.imdbid}${(baseSearchParams.season) ? ":" + baseSearchParams.season + ":" + baseSearchParams.episode : ""}.json`;
                console.log(`Searching ${languageId} subtitles at: ${butaNoSubsUrl}`);
                
                const butaNoSubsResponse = axios.get(butaNoSubsUrl, {
                    timeout: 10000
                }).then((res) => {
                    // Adapt response to expected format
                    if (!res.data || !Array.isArray(res.data.subtitles)) {
                        // If response is not what we expect, treat it as no subtitles
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
                
                return Promise.allSettled([opensubsResponse, butaNoSubsResponse]).then((results) => {
                    if (results[0].status === 'rejected' && results[1].status === 'rejected') {
                        throw results[0].reason;
                    }
                    
                    let combinedSubs = [];
                    
                    // Add OpenSubtitles results
                    if (results[0].status === 'fulfilled' && results[0].value.data && results[0].value.data.subtitles) {
                        combinedSubs = combinedSubs.concat(results[0].value.data.subtitles.filter(sub => sub.lang === languageId));
                    }
                    
                    // Add Buta no Subs results
                    if (results[1].status === 'fulfilled' && results[1].value.subtitles) {
                        combinedSubs = combinedSubs.concat(results[1].value.subtitles);
                    }
                    
                    return { data: { subtitles: combinedSubs } };
                });
            }
        })();

        if (!response.data || !response.data.subtitles || !Array.isArray(response.data.subtitles)) {
            console.log(`No ${languageId} subtitles found or invalid API response.`);
            return null;
        }
        
        // Filter subtitles by the requested language
        const langSubs = response.data.subtitles.filter(sub => sub.lang === languageId);
        
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
        return subtitleList; // Return the whole list

    } catch (error) {
        console.error(`Error fetching ${languageId} subtitles:`, error.message);
        return null; // Return null on error
    }
}
// --- End Helper Function ---

// --- SRT Parsing and Merging Helpers ---

// Fetches subtitle content from URL (always UTF-8 SRT format)
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
        builder.defineSubtitlesHandler(async ({ type, id, extra, config }) => {
            console.log('Strelingo Subtitle request:', { type, id, extra });
            console.log('Config:', config);

            // --- Add Environment Variable for Skipping Vercel ---
            const skipVercelBlob = process.env.SKIP_VERCEL_BLOB === 'true';
            if (skipVercelBlob) {
                console.log("SKIP_VERCEL_BLOB is true, Vercel Blob upload will be skipped.");
            }
            // ---------------------------------------------------

            // Get selected languages from config, with defaults
            const mainLangRaw = config?.mainLang || 'eng';
            const transLangRaw = config?.transLang || 'tur';

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
                // Extract video parameters from extra for better matching
                const videoParams = {
                    filename: extra?.filename,
                    videoSize: extra?.videoSize,
                    videoHash: extra?.videoHash
                };
                
                if (videoParams.filename || videoParams.videoSize || videoParams.videoHash) {
                    console.log('Video matching parameters:', videoParams);
                }

                // 1. Fetch Subtitle Metadata Lists
                console.log(`Fetching metadata list for main language: ${mainLang}`);
                const mainSubInfoList = await fetchAndSelectSubtitle(mainLang, baseSearchParams, type, videoParams);
                
                console.log(`Fetching metadata list for translation language: ${transLang}`);
                const transSubInfoList = await fetchAndSelectSubtitle(transLang, baseSearchParams, type, videoParams);

                // Check if we have subtitles for both languages
                if (!mainSubInfoList || mainSubInfoList.length === 0) {
                    console.log(`No main language (${mainLang}) subtitles found.`);
                    return { subtitles: [], cacheMaxAge: 60 };
                }
                if (!transSubInfoList || transSubInfoList.length === 0) {
                    console.warn(`No translation language (${transLang}) subtitles found. Returning empty results.`);
                    return { subtitles: [], cacheMaxAge: 60 };
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
                    
                    const mainSubContent = await fetchSubtitleContent(mainSubInfo.url, mainSubInfo.format);
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

                    // Fetch content
                    const transSubContent = await fetchSubtitleContent(transSubInfo.url, transSubInfo.format);
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
                    } else if (!uploadUrl && !supabase) {
                        // This case handles when Vercel was skipped/failed AND Supabase isn't configured
                         console.warn(`Skipping upload for v${version}: Vercel Blob skipped or failed, and Supabase client is not initialized.`);
                    } else if (uploadUrl && !uploadedToVercel && skipVercelBlob) {
                         // This case handles when Vercel was skipped but Supabase succeeded (already logged)
                         console.log(`Upload for v${version} completed via Supabase (Vercel was skipped).`);
                    } // Else: Vercel succeeded, no need for Supabase.
                    
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
        serveHTTP(builder.getInterface(), { port: ADDON_PORT });

    } catch (err) {
        console.error("Failed to import srt-parser-2 or setup addon:", err);
        process.exit(1); // Exit if essential import fails
    }
})();

console.log("Addon script initialized. Waiting for ESM import and server start..."); // Log outside IIFE 