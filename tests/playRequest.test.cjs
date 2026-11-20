const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const { isPlayRequest } = require('../dest/modules/playback/playRequest.js');
const { useFakeElectron } = require('./helpers/fakeElectron.cjs');

function loadPlayMovieHandler(t) {
    const handlers = new Map();
    const electron = {
        app: { getPath: () => os.tmpdir(), commandLine: { getSwitchValue: () => '' }, getAppPath: () => os.tmpdir(), isPackaged: false, on() {}, setPath() {} },
        dialog: {},
        ipcMain: { on: (channel, handler) => handlers.set(channel, handler), handle() {} },
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

    require('../dest/main/handlers/plugins/media.js').init();
    return { handler: handlers.get('play-movie'), configReads: () => configReads };
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
    const { handler, configReads } = loadPlayMovieHandler(t);

    await handler({}, undefined);
    await handler({}, {});

    assert.equal(configReads(), 0);
});
