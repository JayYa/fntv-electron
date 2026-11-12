const test = require('node:test');
const assert = require('node:assert/strict');
const {
    LATEST_RELEASE_PAGE,
    setupUpdateChecker,
    settle,
    release,
    simulateHost,
} = require('./helpers/updateChecker.cjs');

const WIN_ASSETS = ['FNMedia_2.7.0_win_x64.exe', 'FNMedia_2.7.0_win_x64.exe.blockmap', 'latest.yml'];
const FEED = 'https://github.com/JayYa/fntv-electron/releases/latest/download/';

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

function setupWindows(t, options = {}) {
    simulateHost(t, 'win32', 'x64');
    return setupUpdateChecker(t, { respond: () => release('v2.7.0', WIN_ASSETS), ...options });
}

test('on Windows the new version dialog offers download and install, keeping the version and notes', async (t) => {
    const { checker, dialogs } = setupWindows(t);

    await checker.manualCheckForUpdates();

    assert.equal(dialogs.length, 1);
    assert.deepEqual(dialogs[0].buttons, ['下载并安装', '查看详情', '稍后提醒']);
    assert.equal(dialogs[0].detail, '当前版本: 2.6.2\n最新版本: 2.7.0\n\n更新内容:\nnotes');
});

for (const [platform, arch] of [['darwin', 'arm64']]) {
    test(`on ${platform} the new version dialog keeps the manual download buttons`, async (t) => {
        simulateHost(t, platform, arch);
        const { checker, dialogs, updater } = setupUpdateChecker(t, {
            respond: () => release('v2.7.0', ['FNMedia_2.7.0_mac_arm64.dmg', 'FNMedia_2.7.0_linux_x86_64.AppImage']),
            dialogResponse: clicking({ 发现新版本: '立即下载' }),
        });

        await checker.manualCheckForUpdates();
        await settle();

        assert.deepEqual(dialogs[0].buttons, ['立即下载', '查看详情', '稍后提醒']);
        assert.equal(updater.downloads, 0);
    });
}

test('an unpackaged Windows client keeps the manual download buttons', async (t) => {
    const { checker, dialogs } = setupWindows(t, { isPackaged: false });

    await checker.manualCheckForUpdates();

    assert.deepEqual(dialogs[0].buttons, ['立即下载', '查看详情', '稍后提醒']);
});

test('download and install starts a background download from the repository feed without opening a browser', async (t) => {
    const { checker, opened, updater } = setupWindows(t, { dialogResponse: clicking({ 发现新版本: '下载并安装' }) });

    await checker.manualCheckForUpdates();
    await settle();

    assert.deepEqual(updater.feeds, [{ provider: 'generic', url: FEED }]);
    assert.equal(updater.autoDownload, false);
    assert.equal(updater.disableDifferentialDownload, false);
    assert.equal(updater.downloads, 1);
    assert.deepEqual(opened, []);
});

test('the feed goes through the download proxy the user turned on', async (t) => {
    const { checker, updater } = setupWindows(t, {
        config: { downloadProxyEnabled: true, downloadProxy: 'https://ghfast.top/' },
        dialogResponse: clicking({ 发现新版本: '下载并安装' }),
    });

    await checker.autoCheckForUpdates();
    await settle();

    assert.deepEqual(updater.feeds, [{ provider: 'generic', url: `https://ghfast.top/${FEED}` }]);
});

test('checking again while downloading does not start a second download', async (t) => {
    const { checker, updater } = setupWindows(t, { dialogResponse: clicking({ 发现新版本: '下载并安装' }) });

    await checker.manualCheckForUpdates();
    await settle();
    updater.progress(42.7);
    await checker.manualCheckForUpdates();
    await settle();

    assert.equal(updater.downloads, 1);
    assert.equal(checker.downloadPercent(), 42);
});

test('download progress is reported and cleared when the download finishes', async (t) => {
    const { checker, updater } = setupWindows(t, { dialogResponse: clicking({ 发现新版本: '下载并安装' }) });
    const seen = [];
    checker.onDownloadProgress((percent) => seen.push(percent));

    await checker.manualCheckForUpdates();
    await settle();
    updater.progress(10.2);
    updater.progress(10.9);
    updater.progress(99.5);
    updater.finishDownload();
    await settle();

    assert.deepEqual(seen, [0, 10, 99, null]);
    assert.equal(checker.downloadPercent(), null);
});

