const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const {
    LATEST_RELEASE_URL,
    setupUpdateChecker,
    release,
    httpError,
    simulateHost,
} = require('./helpers/updateChecker.cjs');

test('checks the latest release of the maintained repository', async (t) => {
    const { checker, requests } = setupUpdateChecker(t, { respond: () => release('v2.7.0') });

    const info = await checker.checkForUpdates();

    assert.deepEqual(requests, [LATEST_RELEASE_URL]);
    assert.equal(info.hasUpdate, true);
    assert.equal(info.latestVersion, '2.7.0');
});

test('a repository without releases means no update, without retrying', async (t) => {
    const { checker, requests } = setupUpdateChecker(t, {
        respond: () => { throw httpError(404); },
    });

    const info = await checker.checkForUpdates();

    assert.deepEqual(info, { hasUpdate: false });
    assert.equal(requests.length, 1);
});

test('manual check reports up to date when the repository has no releases', async (t) => {
    const { checker, dialogs } = setupUpdateChecker(t, {
        respond: () => { throw httpError(404); },
    });

    await checker.manualCheckForUpdates();

    assert.equal(dialogs.length, 1);
    assert.equal(dialogs[0].type, 'info');
    assert.equal(dialogs[0].message, '当前已是最新版本');
});

test('automatic check stays silent when the repository has no releases', async (t) => {
    const { checker, dialogs } = setupUpdateChecker(t, {
        respond: () => { throw httpError(404); },
    });

    await checker.autoCheckForUpdates();

    assert.deepEqual(dialogs, []);
});

test('manual check still reports other GitHub failures after retrying', async (t) => {
    const { checker, dialogs, requests } = setupUpdateChecker(t, {
        respond: () => { throw httpError(503); },
    });

    await checker.manualCheckForUpdates();

    assert.equal(requests.filter((url) => url === LATEST_RELEASE_URL).length, 4);
    assert.equal(dialogs.length, 1);
    assert.equal(dialogs[0].type, 'error');
});

const LINUX_ARM64 = 'FNMedia_2.7.0_linux_arm64.AppImage';
const LINUX_X86_64 = 'FNMedia_2.7.0_linux_x86_64.AppImage';
const LINUX_X64 = 'FNMedia_2.7.0_linux_x64.AppImage';

async function downloadFileName(t, assetNames) {
    const { checker } = setupUpdateChecker(t, { respond: () => release('v2.7.0', assetNames) });
    const { downloadUrl } = await checker.checkForUpdates();
    return downloadUrl === null ? null : path.posix.basename(downloadUrl);
}

test('Linux x64 picks the x86_64 AppImage even when arm64 is listed first', async (t) => {
    simulateHost(t, 'linux', 'x64');

    assert.equal(await downloadFileName(t, [LINUX_ARM64, LINUX_X86_64]), LINUX_X86_64);
});

test('Linux x64 still picks an AppImage named x64', async (t) => {
    simulateHost(t, 'linux', 'x64');

    assert.equal(await downloadFileName(t, [LINUX_ARM64, LINUX_X64]), LINUX_X64);
});

test('Linux x64 gets no download link when only arm64 is published', async (t) => {
    simulateHost(t, 'linux', 'x64');

    assert.equal(await downloadFileName(t, [LINUX_ARM64]), null);
});

test('Linux arm64 keeps picking the arm64 AppImage', async (t) => {
    simulateHost(t, 'linux', 'arm64');

    assert.equal(await downloadFileName(t, [LINUX_X86_64, LINUX_ARM64]), LINUX_ARM64);
});

test('Linux x64 rejects names that end in AppImage without the .AppImage extension', async (t) => {
    simulateHost(t, 'linux', 'x64');

    assert.equal(await downloadFileName(t, [
        'FNMedia_2.7.0_linux_x86_64AppImage',
        'FNMedia_2.7.0_linux_x86_64-AppImage',
        'FNMedia_2.7.0_linux_x64AppImage',
        'FNMedia_2.7.0_linux_x64-AppImage',
    ]), null);
});

test('Linux arm64 rejects names that end in AppImage without the .AppImage extension', async (t) => {
    simulateHost(t, 'linux', 'arm64');

    assert.equal(await downloadFileName(t, [
        'FNMedia_2.7.0_linux_arm64AppImage',
        'FNMedia_2.7.0_linux_arm64-AppImage',
    ]), null);
});

