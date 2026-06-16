import 'dotenv/config';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { HeadObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { head, put } from '@vercel/blob';

import SRTParser2 from 'srt-parser-2';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { Buffer } from 'node:buffer';

import landingTemplate, { Manifest } from './landingTemplate';
import { decodeSubtitleBuffer, getLanguageAliases } from './encoding';
import {
    mergeSubtitlesByTime,
    rankSubtitleCandidates,
    type SubtitleCandidate,
    type SubtitleCue
} from './subtitleMatching';

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

interface SubtitleInfo extends SubtitleCandidate {}

interface SRTLine extends SubtitleCue {}

interface LazySubtitlePayload {
    v: 1;
    exp: number;
    mainUrl: string;
    mainFormat: string;
    mainLang: string;
    transUrl: string;
    transFormat: string;
    transLang: string;
    storageFileName?: string;
    s3Key?: string;
}

interface S3StorageConfig {
    client: S3Client;
    bucket: string;
    publicBaseUrl: string;
    prefix: string;
}

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

function getOptionalExecutionCtx(c: any): any | undefined {
    try {
        return c.executionCtx;
    } catch {
        return undefined;
    }
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

function makeCacheKey(url: string): Request | null {
    try {
        const normalizedUrl = new URL(url);
        normalizedUrl.pathname = normalizedUrl.pathname.replace(/\.json(?=[\/]|$)/gi, '');
        return new Request(normalizedUrl.toString(), { method: 'GET' });
    } catch {
        return null;
    }
}

async function getCachedResponse(cacheKey: Request | null): Promise<Response | null> {
    if (!cacheKey || typeof caches === 'undefined') return null;
    try {
        const cache = caches.default;
        return await cache.match(cacheKey);
    } catch (e: any) {
        console.warn("Cache read error:", e.message);
        return null;
    }
}

function putCachedResponse(cacheKey: Request | null, response: Response, executionCtx?: any): void {
    if (!cacheKey || typeof caches === 'undefined') return;
    try {
        const cache = caches.default;
        const putPromise = cache.put(cacheKey, response.clone());
        if (executionCtx?.waitUntil) {
            executionCtx.waitUntil(putPromise);
        } else {
            putPromise.catch((e: any) => console.warn("Cache write error:", e.message));
        }
    } catch (e: any) {
        console.warn("Cache write error:", e.message);
    }
}

async function fetchSubtitleFilename(url: string): Promise<string | null> {
    if (!isSafeSubtitleUrl(url)) return null;

    try {
        const response = await fetch(url, { method: 'HEAD', signal: AbortSignal.timeout(5000) });
        const disposition = response.headers.get('content-disposition');
        if (!disposition) return null;
        const match = disposition.match(/filename="?([^";]+)"?/i);
        return match ? match[1] : null;
    } catch {
        return null;
    }
}

async function rankSubtitleInfoList(subList: SubtitleInfo[], videoFilename?: string): Promise<SubtitleInfo[]> {
    const ranked = await rankSubtitleCandidates(subList, {
        videoFilename,
        fetchSubtitleFilename
    });

    for (const candidate of ranked.slice(0, 5)) {
        const details = [
            `score=${candidate.score}`,
            `filenameScore=${candidate.filenameScore}`,
            `weakPenalty=${candidate.weakVariantPenalty}`,
            `g=${candidate.providerScore}`
        ].join(' ');
        const filename = candidate.filename ? ` filename=${candidate.filename}` : '';
        console.log(`Ranked subtitle ID=${candidate.sub.id} ${details}${filename}`);
    }

    return ranked.map(candidate => candidate.sub);
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
            signal: AbortSignal.timeout(23000)
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
                    lang: sub.lang || 'jpn',
                    g: sub.g || '0'
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

    const subtitleList = langSubs.map((sub) => {
        return {
            id: sub.id,
            url: sub.url,
            lang: sub.lang,
            format: 'srt',
            langName: languageMap[sub.lang as keyof typeof languageMap] || sub.lang,
            releaseName: 'OpenSubtitles',
            rating: 0,
            g: parseInt(sub.g) || 0
        };
    });

    console.log(`Found ${subtitleList.length} valid subtitles for ${languageId}.`);
    return subtitleList;
}

async function fetchSubtitleContent(url: string, sourceFormat = 'srt', languageCode: string | null = null): Promise<string | null> {
    if (!isSafeSubtitleUrl(url)) {
        console.error(`Rejected unsafe subtitle URL: ${url}`);
        return null;
    }

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

// Merges two arrays of parsed subtitles based on time
function mergeSubtitles(mainSubs: SRTLine[], transSubs: SRTLine[], mergeThresholdMs = 500): SRTLine[] {
    console.log(`Merging ${mainSubs.length} main subs with ${transSubs.length} translation subs.`);
    const mergedSubs = mergeSubtitlesByTime(mainSubs, transSubs, mergeThresholdMs);
    console.log(`Finished merging. Result has ${mergedSubs.length} entries.`);
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

const PAYLOAD_TTL_SECONDS = 30 * 24 * 60 * 60;
const MAX_SIGNED_PAYLOAD_LENGTH = 4096;
const SUPPORTED_SUBTITLE_FORMATS = new Set(['srt', 'sub', 'vtt', 'ssa', 'ass', 'sbv', 'smi', 'lrc', 'dfxp', 'ttml']);

function encodeBase64UrlSafe(str: string): string {
    return Buffer.from(str, 'utf-8').toString('base64url');
}

function decodeBase64UrlSafe(safeBase64: string): string {
    if (!/^[A-Za-z0-9_-]+$/.test(safeBase64)) {
        throw new Error('Invalid base64url payload');
    }
    return Buffer.from(safeBase64, 'base64url').toString('utf-8');
}

function encodeBytesBase64Url(bytes: ArrayBuffer): string {
    return Buffer.from(bytes).toString('base64url');
}

function getPayloadSigningSecret(c: any): string | undefined {
    return getEnvVar(c, 'SUBTITLE_PAYLOAD_SECRET')
        || getEnvVar(c, 'BLOB_READ_WRITE_TOKEN')
        || getEnvVar(c, 'S3_SECRET_ACCESS_KEY');
}

async function hmacSha256Base64Url(secret: string, data: string): Promise<string> {
    const key = await globalThis.crypto.subtle.importKey(
        'raw',
        new TextEncoder().encode(secret),
        { name: 'HMAC', hash: 'SHA-256' },
        false,
        ['sign']
    );
    const signature = await globalThis.crypto.subtle.sign('HMAC', key, new TextEncoder().encode(data));
    return encodeBytesBase64Url(signature);
}

function timingSafeEqualString(a: string, b: string): boolean {
    if (a.length !== b.length) return false;
    let diff = 0;
    for (let i = 0; i < a.length; i++) {
        diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
    }
    return diff === 0;
}

async function createSignedSubtitlePayload(c: any, payload: Omit<LazySubtitlePayload, 'v' | 'exp'>): Promise<string | null> {
    const secret = getPayloadSigningSecret(c);
    if (!secret || secret.length < 16) {
        console.warn('No sufficiently strong subtitle payload signing secret configured. Set SUBTITLE_PAYLOAD_SECRET to enable lazy subtitle serving.');
        return null;
    }

    const fullPayload: LazySubtitlePayload = {
        v: 1,
        exp: Math.floor(Date.now() / 1000) + PAYLOAD_TTL_SECONDS,
        ...payload
    };
    try {
        validateLazySubtitlePayload(fullPayload);
    } catch (e: any) {
        console.warn(`Refusing to sign unsafe subtitle payload: ${e.message}`);
        return null;
    }

    const encodedPayload = encodeBase64UrlSafe(JSON.stringify(fullPayload));
    const signature = await hmacSha256Base64Url(secret, encodedPayload);
    return `${encodedPayload}.${signature}`;
}

async function verifySignedSubtitlePayload(c: any, token: string): Promise<LazySubtitlePayload> {
    if (!token || token.length > MAX_SIGNED_PAYLOAD_LENGTH) {
        throw Object.assign(new Error('Invalid subtitle payload'), { status: 400 });
    }

    const [encodedPayload, signature, extra] = token.split('.');
    if (!encodedPayload || !signature || extra || !/^[A-Za-z0-9_-]+$/.test(signature)) {
        throw Object.assign(new Error('Invalid signed subtitle payload'), { status: 400 });
    }

    const secret = getPayloadSigningSecret(c);
    if (!secret || secret.length < 16) {
        throw Object.assign(new Error('Subtitle payload signing is not configured'), { status: 403 });
    }

    const expectedSignature = await hmacSha256Base64Url(secret, encodedPayload);
    if (!timingSafeEqualString(signature, expectedSignature)) {
        throw Object.assign(new Error('Invalid subtitle payload signature'), { status: 403 });
    }

    const decodedStr = decodeBase64UrlSafe(encodedPayload);
    if (decodedStr.length > MAX_SIGNED_PAYLOAD_LENGTH) {
        throw Object.assign(new Error('Subtitle payload is too large'), { status: 400 });
    }

    let parsed: unknown;
    try {
        parsed = JSON.parse(decodedStr);
    } catch {
        throw Object.assign(new Error('Invalid subtitle payload JSON'), { status: 400 });
    }

    return validateLazySubtitlePayload(parsed);
}

function validateLazySubtitlePayload(payload: any): LazySubtitlePayload {
    const now = Math.floor(Date.now() / 1000);
    if (!payload || payload.v !== 1 || typeof payload.exp !== 'number' || payload.exp <= now) {
        throw Object.assign(new Error('Expired or invalid subtitle payload'), { status: 403 });
    }

    const mainFormat = normalizeSubtitleFormat(payload.mainFormat);
    const transFormat = normalizeSubtitleFormat(payload.transFormat);
    const mainLang = normalizeSubtitleLang(payload.mainLang);
    const transLang = normalizeSubtitleLang(payload.transLang);
    const mainUrl = normalizeSubtitleUrl(payload.mainUrl);
    const transUrl = normalizeSubtitleUrl(payload.transUrl);
    const storageFileName = payload.storageFileName === undefined
        ? undefined
        : normalizeStorageFileName(payload.storageFileName);
    const s3Key = payload.s3Key === undefined
        ? undefined
        : normalizeStorageKey(payload.s3Key);

    return {
        v: 1,
        exp: payload.exp,
        mainUrl,
        mainFormat,
        mainLang,
        transUrl,
        transFormat,
        transLang,
        storageFileName,
        s3Key
    };
}

function normalizeSubtitleFormat(format: unknown): string {
    const value = String(format || 'srt').toLowerCase().trim();
    if (!SUPPORTED_SUBTITLE_FORMATS.has(value)) {
        throw Object.assign(new Error('Unsupported subtitle format'), { status: 400 });
    }
    return value;
}

function normalizeSubtitleLang(lang: unknown): string {
    const value = String(lang || 'eng').toLowerCase().trim();
    if (!/^[a-z0-9_-]{2,12}$/.test(value)) {
        throw Object.assign(new Error('Invalid subtitle language'), { status: 400 });
    }
    return value;
}

function normalizeSubtitleUrl(url: unknown): string {
    const value = String(url || '').trim();
    if (!isSafeSubtitleUrl(value)) {
        throw Object.assign(new Error('Unsafe subtitle URL'), { status: 400 });
    }
    return value;
}

function normalizeStorageFileName(fileName: unknown): string {
    const value = String(fileName || '').trim();
    if (!/^[A-Za-z0-9._-]+\.srt$/.test(value)) {
        throw Object.assign(new Error('Invalid storage filename'), { status: 400 });
    }
    return value;
}

function normalizeStorageKey(key: unknown): string {
    const value = String(key || '').trim();
    if (!/^[A-Za-z0-9._/-]+\.srt$/.test(value) || value.includes('..') || value.startsWith('/') || value.endsWith('/')) {
        throw Object.assign(new Error('Invalid storage key'), { status: 400 });
    }
    return value;
}

function isSafeSubtitleUrl(urlString: string): boolean {
    if (!urlString || urlString.length > 2048) return false;

    let parsed: URL;
    try {
        parsed = new URL(urlString);
    } catch {
        return false;
    }

    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return false;
    if (parsed.username || parsed.password) return false;

    const host = parsed.hostname.toLowerCase();
    if (!host || host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local')) return false;
    if (isBlockedIpv4Host(host) || isBlockedIpv6Host(host)) return false;

    return true;
}

function isBlockedIpv4Host(host: string): boolean {
    const match = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
    if (!match) return false;

    const parts = match.slice(1).map(Number);
    if (parts.some(part => part < 0 || part > 255)) return true;

    const [a, b] = parts;
    return a === 0
        || a === 10
        || a === 127
        || (a === 100 && b >= 64 && b <= 127)
        || (a === 169 && b === 254)
        || (a === 172 && b >= 16 && b <= 31)
        || (a === 192 && b === 168)
        || a >= 224;
}

function isBlockedIpv6Host(host: string): boolean {
    if (!host.includes(':')) return false;
    const normalized = host.replace(/^\[|\]$/g, '').toLowerCase();
    return normalized === '::'
        || normalized === '::1'
        || normalized.startsWith('fc')
        || normalized.startsWith('fd')
        || normalized.startsWith('fe80:')
        || normalized.startsWith('0:');
}

function buildSubtitleFileName(
    type: string,
    imdbId: string,
    season: string | undefined,
    episode: string | undefined,
    mainLang: string | undefined,
    transLang: string | undefined,
    version: number
): string {
    const safeMainLang = mainLang || 'eng';
    const safeTransLang = transLang || 'eng';
    return type === 'series' && season && episode
        ? `${imdbId}_S${season}E${episode}_${safeMainLang}_${safeTransLang}_v${version}.srt`
        : `${imdbId}_${safeMainLang}_${safeTransLang}_v${version}.srt`;
}

function buildSubtitleStoragePath(
    type: string,
    imdbId: string,
    season: string | undefined,
    episode: string | undefined,
    mainLang: string | undefined,
    transLang: string | undefined,
    version: number
): string {
    const safeMainLang = mainLang || 'eng';
    const safeTransLang = transLang || 'eng';
    return type === 'series' && season && episode
        ? `${imdbId}/S${season}E${episode}_${safeMainLang}_${safeTransLang}_v${version}.srt`
        : `${imdbId}/${safeMainLang}_${safeTransLang}_v${version}.srt`;
}

function buildS3SubtitleKey(prefix: string, filePath: string): string {
    const normalizedPrefix = prefix
        .trim()
        .replace(/^\/+|\/+$/g, '');

    return normalizedPrefix ? `${normalizedPrefix}/${filePath}` : filePath;
}

function getS3StorageConfig(c: any): S3StorageConfig | null {
    const bucket = getEnvVar(c, 'S3_BUCKET');
    const accessKeyId = getEnvVar(c, 'S3_ACCESS_KEY_ID');
    const secretAccessKey = getEnvVar(c, 'S3_SECRET_ACCESS_KEY');
    const publicBaseUrl = getEnvVar(c, 'S3_PUBLIC_BASE_URL');

    if (!bucket || !accessKeyId || !secretAccessKey || !publicBaseUrl) {
        return null;
    }

    const endpoint = getEnvVar(c, 'S3_ENDPOINT');
    const region = getEnvVar(c, 'S3_REGION') || 'auto';
    const forcePathStyle = getEnvVar(c, 'S3_FORCE_PATH_STYLE') !== 'false';
    const prefix = getEnvVar(c, 'S3_PREFIX') || '';

    return {
        client: new S3Client({
            region,
            endpoint,
            forcePathStyle,
            credentials: {
                accessKeyId,
                secretAccessKey
            }
        }),
        bucket,
        publicBaseUrl: publicBaseUrl.replace(/\/+$/g, ''),
        prefix
    };
}

function getS3PublicSubtitleUrl(config: S3StorageConfig, key: string): string {
    return `${config.publicBaseUrl}/${key.split('/').map(encodeURIComponent).join('/')}`;
}

async function getExistingVercelBlobUrl(pathname: string): Promise<string | null> {
    try {
        const blob = await head(pathname);
        return blob?.url || null;
    } catch {
        return null;
    }
}

async function getExistingS3SubtitleUrl(config: S3StorageConfig, key: string): Promise<string | null> {
    try {
        await config.client.send(new HeadObjectCommand({
            Bucket: config.bucket,
            Key: key
        }));
        return getS3PublicSubtitleUrl(config, key);
    } catch {
        return null;
    }
}

async function putS3Subtitle(config: S3StorageConfig, key: string, content: string): Promise<string | null> {
    try {
        await config.client.send(new PutObjectCommand({
            Bucket: config.bucket,
            Key: key,
            Body: content,
            ContentType: 'text/srt; charset=utf-8',
            CacheControl: 'public, max-age=3600',
            IfNoneMatch: '*'
        }));
        return getS3PublicSubtitleUrl(config, key);
    } catch {
        return await getExistingS3SubtitleUrl(config, key);
    }
}

async function getExistingLocalSubtitleUrl(localStorageDir: string, fileName: string, externalUrl: string): Promise<string | null> {
    try {
        const filePath = path.join(localStorageDir, fileName);
        await fs.access(filePath);
        return `${externalUrl}/subtitles/${fileName}`;
    } catch {
        return null;
    }
}

async function findExistingStoredSubtitleUrl(
    c: any,
    fileName: string,
    s3Key: string
): Promise<{ url: string; suffix: string } | null> {
    const skipVercelBlob = getEnvVar(c, 'SKIP_VERCEL_BLOB') === 'true';
    if (!skipVercelBlob) {
        const existingBlobUrl = await getExistingVercelBlobUrl(fileName);
        if (existingBlobUrl) return { url: existingBlobUrl, suffix: '-vercel' };
    }

    const s3Storage = getS3StorageConfig(c);
    if (s3Storage) {
        const existingS3Url = await getExistingS3SubtitleUrl(s3Storage, s3Key);
        if (existingS3Url) return { url: existingS3Url, suffix: '-s3' };
    }

    const localStorageDir = getEnvVar(c, 'LOCAL_STORAGE_DIR');
    if (localStorageDir) {
        const externalUrl = getEnvVar(c, 'EXTERNAL_URL') || `${new URL(c.req.url).protocol}//${new URL(c.req.url).host}`;
        const existingLocalUrl = await getExistingLocalSubtitleUrl(localStorageDir, fileName, externalUrl);
        if (existingLocalUrl) return { url: existingLocalUrl, suffix: '-local' };
    }

    return null;
}

async function storeMergedSubtitle(
    c: any,
    fileName: string,
    s3Key: string,
    mergedSrtString: string
): Promise<{ url: string; suffix: string } | null> {
    const skipVercelBlob = getEnvVar(c, 'SKIP_VERCEL_BLOB') === 'true';
    if (!skipVercelBlob) {
        try {
            const { url } = await put(
                fileName,
                mergedSrtString,
                { access: 'public', addRandomSuffix: false }
            );
            return { url, suffix: '-vercel' };
        } catch {
            const existingBlobUrl = await getExistingVercelBlobUrl(fileName);
            if (existingBlobUrl) return { url: existingBlobUrl, suffix: '-vercel' };
        }
    }

    const s3Storage = getS3StorageConfig(c);
    if (s3Storage) {
        const s3Url = await putS3Subtitle(s3Storage, s3Key, mergedSrtString);
        if (s3Url) return { url: s3Url, suffix: '-s3' };
    }

    const localStorageDir = getEnvVar(c, 'LOCAL_STORAGE_DIR');
    if (localStorageDir) {
        const externalUrl = getEnvVar(c, 'EXTERNAL_URL') || `${new URL(c.req.url).protocol}//${new URL(c.req.url).host}`;
        try {
            await fs.mkdir(localStorageDir, { recursive: true });

            const localFilePath = path.join(localStorageDir, fileName);
            await fs.writeFile(localFilePath, mergedSrtString, { encoding: 'utf-8', flag: 'wx' });

            return { url: `${externalUrl}/subtitles/${fileName}`, suffix: '-local' };
        } catch {
            const existingLocalUrl = await getExistingLocalSubtitleUrl(localStorageDir, fileName, externalUrl);
            if (existingLocalUrl) return { url: existingLocalUrl, suffix: '-local' };
        }
    }

    return null;
}

async function buildMergedSubtitleSrt(params: LazySubtitlePayload): Promise<string> {
    const mainSubContent = await fetchSubtitleContent(params.mainUrl, params.mainFormat, params.mainLang);
    if (!mainSubContent) throw new Error("Failed to fetch main subtitle");

    const mainParsed = parseSrt(mainSubContent);
    if (!mainParsed) throw new Error("Failed to parse main subtitle");

    const transSubContent = await fetchSubtitleContent(params.transUrl, params.transFormat, params.transLang);
    if (!transSubContent) throw new Error("Failed to fetch translation subtitle");

    const transParsed = parseSrt(transSubContent);
    if (!transParsed) throw new Error("Failed to parse translation subtitle");

    const mergedParsed = mergeSubtitles([...mainParsed], transParsed);
    if (!mergedParsed || mergedParsed.length === 0) throw new Error("Failed to merge subtitles");

    const mergedSrtString = formatSrt(mergedParsed);
    if (!mergedSrtString) throw new Error("Failed to format merged subtitles");

    return mergedSrtString;
}

async function handleSubtitlesRequest(c: any) {
    const configParam = c.req.param('config');
    const type = c.req.param('type');

    const id = stripJsonExtension(c.req.param('idAndMaybeJson') || c.req.param('id'));
    const extraParam = stripJsonExtension(c.req.param('extraAndMaybeJson') || c.req.param('extra'));

    console.log('Strelingo Subtitle request:', { type, id, extraParam, configParam });

    const cacheKey = configParam ? makeCacheKey(c.req.url) : null;
    const cachedSearch = await getCachedResponse(cacheKey);
    if (cachedSearch) {
        console.log("Subtitle search cache hit! Serving from edge cache.");
        return cachedSearch;
    }

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
        const res = c.json({ subtitles: [], cacheMaxAge: 3600 }, 200, { 'Cache-Control': 'public, max-age=3600' });
        putCachedResponse(cacheKey, res, getOptionalExecutionCtx(c));
        return res;
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
        const res = c.json({ subtitles: [] }, 200, { 'Cache-Control': 'public, max-age=60' });
        putCachedResponse(cacheKey, res, getOptionalExecutionCtx(c));
        return res;
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

    const s3Storage = getS3StorageConfig(c);
    if (s3Storage) {
        console.log("S3-compatible storage initialized.");
    } else {
        console.warn("S3-compatible storage is not fully configured.");
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
            const res = c.json({ subtitles: [], cacheMaxAge: 60 }, 200, { 'Cache-Control': 'public, max-age=60' });
            putCachedResponse(cacheKey, res, getOptionalExecutionCtx(c));
            return res;
        }

        console.log(`Filtering for main language: ${mainLang}`);
        let mainSubInfoList = filterSubtitlesByLanguage(allSubtitles, mainLang || 'eng');

        console.log(`Filtering for translation language: ${transLang}`);
        let transSubInfoList = filterSubtitlesByLanguage(allSubtitles, transLang || 'eng');

        if (!mainSubInfoList || mainSubInfoList.length === 0) {
            console.log(`No main language (${mainLang}) subtitles found.`);
            const res = c.json({ subtitles: [], cacheMaxAge: 60 }, 200, { 'Cache-Control': 'public, max-age=60' });
            putCachedResponse(cacheKey, res, getOptionalExecutionCtx(c));
            return res;
        }

        if (!transSubInfoList || transSubInfoList.length === 0) {
            console.warn(`No translation language (${transLang}) subtitles found.`);
            const res = c.json({ subtitles: [], cacheMaxAge: 60 }, 200, { 'Cache-Control': 'public, max-age=60' });
            putCachedResponse(cacheKey, res, getOptionalExecutionCtx(c));
            return res;
        }

        console.log(`Ranking main subtitles${videoParams.filename ? ` by sync with: ${videoParams.filename}` : ''}`);
        mainSubInfoList = await rankSubtitleInfoList(mainSubInfoList, videoParams.filename);

        console.log(`Ranking translation subtitles${videoParams.filename ? ` by sync with: ${videoParams.filename}` : ''}`);
        transSubInfoList = await rankSubtitleInfoList(transSubInfoList, videoParams.filename);


        const directServingEnabled = getEnvVar(c, 'ENABLE_DIRECT_SERVING') === 'true';
        const storageLazyRequested = getEnvVar(c, 'ENABLE_STORAGE_LAZY_SERVING') === 'true';
        const hasPayloadSigningSecret = Boolean(getPayloadSigningSecret(c));
        const storageLazyServingEnabled = !directServingEnabled && storageLazyRequested && hasPayloadSigningSecret;
        const lazyServingEnabled = (directServingEnabled || storageLazyServingEnabled) && hasPayloadSigningSecret;
        if ((directServingEnabled || storageLazyRequested) && !hasPayloadSigningSecret) {
            console.warn('Lazy serving is enabled, but no subtitle payload signing secret is configured. Set SUBTITLE_PAYLOAD_SECRET.');
        }
        let selectedMainSubInfo: SubtitleInfo | null = null;
        let mainParsed: SRTLine[] | null = null;

        if (lazyServingEnabled) {
            selectedMainSubInfo = mainSubInfoList[0];
            console.log(`Lazy serving: selected main subtitle ID=${selectedMainSubInfo.id}, g=${selectedMainSubInfo.g}`);
        } else {
            for (const mainSubInfo of mainSubInfoList) {
                console.log(`Attempting to process main subtitle: ID=${mainSubInfo.id}, g=${mainSubInfo.g}`);
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
        }

        if (!selectedMainSubInfo) {
            console.error("Failed to fetch and parse any of the available main subtitles. Cannot proceed.");
            const res = c.json({ subtitles: [], cacheMaxAge: 60 }, 200, { 'Cache-Control': 'public, max-age=60' });
            putCachedResponse(cacheKey, res, getOptionalExecutionCtx(c));
            return res;
        }

        if (!lazyServingEnabled && !mainParsed) {
            console.error("Failed to parse any of the available main subtitles. Cannot proceed.");
            const res = c.json({ subtitles: [], cacheMaxAge: 60 }, 200, { 'Cache-Control': 'public, max-age=60' });
            putCachedResponse(cacheKey, res, getOptionalExecutionCtx(c));
            return res;
        }

        const finalSubtitles = [];
        const usedTransUrls = new Set();

        for (const transSubInfo of transSubInfoList) {
            if (finalSubtitles.length >= 4) break;
            if (usedTransUrls.has(transSubInfo.url)) continue;
            usedTransUrls.add(transSubInfo.url);

            const version = finalSubtitles.length + 1;
            console.log(`Processing translation candidate v${version} (ID: ${transSubInfo.id})...`);

            let uploadUrl: string | null = null;
            let subtitleEntryId = `merged-${selectedMainSubInfo.id}-${transSubInfo.id}`;
            const srtFileName = buildSubtitleFileName(type, imdbId, season, episode, mainLang, transLang, version);
            const storagePath = buildSubtitleStoragePath(type, imdbId, season, episode, mainLang, transLang, version);
            const s3Key = buildS3SubtitleKey(getEnvVar(c, 'S3_PREFIX') || '', storagePath);

            if (lazyServingEnabled) {
                console.log(`Generating signed lazy subtitle URL for v${version}...`);
                const workerUrl = (getEnvVar(c, 'EXTERNAL_URL') || `${new URL(c.req.url).protocol}//${new URL(c.req.url).host}`).replace(/\/+$/g, '');

                const paramsObj = {
                    mainUrl: selectedMainSubInfo.url,
                    mainFormat: selectedMainSubInfo.format || 'srt',
                    mainLang: selectedMainSubInfo.lang || mainLang || 'eng',
                    transUrl: transSubInfo.url,
                    transFormat: transSubInfo.format || 'srt',
                    transLang: transSubInfo.lang || transLang || 'eng',
                    storageFileName: storageLazyServingEnabled ? srtFileName : undefined,
                    s3Key: storageLazyServingEnabled ? s3Key : undefined
                };

                const signedToken = await createSignedSubtitlePayload(c, paramsObj);
                if (!signedToken) {
                    console.warn(`Failed to sign lazy subtitle payload for v${version}. Skipping.`);
                    continue;
                }
                uploadUrl = `${workerUrl}/serve-subtitles/${signedToken}/${srtFileName}`;
                subtitleEntryId += directServingEnabled ? '-direct' : '-lazy';
            } else {
                console.log(`Checking storage cache for v${version}...`);
                const existingStoredSubtitle = await findExistingStoredSubtitleUrl(c, srtFileName, s3Key);
                if (existingStoredSubtitle) {
                    console.log(`Storage cache hit for v${version}: ${existingStoredSubtitle.url}`);
                    uploadUrl = existingStoredSubtitle.url;
                    subtitleEntryId += existingStoredSubtitle.suffix;
                }

                if (!uploadUrl) {
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

                    const storedSubtitle = await storeMergedSubtitle(c, srtFileName, s3Key, mergedSrtString);
                    if (storedSubtitle) {
                        uploadUrl = storedSubtitle.url;
                        subtitleEntryId += storedSubtitle.suffix;
                    }
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
                console.warn(`Failed to serve or store v${version}.`);
            }
        }

        if (finalSubtitles.length === 0) {
            console.warn("Processed translation candidates, but none resulted in a usable subtitle file. Returning empty.");
        }

        const successResponse = c.json({
            subtitles: finalSubtitles,
            cacheMaxAge: 6 * 3600,
            staleRevalidate: 24 * 3600
        }, 200, {
            'Cache-Control': 'public, max-age=21600, s-maxage=21600, stale-while-revalidate=86400',
        });
        putCachedResponse(cacheKey, successResponse, getOptionalExecutionCtx(c));
        return successResponse;

    } catch (e: any) {
        console.error('Error in subtitle handler:', e.message);
        const res = c.json({ subtitles: [], cacheMaxAge: 60 }, 200, { 'Cache-Control': 'public, max-age=60' });
        putCachedResponse(cacheKey, res, getOptionalExecutionCtx(c));
        return res;
    }
}

app.get('/serve-subtitles/:token/:filename', async (c) => {
    const token = c.req.param('token');
    if (!token) {
        return c.text('Missing signed subtitle payload', 400);
    }

    const cacheKey = makeCacheKey(c.req.url);
    const cachedResponse = await getCachedResponse(cacheKey);
    if (cachedResponse) {
        console.log("Subtitle Cache Hit! Serving from edge cache.");
        return cachedResponse;
    }

    try {
        const params = await verifySignedSubtitlePayload(c, token);
        const { mainUrl, transUrl, storageFileName, s3Key } = params;

        console.log(`Direct subtitle serve request. Main: ${mainUrl}, Trans: ${transUrl}`);

        if (storageFileName && s3Key) {
            const existingStoredSubtitle = await findExistingStoredSubtitleUrl(c, storageFileName, s3Key);
            if (existingStoredSubtitle) {
                return c.redirect(existingStoredSubtitle.url, 302);
            }
        }

        const mergedSrtString = await buildMergedSubtitleSrt(params);

        if (storageFileName && s3Key) {
            const storedSubtitle = await storeMergedSubtitle(c, storageFileName, s3Key, mergedSrtString);
            if (storedSubtitle) {
                return c.redirect(storedSubtitle.url, 302);
            }
        }

        const response = c.body(mergedSrtString, 200, {
            'Content-Type': 'text/srt; charset=utf-8',
            'Access-Control-Allow-Origin': '*',
            'Cache-Control': 'public, max-age=86400'
        });

        putCachedResponse(cacheKey, response, getOptionalExecutionCtx(c));

        return response;

    } catch (e: any) {
        console.error(`Direct subtitle serving failed: ${e.message}`);
        return c.text(`Subtitle serving failed: ${e.message}`, e.status || 500);
    }
});

app.get('/serve-subtitles.srt', async (c) => {
    return c.text('Unsigned subtitle query URLs are disabled. Use signed /serve-subtitles/:token/:filename URLs.', 410);
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