const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { useFakeElectron } = require('./helpers/fakeElectron.cjs');
const { settle, waitFor } = require('./helpers/updateChecker.cjs');
const { createQuittingApp, deferred, requestQuit, startPlaying, startQuitCoordinator } = require('./helpers/fakeQuitApp.cjs');

// 退出协调（src/modules/quit/quitCoordinator.ts）的普通退出。events 按发生顺序记下：
// MPV 停止、进度回传完成、关 Proxy、销毁托盘、进程退出。
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
    startQuitCoordinator(events, { closeProxy });
    return { app, events, playback, quit };
}

test('a quit while playing waits for the progress report, then closes the Proxy, then quits', async (t) => {
    const env = setup(t);
    const report = deferred();
    startPlaying(env.playback, env.events, report.promise);

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
    startPlaying(env.playback, env.events, new Promise(() => {}));

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
    startPlaying(env.playback, env.events, report.promise);

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
    void session.start({ stop() { throw new Error('mpv ipc closed'); } }, async () => true);
    env.quit.onQuitStarted(() => { throw new Error('listener failed'); });

    requestQuit(env.app);
    await waitFor(() => env.app.exited);

    assert.deepEqual(env.events, ['tray destroyed', 'exited']);
});

test('quit-started listeners hear about the quit before playback is stopped', async (t) => {
    const env = setup(t);
    startPlaying(env.playback, env.events);
    env.quit.onQuitStarted(() => env.events.push('quit started'));
    const unsubscribe = env.quit.onQuitStarted(() => env.events.push('unsubscribed listener'));
    unsubscribe();

    requestQuit(env.app);
    await waitFor(() => env.app.exited);

    assert.deepEqual(env.events.slice(0, 2), ['quit started', 'mpv stopped']);
    assert.ok(!env.events.includes('unsubscribed listener'));
});
