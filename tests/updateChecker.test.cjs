const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Module = require('node:module');
const axios = require('axios');

const LATEST_RELEASE_URL = 'https://api.github.com/repos/JayYa/fntv-electron/releases/latest';

function setupUpdateChecker(t, { respond, version = '2.6.2' }) {
    const testRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'fntv-update-'));
    const paths = { home: testRoot, userData: path.join(testRoot, '.fntv') };
    fs.mkdirSync(paths.userData, { recursive: true });
    fs.writeFileSync(path.join(paths.userData, 'config.json'), JSON.stringify({ downloadProxyEnabled: false }));

    const dialogs = [];
    const opened = [];
    const electronMock = {
        app: {
            isPackaged: true,
            getVersion() { return version; },
            getPath(name) { return paths[name]; },
            setPath(name, value) { paths[name] = value; },
        },
        dialog: {
            async showMessageBox(options) {
                dialogs.push(options);
                return { response: 2 };
            },
        },
        shell: {
            openExternal(url) { opened.push(url); },
        },
        safeStorage: {
            isEncryptionAvailable() { return false; },
        },
    };

    const originalLoad = Module._load;
    Module._load = function(request, parent, isMain) {
        if (request === 'electron') return electronMock;
        return originalLoad.call(this, request, parent, isMain);
    };

    const requests = [];
    const originalGet = axios.get;
    axios.get = async (url) => {
        requests.push(url);
        return respond(url);
    };

    const compiledModules = Object.keys(require.cache).filter((id) => id.includes(`${path.sep}dest${path.sep}`));
    compiledModules.forEach((id) => delete require.cache[id]);
    const { getInstance } = require('../dest/modules/updater/updateChecker.js');

    t.after(() => {
        Module._load = originalLoad;
        axios.get = originalGet;
        Object.keys(require.cache)
            .filter((id) => id.includes(`${path.sep}dest${path.sep}`))
            .forEach((id) => delete require.cache[id]);
        fs.rmSync(testRoot, { recursive: true, force: true });
    });

    return { checker: getInstance(), dialogs, opened, requests };
}

function release(tagName, assetNames = []) {
    return {
        data: {
            tag_name: tagName,
            body: 'notes',
            published_at: '2026-11-05T00:00:00Z',
            html_url: `https://github.com/JayYa/fntv-electron/releases/tag/${tagName}`,
            assets: assetNames.map((name) => ({
                name,
                browser_download_url: `https://github.com/JayYa/fntv-electron/releases/download/${tagName}/${name}`,
            })),
        },
    };
}

test('checks the latest release of the maintained repository', async (t) => {
    const { checker, requests } = setupUpdateChecker(t, { respond: () => release('v2.7.0') });

    const info = await checker.checkForUpdates();

    assert.deepEqual(requests, [LATEST_RELEASE_URL]);
    assert.equal(info.hasUpdate, true);
    assert.equal(info.latestVersion, '2.7.0');
});

function httpError(status) {
    return new axios.AxiosError(
        `Request failed with status code ${status}`,
        'ERR_BAD_REQUEST',
        {},
        {},
        { status, data: { message: 'Not Found' } },
    );
}

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

    assert.equal(requests.length, 4);
    assert.equal(dialogs.length, 1);
    assert.equal(dialogs[0].type, 'error');
});

function simulateHost(t, platform, arch) {
    const originalPlatform = Object.getOwnPropertyDescriptor(process, 'platform');
    const originalArch = Object.getOwnPropertyDescriptor(process, 'arch');
    Object.defineProperty(process, 'platform', { ...originalPlatform, value: platform });
    Object.defineProperty(process, 'arch', { ...originalArch, value: arch });
    t.after(() => {
        Object.defineProperty(process, 'platform', originalPlatform);
        Object.defineProperty(process, 'arch', originalArch);
    });
}

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
