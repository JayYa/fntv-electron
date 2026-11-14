const test = require('node:test');
const assert = require('node:assert/strict');
const {
    setupUpdateChecker,
    settle,
    waitFor,
    requestQuit,
    startQuitCoordinator,
    release,
    simulateHost,
} = require('./helpers/updateChecker.cjs');
const { deferred, startPlaying } = require('./helpers/fakeQuitApp.cjs');

// 应用内更新的两种安装方式和退出收尾（src/modules/quit/quitCoordinator.ts）怎么配合。
// events 按发生顺序记下：MPV 停止、进度回传完成、关 Proxy、开始安装、销毁托盘、进程退出。

const WIN_ASSETS = ['FNMedia_2.7.0_win_x64.exe', 'FNMedia_2.7.0_win_x64.exe.blockmap', 'latest.yml'];

// 新版本提示点「下载并安装」，下载完成框点 choice，其它弹框点取消按钮
function setup(t, choice) {
    simulateHost(t, 'win32', 'x64');
    const env = setupUpdateChecker(t, {
        respond: () => release('v2.7.0', WIN_ASSETS),
        dialogResponse: (options) => {
            if (options.title === '发现新版本') return options.buttons.indexOf('下载并安装');
            if (options.title === '新版本已下载') return options.buttons.indexOf(choice);
            return options.cancelId ?? 0;
        },
    });
    startQuitCoordinator(env.events);
    const playback = require('../dest/modules/playback/playbackState.js');
    return { ...env, playback };
}

// 手动检查、下载完成、在下载完成框做出选择，等选择生效
async function downloadAndChoose(env, chosen) {
    await env.checker.manualCheckForUpdates();
    await waitFor(() => env.updater.downloads === 1);
    env.updater.finishDownload();
    await waitFor(chosen);
}

// 下载完成框弹出前 autoInstallOnAppQuit 已关掉，选了「退出时安装」才再打开
const installOnQuitChosen = (env) => () =>
    env.dialogs.some((d) => d.title === '新版本已下载') && env.updater.autoInstallOnAppQuit === true;

test('install on quit stops playback and waits for the progress report, closes the Proxy, then installs and quits', async (t) => {
    const env = setup(t, '退出时安装');
    await downloadAndChoose(env, installOnQuitChosen(env));
    const report = deferred();
    startPlaying(env.playback, env.events, report.promise);

    assert.equal(requestQuit(env.app).defaultPrevented, true);
    await settle();
    assert.deepEqual(env.events, ['mpv stopped']);

    report.resolve();
    await waitFor(() => env.app.exited);
    // 安装发起的退出直接放行，不再停播放、关 Proxy；托盘到这时才销毁
    assert.deepEqual(env.events, [
        'mpv stopped', 'progress reported', 'proxy closing', 'proxy closed', 'install started', 'tray destroyed', 'exited',
    ]);
    // 不再自动重启客户端，和 electron-updater 自己退出时安装的参数一样
    assert.deepEqual(env.updater.installs, [{ isSilent: true, isForceRunAfter: false }]);
});

test('install on quit with nothing playing closes the Proxy, then installs and quits', async (t) => {
    const env = setup(t, '退出时安装');
    await downloadAndChoose(env, installOnQuitChosen(env));

    requestQuit(env.app);
    await waitFor(() => env.app.exited);

    assert.deepEqual(env.events, ['proxy closing', 'proxy closed', 'install started', 'tray destroyed', 'exited']);
});

test('when the install on quit fails the client shows the failure and still quits', async (t) => {
    const env = setup(t, '退出时安装');
    await downloadAndChoose(env, installOnQuitChosen(env));
    env.updater.installError = new Error('spawn EACCES');

    requestQuit(env.app);
    await waitFor(() => env.app.exited);

    assert.match(env.dialogs.at(-1).detail, /spawn EACCES/);
    assert.deepEqual(env.events, ['proxy closing', 'proxy closed', 'install started', 'tray destroyed', 'exited']);
});

test('restart and install now is not held back, and still closes the Proxy and destroys the tray', async (t) => {
    const env = setup(t, '立即重启安装');
    const report = deferred();
    startPlaying(env.playback, env.events, report.promise);

    await downloadAndChoose(env, () => env.events.includes('mpv stopped'));
    report.resolve();
    await waitFor(() => env.app.exited);

    // 安装前自己停了播放；安装发起的退出放行（不等 Proxy 关完），只关一次 Proxy
    assert.deepEqual(env.events.filter((event) => event !== 'proxy closed'), [
        'mpv stopped', 'progress reported', 'install started', 'proxy closing', 'tray destroyed', 'exited',
    ]);
    assert.deepEqual(env.updater.installs, [{ isSilent: true, isForceRunAfter: true }]);
});

test('quitting after restart and install now failed is an ordinary quit without a second install', async (t) => {
    const env = setup(t, '立即重启安装');
    env.updater.installError = new Error('spawn EACCES');
    await downloadAndChoose(env, () => env.dialogs.some((d) => d.title === '应用内更新失败'));
    await settle();
    assert.equal(env.app.exited, false);

    assert.equal(requestQuit(env.app).defaultPrevented, true);
    await waitFor(() => env.app.exited);

    assert.deepEqual(env.events, ['install started', 'proxy closing', 'proxy closed', 'tray destroyed', 'exited']);
    assert.equal(env.updater.installs.length, 1);
});

test('a quit without choosing install on quit cleans up and quits without installing', async (t) => {
    const env = setup(t, '稍后提醒');
    await downloadAndChoose(env, () => env.dialogs.some((d) => d.title === '新版本已下载'));

    requestQuit(env.app);
    await waitFor(() => env.app.exited);

    assert.deepEqual(env.events, ['proxy closing', 'proxy closed', 'tray destroyed', 'exited']);
    assert.deepEqual(env.updater.installs, []);
});
