const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { useFakeElectron } = require('./helpers/fakeElectron.cjs');

function setupIpc(t) {
    const testRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'fntv-ipc-'));
    const paths = { home: testRoot, userData: path.join(testRoot, '.fntv') };
    const ipcMain = new EventEmitter();
    const invokeHandlers = new Map();
    ipcMain.handle = (channel, handler) => invokeHandlers.set(channel, handler);
    const electronMock = {
        ipcMain,
        app: {
            isPackaged: false,
            getAppPath() { return testRoot; },
            getPath(name) { return paths[name]; },
            commandLine: { getSwitchValue() { return ''; } },
            setPath(name, value) { paths[name] = value; },
        },
        safeStorage: {},
    };

    useFakeElectron(t, electronMock);
    t.after(() => fs.rmSync(testRoot, { recursive: true, force: true }));

    fs.mkdirSync(paths.userData, { recursive: true });
    return {
        ipcMain,
        invoke: (channel, ...args) => invokeHandlers.get(channel)({}, ...args),
        configPath: path.join(paths.userData, 'config.json'),
        logText: () => fs.readFileSync(path.join(testRoot, 'log', 'app.log'), 'utf8'),
        loadIpcHandler: () => require('../dest/main/handlers/core/ipcHandler.js'),
        loadConfigPlugin: () => require('../dest/main/handlers/plugins/config.js'),
        loadLoggerPlugin: () => require('../dest/main/handlers/plugins/logger.js'),
    };
}

function fakeEvent() {
    const replies = [];
    return { replies, reply(channel, payload) { replies.push({ channel, payload }); } };
}

test('a config read failure in a get handler is logged instead of escaping the main process', (t) => {
    const { ipcMain, configPath, logText, loadConfigPlugin } = setupIpc(t);
    fs.mkdirSync(configPath);
    loadConfigPlugin().init();

    const event = fakeEvent();
    assert.doesNotThrow(() => ipcMain.emit('get-nas-proxy', event));

    assert.deepEqual(event.replies, []);
    assert.match(logText(), /get-nas-proxy/);
});

test('a config write failure still reaches the renderer as a failed reply', (t) => {
    const { ipcMain, configPath, loadConfigPlugin } = setupIpc(t);
    fs.mkdirSync(configPath);
    loadConfigPlugin().init();

    const event = fakeEvent();
    ipcMain.emit('set-nas-proxy', event, { nasProxyEnabled: true });

    assert.equal(event.replies.length, 1);
    assert.equal(event.replies[0].channel, 'nas-proxy-set');
    assert.equal(event.replies[0].payload.success, false);
});

for (const [channel, payload] of [
    ['set-download-proxy', { enabled: true, proxyUrl: 'https://relay.example.test/' }],
    ['set-play-button-config', { hideOriginalPlayButton: true }],
]) {
    test(`a config write failure in ${channel} answers the login page with a failure`, async (t) => {
        const { invoke, configPath, loadConfigPlugin } = setupIpc(t);
        fs.mkdirSync(configPath);
        loadConfigPlugin().init();

        const result = await invoke(channel, payload);

        assert.equal(result.success, false);
        assert.equal(typeof result.error, 'string');
    });
}

test('an invoke handler that throws is logged and the error still reaches the caller', async (t) => {
    const { invoke, logText, loadIpcHandler } = setupIpc(t);

    loadIpcHandler().registerHandler('invoke-channel', async () => { throw new Error('invoke failure'); }, { useHandle: true });

    await assert.rejects(invoke('invoke-channel'), /invoke failure/);
    assert.match(logText(), /invoke-channel/);
});

test('a rejected async handler is logged instead of becoming an unhandled rejection', async (t) => {
    const { ipcMain, logText, loadIpcHandler } = setupIpc(t);
    const unhandled = [];
    const onUnhandled = (reason) => unhandled.push(reason);
    process.on('unhandledRejection', onUnhandled);
    t.after(() => process.off('unhandledRejection', onUnhandled));

    loadIpcHandler().registerHandler('async-channel', async () => { throw new Error('async failure'); });
    ipcMain.emit('async-channel', fakeEvent());
    await new Promise((resolve) => setImmediate(resolve));

    assert.deepEqual(unhandled, []);
    assert.match(logText(), /async-channel/);
});

test('handlers still receive their arguments and run synchronously', (t) => {
    const { ipcMain, loadIpcHandler } = setupIpc(t);
    const seen = [];
    loadIpcHandler().registerHandler('sync-channel', (event, ...args) => seen.push(args));

    ipcMain.emit('sync-channel', fakeEvent(), 'a', 2);

    assert.deepEqual(seen, [['a', 2]]);
});

test('registering a channel twice throws and keeps the first handler', (t) => {
    const { ipcMain, loadIpcHandler } = setupIpc(t);
    const { registerHandler } = loadIpcHandler();
    const seen = [];
    registerHandler('twice-channel', () => seen.push('first'));

    assert.throws(() => registerHandler('twice-channel', () => seen.push('second')), /twice-channel.*already registered/);
    ipcMain.emit('twice-channel', fakeEvent());

    assert.deepEqual(seen, ['first']);
});

for (const [level, name] of [['debug', 'DEBUG'], ['info', 'INFO'], ['warn', 'WARN'], ['error', 'ERROR'], ['verbose', 'INFO']]) {
    test(`a renderer log-message at level ${level} is written as ${name} with the Renderer prefix`, async (t) => {
        const { invoke, logText, loadLoggerPlugin } = setupIpc(t);
        loadLoggerPlugin().init();

        await invoke('log-message', level, `${level} from the page`);

        assert.ok(logText().includes(`[${name}] [Renderer] ${level} from the page`), logText());
    });
}

test('a renderer log-message the logger cannot write reports its level and error to the console, without its arguments', async (t) => {
    const { invoke, logText, loadLoggerPlugin } = setupIpc(t);
    loadLoggerPlugin().init();
    const consoleError = t.mock.method(console, 'error', () => {});
    const cyclic = { name: 'cyclic' };
    cyclic.self = cyclic;
    await invoke('log-message', 'info', 'written before');

    await invoke('log-message', 'warn', 'cannot serialize', cyclic);

    const [call] = consoleError.mock.calls;
    assert.ok(call, 'nothing written to the console');
    assert.ok(call.arguments.includes('warn'), String(call.arguments));
    assert.ok(call.arguments.some(arg => /circular/.test(arg)), String(call.arguments));
    assert.ok(!call.arguments.includes('cannot serialize') && !call.arguments.includes(cyclic), 'renderer arguments reached the console unmasked');
    assert.doesNotMatch(logText(), /cannot serialize/);
});
