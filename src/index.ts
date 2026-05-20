import 'dotenv/config';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { createClient } from '@supabase/supabase-js';
import { put } from '@vercel/blob';

import SRTParser2 from 'srt-parser-2';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { Buffer } from 'node:buffer';

import landingTemplate, { Manifest } from './landingTemplate';
import { decodeSubtitleBuffer, getLanguageAliases } from './encoding';

// Cache for dynamically resolved languages map
const languageMap = {
    'abk': 'Abkhazian', 'afr': 'Afrikaans', 'alb': 'Albanian', 'amh': 'Amharic', 'ara': 'Arabic',
    'arg': 'Aragonese', 'arm': 'Armenian', 'asm': 'Assamese', 'ast': 'Asturian', 'azb': 'South Azerbaijani',
    'aze': 'Azerbaijani', 'baq': 'Basque', 'bel': 'Belarusian', 'ben': 'Bengali', 'bos': 'Bosnian',
    'bre': 'Breton', 'bul': 'Bulgarian', 'bur': 'Burmese', 'cat': 'Catalan', 'chi': 'Chinese (simplified)',
    'cze': 'Czech', 'dan': 'Danish', 'dut': 'Dutch', 'ell': 'Greek', 'eng': 'English', 'epo': 'Esperanto',
    'est': 'Estonian', 'ext': 'Extremaduran', 'fin': 'Finnish', 'fre': 'French', 'geo': 'Georgian',
    'ger': 'German', 'gla': 'Gaelic', 'gle': 'Irish', 'glg': 'Galician', 'heb': 'Hebrew', 'hin': 'Hindi',
    'hrv': 'Croatian', 'hat': 'Haitian Creole', 'hun': 'Hungarian', 'ibo': 'Igbo', 'ice': 'Icelandic', 'ina': 'Interlingua',
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
    'zhc': 'Chinese (Cantonese)', 'zht': 'Chinese (traditional)'
};

const browserLanguageMap: Record<string, string> = {
    'en': 'eng', 'es': 'spa', 'fr': 'fre', 'de': 'ger', 'it': 'ita',
    'pt': 'por', 'pt-br': 'pob', 'ru': 'rus', 'ja': 'jpn', 'ko': 'kor',
    'zh': 'chi', 'zh-cn': 'chi', 'zh-tw': 'zht', 'ar': 'ara', 'hi': 'hin',
    'bn': 'ben', 'pa': 'pan', 'te': 'tel', 'mr': 'mar', 'ta': 'tam',
    'gu': 'guj', 'kn': 'kan', 'ml': 'mal', 'or': 'ori', 'pl': 'pol',
    'uk': 'ukr', 'tr': 'tur', 'hu': 'hun', 'cs': 'cze', 'ro': 'rum',
    'nl': 'dut', 'sv': 'swe', 'da': 'dan', 'no': 'nor', 'fi': 'fin',
    'el': 'ell', 'th': 'tha', 'vi': 'vie', 'id': 'ind', 'ms': 'may',
    'fil': 'tgl', 'he': 'heb', 'fa': 'per', 'ur': 'urd', 'sq': 'alb',
    'ht': 'hat', 'hr': 'hrv', 'sr': 'scc', 'bg': 'bul', 'sk': 'slo', 'sl': 'slv',
    'et': 'est', 'lv': 'lav', 'lt': 'lit', 'ca': 'cat', 'eu': 'baq',
    'gl': 'glg', 'mk': 'mac', 'is': 'ice', 'cy': 'wel', 'ga': 'gle'
};

const languageOptions = Object.entries(languageMap).map(([code, name]) => `${name} [${code}]`);

interface SubtitleInfo {
    id: string | number;
    url: string;
    lang: string;
    format: string;
    langName: string;
    releaseName: string;
    rating: number;
}

interface SRTLine {
    id: string;
    startTime: string;
    endTime: string;
    text: string;
}

