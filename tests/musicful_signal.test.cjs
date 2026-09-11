const {test} = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');

function setup() {
    const listeners = new Map();
    let timeout, cleared = false;
    const ctx = vm.createContext({
        document: {addEventListener(){}},
        setTimeout: cb => {timeout = cb; return 1;},
        clearTimeout: () => {cleared = true;},
        window: {addEventListener: (name, cb) => listeners.set(name, cb), removeEventListener: name => listeners.delete(name)}
    });
    vm.runInContext(fs.readFileSync('static/js/globals.js', 'utf8'), ctx);
    return {ctx, listeners, timeout: () => timeout(), cleared: () => cleared};
}

test('ready notification wakes only the matching waiting production', async () => {
    const t = setup();
    let done = false;
    const pending = vm.runInContext("waitForMusicfulSignal(['song-a'],5000)", t.ctx).then(() => {done = true;});
    t.listeners.get('musicful-song-ready')({detail:{song_id:'other'}});
    await Promise.resolve();
    assert.equal(done, false);
    t.listeners.get('musicful-song-ready')({detail:{song_id:'song-a'}});
    await pending;
    assert.equal(t.cleared(), true);
    assert.equal(t.listeners.size, 0);
});

test('without SSE, timeout resumes fallback polling and removes listener', async () => {
    const t = setup();
    const pending = vm.runInContext("waitForMusicfulSignal(['song-a'],5000)", t.ctx);
    t.timeout();
    await pending;
    assert.equal(t.listeners.size, 0);
});

test('SSE aliases wake numeric task waiters', async () => {
    const t = setup();
    const pending = vm.runInContext("waitForMusicfulSignal(['123'],5000)", t.ctx);
    t.listeners.get('musicful-song-ready')({detail:{song_id:'uuid',ids:['uuid','123']}});
    await pending;
    assert.equal(t.cleared(), true);
});
