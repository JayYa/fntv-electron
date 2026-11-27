const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { useFakeElectron } = require('./helpers/fakeElectron.cjs');
const { fakeIpcMain } = require('./helpers/fakeIpc.cjs');

function setupIpc(t) {
    const testRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'fntv-ipc-'));
    const paths = { home: testRoot, userData: path.join(testRoot, '.fntv') };
    const ipc = fakeIpcMain();
    useFakeElectron(t, {
        ipcMain: ipc.ipcMain,
        app: {
            isPackaged: false,
            getAppPath() { return testRoot; },
            getPath(name) { return paths[name]; },
            commandLine: { getSwitchValue() { return ''; } },
            setPath(name, value) { paths[name] = value; },
        },
        safeStorage: {},
    });
    t.after(() => fs.rmSync(testRoot, { recursive: true, force: true }));

    fs.mkdirSync(paths.userData, { recursive: true });
    return {
        invoke: ipc.invoke,
        configPath: path.join(paths.userData, 'config.json'),
        logText: () => fs.readFileSync(path.join(testRoot, 'log', 'app.log'), 'utf8'),
        registerPreferences: () => ipc.register(require('../dest/main/ipc/preferences.js').preferencesHandlers),
        registerRenderer: () => ipc.register(require('../dest/main/ipc/renderer.js').rendererHandlers),
    };
}

test('a config read failure while reading preferences is logged and reaches the page as an error', async (t) => {
    const { invoke, configPath, logText, registerPreferences } = setupIpc(t);
    fs.mkdirSync(configPath);
    registerPreferences();

    await assert.rejects(invoke('get-preferences'));

    assert.match(logText(), /get-preferences/);
});

for (const payload of [
    { appDownloadProxy: { enabled: true, proxyUrl: 'https://relay.example.test/' } },
    { mpvPlayback: true },
]) {
    test(`a config write failure while saving ${JSON.stringify(payload)} answers the login page with a failure`, async (t) => {
        const { invoke, configPath, registerPreferences } = setupIpc(t);
        fs.mkdirSync(configPath);
        registerPreferences();

        const result = await invoke('set-preferences', payload);

        assert.equal(result.success, false);
        assert.equal(typeof result.error, 'string');
    });
}

for (const payload of [
    { appDownloadProxy: { enabled: 'yes', proxyUrl: 'https://relay.example.test/' } },
    { mpvPlayback: 'false' },
    { mpvPlayback: true, appDownloadProxy: { enabled: 'yes' } },
    { nasLocalProxy: true },
    undefined,
]) {
    test(`set-preferences refuses ${JSON.stringify(payload)} and writes nothing`, async (t) => {
        const { invoke, configPath, registerPreferences } = setupIpc(t);
        registerPreferences();

        await assert.rejects(invoke('set-preferences', payload), /参数不合法/);

        assert.equal(fs.existsSync(configPath), false);
    });
}

for (const [level, name] of [['debug', 'DEBUG'], ['info', 'INFO'], ['warn', 'WARN'], ['error', 'ERROR'], ['verbose', 'INFO']]) {
    test(`a renderer log-message at level ${level} is written as ${name} with the Renderer prefix`, async (t) => {
        const { invoke, logText, registerRenderer } = setupIpc(t);
        registerRenderer();

        await invoke('log-message', { level, args: [`${level} from the page`] });

        assert.ok(logText().includes(`[${name}] [Renderer] ${level} from the page`), logText());
    });
}

test('a renderer log-message the logger cannot write reports its level and error to the console, without its arguments', async (t) => {
    const { invoke, logText, registerRenderer } = setupIpc(t);
    registerRenderer();
    const consoleError = t.mock.method(console, 'error', () => {});
    const cyclic = { name: 'cyclic' };
    cyclic.self = cyclic;
    await invoke('log-message', { level: 'info', args: ['written before'] });

    await invoke('log-message', { level: 'warn', args: ['cannot serialize', cyclic] });

    const [call] = consoleError.mock.calls;
    assert.ok(call, 'nothing written to the console');
    assert.ok(call.arguments.includes('warn'), String(call.arguments));
    assert.ok(call.arguments.some(arg => /circular/.test(arg)), String(call.arguments));
    assert.ok(!call.arguments.includes('cannot serialize') && !call.arguments.some(arg => typeof arg === 'object'), 'renderer arguments reached the console unmasked');
    assert.doesNotMatch(logText(), /cannot serialize/);
});
