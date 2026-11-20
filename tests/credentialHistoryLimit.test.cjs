const test = require('node:test');
const assert = require('node:assert/strict');
const {
    setupConfig,
    logInWithHistory,
    readHistoryWithCredentials,
} = require('./helpers/credentialConfig.cjs');

async function addHistoryEntries(config, names) {
    for (const name of names) {
        await logInWithHistory(config, { domain: `${name}.example`, account: name, password: `${name}-password` });
    }
}

const historyAccounts = async (config) => (await readHistoryWithCredentials(config)).map((item) => item.account);

test('the history limit evicts readable entries before undecryptable ones', async (t) => {
    const { loadStores, undecryptable } = setupConfig(t);
    const config = loadStores();
    await addHistoryEntries(config, ['oldest', 'b', 'c', 'd', 'e']);

    undecryptable.add('oldest-password');
    await addHistoryEntries(config, ['f', 'g']);

    undecryptable.clear();
    assert.deepEqual(await historyAccounts(config), ['g', 'f', 'e', 'd', 'oldest']);
    assert.equal((await readHistoryWithCredentials(config))[4].password, 'oldest-password');
});

test('a history entry with only an undecryptable access code is also evicted last', async (t) => {
    const { loadStores, undecryptable } = setupConfig(t);
    const config = loadStores();
    await logInWithHistory(config, { domain: 'kept.example', account: 'kept', password: 'kept-password', accessCode: 'kept-code' });
    await addHistoryEntries(config, ['b', 'c', 'd', 'e']);

    undecryptable.add('kept-code');
    await addHistoryEntries(config, ['f']);

    undecryptable.clear();
    assert.deepEqual(await historyAccounts(config), ['f', 'e', 'd', 'c', 'kept']);
});

test('a new login stays in history when every other entry is undecryptable', async (t) => {
    const { loadStores, undecryptable } = setupConfig(t);
    const config = loadStores();
    const names = ['a', 'b', 'c', 'd', 'e'];
    await addHistoryEntries(config, names);

    names.forEach((name) => undecryptable.add(`${name}-password`));
    await addHistoryEntries(config, ['new']);

    undecryptable.clear();
    assert.deepEqual(await historyAccounts(config), ['new', 'e', 'd', 'c', 'b']);
});

test('the history limit still drops the oldest entry when everything is readable', async (t) => {
    const { loadStores } = setupConfig(t);
    const config = loadStores();

    await addHistoryEntries(config, ['a', 'b', 'c', 'd', 'e', 'f']);

    assert.deepEqual(await historyAccounts(config), ['f', 'e', 'd', 'c', 'b']);
});
