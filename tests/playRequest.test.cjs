const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
const os = require('node:os');
const { isPlayRequest } = require('../dest/modules/playback/playRequest.js');

function loadPlayMovieHandler(t) {
    const handlers = new Map();
    const electron = {
        app: { getPath: () => os.tmpdir(), getAppPath: () => os.tmpdir(), isPackaged: false, on() {}, setPath() {} },
        dialog: {},
        ipcMain: { on: (channel, handler) => handlers.set(channel, handler), handle() {} },
        safeStorage: {},
        session: {},
    };
    const originalLoad = Module._load;
    Module._load = function load(request, ...rest) {
        return request === 'electron' ? electron : originalLoad.call(this, request, ...rest);
    };
    t.after(() => {
        Module._load = originalLoad;
    });

    const config = require('../dest/modules/fn_config/config.js');
    const originalRead = config.readConfig;
    let configReads = 0;
    config.readConfig = () => {
        configReads += 1;
        return null;
    };
    t.after(() => {
        config.readConfig = originalRead;
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
