const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const Module = require('node:module');
const os = require('node:os');
const path = require('node:path');

const LOGGER = path.resolve(__dirname, '../dest/modules/logger/logger.js');

// 模拟打包后的客户端在 config.ts 调 app.setPath('userData', ~/.fntv) 之前加载日志器：
// 这时 app.getPath('userData') 还是 Electron 默认的目录（Linux 上是 ~/.config/fntv）。
function loadPackagedLogger(t) {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'fntv-log-home-'));
    const electronDefault = path.join(home, '.config', 'fntv');
    const electron = {
        app: {
            isPackaged: true,
            getAppPath: () => path.join(home, 'resources', 'app.asar'),
            getPath: name => ({ home, userData: electronDefault })[name],
            commandLine: { getSwitchValue: () => '' },
        },
    };
    const originalLoad = Module._load;
    Module._load = function load(request, ...rest) {
        return request === 'electron' ? electron : originalLoad.call(this, request, ...rest);
    };
    const clearCompiledModules = () => Object.keys(require.cache)
        .filter(id => id.includes(`${path.sep}dest${path.sep}`))
        .forEach(id => delete require.cache[id]);
    t.after(() => {
        Module._load = originalLoad;
        clearCompiledModules();
        fs.rmSync(home, { recursive: true, force: true });
    });
    clearCompiledModules();
    return { home, electronDefault, logger: require(LOGGER).logger };
}

test('a packaged client writes app.log under ~/.fntv/logs even when loaded before userData moves there', t => {
    const { home, electronDefault, logger } = loadPackagedLogger(t);

    logger.info('started');

    assert.ok(fs.existsSync(path.join(home, '.fntv', 'logs', 'app.log')));
    assert.equal(fs.existsSync(path.join(electronDefault, 'logs')), false);
});