test('restart and install now installs silently and reopens the client', async (t) => {
    const { checker, dialogs, updater } = setupWindows(t, {
        dialogResponse: clicking({ 发现新版本: '下载并安装', 新版本已下载: '立即重启安装' }),
    });

    await checker.manualCheckForUpdates();
    await settle();
    updater.finishDownload();
    await settle();

    assert.deepEqual(dialogs.map((d) => d.buttons), [
        ['下载并安装', '查看详情', '稍后提醒'],
        ['立即重启安装', '退出时安装'],
    ]);
    assert.deepEqual(updater.installs, [{ isSilent: true, isForceRunAfter: true }]);
});

test('install on quit leaves the client running and installs when it quits', async (t) => {
    const { checker, updater } = setupWindows(t, {
        dialogResponse: clicking({ 发现新版本: '下载并安装', 新版本已下载: '退出时安装' }),
    });

    await checker.manualCheckForUpdates();
    await settle();
    updater.finishDownload();
    await settle();

    assert.deepEqual(updater.installs, []);
    assert.equal(updater.autoInstallOnAppQuit, true);
});

test('a downloaded update is not installed on quit until the user chooses so', async (t) => {
    // 下载完成框一直开着，看这时退出会不会安装
    let answer;
    const click = clicking({ 发现新版本: '下载并安装' });
    const { checker, dialogs, updater } = setupWindows(t, {
        dialogResponse: (options) => (options.title === '新版本已下载'
            ? new Promise((resolve) => { answer = resolve; })
            : click(options)),
    });

    await checker.manualCheckForUpdates();
    await settle();
    updater.finishDownload();
    await settle();

    assert.equal(dialogs.at(-1).title, '新版本已下载');
    assert.equal(updater.autoInstallOnAppQuit, false);
    answer(0);
    await settle();
});

test('a failed download offers the Release page for a manual update', async (t) => {
    const { checker, dialogs, opened, updater } = setupWindows(t, {
        dialogResponse: clicking({ 发现新版本: '下载并安装', 应用内更新失败: '打开下载页面' }),
    });

    await checker.manualCheckForUpdates();
    await settle();
    updater.failDownload(new Error('sha512 checksum mismatch'));
    await settle();

    const failure = dialogs.at(-1);
    assert.equal(failure.type, 'error');
    assert.deepEqual(failure.buttons, ['打开下载页面', '确定']);
    assert.match(failure.detail, /sha512 checksum mismatch/);
    assert.deepEqual(opened, [LATEST_RELEASE_PAGE]);
    assert.equal(checker.downloadPercent(), null);
});

test('after a failed download the user can start the download again', async (t) => {
    const { checker, updater } = setupWindows(t, { dialogResponse: clicking({ 发现新版本: '下载并安装' }) });

    await checker.manualCheckForUpdates();
    await settle();
    updater.failDownload(new Error('net::ERR_CONNECTION_RESET'));
    await settle();
    await checker.manualCheckForUpdates();
    await settle();

    assert.equal(updater.downloads, 2);
});

test('a failed install offers the Release page for a manual update', async (t) => {
    const { checker, dialogs, opened, updater } = setupWindows(t, {
        dialogResponse: clicking({ 发现新版本: '下载并安装', 新版本已下载: '立即重启安装', 应用内更新失败: '打开下载页面' }),
    });

    await checker.manualCheckForUpdates();
    await settle();
    updater.finishDownload();
    await settle();
    updater.emit('error', new Error('spawn EACCES'));
    await settle();

    assert.match(dialogs.at(-1).detail, /spawn EACCES/);
    assert.deepEqual(opened, [LATEST_RELEASE_PAGE]);
});

test('remind me later neither downloads nor opens anything', async (t) => {
    const { checker, dialogs, opened, updater } = setupWindows(t, { dialogResponse: clicking({ 发现新版本: '稍后提醒' }) });

    await checker.manualCheckForUpdates();
    await settle();

    assert.equal(dialogs.length, 1);
    assert.equal(updater.downloads, 0);
    assert.deepEqual(updater.feeds, []);
    assert.deepEqual(opened, []);
});

test('remind me later still shows the dialog on the next check', async (t) => {
    const { checker, dialogs } = setupWindows(t, { dialogResponse: clicking({ 发现新版本: '稍后提醒' }) });

    await checker.manualCheckForUpdates();
    await checker.manualCheckForUpdates();

    assert.equal(dialogs.length, 2);
});