// --------------------------------------------------------------------------------------
// INTERNAL SUBTITLE CONVERTER (Ported flawlessly from subsrt & subtitle-converter)
// Removes need for unsupported node_modules while ensuring perfect format conversions.
// --------------------------------------------------------------------------------------
const SubtitleConverter = {
    toTimeString(ms: number): string {
        const hh = Math.floor(ms / 1000 / 3600);
        const mm = Math.floor(ms / 1000 / 60 % 60);
        const ss = Math.floor(ms / 1000 % 60);
        const ff = Math.floor(ms % 1000);
        return (hh < 10 ? "0" : "") + hh + ":" +
            (mm < 10 ? "0" : "") + mm + ":" +
            (ss < 10 ? "0" : "") + ss + "," +
            (ff < 100 ? "0" : "") + (ff < 10 ? "0" : "") + ff;
    },
    htmlDecode(html: string): string {
        return html.replace(/&nbsp;/g, ' ')
            .replace(/&quot;/g, '"')
            .replace(/&#39;/g, "'")
            .replace(/&lt;/g, '<')
            .replace(/&gt;/g, '>')
            .replace(/&amp;/g, '&');
    },
    buildSrt(captions: any[]): string {
        let srt = "";
        for (let i = 0; i < captions.length; i++) {
            const caption = captions[i];
            if (!caption.text) continue;
            srt += (i + 1).toString() + "\n";
            srt += this.toTimeString(caption.start) + " --> " + this.toTimeString(caption.end) + "\n";
            srt += caption.text + "\n\n";
        }
        return srt;
    },
    parseVttToMs(s: string): number {
        const match = /^\s*(\d{1,2}:)?(\d{1,2}):(\d{1,2})([.,](\d{1,3}))?\s*$/.exec(s);
        if (!match) return 0;
        const hh = match[1] ? parseInt(match[1].replace(":", "")) : 0;
        const mm = parseInt(match[2]);
        const ss = parseInt(match[3]);
        const ff = match[5] ? parseInt(match[5]) : 0;
        return hh * 3600 * 1000 + mm * 60 * 1000 + ss * 1000 + ff;
    },
    parseVtt(content: string): any[] {
        const captions = [];
        const parts = content.split(/\r?\n\s+\r?\n/);
        for (let i = 0; i < parts.length; i++) {
            const regex = /^([^\r\n]+\r?\n)?((\d{1,2}:)?\d{1,2}:\d{1,2}([.,]\d{1,3})?)\s*\-\-\>\s*((\d{1,2}:)?\d{1,2}:\d{1,2}([.,]\d{1,3})?)\r?\n([\s\S]*)(\r?\n)*$/gi;
            const match = regex.exec(parts[i]);
            if (match) {
                const text = match[8].split(/\r?\n/).join("\n").replace(/\<[^\>]+\>/g, "").replace(/\{[^\}]+\}/g, "");
                captions.push({ start: this.parseVttToMs(match[2]), end: this.parseVttToMs(match[5]), text });
            }
        }
        return captions;
    },
    parseSsaToMs(s: string): number {
        const match = /^\s*(\d+:)?(\d{1,2}):(\d{1,2})([.,](\d{1,3}))?\s*$/.exec(s);
        if (!match) return 0;
        const hh = match[1] ? parseInt(match[1].replace(":", "")) : 0;
        const mm = parseInt(match[2]);
        const ss = parseInt(match[3]);
        const ff = match[5] ? parseInt(match[5]) : 0;
        return hh * 3600 * 1000 + mm * 60 * 1000 + ss * 1000 + ff * 10;
    },
    parseSsa(content: string): any[] {
        const captions = [];
        let columns: string[] = [];
        const parts = content.split(/\r?\n\s*\r?\n/);
        for (let i = 0; i < parts.length; i++) {
            const match = /^\s*\[([^\]]+)\]\r?\n([\s\S]*)(\r?\n)*$/gi.exec(parts[i]);
            if (match) {
                const tag = match[1];
                const lines = match[2].split(/\r?\n/);
                for (let l = 0; l < lines.length; l++) {
                    const line = lines[l];
                    if (/^\s*;/.test(line)) continue;
                    const m = /^\s*([^:]+):\s*(.*)(\r?\n)?$/.exec(line);
                    if (m && (tag === "V4 Styles" || tag === "V4+ Styles" || tag === "Events")) {
                        const name = m[1].trim();
                        const value = m[2].trim();
                        if (name === "Format") {
                            columns = value.split(/\s*,\s*/g);
                        } else if (name === "Dialogue" && columns.length > 0) {
                            const values = value.split(/\s*,\s*/g);
                            const data: any = {};
                            for (let c = 0; c < columns.length - 1 && c < values.length; c++) {
                                data[columns[c]] = values[c];
                            }
                            const getPosition = (s: string, search: string, index: number) => s.split(search, index).join(search).length;
                            const indexOfText = getPosition(value, ',', columns.length - 1) + 1;
                            let textContent = value.substring(indexOfText);
                            textContent = textContent.replace(/\\N/gi, "\n").replace(/\{[^\}]+\}/g, "");
                            captions.push({
                                start: this.parseSsaToMs(data["Start"]),
                                end: this.parseSsaToMs(data["End"]),
                                text: textContent
                            });
                        }
                    }
                }
            }
        }
        return captions;
    },
    parseSbvToMs(s: string): number {
        const match = /^\s*(\d{1,2}):(\d{1,2}):(\d{1,2})([.,](\d{1,3}))?\s*$/.exec(s);
        if (!match) return 0;
        const hh = parseInt(match[1]);
        const mm = parseInt(match[2]);
        const ss = parseInt(match[3]);
        const ff = match[5] ? parseInt(match[5]) : 0;
        return hh * 3600 * 1000 + mm * 60 * 1000 + ss * 1000 + ff;
    },
    parseSbv(content: string): any[] {
        const captions = [];
        const parts = content.split(/\r?\n\s+\r?\n/);
        for (let i = 0; i < parts.length; i++) {
            const regex = /^(\d{1,2}:\d{1,2}:\d{1,2}([.,]\d{1,3})?)\s*[,;]\s*(\d{1,2}:\d{1,2}:\d{1,2}([.,]\d{1,3})?)\r?\n([\s\S]*)(\r?\n)*$/gi;
            const match = regex.exec(parts[i]);
            if (match) {
                const text = match[5].split(/\[br\]|\r?\n/gi).join("\n").replace(/\>\>\s*[^:]+:\s*/g, "");
                captions.push({ start: this.parseSbvToMs(match[1]), end: this.parseSbvToMs(match[3]), text });
            }
        }
        return captions;
    },
    parseSmi(content: string): any[] {
        const captions = [];
        const sami = content.replace(/^[\s\S]*\<BODY[^\>]*\>/gi, "").replace(/\<\/BODY[^\>]*\>[\s\S]*$/gi, "");
        let prev = null;
        const parts = sami.split(/\<SYNC/gi);
        for (let i = 0; i < parts.length; i++) {
            if (!parts[i] || parts[i].trim().length == 0) continue;
            const match = /^\<SYNC[^\>]+Start\s*=\s*["']?(\d+)["']?[^\>]*\>([\s\S]*)/gi.exec('<SYNC' + parts[i]);
            if (match) {
                const start = parseInt(match[1]);
                let contentText = match[2].replace(/^\<\/SYNC[^\>]*>/gi, "");
                let p = /^\<P[^\>]+Class\s*=\s*["']?([\w\d\-_]+)["']?[^\>]*\>([\s\S]*)/gi.exec(contentText);
                if (!p) p = /^\<P([^\>]*)\>([\s\S]*)/gi.exec(contentText);
                let html = p ? p[2] : contentText;
                html = html.replace(/\<P[\s\S]+$/gi, "");
                html = html.replace(/\<BR\s*\/?\>[\s\r\n]+/gi, "\n").replace(/\<BR\s*\/?\>/gi, "\n").replace(/\<[^\>]+\>/g, "");
                html = html.replace(/^[\s\r\n]+/g, "").replace(/[\s\r\n]+$/g, "");
                const blank = (html.replace(/&nbsp;/gi, " ").replace(/[\s\r\n]+/g, "").length == 0);
                html = this.htmlDecode(html);
                const caption = { start, end: start + 2000, text: html };
                if (prev) prev.end = caption.start;
                if (!blank) captions.push(caption);
                prev = blank ? null : caption;
            }
        }
        return captions;
    },
    parseSub(content: string, fps = 23.976): any[] {
        const captions = [];
        const parts = content.split(/\r?\n/g);
        for (let i = 0; i < parts.length; i++) {
            const match = /^\{(\d+)\}\{(\d+)\}(.*)$/gi.exec(parts[i]);
            if (match) {
                const text = match[3].split(/\|/g).join("\n").replace(/\{[^\}]+\}/g, "");
                captions.push({
                    start: Math.round((parseInt(match[1]) / fps) * 1000),
                    end: Math.round((parseInt(match[2]) / fps) * 1000),
                    text
                });
            }
        }
        return captions;
    },
    parseLrcToMs(s: string): number {
        const match = /^\s*(\d+):(\d{1,2})([.,](\d{1,3}))?\s*$/.exec(s);
        if (!match) return 0;
        const mm = parseInt(match[1]);
        const ss = parseInt(match[2]);
        const ff = match[4] ? parseInt(match[4]) : 0;
        return mm * 60 * 1000 + ss * 1000 + ff * 10;
    },
    parseLrc(content: string): any[] {
        const captions = [];
        let prev = null;
        const parts = content.split(/\r?\n/);
        for (let i = 0; i < parts.length; i++) {
            if (!parts[i] || parts[i].trim().length == 0) continue;
            const match = /^\[(\d{1,2}:\d{1,2}([.,]\d{1,3})?)\](.*)(\r?\n)*$/gi.exec(parts[i]);
            if (match) {
                const start = this.parseLrcToMs(match[1]);
                const caption = { start, end: start + 2000, text: match[3] };
                if (prev) prev.end = caption.start;
                captions.push(caption);
                prev = caption;
            }
        }
        return captions;
    },
    parseTtmlToMs(s: string): number {
        const match = /^\s*(\d{1,2}):(\d{1,2}):(\d{1,2})([.,](\d{1,3}))?\s*$/.exec(s);
        if (match) {
            const hh = parseInt(match[1]);
            const mm = parseInt(match[2]);
            const ss = parseInt(match[3]);
            const ff = match[5] ? parseInt(match[5]) : 0;
            return hh * 3600 * 1000 + mm * 60 * 1000 + ss * 1000 + ff;
        }
        return 0;
    },
    parseTtml(content: string): any[] {
        const captions = [];
        const pRegex = /\<p\s+[^>]*begin="([^"]+)"[^>]*end="([^"]+)"[^>]*\>([\s\S]*?)\<\/p\>/gi;
        let match;
        while ((match = pRegex.exec(content)) !== null) {
            const start = this.parseTtmlToMs(match[1]);
            const end = this.parseTtmlToMs(match[2]);
            let text = match[3].replace(/\<br\s*\/?\>/gi, "\n").replace(/\<[^\>]+\>/g, "");
            text = this.htmlDecode(text).trim();
            captions.push({ start, end, text });
        }
        return captions;
    },
    convert(text: string, format: string): string | null {
        const f = format.toLowerCase().trim();
        if (f === 'srt') return text;
        try {
            let captions: any[] = [];
            if (f === 'sub') captions = this.parseSub(text);
            else if (f === 'vtt') captions = this.parseVtt(text);
            else if (f === 'ssa' || f === 'ass') captions = this.parseSsa(text);
            else if (f === 'sbv') captions = this.parseSbv(text);
            else if (f === 'smi') captions = this.parseSmi(text);
            else if (f === 'lrc') captions = this.parseLrc(text);
            else if (f === 'dfxp' || f === 'ttml') captions = this.parseTtml(text);

            if (captions.length > 0) return this.buildSrt(captions);
        } catch (e: any) {
            console.error(`Subtitle conversion error for ${format}:`, e.message);
        }
        return null;
    }
};

