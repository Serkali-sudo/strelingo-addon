export const ASS_ANIMATIONS = ['none', 'fade', 'pop', 'character-pop', 'glow-wave'] as const;
export type AssAnimation = typeof ASS_ANIMATIONS[number];

export function getAssAnimation(value: unknown): AssAnimation {
    return ASS_ANIMATIONS.includes(value as AssAnimation) ? value as AssAnimation : 'none';
}

// One line-level fade, shared by both languages. Very brief cues stay static.
export function assFadeTags(animation: AssAnimation, durationMs: number): string {
    if (animation === 'none' || durationMs < 300) return '';
    const edge = Math.min(120, Math.floor(durationMs / 6));
    return `{\\fad(${animation === 'fade' ? edge : 0},${edge})}`;
}

let segmenter: Intl.Segmenter | undefined;

// Accept only escaped subtitle text, with literal \N separators. Effects stay
// inside one Dialogue event; no additional layers or positioned glyph events.
export function animateAssText(value: string, animation: AssAnimation, durationMs: number, color: string): string {
    if (!value || animation === 'none' || animation === 'fade' || durationMs < 300) return value;
    const intro = Math.min(180, Math.floor(durationMs / 4));
    const peak = Math.max(1, Math.floor(intro / 2));
    const pop = `{\\fscx85\\fscy85\\t(0,${peak},\\fscx110\\fscy110)\\t(${peak},${intro},\\fscx100\\fscy100)}${value}`;
    if (animation === 'pop') return pop;
    // Preserve readability during fast dialogue; use just the line-level fade.
    if (durationMs < 700) return value;

    // Character overrides can disturb joining and complex-script shaping.
    // Use a whole-run pop for those scripts, unavailable segmentation, or long
    // text. Segment graphemes so accents and emoji aren't split into code points.
    const simpleScripts = /^[\p{Script=Latin}\p{Script=Greek}\p{Script=Cyrillic}\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}\p{Script=Common}\p{Script=Inherited}]*$/u;
    if (value.length > 320 || !simpleScripts.test(value) || typeof Intl.Segmenter !== 'function') return pop;
    const graphemeSegmenter = segmenter ??= new Intl.Segmenter(undefined, { granularity: 'grapheme' });
    const lines = value.split('\\N').map(line => Array.from(graphemeSegmenter.segment(line), part => part.segment));
    const count = lines.reduce((sum, line) => sum + line.filter(char => char.trim()).length, 0);
    if (count > 160) return pop;

    const animationWindow = Math.min(360, Math.floor(durationMs / 4));
    const stagger = Math.floor(animationWindow / 2);
    const rise = Math.max(1, Math.floor(animationWindow / 4));
    const glowColor = `&H${color.slice(5, 7)}${color.slice(3, 5)}${color.slice(1, 3)}&`;
    let index = 0;
    return lines.map(line => line.map(char => {
        if (!char.trim()) return char;
        const start = Math.round(stagger * index++ / Math.max(1, count - 1));
        const middle = start + rise;
        const end = middle + rise;
        if (animation === 'character-pop') {
            return `{\\alpha&HFF&\\fscx75\\fscy75`
                + `\\t(${start},${middle},\\alpha&H00&\\fscx110\\fscy110)`
                + `\\t(${middle},${end},\\fscx100\\fscy100)}${char}`;
        }
        return `{\\bord2\\blur0\\3c&H000000&`
            + `\\t(${start},${middle},\\bord4\\blur1.5\\3c${glowColor})`
            + `\\t(${middle},${end},\\bord2\\blur0\\3c&H000000&)}${char}`;
    }).join('')).join('\\N');
}
