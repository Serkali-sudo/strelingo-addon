import assert from 'node:assert/strict';
import {
    mergeSubtitlesByTime,
    rankSubtitleCandidates,
    sanitizeSubtitleText
} from '../src/subtitleMatching.ts';

const cue = (id, startTime, endTime, text) => ({ id, startTime, endTime, text });

const toSrtTime = (ms) => {
    const hh = String(Math.floor(ms / 3600000)).padStart(2, '0');
    const mm = String(Math.floor(ms / 60000) % 60).padStart(2, '0');
    const ss = String(Math.floor(ms / 1000) % 60).padStart(2, '0');
    const mmm = String(ms % 1000).padStart(3, '0');
    return `${hh}:${mm}:${ss},${mmm}`;
};

{
    const merged = mergeSubtitlesByTime(
        [cue('1', '00:00:10,000', '00:00:14,000', '<b>Hello</b>\nworld')],
        [
            cue('1', '00:00:10,500', '00:00:11,500', 'Hola'),
            cue('2', '00:00:12,000', '00:00:13,500', 'mundo')
        ]
    );

    assert.equal(merged.length, 1);
    assert.equal(merged[0].text, '<b>Hello world</b>\n<i>> Hola mundo</i>');
}

{
    const merged = mergeSubtitlesByTime(
        [cue('1', '00:00:10,000', '00:00:12,000', 'Main')],
        [
            cue('1', '00:00:07,000', '00:00:08,000', 'too early'),
            cue('2', '00:00:10,100', '00:00:12,100', 'best overlap')
        ]
    );

    assert.equal(merged[0].text, '<b>Main</b>\n<i>> best overlap</i>');
}

{
    const ranked = await rankSubtitleCandidates([
        { id: 1, url: 'https://subs.example/full.srt', lang: 'eng', format: 'srt', langName: 'English', releaseName: '', rating: 0, g: 1 },
        { id: 2, url: 'https://subs.example/forced.srt', lang: 'eng', format: 'srt', langName: 'English', releaseName: '', rating: 0, g: 999 }
    ]);

    assert.equal(ranked[0].sub.id, 1);
}

{
    const merged = mergeSubtitlesByTime(
        [
            cue('1', '00:00:10,000', '00:00:12,000', 'First'),
            cue('2', '00:00:20,000', '00:00:22,000', 'Second'),
            cue('3', '00:00:30,000', '00:00:32,000', 'Third')
        ],
        [
            cue('1', '00:00:12,500', '00:00:14,500', 'Uno'),
            cue('2', '00:00:22,500', '00:00:24,500', 'Dos'),
            cue('3', '00:00:32,500', '00:00:34,500', 'Tres')
        ]
    );

    assert.equal(merged[0].text, '<b>First</b>\n<i>> Uno</i>');
    assert.equal(merged[1].text, '<b>Second</b>\n<i>> Dos</i>');
    assert.equal(merged[2].text, '<b>Third</b>\n<i>> Tres</i>');
}

{
    const ranked = await rankSubtitleCandidates([
        { id: 1, url: 'https://subs.example/one.srt', lang: 'eng', format: 'srt', langName: 'English', releaseName: '', rating: 0, g: 0 },
        { id: 2, url: 'https://subs.example/two.srt', lang: 'eng', format: 'srt', langName: 'English', releaseName: '', rating: 0, g: 0 }
    ], {
        videoFilename: 'Movie.Name.2024.1080p.WEB-DL.x265.mkv',
        fetchSubtitleFilename: async url => url.includes('two')
            ? 'Movie.Name.2024.1080p.WEB-DL.x265.srt'
            : 'Movie.Name.2024.DVDRip.srt'
    });

    assert.equal(ranked[0].sub.id, 2);
}

{
    const ranked = await rankSubtitleCandidates([
        { id: 1, url: 'https://subs.example/popular.srt', lang: 'eng', format: 'srt', langName: 'English', releaseName: '', rating: 0, g: 100000 },
        { id: 2, url: 'https://subs.example/matching.srt', lang: 'eng', format: 'srt', langName: 'English', releaseName: '', rating: 0, g: 0 }
    ], {
        videoFilename: 'Movie.Name.2024.1080p.WEB-DL.x265.mkv',
        fetchSubtitleFilename: async url => url.includes('matching')
            ? 'Movie.Name.2024.WEB-DL.x265.srt'
            : 'Movie.Name.2024.1080p.BluRay.x264.srt'
    });

    assert.equal(ranked[0].sub.id, 2);
}

{
    assert.equal(
        sanitizeSubtitleText('[laughing]\nMATT: You saw that?\n(laughing)\nMATT SMITH: Yeah.'),
        'You saw that? Yeah.'
    );
    assert.equal(
        sanitizeSubtitleText('(laughs) I did. This one stays (for now). [music]'),
        'I did. This one stays.'
    );
}