// Helpers for cross-runtime environment support
function getEnvVar(c: any, key: string): string | undefined {
    return c.env?.[key] || (typeof process !== 'undefined' && process.env ? process.env[key] : undefined);
}

function extractBrowserLanguageFromHeader(acceptLanguageHeader: string | null): string {
    if (!acceptLanguageHeader) {
        return 'eng';
    }
    const languages = acceptLanguageHeader
        .split(',')
        .map(lang => lang.trim().split(';')[0])
        .map(lang => lang.split('-')[0].toLowerCase())
        .filter(lang => lang.length > 0);

    if (languages.length === 0) {
        return 'eng';
    }

    for (const lang of languages) {
        const iso639_3Code = browserLanguageMap[lang];
        if (iso639_3Code) {
            return iso639_3Code;
        }
    }
    return 'eng';
}

function parseLangCode(lang: string | undefined): string | undefined {
    if (!lang) return lang;
    const match = lang.match(/\[([^\]]+)\]$/);
    return match ? match[1] : lang;
}

function getBrowserLanguageOption(acceptLanguageHeader: string | null): string {
    const code = extractBrowserLanguageFromHeader(acceptLanguageHeader);
    const name = languageMap[code as keyof typeof languageMap] || 'English';
    return `${name} [${code}]`;
}

function stripJsonExtension(str: string | undefined): string {
    if (!str) return '';
    if (str.endsWith('.json')) {
        return str.substring(0, str.length - 5);
    }
    return str;
}

