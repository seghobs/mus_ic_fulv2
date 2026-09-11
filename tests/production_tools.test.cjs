const {test} = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');

function setup(results, fail = false) {
    let refreshes = 0, scheduled = 0;
    const element = () => ({replaceChildren(){}, appendChild(){}, className:'', textContent:'', dataset:{}});
    const context = vm.createContext({
        document: {getElementById: element, createElement: element},
        localStorage: {setItem(){}}, Date, URLSearchParams,
        setTimeout: () => {scheduled++;}, clearTimeout(){},
        featureRequest: async () => {if (fail) throw Error('Account changed'); return {results};},
        loadAllSongs: () => {refreshes++;}
    });
    vm.runInContext(fs.readFileSync('static/js/production_tools.js', 'utf8'), context);
    vm.runInContext("productionAccount='a'; productionJobs=[{ids:['a','b'],name:'Test',state:'pending',started:Date.now()}]", context);
    return {context, refreshes: () => refreshes, scheduled: () => scheduled};
}

test('partial and unrelated task results never finish production', async () => {
    const t = setup([{song_id:'a',ready:true,status:2}, {song_id:'other',ready:true,status:2}]);
    await vm.runInContext('refreshProductionJobs()', t.context);
    assert.equal(vm.runInContext('productionJobs[0].state', t.context), 'pending');
    assert.equal(t.refreshes(), 0);
    assert.equal(t.scheduled(), 1);
});

test('all expected ready songs complete and refresh library once', async () => {
    const t = setup([{song_id:'b',ready:true,status:2}, {song_id:'a',ready:true,status:0}]);
    await vm.runInContext('refreshProductionJobs()', t.context);
    assert.equal(vm.runInContext('productionJobs[0].state', t.context), 'done');
    assert.equal(t.refreshes(), 1);
    assert.equal(t.scheduled(), 0);
});

test('account and network errors pause polling without submitting again', async () => {
    const t = setup([], true);
    await vm.runInContext('refreshProductionJobs()', t.context);
    assert.equal(vm.runInContext('productionJobs[0].error', t.context), 'Account changed');
    assert.equal(t.scheduled(), 0);
});

test('failed task is kept visible and does not report completion', async () => {
    const t = setup([{song_id:'b',status:3}]);
    await vm.runInContext('refreshProductionJobs()', t.context);
    assert.equal(vm.runInContext('productionJobs[0].state', t.context), 'failed');
    assert.equal(t.refreshes(), 0);
});

test('verified SSE tracks each variant, rejects other accounts and completes once', () => {
    const t = setup([]);
    t.context.handleProductionReady({account:'other',song_id:'a'});
    t.context.handleProductionReady({account:'a',song_id:'b'});
    assert.equal(vm.runInContext('productionJobs[0].state', t.context), 'pending');
    t.context.handleProductionReady({account:'a',song_id:'a'});
    assert.equal(vm.runInContext('productionJobs[0].state', t.context), 'done');
});

test('numeric task IDs match completed UUID songs in production tools', async () => {
    const t = setup([{id:'a',song_id:'uuid-a',ready:true,status:0},{id:'b',song_id:'uuid-b',ready:true,status:0}]);
    await vm.runInContext('refreshProductionJobs()', t.context);
    assert.equal(vm.runInContext('productionJobs[0].state', t.context), 'done');
});
