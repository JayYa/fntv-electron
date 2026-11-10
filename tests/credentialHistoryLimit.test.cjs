const test = require('node:test');
const assert = require('node:assert/strict');
const {
    setupConfig,
} = require('./helpers/credentialConfig.cjs');

async function addHistoryEntries(config, names) {
    for (const name of names) {
        await config.addHistory({ domain: `${name}.example`, account: name, password: `${name}-password` });
    }
}

const historyAccounts = async (config) => (await config.getHistory()).map((item) => item.account);

test('the history limit evicts readable entries before undecryptable ones', async (t) => {
    const { loadConfig, undecryptable } = setupConfig(t);
    const config = loadConfig();
    await addHistoryEntries(config, ['oldest', 'b', 'c', 'd', 'e']);

    undecryptable.add('oldest-password');
    await addHistoryEntries(config, ['f', 'g']);

    undecryptable.clear();
    assert.deepEqual(await historyAccounts(config), ['g', 'f', 'e', 'd', 'oldest']);
    assert.equal((await config.getHistory())[4].password, 'oldest-password');
});

test('a history entry with only an undecryptable access code is also evicted last', async (t) => {
    const { loadConfig, undecryptable } = setupConfig(t);
    const config = loadConfig();
    await config.addHistory({ domain: 'kept.example', account: 'kept', password: 'kept-password', accessCode: 'kept-code' });
    await addHistoryEntries(config, ['b', 'c', 'd', 'e']);

    undecryptable.add('kept-code');
    await addHistoryEntries(config, ['f']);

    undecryptable.clear();
    assert.deepEqual(await historyAccounts(config), ['f', 'e', 'd', 'c', 'kept']);
});

test('a new login stays in history when every other entry is undecryptable', async (t) => {
    const { loadConfig, undecryptable } = setupConfig(t);
    const config = loadConfig();
    const names = ['a', 'b', 'c', 'd', 'e'];
    await addHistoryEntries(config, names);

    names.forEach((name) => undecryptable.add(`${name}-password`));
    await addHistoryEntries(config, ['new']);

    undecryptable.clear();
    assert.deepEqual(await historyAccounts(config), ['new', 'e', 'd', 'c', 'b']);
});

test('the history limit still drops the oldest entry when everything is readable', async (t) => {
    const { loadConfig } = setupConfig(t);
    const config = loadConfig();

    await addHistoryEntries(config, ['a', 'b', 'c', 'd', 'e', 'f']);

    assert.deepEqual(await historyAccounts(config), ['f', 'e', 'd', 'c', 'b']);
});