// Functionally perfectly matches sanitize-html behavior for extracting just the raw text
function sanitizeText(text: string): string {
    if (!text) return '';
    text = text.replace(/<[^>]+>/g, '');
    text = text.replace(/&nbsp;/gi, ' ')
        .replace(/&quot;/gi, '"')
        .replace(/&#39;/gi, "'")
        .replace(/&lt;/gi, '<')
        .replace(/&gt;/gi, '>')
        .replace(/&amp;/gi, '&');
    return text.trim();
}

function parseTimeToMs(timeString: string): number {
    if (!timeString || !/\d{2}:\d{2}:\d{2},\d{3}/.test(timeString)) {
        console.error(`Invalid time format encountered: ${timeString}`);
        return 0;
    }
    const parts = timeString.split(':');
    const secondsParts = parts[2].split(',');
    const hours = parseInt(parts[0], 10);
    const minutes = parseInt(parts[1], 10);
    const seconds = parseInt(secondsParts[0], 10);
    const milliseconds = parseInt(secondsParts[1], 10);
    return (hours * 3600 + minutes * 60 + seconds) * 1000 + milliseconds;
}

// Fetch all subtitles using standard web fetch (axios-free)
async function fetchAllSubtitles(
    baseSearchParams: { imdbid: string; season?: string; episode?: string },
    type: string,
    videoParams: { filename?: string; videoSize?: string; videoHash?: string } = {},
    needsJapanese = false
): Promise<any[] | null> {
    const imdbId = `tt${baseSearchParams.imdbid}`;
    let apiUrl = `https://opensubtitles-v3.strem.io/subtitles/${type}/${imdbId}`;

    if (type === 'series' && baseSearchParams.season && baseSearchParams.episode) {
        apiUrl += `:${baseSearchParams.season}:${baseSearchParams.episode}`;
    } else {
        // apiUrl += `:${videoParams.videoHash || '0'}`;
    }

    const queryParams: string[] = [];
    if (videoParams.filename) {
        queryParams.push(`filename=${encodeURIComponent(videoParams.filename)}`);
    }
    if (videoParams.videoSize) {
        queryParams.push(`videoSize=${videoParams.videoSize}`);
    }
    if (videoParams.videoHash) {
        queryParams.push(`videoHash=${videoParams.videoHash}`);
    }

    if (queryParams.length > 0) {
        apiUrl += `/${queryParams.join('&')}`;
    }

    apiUrl += '.json';
    console.log(`Fetching all subtitles from: ${apiUrl}`);

    try {
        const opensubsResponsePromise = fetch(apiUrl, {
            signal: AbortSignal.timeout(10000)
        }).then(async res => {
            if (!res.ok) throw new Error(`OpenSubtitles API responded with ${res.status}`);
            return await res.json() as any;
        });

        const promises: Array<Promise<any>> = [opensubsResponsePromise];

        if (needsJapanese) {
            const butaNoSubsUrl = `https://buta-no-subs-stremio-addon.onrender.com/subtitles/${type}/tt${baseSearchParams.imdbid}${(baseSearchParams.season) ? ":" + baseSearchParams.season + ":" + baseSearchParams.episode : ""}.json`;
            console.log(`Also fetching Japanese subtitles from: ${butaNoSubsUrl}`);

            const butaNoSubsPromise = fetch(butaNoSubsUrl, {
                signal: AbortSignal.timeout(10000)
            }).then(async (res) => {
                if (!res.ok) return { subtitles: [] };
                const data = await res.json() as any;
                if (!data || !Array.isArray(data.subtitles)) {
                    return { subtitles: [] };
                }
                const subtitles = data.subtitles.map((sub: any) => ({
                    id: sub.id,
                    url: sub.url,
                    lang: sub.lang || 'jpn'
                }));
                return { subtitles };
            }).catch(() => {
                return { subtitles: [] };
            });

            promises.push(butaNoSubsPromise);
        }

        const results = await Promise.allSettled(promises);

        if (results.every(result => result.status === 'rejected')) {
            throw (results[0] as PromiseRejectedResult).reason;
        }

        let allSubtitles: any[] = [];

        if (results[0].status === 'fulfilled' && results[0].value && results[0].value.subtitles) {
            allSubtitles = allSubtitles.concat(results[0].value.subtitles);
        }

        if (needsJapanese && results[1] && results[1].status === 'fulfilled' && results[1].value?.subtitles) {
            allSubtitles = allSubtitles.concat(results[1].value.subtitles);
        }

        if (allSubtitles.length === 0) {
            console.log('No subtitles found from any source.');
            return null;
        }

        console.log(`Found ${allSubtitles.length} total subtitles from all sources.`);
        return allSubtitles;

    } catch (error: any) {
        console.error('Error fetching subtitles:', error.message);
        return null;
    }
}

function filterSubtitlesByLanguage(allSubtitles: any[] | null, languageId: string): SubtitleInfo[] | null {
    if (!allSubtitles) return null;

    const codesToMatch = getLanguageAliases(languageId);
    const langSubs = allSubtitles.filter(sub => codesToMatch.includes(sub.lang));

    if (langSubs.length === 0) {
        console.log(`No subtitles found for language ${languageId}.`);
        return null;
    }

    const subtitleList: SubtitleInfo[] = langSubs.map((sub) => {
        return {
            id: sub.id,
            url: sub.url,
            lang: sub.lang,
            format: 'srt',
            langName: languageMap[sub.lang as keyof typeof languageMap] || sub.lang,
            releaseName: sub.release_name || sub.releaseName || 'Unknown',
            rating: sub.rating || 0
        };
    });

    subtitleList.sort((a, b) => {
        const aCodeIndex = codesToMatch.indexOf(a.lang);
        const bCodeIndex = codesToMatch.indexOf(b.lang);
        if (aCodeIndex !== bCodeIndex) {
            return aCodeIndex - bCodeIndex;
        }
        return 0;
    });

    console.log(`Found ${subtitleList.length} valid subtitles for ${languageId}.`);
    return subtitleList;
}

async function fetchSubtitleContent(url: string, sourceFormat = 'srt', languageCode: string | null = null): Promise<string | null> {
    console.log(`Fetching subtitle content from: ${url}`);
    try {
        const response = await fetch(url, {
            signal: AbortSignal.timeout(15000)
        });
        if (!response.ok) throw new Error(`Fetched subtitle responded with ${response.status}`);

        const arrayBuffer = await response.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);

        let subtitleText = await decodeSubtitleBuffer(buffer, languageCode);
        if (!subtitleText) {
            console.error(`Decoding/validation failed (possibly wrong language or encoding issue)`);
            return null;
        }

        if (sourceFormat.toLowerCase() !== 'srt') {
            console.log(`Converting subtitle from ${sourceFormat} to srt.`);
            const convertedSrt = SubtitleConverter.convert(subtitleText, sourceFormat);
            if (convertedSrt) {
                subtitleText = convertedSrt;
            } else {
                console.warn(`Converter returned empty for format ${sourceFormat}. Attempting fallback as-is.`);
            }
        }

        return subtitleText;
    } catch (error: any) {
        console.error(`Error fetching subtitle content from ${url}:`, error.message);
        return null;
    }
}

function extractNumbers(text: string): string[] {
    const nums: string[] = [];
    const digitMatches = text.match(/\d+/g);
    if (digitMatches) nums.push(...digitMatches);
    const yearMatches = text.match(/\b(19|20)\d{2}\b/g);
    if (yearMatches) nums.push(...yearMatches);
    return [...new Set(nums)];
}

function computeMatchScore(
    mainSub: SRTLine,
    transSub: SRTLine,
    mainStartMs: number,
    transStartMs: number,
    mainEndMs: number,
    transEndMs: number,
    expectedIndex: number,
    actualIndex: number
): number {
    let score = 0;

    // Time proximity + overlap (0-70 points)
    const startDiff = Math.abs(mainStartMs - transStartMs);
    const endDiff = Math.abs(mainEndMs - transEndMs);
    const timePenalty = startDiff / 1000 + endDiff / 2000;
    score += Math.max(0, 40 - timePenalty * 5);

    const overlapStart = Math.max(mainStartMs, transStartMs);
    const overlapEnd = Math.min(mainEndMs, transEndMs);
    const overlap = Math.max(0, overlapEnd - overlapStart);
    const union = Math.max(mainEndMs, transEndMs) - Math.min(mainStartMs, transStartMs);
    const iou = union > 0 ? overlap / union : 0;
    score += iou * 30;

    // Number overlap (0-50 points) - strong content signal
    const mainNums = extractNumbers(mainSub.text);
    const transNums = extractNumbers(transSub.text);
    if (mainNums.length > 0 && transNums.length > 0) {
        const intersection = mainNums.filter(n => transNums.includes(n));
        const unionNums = new Set([...mainNums, ...transNums]);
        if (unionNums.size > 0) {
            score += (intersection.length / unionNums.size) * 50;
        }
    }

    // Length ratio (0-20 points)
    const mainLen = sanitizeText(mainSub.text).length;
    const transLen = sanitizeText(transSub.text).length;
    if (mainLen > 0 && transLen > 0) {
        score += (Math.min(mainLen, transLen) / Math.max(mainLen, transLen)) * 20;
    }

    // Sequential consistency (0-10 points)
    const indexDiff = Math.abs(actualIndex - expectedIndex);
    score += Math.max(0, 10 - indexDiff * 2);

    return score;
}

