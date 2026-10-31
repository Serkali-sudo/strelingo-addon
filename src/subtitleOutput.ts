import type { Manifest } from './landingTemplate';
import { parseSrtTimeToMs, type SubtitleCue } from './subtitleMatching';

const FONTS = ['Arial', 'Verdana', 'Tahoma', 'Times New Roman', 'Courier New', 'Noto Sans'];
const TEXT_STYLES = ['regular', 'bold', 'italic', 'bold-italic'] as const;
type TextStyle = typeof TEXT_STYLES[number];

export interface SubtitleOutputOptions {
    subtitleFormat: 'srt' | 'ass';
    mainColor: string;
    transColor: string;
    mainFont: string;
    transFont: string;
    mainTextStyle: TextStyle;
    transTextStyle: TextStyle;
    mainFontSize: number;
    transFontSize: number;
    verticalPosition: number;
}

export const subtitleOutputConfig: NonNullable<Manifest['config']> = [
    {
        key: 'subtitleFormat', type: 'select', title: 'Subtitle format',
        section: 'Subtitle Appearance (optional)', default: 'srt',
        options: [{ value: 'srt', label: 'SRT (default)' }, { value: 'ass', label: 'ASS (styled subtitles)' }],
        description: 'Choose ASS to customize colors, fonts, text styles, sizes and vertical position. Requires a player with ASS styling support; player overrides may still apply. SRT keeps the existing appearance.'
    },
    { key: 'mainColor', type: 'color', title: 'Main language color', default: '#FFFFFF' },
    { key: 'mainFont', type: 'select', title: 'Main language font', options: FONTS, default: 'Arial' },
    {
        key: 'mainFontSize', type: 'number', title: 'Main language font size', default: '48',
        min: 16, max: 144, step: 1,
        description: '16–144 (default 48). Scales with the video size.'
    },
    {
        key: 'mainTextStyle', type: 'select', title: 'Main language text style', default: 'bold',
        options: TEXT_STYLES.map(value => ({ value, label: value === 'bold-italic' ? 'Bold italic' : value[0].toUpperCase() + value.slice(1) }))
    },
    { key: 'transColor', type: 'color', title: 'Translation language color', default: '#FFFF00' },
    {
        key: 'transFont', type: 'select', title: 'Translation language font', options: FONTS, default: 'Arial',
        description: 'Fonts must be available on the playback device; otherwise the player selects a fallback.'
    },
    {
        key: 'transFontSize', type: 'number', title: 'Translation language font size', default: '48',
        min: 16, max: 144, step: 1,
        description: '16–144 (default 48). Scales with the video size.'
    },
    {
        key: 'transTextStyle', type: 'select', title: 'Translation language text style', default: 'italic',
        options: TEXT_STYLES.map(value => ({ value, label: value === 'bold-italic' ? 'Bold italic' : value[0].toUpperCase() + value.slice(1) }))
    },
    {
        key: 'verticalPosition', type: 'number', title: 'Distance from bottom (%)', default: '4',
        min: 0, max: 80, step: 1,
        description: 'Moves both languages together. 0–80% (default 4%). Higher values move subtitles up.'
    }
];

// Normalize both URL configuration and signed lazy payloads. Only fixed font and
// style choices, RGB colors and bounded numbers can reach ASS headers or filenames.
export function getSubtitleOutputOptions(config: any = {}): SubtitleOutputOptions {
    const color = (value: unknown, fallback: string): string =>
        typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value) ? value.toUpperCase() : fallback;
    const font = (value: unknown): string =>
        typeof value === 'string' && FONTS.includes(value) ? value : 'Arial';
    const style = (value: unknown, fallback: TextStyle): TextStyle =>
        TEXT_STYLES.includes(value as TextStyle) ? value as TextStyle : fallback;
    const number = (value: unknown, fallback: number, min: number, max: number): number => {
        if ((typeof value !== 'number' && typeof value !== 'string') || String(value).trim() === '') return fallback;
        const parsed = Number(value);
        return Number.isFinite(parsed) ? Math.max(min, Math.min(max, Math.round(parsed))) : fallback;
    };
    return {
        subtitleFormat: config?.subtitleFormat === 'ass' ? 'ass' : 'srt',
        mainColor: color(config?.mainColor, '#FFFFFF'),
        transColor: color(config?.transColor, '#FFFF00'),
        mainFont: font(config?.mainFont),
        transFont: font(config?.transFont),
        mainTextStyle: style(config?.mainTextStyle, 'bold'),
        transTextStyle: style(config?.transTextStyle, 'italic'),
        mainFontSize: number(config?.mainFontSize, 48, 16, 144),
        transFontSize: number(config?.transFontSize, 48, 16, 144),
        verticalPosition: number(config?.verticalPosition, 4, 0, 80)
    };
}

