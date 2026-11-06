const test = require('node:test');
const assert = require('node:assert/strict');
const {
    setupConfig,
} = require('./helpers/credentialConfig.cjs');

function addHistoryEntries(config, names) {
    names.forEach((name) => config.addHistory({ domain: `${name}.example`, account: name, password: `${name}-password` }));
}

const historyAccounts = (config) => config.getHistory().map((item) => item.account);

test('the history limit evicts readable entries before undecryptable ones', (t) => {
    const { loadConfig, undecryptable } = setupConfig(t);
    const config = loadConfig();
    addHistoryEntries(config, ['oldest', 'b', 'c', 'd', 'e']);

    undecryptable.add('oldest-password');
    addHistoryEntries(config, ['f', 'g']);

    undecryptable.clear();
    assert.deepEqual(historyAccounts(config), ['g', 'f', 'e', 'd', 'oldest']);
    assert.equal(config.getHistory()[4].password, 'oldest-password');
});

test('a history entry with only an undecryptable access code is also evicted last', (t) => {
    const { loadConfig, undecryptable } = setupConfig(t);
    const config = loadConfig();
    config.addHistory({ domain: 'kept.example', account: 'kept', password: 'kept-password', accessCode: 'kept-code' });
    addHistoryEntries(config, ['b', 'c', 'd', 'e']);

    undecryptable.add('kept-code');
    addHistoryEntries(config, ['f']);

    undecryptable.clear();
    assert.deepEqual(historyAccounts(config), ['f', 'e', 'd', 'c', 'kept']);
});

test('a new login stays in history when every other entry is undecryptable', (t) => {
    const { loadConfig, undecryptable } = setupConfig(t);
    const config = loadConfig();
    const names = ['a', 'b', 'c', 'd', 'e'];
    addHistoryEntries(config, names);

    names.forEach((name) => undecryptable.add(`${name}-password`));
    addHistoryEntries(config, ['new']);

    undecryptable.clear();
    assert.deepEqual(historyAccounts(config), ['new', 'e', 'd', 'c', 'b']);
});

test('the history limit still drops the oldest entry when everything is readable', (t) => {
    const { loadConfig } = setupConfig(t);
    const config = loadConfig();

    addHistoryEntries(config, ['a', 'b', 'c', 'd', 'e', 'f']);

    assert.deepEqual(historyAccounts(config), ['f', 'e', 'd', 'c', 'b']);
});