// Hybrid content-aware subtitle merge using time, numbers, length and sequence signals
function mergeSubtitles(mainSubs: SRTLine[], transSubs: SRTLine[], _mergeThresholdMs = 500): SRTLine[] {
    console.log(`Smart-merging ${mainSubs.length} main subs with ${transSubs.length} translation subs.`);
    const mergedSubs: SRTLine[] = [];
    let expectedTransIndex = 0;
    const CONFIDENCE_THRESHOLD = 30;

    for (let i = 0; i < mainSubs.length; i++) {
        const mainSub = mainSubs[i];
        if (!mainSub || !mainSub.startTime || !mainSub.endTime) {
            console.warn("Skipping invalid main subtitle entry:", mainSub);
            continue;
        }

        const mainStartTime = parseTimeToMs(mainSub.startTime);
        const mainEndTime = parseTimeToMs(mainSub.endTime);

        let bestMatchIndex = -1;
        let bestScore = -Infinity;

        const searchStart = Math.max(0, expectedTransIndex - 2);
        const searchEnd = Math.min(transSubs.length, expectedTransIndex + 8);

        for (let j = searchStart; j < searchEnd; j++) {
            const transSub = transSubs[j];
            if (!transSub || !transSub.startTime || !transSub.endTime) continue;

            const transStartTime = parseTimeToMs(transSub.startTime);
            const transEndTime = parseTimeToMs(transSub.endTime);

            if (transStartTime > mainEndTime + 5000 && j > expectedTransIndex + 2) continue;
            if (transEndTime < mainStartTime - 5000 && j < expectedTransIndex - 1) continue;

            const score = computeMatchScore(
                mainSub, transSub,
                mainStartTime, transStartTime,
                mainEndTime, transEndTime,
                expectedTransIndex, j
            );

            if (score > bestScore) {
                bestScore = score;
                bestMatchIndex = j;
            }
        }

        const cleanMainText = sanitizeText(mainSub.text);
        const flatMainText = cleanMainText.replace(/\r?\n|\r/g, ' ').trim();
        if (!flatMainText) continue;

        let mergedText = flatMainText;
        if (bestMatchIndex !== -1 && bestScore >= CONFIDENCE_THRESHOLD) {
            const bestTransSub = transSubs[bestMatchIndex];
            const cleanTransText = sanitizeText(bestTransSub.text);
            const flatTransText = cleanTransText.replace(/\r?\n|\r/g, ' ').trim();
            if (flatTransText) {
                mergedText = (flatMainText + '\n<i>' + flatTransText + '</i>').trim();
            }
            expectedTransIndex = bestMatchIndex + 1;
        } else {
            // No confident match: only advance expected index if translation is clearly behind
            if (expectedTransIndex < transSubs.length) {
                const nextTrans = transSubs[expectedTransIndex];
                if (nextTrans && nextTrans.endTime) {
                    const nextTransEnd = parseTimeToMs(nextTrans.endTime);
                    if (nextTransEnd < mainStartTime - 2000) {
                        expectedTransIndex++;
                    }
                }
            }
        }

        mergedSubs.push({
            ...mainSub,
            text: mergedText
        });
    }

    console.log(`Finished smart-merging. Result has ${mergedSubs.length} entries.`);
    return mergedSubs;
}

// Formats an array of subtitle objects back into SRT text
function formatSrt(subtitleArray: SRTLine[]): string | null {
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
    } catch (error: any) {
        console.error('Error formatting SRT:', error.message);
        console.error('Problematic data for formatSrt:', JSON.stringify(subtitleArray.slice(0, 5)));
        return null;
    }
}

// Parses SRT text into an array of objects
function parseSrt(srtText: string): SRTLine[] | null {
    if (!srtText || typeof srtText !== 'string') {
        console.error("Invalid input to parseSrt: not a string or empty.");
        return null;
    }
    try {
        const parser = new SRTParser2();
        if (srtText.charCodeAt(0) === 0xFEFF) {
            console.log("Found BOM in parseSrt, removing it.");
            srtText = srtText.substring(1);
        }
        srtText = srtText.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

        let subtitles = parser.fromSrt(srtText);

        if (!Array.isArray(subtitles)) {
            console.error("Parsing did not return an array.");
            return null;
        }

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
            return null;
        }

        if (subtitles.length > 0) {
            const firstText = subtitles[0].text.replace(/[\r\n]+/g, ' ');
            console.log(`First parsed subtitle text by SRTParser2: [${firstText}]`);
        } else {
            console.log("SRTParser2 returned an empty array.");
        }

        if (subtitles.length > 0 && (!subtitles[0].startTime || !subtitles[0].text)) {
            console.warn("Parsed structure seems invalid (missing startTime or text in first entry).");
            return null;
        }

        console.log(`Parsed ${subtitles.length} subtitle entries.`);
        return subtitles as SRTLine[];
    } catch (error: any) {
        console.error('Error parsing SRT:', error.message);
        return null;
    }
}

function getManifest(addonName: string): Manifest {
    return {
        id: 'com.serhat.strelingo',
        version: '0.1.2',
        name: addonName,
        description: 'Provides dual subtitles (main + translation) from OpenSubtitles for language learning.',
        githubUrl: 'https://github.com/Serkali-sudo/strelingo-addon',
        resources: ['subtitles'],
        subtitleExtra: ['videoHash', 'videoSize', 'filename'],
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
                default: 'English [eng]'
            }
        ]
    };
}

const app = new Hono();

app.use('*', cors());

// Manifest route handlers
app.get('/manifest.json', (c) => {
    const addonName = getEnvVar(c, 'ADDON_NAME') || 'Strelingo - Dual Language Subtitles';
    return c.json(getManifest(addonName));
});

app.get('/:config/manifest.json', (c) => {
    const configParam = c.req.param('config');
    const addonName = getEnvVar(c, 'ADDON_NAME') || 'Strelingo - Dual Language Subtitles';
    const manifest = getManifest(addonName);

    let configObj: any = {};
    if (configParam) {
        try {
            configObj = JSON.parse(decodeURIComponent(configParam));
        } catch (e) {
            console.error("Failed to parse config from manifest URL:", e);
        }
    }

    if (manifest.config) {
        manifest.config = manifest.config.map(item => {
            if (configObj[item.key]) {
                return {
                    ...item,
                    default: configObj[item.key]
                };
            }
            return item;
        });
    }

    if (manifest.behaviorHints) {
        manifest.behaviorHints.configurationRequired = false;
    }

    const mainLangCode = parseLangCode(configObj.mainLang)?.toUpperCase() || '';
    const transLangCode = parseLangCode(configObj.transLang)?.toUpperCase() || '';
    if (mainLangCode && transLangCode) {
        manifest.name = `${manifest.name} (${mainLangCode}+${transLangCode})`;
    }

    return c.json(manifest);
});

app.get('/', (c) => {
    const addonName = getEnvVar(c, 'ADDON_NAME') || 'Strelingo - Dual Language Subtitles';
    const manifest = getManifest(addonName);
    const hasConfig = !!(manifest.config || []).length;
    if (hasConfig) {
        return c.redirect('/configure');
    }
    return c.html(landingTemplate(manifest));
});

app.get('/configure', (c) => {
    const addonName = getEnvVar(c, 'ADDON_NAME') || 'Strelingo - Dual Language Subtitles';
    const manifest = getManifest(addonName);
    const browserLangOption = getBrowserLanguageOption(c.req.header('accept-language'));
    if (manifest.config) {
        manifest.config = manifest.config.map(item => {
            if (item.key === 'transLang') {
                return { ...item, default: browserLangOption };
            }
            return item;
        });
    }
    return c.html(landingTemplate(manifest));
});