// 2.6.2 在 Release Build（actions/runs/41963636062）里的真实产物名，版本号换成 2.7.0。
const PUBLISHED_ASSETS = [
    'FNMedia_2.7.0_linux_arm64.AppImage',
    'FNMedia_2.7.0_linux_x86_64.AppImage',
    'FNMedia_2.7.0_mac_arm64.dmg',
    'FNMedia_2.7.0_mac_arm64.dmg.blockmap',
    'FNMedia_2.7.0_mac_x64.dmg',
    'FNMedia_2.7.0_mac_x64.dmg.blockmap',
    'FNMedia_2.7.0_win_x64.exe',
    'FNMedia_2.7.0_win_x64.exe.blockmap',
];

for (const [platform, arch, expected] of [
    ['win32', 'x64', 'FNMedia_2.7.0_win_x64.exe'],
    ['darwin', 'x64', 'FNMedia_2.7.0_mac_x64.dmg'],
    ['darwin', 'arm64', 'FNMedia_2.7.0_mac_arm64.dmg'],
    ['linux', 'x64', 'FNMedia_2.7.0_linux_x86_64.AppImage'],
    ['linux', 'arm64', 'FNMedia_2.7.0_linux_arm64.AppImage'],
]) {
    test(`${platform} ${arch} picks its installer from a full release, not a blockmap`, async (t) => {
        simulateHost(t, platform, arch);

        assert.equal(await downloadFileName(t, PUBLISHED_ASSETS), expected);
    });
}

for (const [tagName, current, hasUpdate] of [
    ['v2.7.0', '2.6.2', true],
    ['v2.7.0', '2.7.0', false],
    ['v2.6.2', '2.7.0', false],
    ['v2.10.0', '2.9.0', true],
]) {
    test(`release tag ${tagName} against installed ${current} reports hasUpdate ${hasUpdate}`, async (t) => {
        const { checker } = setupUpdateChecker(t, { version: current, respond: () => release(tagName) });

        const info = await checker.checkForUpdates();

        assert.equal(info.hasUpdate, hasUpdate);
        assert.equal(info.latestVersion, tagName.slice(1));
    });
}

test('download link goes straight to GitHub when the proxy was never configured', async (t) => {
    simulateHost(t, 'win32', 'x64');
    const { checker } = setupUpdateChecker(t, { config: {}, respond: () => release('v2.7.0', PUBLISHED_ASSETS) });

    const { downloadUrl } = await checker.checkForUpdates();

    assert.equal(downloadUrl, 'https://github.com/JayYa/fntv-electron/releases/download/v2.7.0/FNMedia_2.7.0_win_x64.exe');
});

test('download link keeps the proxy a user explicitly turned on', async (t) => {
    simulateHost(t, 'win32', 'x64');
    const { checker } = setupUpdateChecker(t, {
        config: { downloadProxyEnabled: true, downloadProxy: 'https://ghfast.top' },
        respond: () => release('v2.7.0', PUBLISHED_ASSETS),
    });

    const { downloadUrl } = await checker.checkForUpdates();

    assert.equal(downloadUrl, 'https://ghfast.top/https://github.com/JayYa/fntv-electron/releases/download/v2.7.0/FNMedia_2.7.0_win_x64.exe');
});

test('update dialog shows release-please notes as plain text', async (t) => {
    const body = [
        '## [2.7.0](https://github.com/JayYa/fntv-electron/compare/v2.6.2...v2.7.0) (2026-11-07)',
        '',
        '',
        '### 问题修复',
        '',
        '* **updater:** 新版本下载链接默认直连 GitHub ([ac6a39a](https://github.com/JayYa/fntv-electron/commit/ac6a39a))',
        '',
    ].join('\n');
    const { checker, dialogs } = setupUpdateChecker(t, {
        respond: () => ({ data: { ...release('v2.7.0').data, body } }),
    });

    await checker.manualCheckForUpdates();

    assert.equal(dialogs.length, 1);
    assert.equal(
        dialogs[0].detail,
        '当前版本: 2.6.2\n最新版本: 2.7.0\n\n更新内容:\n问题修复\n• 新版本下载链接默认直连 GitHub',
    );
});

test('update dialog shows a placeholder when the release has no notes', async (t) => {
    const { checker, dialogs } = setupUpdateChecker(t, {
        respond: () => ({ data: { ...release('v2.7.0').data, body: '' } }),
    });

    await checker.manualCheckForUpdates();

    assert.match(dialogs[0].detail, /更新内容:\n暂无更新说明$/);
});
