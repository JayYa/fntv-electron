const test = require('node:test');
const assert = require('node:assert/strict');
const { useFakeElectron, useFakeModule } = require('./helpers/fakeElectron.cjs');

const HOST_PLATFORM = process.platform;
const REAL_ELECTRON = require('electron');

test('replacing electron twice in one test uses the later fake', (t) => {
    useFakeElectron(t, { name: 'first launch' }, { platform: 'linux' });
    useFakeElectron(t, { name: 'second launch' }, { platform: 'darwin' });
    useFakeModule(t, 'electron-updater', { name: 'updater' });

    assert.equal(require('electron').name, 'second launch');
    assert.equal(require('electron-updater').name, 'updater');
    assert.equal(process.platform, 'darwin');
});

test('nothing from the previous test is left behind', () => {
    assert.equal(require('electron'), REAL_ELECTRON);
    assert.equal(process.platform, HOST_PLATFORM);
});
