import assert from 'node:assert/strict';
import {
    mergeSubtitlesByTime,
    rankSubtitleCandidates
} from '../src/subtitleMatching.ts';

const cue = (id, startTime, endTime, text) => ({ id, startTime, endTime, text });

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

console.log('subtitleMatching tests passed');
