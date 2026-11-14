const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const {
    setupUpdateChecker,
    settle,
    waitFor,
    requestQuit,
    startQuitCoordinator,
    release,
    simulateHost,
    runAsAppImage,
    tempDir,
} = require('./helpers/updateChecker.cjs');
const { deferred, startPlaying } = require('./helpers/fakeQuitApp.cjs');

// 系统关机、重启或注销时放弃「退出时安装」（#192）。关机信号：Windows 是主窗口的 session-end，
// Linux 是 powerMonitor 的 shutdown。events 按发生顺序记下：MPV 停止、进度回传完成、关 Proxy、开始安装、销毁托盘、进程退出。

const WIN_ASSETS = ['FNMedia_2.7.0_win_x64.exe', 'FNMedia_2.7.0_win_x64.exe.blockmap', 'latest.yml'];
const LINUX_ASSETS = ['FNMedia_2.7.0_linux_x86_64.AppImage', 'latest-linux.yml'];
const ABANDONED = /放弃这次退出时安装/;

// Electron 发关机信号时带的事件对象；我们不调用 preventDefault，不推迟关机
const shutdownEvent = (extra = {}) => ({ ...extra, preventDefault() { throw new Error('不该推迟关机'); } });

// 新版本提示点「下载并安装」，下载完成框点 choice，其它弹框点取消按钮。
// 像主进程入口那样启动退出协调，并在主窗口创建后监听关机信号（src/main/main.ts）
function setup(t, choice, platform = 'win32') {
    simulateHost(t, platform, 'x64');
    // Linux 上应用内更新只在可写目录里的 AppImage 运行时提供
    if (platform === 'linux') runAsAppImage(t, tempDir(t));
    const env = setupUpdateChecker(t, {
        respond: () => release('v2.7.0', platform === 'linux' ? LINUX_ASSETS : WIN_ASSETS),
        dialogResponse: (options) => {
            if (options.title === '发现新版本') return options.buttons.indexOf('下载并安装');
            if (options.title === '新版本已下载') return options.buttons.indexOf(choice);
            return options.cancelId ?? 0;
        },
    });
    startQuitCoordinator(env.events);
    const mainWindow = new EventEmitter();
    require('../dest/modules/quit/quitCoordinator.js').listenForSystemShutdown(mainWindow);
    const playback = require('../dest/modules/playback/playbackState.js');
    const sessionEnd = () => mainWindow.emit('session-end', shutdownEvent({ reasons: ['shutdown'] }));
    const powerShutdown = () => env.powerMonitor.emit('shutdown', shutdownEvent());
    return {
        ...env,
        playback,
        sessionEnd,
        powerShutdown,
        // 两种关机信号都发一遍
        bothShutdownSignals() {
            sessionEnd();
            powerShutdown();
        },
    };
}

// 手动检查、下载完成、在下载完成框做出选择，等选择生效
async function downloadAndChoose(env, chosen) {
    await env.checker.manualCheckForUpdates();
    await waitFor(() => env.updater.downloads === 1);
    env.updater.finishDownload();
    await waitFor(chosen);
}

const installOnQuitChosen = (env) => () =>
    env.dialogs.some((d) => d.title === '新版本已下载') && env.updater.autoInstallOnAppQuit === true;

// quitAndInstall 一调用（安装已经开始）就收到两种关机信号
function shutdownRightAfterInstallStarts(env) {
    const quitAndInstall = env.updater.quitAndInstall.bind(env.updater);
    env.updater.quitAndInstall = (...args) => {
        quitAndInstall(...args);
        env.bothShutdownSignals();
    };
}

const signals = [
    { name: 'a Windows session end', platform: 'win32', emit: (env) => env.sessionEnd() },
    { name: 'a Linux powerMonitor shutdown', platform: 'linux', emit: (env) => env.powerShutdown() },
];