{
    const merged = mergeSubtitlesByTime(
        [cue('1', '00:00:10,000', '00:00:12,000', '[laughing]\nMATT: (laughs) Hello')],
        [cue('1', '00:00:10,000', '00:00:12,000', '(laughing)\nMATT SMITH: Hola')]
    );

    assert.equal(merged[0].text, '<b>Hello</b>\n<i>> Hola</i>');
}

// Boundary jitter: a translation cue that mostly covers one main cue must not
// be duplicated onto the neighbouring main cue it only brushes.
{
    const merged = mergeSubtitlesByTime(
        [
            cue('1', '00:00:10,000', '00:00:13,000', 'First main'),
            cue('2', '00:00:13,200', '00:00:16,000', 'Second main')
        ],
        [
            cue('1', '00:00:10,100', '00:00:13,600', 'Primera'),
            cue('2', '00:00:13,700', '00:00:15,900', 'Segunda')
        ]
    );

    assert.equal(merged[0].text, '<b>First main</b>\n<i>> Primera</i>');
    assert.equal(merged[1].text, '<b>Second main</b>\n<i>> Segunda</i>');
}

// A translation cue that genuinely spans two main cues still shows on both.
{
    const merged = mergeSubtitlesByTime(
        [
            cue('1', '00:00:10,000', '00:00:12,000', 'One'),
            cue('2', '00:00:12,100', '00:00:14,000', 'Two')
        ],
        [cue('1', '00:00:10,000', '00:00:14,000', 'Ambos')]
    );

    assert.equal(merged[0].text, '<b>One</b>\n<i>> Ambos</i>');
    assert.equal(merged[1].text, '<b>Two</b>\n<i>> Ambos</i>');
}

// Consecutive identical translation lines are collapsed within one entry.
{
    const merged = mergeSubtitlesByTime(
        [cue('1', '00:00:10,000', '00:00:14,000', 'Main')],
        [
            cue('1', '00:00:10,000', '00:00:11,800', 'Same line'),
            cue('2', '00:00:12,000', '00:00:13,800', 'Same line')
        ]
    );

    assert.equal(merged[0].text, '<b>Main</b>\n<i>> Same line</i>');
}

// Linear drift (23.976 vs 25 fps style) plus a constant lag: the piecewise
// alignment should recover essentially every pairing.
{
    const mains = [];
    const trans = [];
    const scale = 1.0427;
    let startMs = 10000;
    for (let i = 0; i < 120; i++) {
        const endMs = startMs + 2000;
        mains.push(cue(String(i + 1), toSrtTime(startMs), toSrtTime(endMs), `Main ${i + 1}`));
        trans.push(cue(
            String(i + 1),
            toSrtTime(Math.round(startMs * scale) + 500),
            toSrtTime(Math.round(endMs * scale) + 500),
            `Trans ${i + 1}`
        ));
        startMs = endMs + 2000 + ((i * 937) % 2500);
    }

    const merged = mergeSubtitlesByTime(mains, trans);
    assert.equal(merged.length, 120);

    let matched = 0;
    for (let i = 0; i < merged.length; i++) {
        if (merged[i].text === `<b>Main ${i + 1}</b>\n<i>> Trans ${i + 1}</i>`) matched++;
    }
    assert.ok(matched >= 110, `expected at least 110 drift-corrected matches, got ${matched}`);
}

// Already-synced files must pass through the aligner untouched: every main
// cue keeps exactly its own translation.
{
    const mains = [];
    const trans = [];
    let startMs = 5000;
    for (let i = 0; i < 40; i++) {
        const endMs = startMs + 1500 + ((i * 631) % 900);
        mains.push(cue(String(i + 1), toSrtTime(startMs), toSrtTime(endMs), `M${i + 1}`));
        trans.push(cue(String(i + 1), toSrtTime(startMs), toSrtTime(endMs), `T${i + 1}`));
        startMs = endMs + 1500 + ((i * 811) % 1200);
    }

    const merged = mergeSubtitlesByTime(mains, trans);
    assert.equal(merged.length, 40);
    for (let i = 0; i < merged.length; i++) {
        assert.equal(merged[i].text, `<b>M${i + 1}</b>\n<i>> T${i + 1}</i>`);
    }
}

// Music/lyric lines and punctuation-only leftovers are stripped.
{
    assert.equal(sanitizeSubtitleText('♪ dramatic music ♪\nRun!'), 'Run!');
    assert.equal(sanitizeSubtitleText('- [groans]\n- What?'), '- What?');
    assert.equal(sanitizeSubtitleText('[thunder]\n-'), '');
    assert.equal(sanitizeSubtitleText('# happy birthday to you #\nBlow the candles.'), 'Blow the candles.');
}

console.log('subtitleMatching tests passed');