app.get('/:config/configure', (c) => {
    const configParam = c.req.param('config');
    const addonName = getEnvVar(c, 'ADDON_NAME') || 'Strelingo - Dual Language Subtitles';
    const manifest = getManifest(addonName);

    let configObj: any = {};
    if (configParam) {
        try {
            configObj = JSON.parse(decodeURIComponent(configParam));
        } catch (e) {
            console.error("Failed to parse config from configure URL:", e);
        }
    }

    const browserLangOption = getBrowserLanguageOption(c.req.header('accept-language'));
    if (manifest.config) {
        manifest.config = manifest.config.map(item => {
            if (configObj[item.key]) {
                return {
                    ...item,
                    default: configObj[item.key]
                };
            }
            if (item.key === 'transLang') {
                return { ...item, default: browserLangOption };
            }
            return item;
        });
    }

    const mainLangCode = parseLangCode(configObj.mainLang)?.toUpperCase() || '';
    const transLangCode = parseLangCode(configObj.transLang)?.toUpperCase() || '';
    if (mainLangCode && transLangCode) {
        manifest.name = `${manifest.name} (${mainLangCode}+${transLangCode})`;
    }

    return c.html(landingTemplate(manifest));
});

app.get('/:config', (c) => {
    const configParam = c.req.param('config');
    if (configParam.endsWith('.json') || configParam === 'configure' || configParam === 'subtitles') {
        return c.notFound();
    }
    return c.redirect(`/${configParam}/configure`);
});

app.get('/subtitles/:filename', async (c) => {
    const filename = c.req.param('filename');
    const localStorageDir = getEnvVar(c, 'LOCAL_STORAGE_DIR');
    if (!localStorageDir) {
        return c.text('Local storage is not configured', 400);
    }

    try {
        const filePath = path.join(localStorageDir, filename);
        const content = await fs.readFile(filePath);
        return c.body(content, 200, {
            'Content-Type': 'text/srt; charset=utf-8',
            'Access-Control-Allow-Origin': '*'
        });
    } catch (e) {
        return c.text('Subtitle not found', 404);
    }
});

