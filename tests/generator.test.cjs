const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '../static/js/generator.js'), 'utf8');

async function runPoll(results, expected = ['a', 'b']) {
    let refreshes = 0, downloads = 0;
    const elements = {};
    const card = { id: 'task_1', style: {}, querySelector: key =>
        elements[key] ||= { style: {}, className: '', innerHTML: '' } };
    const context = vm.createContext({
        document: { getElementById: () => card },
        activeTasks: { task_1: {} }, saveActiveTasks() {},
        loadAllSongs() { refreshes++; }, setTimeout() {},
        sleep: async () => {},
        fetch: async url => {
            if (url.startsWith('/api/check-download/')) {
                downloads++;
                return { ok: true, json: async () => ({ ready: true }) };
            }
            return { ok: true, json: async () => ({ data: { result: results } }) };
        }
    });
    vm.runInContext(source, context);
    await context.pollForTask('task_1', expected);
    return { refreshes, downloads, context };
}

test('empty, partial, duplicate and unrelated results never complete', async () => {
    for (const results of [[], [{ song_id: 'a', status: 0 }],
        [{ song_id: 'a', status: 0 }, { song_id: 'a', status: 0 }],
        [{ song_id: 'x', status: 0 }, { song_id: 'y', status: 0 }]]) {
        const result = await runPoll(results);
        assert.equal(result.refreshes, 0);
        assert.equal(result.downloads, 0);
    }
});

test('all expected songs complete without waiting for CDN download availability', async () => {
    const result = await runPoll([{ song_id: 'b', status: 0 }, { song_id: 'a', status: 0 }]);
    assert.equal(result.refreshes, 1);
    assert.equal(result.downloads, 0);
    assert.equal(await result.context.checkCDNReady([]), false);
});

test('pending or failed songs never complete', async () => {
    for (const status of [1, 3]) {
        const result = await runPoll([{ song_id: 'a', status: 0 }, { song_id: 'b', status }]);
        assert.equal(result.refreshes, 0);
        assert.equal(result.downloads, 0);
    }
});

test('SSE completes all variants during an in-flight poll and ignores its stale response', async () => {
    let reply, refreshes = 0;
    const elements = {};
    const card = {style: {}, querySelector: key => elements[key] ||= {style: {}}};
    const context = vm.createContext({
        document: {getElementById: () => card},
        activeTasks: {task_1: {}}, saveActiveTasks() {},
        loadAllSongs() {refreshes++;}, setTimeout() {},
        fetch: () => new Promise(resolve => {reply = resolve;})
    });
    vm.runInContext(source, context);
    const pending = context.pollForTask('task_1', ['a', 'b']);
    context.handleGenerationReady({song_id:'other'});
    context.handleGenerationReady({song_id:'a'});
    context.handleGenerationReady({song_id:'a'});
    assert.equal(refreshes, 0);
    context.handleGenerationReady({song_id:'b'});
    assert.equal(refreshes, 1);
    assert.equal(elements['.ct-bar'].style.width, '100%');
    assert.match(elements['.fa-spinner'].className, /circle-check/);
    assert.equal(context.activeTasks.task_1, undefined);
    context.handleGenerationReady({song_id:'b'});
    reply({ok:true, json:async () => ({data:{result:[{song_id:'a',status:3}]}})});
    await pending;
    assert.equal(refreshes, 1);
    assert.equal(elements['.ct-bar'].style.width, '100%');
});

test('numeric task IDs match UUID song results', async () => {
    const result = await runPoll([{id:'123', song_id:'uuid-a',status:0}, {id:'124',song_id:'uuid-b',status:0}], ['123','124']);
    assert.equal(result.refreshes, 1);
    assert.equal(result.downloads, 0);
});

test('successful submission closes confirmation; double clicks send only one request', async () => {
    let respond, calls = 0;
    const hidden = {};
    const elements = {};
    const element = id => elements[id] ||= {
        innerHTML: 'Create', style: {},
        classList: {toggle: (name, value) => {hidden[id] = value;}},
        focus(){}, scrollIntoView(){}, prepend(){},
        querySelector: () => ({style:{}})
    };
    const context = vm.createContext({
        document:{getElementById:element, createElement:() => element('card')},
        state:{title:'Test'}, activeTaskCounter:0, activeTasks:{}, saveActiveTasks(){},
        fetch:() => {calls++; return new Promise(resolve => {respond = resolve;});}
    });
    vm.runInContext(source, context);
    vm.runInContext('pollForTask = () => {};', context);
    const first = context.createSong();
    await context.createSong();
    assert.equal(calls, 1);
    assert.equal(elements.createBtn.disabled, true);
    respond({ok:true, json:async () => ({data:{song_ids:['123']}})});
    await first;
    assert.equal(hidden.generationConfirmation, true);
    assert.equal(hidden.generationTracking, false);
    await context.createSong();
    assert.equal(calls, 1);
    context.setGenerationSubmitted(false);
    assert.equal(hidden.generationConfirmation, false);
});
