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

const WIN_ASSETS = ['FNMedia_2.7.0_win_x64.exe', 'FNMedia_2.7.0_win_x64.exe.blockmap', 'latest.yml'];

// 按弹框标题点按钮：clicks 是 { 标题: 按钮文字 }，没列出的弹框点取消按钮
function clicking(clicks) {
    return (options) => {
        const label = clicks[options.title];
        if (label === undefined) return options.cancelId ?? 0;
        const index = options.buttons.indexOf(label);
        assert.notEqual(index, -1, `「${options.title}」没有按钮「${label}」: ${options.buttons}`);
        return index;
    };
}

function deferred() {
    let resolve;
    let reject;
    const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
    return { promise, resolve, reject };
}

// 加载更新检查，并取同一份播放状态模块（setupUpdateChecker 清了 dest/ 的缓存）
function setup(t, options = {}) {
    simulateHost(t, 'win32', 'x64');
    const env = setupUpdateChecker(t, { respond: () => release('v2.7.0', WIN_ASSETS), ...options });
    const playback = require('../dest/modules/playback/playbackState.js');
    return { ...env, playback };
}

// 模拟媒体播放插件：开始一次播放，stop() 时 MPV 退出并开始回传进度，回传由 report 控制
function startPlaying(playback, report = Promise.resolve()) {
    const session = playback.beginPlayback();
    const player = {
        stops: 0,
        stop() {
            player.stops += 1;
            session.ended(report);
        },
    };
    assert.equal(session.attach(player), true);
    return { session, player };
}

test('the startup check holds the new version dialog while MPV is playing and shows it once playback ends', async (t) => {
    const { checker, dialogs, playback } = setup(t);
    const { session } = startPlaying(playback);

    await checker.autoCheckForUpdates();
    // 断言提示没有弹出，没有可等的条件
    await settle();
    assert.deepEqual(dialogs, []);

    session.ended();
    await waitFor(() => dialogs.length === 1);
    assert.deepEqual(dialogs.map((d) => d.title), ['发现新版本']);

    playback.beginPlayback().ended();
    await settle();
    assert.equal(dialogs.length, 1);
});

test('a manual check shows the new version dialog even while MPV is playing', async (t) => {
    const { checker, dialogs, playback } = setup(t);
    startPlaying(playback);

    await checker.manualCheckForUpdates();

    assert.deepEqual(dialogs.map((d) => d.title), ['发现新版本']);
});

test('a held dialog is not shown again after a manual check already showed it', async (t) => {
    const { checker, dialogs, playback } = setup(t);
    const { session } = startPlaying(playback);

    await checker.autoCheckForUpdates();
    await checker.manualCheckForUpdates();
    session.ended();
    await settle();

    assert.equal(dialogs.length, 1);
});

test('quitting while MPV is playing drops the held dialog, even though the quit stops playback', async (t) => {
    const { app, checker, dialogs, events, playback } = setup(t);
    startQuitCoordinator(events);
    const { player } = startPlaying(playback);

    await checker.autoCheckForUpdates();
    requestQuit(app);
    await waitFor(() => app.exited);
    await settle();

    assert.equal(player.stops, 1);
    assert.deepEqual(dialogs, []);
});

// 新版本提示点「下载并安装」，下载完成框点 choice
function setupDownload(t, choice) {
    return setup(t, { dialogResponse: clicking({ 发现新版本: '下载并安装', 新版本已下载: choice }) });
}

// 手动检查并开始下载，等下载真正开始
async function startDownload(env) {
    await env.checker.manualCheckForUpdates();
    await waitFor(() => env.updater.downloads === 1);
}

// 让进行中的下载完成，等下载完成框按 setupDownload 的选择点掉、选择生效（chosen() 为真）
async function downloadAndChoose(env, chosen) {
    env.updater.finishDownload();
    await waitFor(chosen);
}

test('restart and install now stops playback and waits for the progress report before installing', async (t) => {
    const env = setupDownload(t, '立即重启安装');
    const report = deferred();
    const { player } = startPlaying(env.playback, report.promise);

    await startDownload(env);
    await downloadAndChoose(env, () => player.stops === 1);
    // 断言回传完成前没有安装，没有可等的条件
    await settle();
    assert.deepEqual(env.updater.installs, []);

    report.resolve();
    await waitFor(() => env.updater.installs.length === 1);
    assert.deepEqual(env.updater.installs, [{ isSilent: true, isForceRunAfter: true }]);
});

test('restart and install now still installs 5 seconds after stopping when the progress report never returns', async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const env = setupDownload(t, '立即重启安装');
    t.mock.method(require('../dest/modules/logger/index.js'), 'warn', () => {});
    const { player } = startPlaying(env.playback, new Promise(() => {}));

    await startDownload(env);
    await downloadAndChoose(env, () => player.stops === 1);
    t.mock.timers.tick(4999);
    // 断言超时前没有安装，没有可等的条件
    await settle();
    assert.deepEqual(env.updater.installs, []);

    t.mock.timers.tick(1);
    await waitFor(() => env.updater.installs.length === 1);
    assert.deepEqual(env.updater.installs, [{ isSilent: true, isForceRunAfter: true }]);
});

test('restart and install now installs right away when nothing is playing', async (t) => {
    const env = setupDownload(t, '立即重启安装');

    await startDownload(env);
    await downloadAndChoose(env, () => env.updater.installs.length === 1);

    assert.deepEqual(env.updater.installs, [{ isSilent: true, isForceRunAfter: true }]);
});

test('a failed progress report does not block the install', async (t) => {
    const env = setupDownload(t, '立即重启安装');
    const report = deferred();
    const { player } = startPlaying(env.playback, report.promise);

    await startDownload(env);
    await downloadAndChoose(env, () => player.stops === 1);
    report.reject(new Error('NAS unreachable'));
    await waitFor(() => env.updater.installs.length === 1);

    assert.deepEqual(env.updater.installs, [{ isSilent: true, isForceRunAfter: true }]);
});