function encodeBase64UrlSafe(str: string): string {
    const base64 = btoa(str);
    return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

function decodeBase64UrlSafe(safeBase64: string): string {
    let base64 = safeBase64.replace(/-/g, '+').replace(/_/g, '/');
    while (base64.length % 4) {
        base64 += '=';
    }
    return atob(base64);
}

async function handleSubtitlesRequest(c: any) {
    const configParam = c.req.param('config');
    const type = c.req.param('type');

    const id = stripJsonExtension(c.req.param('idAndMaybeJson') || c.req.param('id'));
    const extraParam = stripJsonExtension(c.req.param('extraAndMaybeJson') || c.req.param('extra'));

    console.log('Strelingo Subtitle request:', { type, id, extraParam, configParam });

    let browserLanguageCode = 'eng';
    const acceptLang = c.req.header('accept-language');
    if (acceptLang) {
        browserLanguageCode = extractBrowserLanguageFromHeader(acceptLang);
        console.log(`Detected browser language: ${browserLanguageCode}`);
    }

    let configObj: any = {};
    if (configParam) {
        try {
            configObj = JSON.parse(decodeURIComponent(configParam));
        } catch (e) {
            console.error("Failed to parse config from subtitles request:", e);
        }
    }

    const mainLangRaw = configObj.mainLang || 'English [eng]';
    const transLangRaw = configObj.transLang || `${languageMap[browserLanguageCode as keyof typeof languageMap]} [${browserLanguageCode}]`;

    const mainLang = parseLangCode(mainLangRaw);
    const transLang = parseLangCode(transLangRaw);

    console.log(`Selected Languages: Main=${mainLang}, Translation=${transLang}`);

    if (mainLang === transLang) {
        console.log(`Error: Main language (${mainLang}) and Translation language (${transLang}) cannot be the same. Aborting.`);
        return c.json({ subtitles: [], cacheMaxAge: 3600 });
    }

    let imdbId = id;
    let season: string | undefined;
    let episode: string | undefined;

    if (imdbId.includes(':')) {
        const parts = imdbId.split(':');
        imdbId = parts[0];
        if (parts.length >= 3) {
            season = parts[1];
            episode = parts[2];
        }
    }

    if (!imdbId || !imdbId.startsWith('tt')) {
        console.log('No valid IMDB ID provided');
        return c.json({ subtitles: [] });
    }

    const baseSearchParams: any = {
        imdbid: imdbId.replace('tt', '')
    };
    if (type === 'series' && season && episode) {
        baseSearchParams.season = season;
        baseSearchParams.episode = episode;
    }

    const videoParams: any = {};
    if (extraParam) {
        const pairs = extraParam.split('&');
        for (const pair of pairs) {
            const [key, value] = pair.split('=');
            if (key && value) {
                videoParams[key] = decodeURIComponent(value);
            }
        }
        console.log('Video matching parameters parsed:', videoParams);
    }

    const skipVercelBlob = getEnvVar(c, 'SKIP_VERCEL_BLOB') === 'true';
    if (skipVercelBlob) {
        console.log("SKIP_VERCEL_BLOB is true, Vercel Blob upload will be skipped.");
    }

    const supabaseUrl = getEnvVar(c, 'SUPABASE_URL');
    const supabaseKey = getEnvVar(c, 'SUPABASE_SERVICE_KEY');

    let supabase: any;
    if (supabaseUrl && supabaseKey) {
        supabase = createClient(supabaseUrl, supabaseKey);
        console.log("Supabase client initialized with Service Role Key.");
    } else {
        console.warn("Supabase URL or Service Role Key not found in environment variables. Supabase fallback disabled.");
    }

    try {
        const needsJapanese = mainLang === 'jpn' || transLang === 'jpn';
        if (needsJapanese) {
            console.log('Japanese language detected, will fetch from Buta no Subs too.');
        }

        console.log('Fetching all subtitles...');
        const allSubtitles = await fetchAllSubtitles(baseSearchParams, type, videoParams, needsJapanese);

        if (!allSubtitles) {
            console.log('Failed to fetch subtitles.');
            return c.json({ subtitles: [], cacheMaxAge: 60 });
        }

        console.log(`Filtering for main language: ${mainLang}`);
        let mainSubInfoList = filterSubtitlesByLanguage(allSubtitles, mainLang || 'eng');

        console.log(`Filtering for translation language: ${transLang}`);
        let transSubInfoList = filterSubtitlesByLanguage(allSubtitles, transLang || 'eng');

        if (!mainSubInfoList || mainSubInfoList.length === 0) {
            console.log(`No main language (${mainLang}) subtitles found.`);
            return c.json({ subtitles: [], cacheMaxAge: 60 });
        }

        if (!transSubInfoList || transSubInfoList.length === 0) {
            console.warn(`No translation language (${transLang}) subtitles found.`);
            return c.json({ subtitles: [], cacheMaxAge: 60 });
        }

        let mainParsed: SRTLine[] | null = null;
        let selectedMainSubInfo: SubtitleInfo | null = null;

        for (const mainSubInfo of mainSubInfoList) {
            console.log(`Attempting to process main subtitle: ID=${mainSubInfo.id}, Release=${mainSubInfo.releaseName}`);
            const mainSubContent = await fetchSubtitleContent(mainSubInfo.url, mainSubInfo.format, mainSubInfo.lang);

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

            mainParsed = parsed;
            selectedMainSubInfo = mainSubInfo;
            console.log(`Successfully processed main subtitle (ID: ${selectedMainSubInfo.id}). Proceeding with translations.`);
            break;
        }

        if (!mainParsed || !selectedMainSubInfo) {
            console.error("Failed to fetch and parse any of the available main subtitles. Cannot proceed.");
            return c.json({ subtitles: [], cacheMaxAge: 60 });
        }

        const finalSubtitles = [];
        const usedTransUrls = new Set();

        // Use the first translation subtitle from the API (max 1 result)
        const candidates: SubtitleInfo[] = [];
        if (transSubInfoList.length > 0) {
            candidates.push(transSubInfoList[0]);
        }

        for (const transSubInfo of candidates) {
            if (finalSubtitles.length >= 1) break;
            if (usedTransUrls.has(transSubInfo.url)) continue;
            usedTransUrls.add(transSubInfo.url);

            const version = finalSubtitles.length + 1;
            console.log(`Processing translation candidate v${version} (ID: ${transSubInfo.id})...`);

            const transSubContent = await fetchSubtitleContent(transSubInfo.url, transSubInfo.format, transSubInfo.lang);

            if (!transSubContent) {
                console.warn(`Failed to fetch content for translation v${version}. Skipping.`);
                continue;
            }

            const transParsed = parseSrt(transSubContent);
            if (!transParsed) {
                console.warn(`Failed to parse content for translation v${version}. Skipping.`);
                continue;
            }

            console.log(`Merging main with translation v${version}...`);
            const mergedParsed = mergeSubtitles([...mainParsed], transParsed);
            if (!mergedParsed || mergedParsed.length === 0) {
                console.warn(`Merging failed or resulted in empty subtitles for v${version}. Skipping.`);
                continue;
            }

            console.log(`Formatting merged SRT for v${version}...`);
            const mergedSrtString = formatSrt(mergedParsed);
            if (!mergedSrtString) {
                console.warn(`Failed to format merged SRT for v${version}. Skipping.`);
                continue;
            }

            let uploadedToVercel = false;
            let uploadUrl: string | null = null;
            let subtitleEntryId = `merged-${selectedMainSubInfo.id}-${transSubInfo.id}`;

            const directServingEnabled = getEnvVar(c, 'ENABLE_DIRECT_SERVING') === 'true';

            if (directServingEnabled) {
                console.log(`Direct serving enabled! Generating edge-serving URL for v${version}...`);
                const workerUrl = `${new URL(c.req.url).protocol}//${new URL(c.req.url).host}`;

                const paramsObj = {
                    mainUrl: selectedMainSubInfo.url,
                    mainFormat: selectedMainSubInfo.format || 'srt',
                    mainLang: selectedMainSubInfo.lang || mainLang || 'eng',
                    transUrl: transSubInfo.url,
                    transFormat: transSubInfo.format || 'srt',
                    transLang: transSubInfo.lang || transLang || 'eng'
                };

                const encodedData = encodeBase64UrlSafe(JSON.stringify(paramsObj));
                uploadUrl = `${workerUrl}/serve-subtitles/${encodedData}/subtitles.srt`;
                subtitleEntryId += '-direct';
            }

            if (!uploadUrl && !skipVercelBlob) {
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
                } catch (e: any) {
                    console.error(`Failed to upload merged SRT for v${version} to Vercel Blob: ${e.message}`);
                }
            }

            if (!uploadUrl && supabase) {
                console.log(`Attempting Supabase Storage upload for v${version}...`);
                try {
                    const supabaseFileName = type === 'series' && season && episode
                        ? `${imdbId}/S${season}E${episode}_${mainLang}_${transLang}_v${version}.srt`
                        : `${imdbId}/${mainLang}_${transLang}_v${version}.srt`;

                    const { error: supabaseError } = await supabase
                        .storage
                        .from('subtitles')
                        .upload(supabaseFileName, mergedSrtString, {
                            cacheControl: '3600',
                            upsert: true,
                            contentType: 'text/srt; charset=utf-8'
                        });

                    if (supabaseError) throw supabaseError;

                    const { data: publicUrlData } = supabase
                        .storage
                        .from('subtitles')
                        .getPublicUrl(supabaseFileName);

                    if (!publicUrlData || !publicUrlData.publicUrl) {
                        console.error(`Supabase upload successful for v${version}, but failed to get public URL.`);
                    } else {
                        uploadUrl = publicUrlData.publicUrl;
                        console.log(`Uploaded v${version} to Supabase: ${uploadUrl}`);
                        subtitleEntryId += '-supabase';
                    }
                } catch (e: any) {
                    console.error(`Supabase Storage upload failed for v${version}: ${e.message}`);
                }
            }

            const localStorageDir = getEnvVar(c, 'LOCAL_STORAGE_DIR');
            const externalUrl = getEnvVar(c, 'EXTERNAL_URL') || `${new URL(c.req.url).protocol}//${new URL(c.req.url).host}`;

            if (!uploadUrl && localStorageDir) {
                console.log(`Attempting Local Storage upload for v${version}...`);
                try {
                    await fs.mkdir(localStorageDir, { recursive: true });

                    const localFileName = type === 'series' && season && episode
                        ? `${imdbId}_S${season}E${episode}_${mainLang}_${transLang}_v${version}.srt`
                        : `${imdbId}_${mainLang}_${transLang}_v${version}.srt`;
                    const localFilePath = path.join(localStorageDir, localFileName);

                    await fs.writeFile(localFilePath, mergedSrtString, 'utf-8');

                    uploadUrl = `${externalUrl}/subtitles/${localFileName}`;
                    console.log(`Uploaded v${version} to Local Storage: ${uploadUrl}`);
                    subtitleEntryId += '-local';
                } catch (e: any) {
                    console.warn(`Local Storage write failed (normal on read-only environments like Workers): ${e.message}`);
                }
            }

            if (uploadUrl) {
                const readableLang = `${languageMap[mainLang as keyof typeof languageMap] || mainLang}+${languageMap[transLang as keyof typeof languageMap] || transLang}`;
                finalSubtitles.push({
                    id: subtitleEntryId,
                    url: uploadUrl,
                    lang: readableLang,
                    label: readableLang
                });
            } else {
                console.warn(`Failed to upload v${version} to either Vercel Blob or Supabase Storage.`);
            }
        }

        if (finalSubtitles.length === 0) {
            console.warn("Processed translation candidates, but none resulted in a usable subtitle file. Returning empty.");
        }

        return c.json({
            subtitles: finalSubtitles,
            cacheMaxAge: 6 * 3600,
            staleRevalidate: 24 * 3600
        });

    } catch (e: any) {
        console.error('Error in subtitle handler:', e.message);
        return c.json({ subtitles: [], cacheMaxAge: 60 });
    }
}

