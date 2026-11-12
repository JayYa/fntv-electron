const test = require('node:test');
const assert = require('node:assert/strict');
const {
    setupUpdateChecker,
    settle,
    quitApp,
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
    await settle();
    assert.deepEqual(dialogs, []);

    session.ended();
    await settle();
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

test('quitting before playback ends drops the held dialog without errors', async (t) => {
    const { app, checker, dialogs, playback } = setup(t);
    const { session } = startPlaying(playback);

    await checker.autoCheckForUpdates();
    const event = quitApp(app);
    session.ended();
    await settle();

    assert.deepEqual(dialogs, []);
    assert.equal(event.defaultPrevented, false);
});

// 让进行中的下载完成，下载完成框按 setupDownload 的选择点掉
async function downloadAndChoose(env) {
    env.updater.finishDownload();
    await settle();
}

// 新版本提示点「下载并安装」，下载完成框点 choice
function setupDownload(t, choice) {
    return setup(t, { dialogResponse: clicking({ 发现新版本: '下载并安装', 新版本已下载: choice }) });
}

test('restart and install now stops playback and waits for the progress report before installing', async (t) => {
    const env = setupDownload(t, '立即重启安装');
    const report = deferred();
    const { player } = startPlaying(env.playback, report.promise);

    await env.checker.manualCheckForUpdates();
    await settle();
    await downloadAndChoose(env);

    assert.equal(player.stops, 1);
    assert.deepEqual(env.updater.installs, []);

    report.resolve();
    await settle();
    assert.deepEqual(env.updater.installs, [{ isSilent: true, isForceRunAfter: true }]);
});

test('restart and install now installs right away when nothing is playing', async (t) => {
    const env = setupDownload(t, '立即重启安装');

    await env.checker.manualCheckForUpdates();
    await settle();
    await downloadAndChoose(env);

    assert.deepEqual(env.updater.installs, [{ isSilent: true, isForceRunAfter: true }]);
});

test('install on quit holds the quit, stops playback and waits for the progress report, then installs', async (t) => {
    const env = setupDownload(t, '退出时安装');
    const report = deferred();
    const { player } = startPlaying(env.playback, report.promise);

    await env.checker.manualCheckForUpdates();
    await settle();
    await downloadAndChoose(env);
    const firstQuit = quitApp(env.app);
    await settle();

    assert.equal(firstQuit.defaultPrevented, true);
    assert.equal(player.stops, 1);
    assert.deepEqual(env.updater.installs, []);

    report.resolve();
    await settle();
    // 不再自动重启客户端，和 electron-updater 自己退出时安装的参数一样
    assert.deepEqual(env.updater.installs, [{ isSilent: true, isForceRunAfter: false }]);
    // quitAndInstall 发起的退出照常进行
    assert.equal(quitApp(env.app).defaultPrevented, false);
});

test('install on quit installs on quit when nothing is playing', async (t) => {
    const env = setupDownload(t, '退出时安装');

    await env.checker.manualCheckForUpdates();
    await settle();
    await downloadAndChoose(env);
    assert.deepEqual(env.updater.installs, []);

    quitApp(env.app);
    await settle();

    assert.deepEqual(env.updater.installs, [{ isSilent: true, isForceRunAfter: false }]);
});

test('a client that quits without choosing install on quit quits right away', async (t) => {
    const env = setupDownload(t, '稍后提醒');

    await env.checker.manualCheckForUpdates();
    await settle();

    assert.equal(quitApp(env.app).defaultPrevented, false);
});

test('when the install on quit fails the client still quits', async (t) => {
    const env = setupDownload(t, '退出时安装');

    await env.checker.manualCheckForUpdates();
    await settle();
    await downloadAndChoose(env);
    quitApp(env.app);
    await settle();
    env.updater.emit('error', new Error('spawn EACCES'));
    await settle();

    assert.match(env.dialogs.at(-1).detail, /spawn EACCES/);
    assert.equal(env.app.quits, 1);
    assert.equal(quitApp(env.app).defaultPrevented, false);
});

test('a failed progress report does not block the install', async (t) => {
    const env = setupDownload(t, '立即重启安装');
    const report = deferred();
    startPlaying(env.playback, report.promise);

    await env.checker.manualCheckForUpdates();
    await settle();
    await downloadAndChoose(env);
    report.reject(new Error('NAS unreachable'));
    await settle();

    assert.deepEqual(env.updater.installs, [{ isSilent: true, isForceRunAfter: true }]);
});
