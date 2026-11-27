const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { useFakeElectron } = require('./helpers/fakeElectron.cjs');
const { fakeIpcMain } = require('./helpers/fakeIpc.cjs');
const { REQUEST_CALLERS, mayCall } = require('../dest/public/ipcChannels.js');

const CHANNELS = Object.keys(REQUEST_CALLERS);

function setupMain(t) {
    const testRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'fntv-ipc-channels-'));
    t.after(() => fs.rmSync(testRoot, { recursive: true, force: true }));
    t.mock.timers.enable({ apis: ['setInterval'] });
    const ipc = fakeIpcMain();
    useFakeElectron(t, {
        app: {
            getPath: () => testRoot,
            getAppPath: () => testRoot,
            getVersion: () => '0.0.0',
            getName: () => 'fntv',
            on() {},
            isPackaged: false,
            setPath() {},
            commandLine: { getSwitchValue: () => '' },
        },
        ipcMain: ipc.ipcMain,
    });
    return { ipc, log: () => fs.readFileSync(path.join(testRoot, 'log', 'app.log'), 'utf8') };
}

function spyHandlers() {
    const calls = [];
    const handlers = Object.fromEntries(CHANNELS.map((channel) => [channel, {
        parse(raw) {
            if (raw === 'bad') throw new (require('../dest/main/ipc/adapter.js').InvalidPayload)('坏参数');
            return raw;
        },
        handle(payload) {
            calls.push({ channel, payload });
            if (payload === 'explode') throw new Error('handler failed');
            return `${channel} done`;
        },
    }]));
    return { calls, handlers };
}

test('the main process answers every channel of the table and nothing else', (t) => {
    const { ipc } = setupMain(t);

    require('../dest/main/ipc/index.js').startIpc({ isMainWindow: (sender) => sender === ipc.MAIN_WINDOW });

    assert.deepEqual([...ipc.handlers.keys()].sort(), [...CHANNELS].sort());
});

test('every channel refuses a payload of the wrong shape before doing anything', async (t) => {
    const { ipc } = setupMain(t);
    require('../dest/main/ipc/index.js').startIpc({ isMainWindow: (sender) => sender === ipc.MAIN_WINDOW });

    for (const channel of CHANNELS) {
        const from = mayCall(channel, 'loginPage') ? 'loginPage' : 'webUi';
        await assert.rejects(ipc.invoke(channel, 42, { from }), /参数不合法/, channel);
    }
});

for (const from of ['loginPage', 'webUi']) {
    test(`a request from the ${from} reaches exactly the channels the table opens to it`, async (t) => {
        const { ipc } = setupMain(t);
        const { calls, handlers } = spyHandlers();
        ipc.register(handlers);

        for (const channel of CHANNELS) {
            const request = ipc.invoke(channel, 'payload', { from });
            if (mayCall(channel, from)) {
                assert.equal(await request, `${channel} done`);
            } else {
                await assert.rejects(request, /不接受这个页面的请求/, channel);
            }
        }

        assert.deepEqual(calls.map(({ channel }) => channel), CHANNELS.filter((channel) => mayCall(channel, from)));
    });
}

test('a request from a window other than the main window is refused on every channel', async (t) => {
    const { ipc } = setupMain(t);
    const { calls, handlers } = spyHandlers();
    ipc.register(handlers);

    for (const channel of CHANNELS) {
        await assert.rejects(ipc.invoke(channel, 'payload', { from: 'otherWindow', frameUrl: 'https://nas.example:5667/v' }), /不接受这个页面的请求/);
    }
    assert.deepEqual(calls, []);
});

test('a refused payload never reaches the handler and is not written to the log', async (t) => {
    const { ipc, log } = setupMain(t);
    const { calls, handlers } = spyHandlers();
    ipc.register(handlers);

    await assert.rejects(ipc.invoke('login', 'bad'), /login 的参数不合法: 坏参数/);

    assert.deepEqual(calls, []);
    assert.match(log(), /拒绝了 login 请求: 坏参数/);
    assert.doesNotMatch(log(), /"bad"|'bad'/);
});

test('a failing handler is logged and its error reaches the page', async (t) => {
    const { ipc, log } = setupMain(t);
    const { handlers } = spyHandlers();
    ipc.register(handlers);

    await assert.rejects(ipc.invoke('get-config', 'explode'), /handler failed/);

    assert.match(log(), /IPC 处理器执行失败: get-config/);
});