app.get('/serve-subtitles/:encodedData/subtitles.srt', async (c) => {
    const encodedData = c.req.param('encodedData');
    if (!encodedData) {
        return c.text('Missing encoded parameter payload', 400);
    }

    const globalCaches = typeof caches !== 'undefined' ? caches : null;
    if (globalCaches && globalCaches.default) {
        try {
            const cachedResponse = await globalCaches.default.match(c.req.raw);
            if (cachedResponse) {
                console.log("Subtitle Cache Hit! Serving immediately from Cloudflare Edge Cache.");
                return cachedResponse;
            }
        } catch (cacheErr: any) {
            console.warn("Failed to check Cloudflare Cache:", cacheErr.message);
        }
    }

    try {
        const decodedStr = decodeBase64UrlSafe(encodedData);
        const params = JSON.parse(decodedStr);

        const mainUrl = params.mainUrl;
        const mainFormat = params.mainFormat || 'srt';
        const mainLang = params.mainLang || 'eng';
        const transUrl = params.transUrl;
        const transFormat = params.transFormat || 'srt';
        const transLang = params.transLang || 'eng';

        if (!mainUrl || !transUrl) {
            return c.text('Missing required subtitle URLs inside payload', 400);
        }

        console.log(`Direct subtitle serve request. Main: ${mainUrl}, Trans: ${transUrl}`);

        const mainSubContent = await fetchSubtitleContent(mainUrl, mainFormat, mainLang);

        if (!mainSubContent) throw new Error("Failed to fetch main subtitle");
        const mainParsed = parseSrt(mainSubContent);
        if (!mainParsed) throw new Error("Failed to parse main subtitle");

        const transSubContent = await fetchSubtitleContent(transUrl, transFormat, transLang);

        if (!transSubContent) throw new Error("Failed to fetch translation subtitle");
        const transParsed = parseSrt(transSubContent);
        if (!transParsed) throw new Error("Failed to parse translation subtitle");

        const mergedParsed = mergeSubtitles([...mainParsed], transParsed);
        if (!mergedParsed || mergedParsed.length === 0) throw new Error("Failed to merge subtitles");

        const mergedSrtString = formatSrt(mergedParsed);
        if (!mergedSrtString) throw new Error("Failed to format merged subtitles");

        const response = c.body(mergedSrtString, 200, {
            'Content-Type': 'text/srt; charset=utf-8',
            'Access-Control-Allow-Origin': '*',
            'Cache-Control': 'public, max-age=86400'
        });

        if (globalCaches && globalCaches.default && c.executionCtx?.waitUntil) {
            try {
                c.executionCtx.waitUntil(globalCaches.default.put(c.req.raw, response.clone()));
            } catch (cachePutErr: any) {
                console.warn("Failed to write to Cloudflare Cache:", cachePutErr.message);
            }
        }

        return response;

    } catch (e: any) {
        console.error(`Direct subtitle serving failed: ${e.message}`);
        return c.text(`Subtitle serving failed: ${e.message}`, 500);
    }
});

app.get('/serve-subtitles.srt', async (c) => {
    const mainUrl = c.req.query('mainUrl');
    const mainFormat = c.req.query('mainFormat') || 'srt';
    const mainLang = c.req.query('mainLang') || 'eng';
    const transUrl = c.req.query('transUrl');
    const transFormat = c.req.query('transFormat') || 'srt';
    const transLang = c.req.query('transLang') || 'eng';

    if (!mainUrl || !transUrl) {
        return c.text('Missing required subtitle URLs', 400);
    }

    try {
        console.log(`Direct subtitle serve request. Main: ${mainUrl}, Trans: ${transUrl}`);

        const mainSubContent = await fetchSubtitleContent(mainUrl, mainFormat, mainLang);

        if (!mainSubContent) throw new Error("Failed to fetch main subtitle");
        const mainParsed = parseSrt(mainSubContent);
        if (!mainParsed) throw new Error("Failed to parse main subtitle");

        const transSubContent = await fetchSubtitleContent(transUrl, transFormat, transLang);

        if (!transSubContent) throw new Error("Failed to fetch translation subtitle");
        const transParsed = parseSrt(transSubContent);
        if (!transParsed) throw new Error("Failed to parse translation subtitle");

        const mergedParsed = mergeSubtitles([...mainParsed], transParsed);
        if (!mergedParsed || mergedParsed.length === 0) throw new Error("Failed to merge subtitles");

        const mergedSrtString = formatSrt(mergedParsed);
        if (!mergedSrtString) throw new Error("Failed to format merged subtitles");

        return c.body(mergedSrtString, 200, {
            'Content-Type': 'text/srt; charset=utf-8',
            'Access-Control-Allow-Origin': '*',
            'Cache-Control': 'public, max-age=86400'
        });

    } catch (e: any) {
        console.error(`Direct subtitle serving failed: ${e.message}`);
        return c.text(`Subtitle serving failed: ${e.message}`, 500);
    }
});

app.get('/subtitles/:type/:idAndMaybeJson', handleSubtitlesRequest);
app.get('/subtitles/:type/:id/:extraAndMaybeJson', handleSubtitlesRequest);
app.get('/:config/subtitles/:type/:idAndMaybeJson', handleSubtitlesRequest);
app.get('/:config/subtitles/:type/:id/:extraAndMaybeJson', handleSubtitlesRequest);

export default app;

if (typeof process !== 'undefined' && process.argv[1]?.includes('src/index')) {
    import('@hono/node-server').then(({ serve }) => {
        const port = parseInt(getEnvVar({}, 'PORT') || '7000', 10);
        serve({ fetch: app.fetch, port }, (info) => {
            console.log(`Strelingo addon running at http://127.0.0.1:${info.port}/manifest.json`);
            const localStorageDir = getEnvVar({}, 'LOCAL_STORAGE_DIR');
            if (localStorageDir) {
                const externalUrl = getEnvVar({}, 'EXTERNAL_URL') || `http://127.0.0.1:${info.port}`;
                console.log(`Local storage enabled at: ${localStorageDir}`);
                console.log(`Subtitle files served at: ${externalUrl}/subtitles/`);
            }
        });
    }).catch((err) => {
        console.error('Failed to start Node.js server. Make sure @hono/node-server is installed.', err);
        process.exit(1);
    });
}