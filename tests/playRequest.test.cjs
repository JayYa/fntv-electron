const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const { isPlayRequest } = require('../dest/modules/playback/playRequest.js');
const { useFakeElectron } = require('./helpers/fakeElectron.cjs');
const { fakeIpcMain } = require('./helpers/fakeIpc.cjs');

function loadPlayMovieHandler(t) {
    const ipc = fakeIpcMain();
    const electron = {
        app: { getPath: () => os.tmpdir(), commandLine: { getSwitchValue: () => '' }, getAppPath: () => os.tmpdir(), isPackaged: false, on() {}, setPath() {} },
        dialog: {},
        ipcMain: ipc.ipcMain,
        safeStorage: {},
        session: {},
    };
    useFakeElectron(t, electron);

    const config = require('../dest/modules/fn_config/loginStore.js');
    const originalRead = config.readCurrentLogin;
    let configReads = 0;
    config.readCurrentLogin = () => {
        configReads += 1;
        return null;
    };
    t.after(() => {
        config.readCurrentLogin = originalRead;
    });

    ipc.register(require('../dest/main/ipc/playback.js').playbackHandlers);
    return { play: (request) => ipc.invoke('play-movie', request, { from: 'webUi' }), configReads: () => configReads };
}

test('accepts a request with an item id', () => {
    assert.equal(isPlayRequest({ id: 'abc', sourceIndex: 0 }), true);
    assert.equal(isPlayRequest({ id: 'abc', sourceIndex: 0, restart: true }), true);
});

test('rejects requests without a usable item id', () => {
    for (const request of [undefined, null, 'abc', 1, {}, { id: '' }, { id: '  ' }, { id: 1 }]) {
        assert.equal(isPlayRequest(request), false, JSON.stringify(request));
    }
});

test('play-movie ignores invalid requests before starting playback', async t => {
    const { play, configReads } = loadPlayMovieHandler(t);

    await assert.rejects(play(undefined), /参数不合法/);
    await assert.rejects(play({}), /参数不合法/);

    assert.equal(configReads(), 0);
});