export function subtitleFileExtension(options: SubtitleOutputOptions): string {
    if (options.subtitleFormat !== 'ass') return '.srt';
    // Preserve all existing SRT names. ASS files vary with every appearance
    // setting; the revision allows future changes to the generated ASS layout.
    const fontKey = (font: string) => font.replace(/ /g, '-');
    return `_ass3-${options.mainColor.slice(1)}-${fontKey(options.mainFont)}-${options.mainTextStyle}-${options.mainFontSize}`
        + `-${options.transColor.slice(1)}-${fontKey(options.transFont)}-${options.transTextStyle}-${options.transFontSize}`
        + `-y${options.verticalPosition}.ass`;
}

export function subtitleContentType(fileName: string): string {
    return fileName.endsWith('.ass') ? 'text/x-ssa; charset=utf-8' : 'text/srt; charset=utf-8';
}

export function formatAss(cues: SubtitleCue[], options: SubtitleOutputOptions): string {
    const assColor = (rgb: string): string => `&H00${rgb.slice(5, 7)}${rgb.slice(3, 5)}${rgb.slice(1, 3)}`;
    const marginV = Math.round(1080 * options.verticalPosition / 100);
    const styleLine = (name: string, font: string, color: string, style: TextStyle, size: number): string =>
        `Style: ${name},${font},${size},${assColor(color)},&H000000FF,&H00000000,&H80000000,`
        + `${style.includes('bold') ? -1 : 0},${style.includes('italic') ? -1 : 0},0,0,100,100,0,0,1,2,1,2,40,40,${marginV},1`;
    const time = (centiseconds: number): string => {
        const h = Math.floor(centiseconds / 360000);
        const m = Math.floor(centiseconds / 6000) % 60;
        const s = Math.floor(centiseconds / 100) % 60;
        return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(centiseconds % 100).padStart(2, '0')}`;
    };
    // Merged text is already sanitized. Neutralize literal ASS control syntax
    // too, so text from a provider cannot override the selected appearance.
    const text = (value: string): string => value
        .replace(/\\/g, '＼').replace(/\{/g, '｛').replace(/\}/g, '｝').replace(/\r\n|\r|\n/g, '\\N');
    const lines = [
        '[Script Info]', 'ScriptType: v4.00+', 'PlayResX: 1920', 'PlayResY: 1080',
        'WrapStyle: 0', 'ScaledBorderAndShadow: yes', '', '[V4+ Styles]',
        'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
        styleLine('Main', options.mainFont, options.mainColor, options.mainTextStyle, options.mainFontSize),
        styleLine('Translation', options.transFont, options.transColor, options.transTextStyle, options.transFontSize),
        '', '[Events]', 'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text'
    ];
    const events: Array<{ start: number; end: number; main: string[]; translation: string[] }> = [];
    for (const cue of cues) {
        const startMs = parseSrtTimeToMs(cue.startTime);
        const endMs = parseSrtTimeToMs(cue.endTime);
        if (startMs === null || endMs === null || endMs <= startMs) continue;
        const main = text(cue.mainText || '');
        const translation = text(cue.transText || '');
        if (!main && !translation) continue;
        // Use the same rounding for both boundaries so touching cues stay
        // touching when milliseconds are reduced to ASS centiseconds.
        const start = Math.round(startMs / 10);
        const end = Math.max(start + 1, Math.round(endMs / 10));
        events.push({ start, end, main: main ? [main] : [], translation: translation ? [translation] : [] });
    }
    events.sort((a, b) => a.start - b.start);

    // Multiple cues may share a start (including after rounding). Keep their
    // text in one event, rather than clipping one of them to zero duration.
    const grouped: typeof events = [];
    for (const event of events) {
        const previous = grouped[grouped.length - 1];
        if (previous && previous.start === event.start) {
            previous.end = Math.max(previous.end, event.end);
            for (const part of event.main) {
                if (!previous.main.includes(part)) previous.main.push(part);
            }
            for (const part of event.translation) {
                if (!previous.translation.includes(part)) previous.translation.push(part);
            }
        } else {
            grouped.push(event);
        }
    }

    // Explicit positioning stops ASS renderers from retaining an upward
    // collision offset. Clip overlaps too, so cues replace each other instead
    // of being drawn on top of one another at the fixed position.
    const position = `{\\an2\\pos(960,${1080 - marginV})}`;
    for (let i = 0; i < grouped.length; i++) {
        const event = grouped[i];
        const next = grouped[i + 1];
        const end = next ? Math.min(event.end, next.start) : event.end;
        const main = event.main.join('\\N');
        const translation = event.translation.join('\\N');
        const content = main && translation ? `${main}\\N{\\rTranslation}${translation}` : main || translation;
        lines.push(`Dialogue: 0,${time(event.start)},${time(end)},${main ? 'Main' : 'Translation'},,0,0,0,,${position}${content}`);
    }
    return lines.join('\n') + '\n';
}
