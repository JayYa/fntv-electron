const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { useFakeElectron } = require('./helpers/fakeElectron.cjs');
const { createQuittingApp, requestQuit } = require('./helpers/fakeQuitApp.cjs');

const nextTurn = () => new Promise((resolve) => setImmediate(resolve));

async function waitFor(condition, timeoutMs = 2000) {
    const deadline = Date.now() + timeoutMs;
    while (!condition()) {
        if (Date.now() > deadline) throw new Error(`等待超时（${timeoutMs}ms）：${condition}`);
        await nextTurn();
    }
}

// 断言某事没有发生时用：给已排队的回调足够的机会跑完
async function settle() {
    for (let i = 0; i < 20; i += 1) await nextTurn();
}

function deferred() {
    let resolve;
    let reject;
    const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
    return { promise, resolve, reject };
}

// 加载退出协调模块，Proxy 和托盘换成记录事件的假收尾，播放状态用真的模块
function setup(t, { closeProxy } = {}) {
    const testRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'fntv-quit-'));
    const paths = { home: testRoot, userData: path.join(testRoot, '.fntv') };
    fs.mkdirSync(paths.userData, { recursive: true });
    t.after(() => fs.rmSync(testRoot, { recursive: true, force: true }));

    const events = [];
    const app = createQuittingApp(events, {
        isPackaged: false,
        getAppPath() { return testRoot; },
        getPath(name) { return paths[name]; },
        setPath(name, value) { paths[name] = value; },
        commandLine: { getSwitchValue() { return ''; } },
        getVersion() { return '0.0.0'; },
    });
    useFakeElectron(t, { app, dialog: {}, shell: {} });

    const playback = require('../dest/modules/playback/playbackState.js');
    const quit = require('../dest/modules/quit/quitCoordinator.js');
    quit.initQuitCoordinator({
        closeProxy: closeProxy ?? (async () => {
            events.push('proxy closing');
            await nextTurn();
            events.push('proxy closed');
        }),
        onQuit() { events.push('tray destroyed'); },
    });
    return { app, events, playback, quit };
}

// 模拟媒体播放插件：开始一次播放，stop() 时 MPV 退出，退出的进度回传由 report 决定
function startPlaying({ playback, events }, report = Promise.resolve()) {
    const session = playback.beginPlayback();
    const player = {
        stop() {
            events.push('mpv stopped');
            session.ended(report.then(() => events.push('progress reported')));
        },
    };
    assert.equal(session.attach(player), true);
    return player;
}

test('a quit while playing waits for the progress report, then closes the Proxy, then quits', async (t) => {
    const env = setup(t);
    const report = deferred();
    startPlaying(env, report.promise);

    assert.equal(requestQuit(env.app).defaultPrevented, true);
    await settle();
    assert.deepEqual(env.events, ['mpv stopped'], '进度回传完成前就关了 Proxy 或退出了');

    report.resolve();
    await waitFor(() => env.app.exited);
    assert.deepEqual(env.events, ['mpv stopped', 'progress reported', 'proxy closing', 'proxy closed', 'tray destroyed', 'exited']);
});

test('a quit with nothing playing closes the Proxy and quits without waiting for playback', async (t) => {
    const env = setup(t);

    assert.equal(requestQuit(env.app).defaultPrevented, true);
    await waitFor(() => env.app.exited);

    assert.deepEqual(env.events, ['proxy closing', 'proxy closed', 'tray destroyed', 'exited']);
});

test('a quit still goes ahead 5 seconds after stopping when the progress report never returns', async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const env = setup(t);
    t.mock.method(require('../dest/modules/logger/index.js'), 'warn', () => {});
    startPlaying(env, new Promise(() => {}));

    requestQuit(env.app);
    t.mock.timers.tick(4999);
    await settle();
    assert.deepEqual(env.events, ['mpv stopped']);

    t.mock.timers.tick(1);
    await waitFor(() => env.app.exited);
    assert.deepEqual(env.events, ['mpv stopped', 'proxy closing', 'proxy closed', 'tray destroyed', 'exited']);
});

test('quitting again during the cleanup is held back and does not repeat the cleanup', async (t) => {
    const env = setup(t);
    const report = deferred();
    startPlaying(env, report.promise);

    requestQuit(env.app);
    await settle();
    // 托盘菜单再点一次退出
    assert.equal(requestQuit(env.app).defaultPrevented, true);
    await settle();
    assert.equal(env.app.exited, false);

    report.resolve();
    await waitFor(() => env.app.exited);
    assert.deepEqual(env.events, ['mpv stopped', 'progress reported', 'proxy closing', 'proxy closed', 'tray destroyed', 'exited']);
});

test('a failing cleanup step is logged and the remaining steps still run until the client quits', async (t) => {
    const env = setup(t, { closeProxy: () => Promise.reject(new Error('proxy hung')) });
    t.mock.method(require('../dest/modules/logger/index.js'), 'error', () => {});
    const session = env.playback.beginPlayback();
    session.attach({ stop() { throw new Error('mpv ipc closed'); } });
    env.quit.onQuitStarted(() => { throw new Error('listener failed'); });

    requestQuit(env.app);
    await waitFor(() => env.app.exited);

    assert.deepEqual(env.events, ['tray destroyed', 'exited']);
});

test('quit-started listeners hear about the quit before playback is stopped', async (t) => {
    const env = setup(t);
    startPlaying(env);
    env.quit.onQuitStarted(() => env.events.push('quit started'));
    const unsubscribe = env.quit.onQuitStarted(() => env.events.push('unsubscribed listener'));
    unsubscribe();

    requestQuit(env.app);
    await waitFor(() => env.app.exited);

    assert.deepEqual(env.events.slice(0, 2), ['quit started', 'mpv stopped']);
    assert.ok(!env.events.includes('unsubscribed listener'));
});
