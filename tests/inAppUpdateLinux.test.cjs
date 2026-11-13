const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
    setupUpdateChecker,
    waitFor,
    release,
    simulateHost,
} = require('./helpers/updateChecker.cjs');

const APPIMAGE_NAME = 'FNMedia_2.7.0_linux_x86_64.AppImage';
const LINUX_ASSETS = [APPIMAGE_NAME, 'latest-linux.yml', 'FNMedia_2.7.0_linux_arm64.AppImage', 'latest-linux-arm64.yml'];
const ASSET_URL = `https://github.com/JayYa/fntv-electron/releases/download/v2.7.0/${APPIMAGE_NAME}`;
const FEED = 'https://github.com/JayYa/fntv-electron/releases/latest/download/';

function clickFirstButton() {
    return (options) => (options.title === '发现新版本' ? 0 : options.cancelId ?? 0);
}

// 模拟以 AppImage 运行：APPIMAGE 指向 dir 里的 AppImage；appImageDir 为 undefined 时模拟解包后运行
function runAsAppImage(t, appImageDir) {
    const original = process.env.APPIMAGE;
    if (appImageDir === undefined) {
        delete process.env.APPIMAGE;
    } else {
        // 客户端按 Linux 路径取目录，Windows 主机上也用正斜杠拼，fs 照样认
        process.env.APPIMAGE = `${appImageDir.split(path.sep).join('/')}/FNMedia_2.6.2_linux_x86_64.AppImage`;
    }
    t.after(() => {
        if (original === undefined) {
            delete process.env.APPIMAGE;
        } else {
            process.env.APPIMAGE = original;
        }
    });
}

function tempDir(t) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fntv-appimage-'));
    t.after(() => {
        fs.chmodSync(dir, 0o755);
        fs.rmSync(dir, { recursive: true, force: true });
    });
    return dir;
}

function setupLinux(t, options = {}) {
    simulateHost(t, 'linux', 'x64');
    return setupUpdateChecker(t, {
        respond: () => release('v2.7.0', LINUX_ASSETS),
        dialogResponse: clickFirstButton(),
        ...options,
    });
}

test('a Linux AppImage in a writable directory offers download and install and downloads in app', async (t) => {
    runAsAppImage(t, tempDir(t));
    const { checker, dialogs, opened, updater } = setupLinux(t);

    await checker.manualCheckForUpdates();
    await waitFor(() => updater.downloads === 1);

    assert.deepEqual(dialogs[0].buttons, ['下载并安装', '查看详情', '稍后提醒']);
    assert.deepEqual(updater.feeds, [{ provider: 'generic', url: FEED }]);
    assert.equal(updater.downloads, 1);
    assert.deepEqual(opened, []);
});

test('the Linux feed goes through the download proxy the user turned on', async (t) => {
    runAsAppImage(t, tempDir(t));
    const { checker, updater } = setupLinux(t, {
        config: { downloadProxyEnabled: true, downloadProxy: 'https://ghfast.top/' },
    });

    await checker.autoCheckForUpdates();
    await waitFor(() => updater.feeds.length === 1);

    assert.deepEqual(updater.feeds, [{ provider: 'generic', url: `https://ghfast.top/${FEED}` }]);
});

test('a Linux client not running as an AppImage keeps the manual download buttons and opens the AppImage link', async (t) => {
    runAsAppImage(t, undefined);
    const { checker, dialogs, opened, updater } = setupLinux(t);

    await checker.manualCheckForUpdates();
    await waitFor(() => opened.length === 1);

    assert.deepEqual(dialogs[0].buttons, ['立即下载', '查看详情', '稍后提醒']);
    assert.deepEqual(opened, [ASSET_URL]);
    assert.equal(updater.downloads, 0);
});

test('when the installed AppImage gets a new file name the new path is logged', async (t) => {
    runAsAppImage(t, tempDir(t));
    const { checker, updater, logText } = setupLinux(t);
    const newPath = '/home/user/Applications/FNMedia_2.7.0_linux_x86_64.AppImage';

    await checker.manualCheckForUpdates();
    await waitFor(() => updater.downloads === 1);
    // AppImage 文件名带版本号时，electron-updater 安装时换成新文件名并发这个事件
    updater.emit('appimage-filename-updated', newPath);

    const lines = logText().split('\n').filter((line) => line.includes(newPath));
    assert.equal(lines.length, 1, logText());
    assert.match(lines[0], /\bINFO\b/);
});

// Windows 上目录的只读属性不影响写入，造不出不可写的目录；root 能写任何目录。这条由 CI 的 Linux 和 macOS 验证。
const cannotMakeReadOnlyDir = process.platform === 'win32' || process.getuid?.() === 0;

test('a Linux AppImage in a read-only directory keeps the manual download buttons and opens the AppImage link', { skip: cannotMakeReadOnlyDir }, async (t) => {
    const dir = tempDir(t);
    fs.chmodSync(dir, 0o555);
    runAsAppImage(t, dir);
    const { checker, dialogs, opened, updater } = setupLinux(t);

    await checker.manualCheckForUpdates();
    await waitFor(() => opened.length === 1);

    assert.deepEqual(dialogs[0].buttons, ['立即下载', '查看详情', '稍后提醒']);
    assert.deepEqual(opened, [ASSET_URL]);
    assert.equal(updater.downloads, 0);
});
