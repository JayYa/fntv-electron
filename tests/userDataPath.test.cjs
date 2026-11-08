const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
const os = require('node:os');
const path = require('node:path');

const CONSTANTS = path.resolve(__dirname, '../dest/public/constants.js');

// 按给定的 --user-data-dir 启动参数加载 constants，返回 USER_DATA_PATH。
function userDataPathWith(t, userDataDir) {
    const home = path.join(os.tmpdir(), 'fntv-home');
    const electron = {
        app: {
            getPath: name => (name === 'home' ? home : os.tmpdir()),
            commandLine: { getSwitchValue: name => (name === 'user-data-dir' ? userDataDir : '') },
        },
    };
    const originalLoad = Module._load;
    Module._load = function load(request, ...rest) {
        return request === 'electron' ? electron : originalLoad.call(this, request, ...rest);
    };
    t.after(() => {
        Module._load = originalLoad;
        delete require.cache[CONSTANTS];
    });
    delete require.cache[CONSTANTS];
    return { home, value: require(CONSTANTS).USER_DATA_PATH };
}

test('without --user-data-dir the user data stays in ~/.fntv', t => {
    const { home, value } = userDataPathWith(t, '');
    assert.equal(value, path.join(home, '.fntv'));
});

test('an absolute --user-data-dir is used as the user data directory', t => {
    const dir = path.join(os.tmpdir(), 'fntv-smoke-home', '.fntv');
    assert.equal(userDataPathWith(t, dir).value, dir);
});

test('a relative --user-data-dir is resolved against the working directory like Chromium does', t => {
    // app.setPath 只接受绝对路径，原样传下去时启动就会失败。
    assert.equal(userDataPathWith(t, path.join('portable', 'data')).value, path.resolve('portable', 'data'));
});
