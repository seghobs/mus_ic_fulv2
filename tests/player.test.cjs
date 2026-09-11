const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function player() {
    const instances = [];
    class Audio {
        constructor() { instances.push(this); this.playCalls = 0; }
        play() { this.playCalls++; return Promise.resolve(); }
        pause() {}
    }
    const context = vm.createContext({
        Audio, fpAudio: null, fpCurrentId: null,
        knownSongs: { song1: { audio_url: 'https://cdn.example.test/song1.mp3' } },
        localStorage: { getItem: () => null },
        document: { getElementById: () => null, addEventListener() {},
            body: { classList: { add() {} } } },
    });
    vm.runInContext(fs.readFileSync(path.join(__dirname, '../static/js/player.js'), 'utf8'), context);
    return { context, instances };
}

test('play click starts CDN audio immediately while keeping library identity', () => {
    const { context, instances } = player();
    context.playLocalSong('song1', 'Song');
    assert.equal(instances[0].src, 'https://cdn.example.test/song1.mp3');
    assert.equal(instances[0].playCalls, 1);
    assert.equal(context.fpCurrentId, '/api/download/song1');
});

test('missing URL uses streaming fallback and old saved download URLs migrate', () => {
    const { context } = player();
    assert.equal(context.playbackSource('/api/download/missing'), '/api/stream/missing');
    assert.equal(context.playbackSource('http://localhost:5000/api/download/song1'), 'https://cdn.example.test/song1.mp3');
    assert.equal(context.playbackSource('blob:local-audio'), 'blob:local-audio');
});

test('media failure is visible once and stale audio errors are ignored', () => {
    const {context,instances} = player();
    let messages=0;
    context.showNotification=()=>messages++;
    context.playLocalSong('song1','Test');
    instances[0].onerror();
    instances[0].onerror();
    assert.equal(messages,1);
    context.playLocalSong('song1','Next');
    instances[0].onerror();
    assert.equal(messages,1);
});

test('YouTube starts in the existing audio player via yt-dlp', () => {
    const {context,instances} = player();
    context.playYtVideo('abcdefghijk','Song');
    assert.equal(instances.length,1);
    assert.equal(instances[0].src,'/api/yt-play/abcdefghijk');
    assert.equal(instances[0].playCalls,1);
    context.playYtVideo('invalid','Song');
    assert.equal(instances.length,1);
});