for (const signal of signals) {
    test(`${signal.name} after choosing install on quit gives up the install, and the following quit still stops playback first`, async (t) => {
        const env = setup(t, '退出时安装', signal.platform);
        await downloadAndChoose(env, installOnQuitChosen(env));
        const report = deferred();
        startPlaying(env.playback, env.events, report.promise);

        signal.emit(env);
        assert.equal(env.updater.autoInstallOnAppQuit, false);
        assert.match(env.logText(), ABANDONED);

        assert.equal(requestQuit(env.app).defaultPrevented, true);
        await settle();
        assert.deepEqual(env.events, ['mpv stopped']);
        report.resolve();
        await waitFor(() => env.app.exited);

        assert.deepEqual(env.events, ['mpv stopped', 'progress reported', 'proxy closing', 'proxy closed', 'tray destroyed', 'exited']);
        assert.deepEqual(env.updater.installs, []);
    });
}

test('a shutdown signal arriving while the quit is waiting for the progress report still gives up the install', async (t) => {
    const env = setup(t, '退出时安装', 'linux');
    await downloadAndChoose(env, installOnQuitChosen(env));
    const report = deferred();
    startPlaying(env.playback, env.events, report.promise);

    // Linux 关机时 SIGTERM 先让客户端开始退出也一样
    requestQuit(env.app);
    await settle();
    env.powerShutdown();
    report.resolve();
    await waitFor(() => env.app.exited);

    assert.deepEqual(env.updater.installs, []);
    assert.equal(env.updater.autoInstallOnAppQuit, false);
    assert.match(env.logText(), ABANDONED);
});

test('a shutdown signal after the install on quit has started changes nothing', async (t) => {
    const env = setup(t, '退出时安装');
    await downloadAndChoose(env, installOnQuitChosen(env));
    shutdownRightAfterInstallStarts(env);

    requestQuit(env.app);
    await waitFor(() => env.app.exited);

    assert.deepEqual(env.events, ['proxy closing', 'proxy closed', 'install started', 'tray destroyed', 'exited']);
    assert.deepEqual(env.updater.installs, [{ isSilent: true, isForceRunAfter: false }]);
    assert.doesNotMatch(env.logText(), ABANDONED);
});

test('a shutdown signal after restart and install now has started changes nothing', async (t) => {
    const env = setup(t, '立即重启安装');
    shutdownRightAfterInstallStarts(env);

    await downloadAndChoose(env, () => env.app.exited);

    assert.deepEqual(env.updater.installs, [{ isSilent: true, isForceRunAfter: true }]);
    assert.doesNotMatch(env.logText(), ABANDONED);
});

test('a shutdown signal without install on quit chosen has no effect', async (t) => {
    const env = setup(t, '稍后提醒');
    // 还没下载
    env.bothShutdownSignals();

    // 下载中：electron-updater 的 autoInstallOnAppQuit 这时临时开着，不去动它
    await env.checker.manualCheckForUpdates();
    await waitFor(() => env.updater.downloads === 1);
    env.bothShutdownSignals();
    assert.equal(env.updater.autoInstallOnAppQuit, true);

    // 下载完成、选了「稍后提醒」
    env.updater.finishDownload();
    await waitFor(() => env.dialogs.some((d) => d.title === '新版本已下载'));
    const dialogs = env.dialogs.length;
    env.bothShutdownSignals();
    await settle();

    assert.equal(env.updater.autoInstallOnAppQuit, false);
    assert.equal(env.dialogs.length, dialogs);
    assert.deepEqual(env.events, []);
    assert.doesNotMatch(env.logText(), ABANDONED);
});

test('after giving up the install on quit, download and install again offers both install choices', async (t) => {
    const env = setup(t, '退出时安装');
    await downloadAndChoose(env, installOnQuitChosen(env));
    env.sessionEnd();

    // 关机被取消、客户端还开着时，再点「下载并安装」不重新下载，直接问安装方式
    await env.checker.manualCheckForUpdates();
    await waitFor(() => env.updater.autoInstallOnAppQuit === true);

    assert.equal(env.updater.downloads, 1);
    assert.equal(env.dialogs.filter((d) => d.title === '新版本已下载').length, 2);
});

test('listening for system shutdown a second time is refused', async (t) => {
    setup(t, '稍后提醒');
    const quit = require('../dest/modules/quit/quitCoordinator.js');

    assert.throws(() => quit.listenForSystemShutdown(new EventEmitter()), /已经在监听系统关机/);
});
