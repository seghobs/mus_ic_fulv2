const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

test('account data loads only after background login finishes', async () => {
    let onLoad, finish;
    const calls = [];
    const pending = new Promise(resolve => { finish = resolve; });
    const context = {
        window: { addEventListener: (_, callback) => { onLoad = callback; } },
        document: { getElementById: () => ({ textContent: '' }) },
        fetch: async (url, options) => {
            assert.equal(url, '/api/session/refresh');
            assert.equal(options.method, 'POST');
            await pending;
            return { ok: true, json: async () => ({ ok: true }) };
        },
        loadRights: () => calls.push('rights'),
        loadAllSongs: () => calls.push('songs'),
        loadActiveTasks: () => calls.push('tasks'),
    };
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../static/js/init.js'), 'utf8'), context);
    const loading = onLoad();
    assert.deepEqual(calls, []);
    finish();
    await loading;
    assert.deepEqual(calls, ['tasks', 'rights', 'songs']);
});

test('failed refresh does not load account data with an expired token', async () => {
    let onLoad;
    const calls = [];
    const context = {
        window: { addEventListener: (_, callback) => { onLoad = callback; } },
        document: { getElementById: () => ({ textContent: '' }) },
        fetch: async () => ({ ok: false, json: async () => ({ ok: false, error: 'Login failed' }) }),
        loadRights: () => calls.push('rights'), loadAllSongs: () => calls.push('songs'),
        loadActiveTasks: () => calls.push('tasks'), initSSE: () => calls.push('events'),
    };
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../static/js/init.js'), 'utf8'), context);
    await onLoad();
    assert.deepEqual(calls, []);
});
