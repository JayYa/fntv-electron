const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const {
    LATEST_RELEASE_URL,
    LATEST_RELEASE_PAGE,
    setupUpdateChecker,
    httpError,
    networkError,
    simulateHost,
} = require('./helpers/updateChecker.cjs');

const RESET_AT = Math.floor(Date.now() / 1000) + 30 * 60;

function localClock(epochSeconds) {
    const date = new Date(epochSeconds * 1000);
    return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

function rateLimited(status = 403) {
    return httpError(status, {
        headers: { 'x-ratelimit-limit': '60', 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': String(RESET_AT) },
        data: { message: 'API rate limit exceeded for 203.0.113.7.' },
    });
}

// 真实的 axios 默认跟随重定向，拿到的是 200 的 HTML；只有关掉重定向才看得到 Location
function releasePageRedirect(tagName) {
    return (config) => {
        if (config?.maxRedirects !== 0) {
            return { status: 200, headers: {}, data: '<html></html>' };
        }
        return { status: 302, headers: { location: `https://github.com/JayYa/fntv-electron/releases/tag/${tagName}` }, data: '' };
    };
}

function apiCount(requests) {
    return requests.filter((url) => url === LATEST_RELEASE_URL).length;
}

test('a rate-limited API is not retried and the user is told when to retry', async (t) => {
    const { checker, dialogs, opened, requests } = setupUpdateChecker(t, {
        respond: (url) => { throw url === LATEST_RELEASE_URL ? rateLimited() : networkError(); },
        dialogResponse: 0,
    });

    await checker.manualCheckForUpdates();

    assert.equal(apiCount(requests), 1);
    assert.equal(dialogs.length, 1);
    assert.match(dialogs[0].detail, /GitHub 访问次数暂时用完/);
    assert.ok(dialogs[0].detail.includes(localClock(RESET_AT)), dialogs[0].detail);
    assert.doesNotMatch(dialogs[0].detail, /status code/);
    assert.equal(dialogs[0].buttons[0], '打开下载页面');
    assert.deepEqual(opened, [LATEST_RELEASE_PAGE]);
});

test('HTTP 429 with an exhausted quota is not retried either', async (t) => {
    const { checker, requests } = setupUpdateChecker(t, {
        respond: (url) => { throw url === LATEST_RELEASE_URL ? rateLimited(429) : networkError(); },
    });

    await assert.rejects(checker.checkForUpdates(), /GitHub 访问次数暂时用完/);
    assert.equal(apiCount(requests), 1);
});

test('when the API is rate-limited the release page redirect still finds the new version', async (t) => {
    simulateHost(t, 'win32', 'x64');
    const { checker } = setupUpdateChecker(t, {
        respond: (url, config) => {
            if (url === LATEST_RELEASE_URL) throw rateLimited();
            if (url === LATEST_RELEASE_PAGE) return releasePageRedirect('v2.7.0')(config);
            throw networkError();
        },
    });

    const info = await checker.checkForUpdates();

    assert.equal(info.hasUpdate, true);
    assert.equal(info.latestVersion, '2.7.0');
    assert.equal(info.downloadUrl, 'https://github.com/JayYa/fntv-electron/releases/download/v2.7.0/FNMedia_2.7.0_win_x64.exe');
    assert.equal(info.htmlUrl, 'https://github.com/JayYa/fntv-electron/releases/tag/v2.7.0');
    assert.match(info.releaseNotes, /Release 页面/);
});

test('the fallback download link for Linux x64 uses the x86_64 AppImage name', async (t) => {
    simulateHost(t, 'linux', 'x64');
    const { checker } = setupUpdateChecker(t, {
        respond: (url, config) => {
            if (url === LATEST_RELEASE_URL) throw rateLimited();
            return releasePageRedirect('v2.7.0')(config);
        },
    });

    const { downloadUrl } = await checker.checkForUpdates();

    assert.equal(path.posix.basename(downloadUrl), 'FNMedia_2.7.0_linux_x86_64.AppImage');
});

test('the fallback download link goes through the download proxy when it is enabled', async (t) => {
    simulateHost(t, 'darwin', 'arm64');
    const { checker } = setupUpdateChecker(t, {
        config: { downloadProxyEnabled: true, downloadProxy: 'https://proxy.example/' },
        respond: (url, config) => {
            if (url === LATEST_RELEASE_URL) throw rateLimited();
            return releasePageRedirect('v2.7.0')(config);
        },
    });

    const { downloadUrl } = await checker.checkForUpdates();

    assert.equal(downloadUrl, 'https://proxy.example/https://github.com/JayYa/fntv-electron/releases/download/v2.7.0/FNMedia_2.7.0_mac_arm64.dmg');
});

test('the fallback reports no update when the redirect points at the current version', async (t) => {
    const { checker } = setupUpdateChecker(t, {
        version: '2.7.0',
        respond: (url, config) => {
            if (url === LATEST_RELEASE_URL) throw rateLimited();
            return releasePageRedirect('v2.7.0')(config);
        },
    });

    const info = await checker.checkForUpdates();

    assert.equal(info.hasUpdate, false);
});

test('checks before the rate limit resets skip the API and use the release page', async (t) => {
    const { checker, requests } = setupUpdateChecker(t, {
        respond: (url, config) => {
            if (url === LATEST_RELEASE_URL) throw rateLimited();
            return releasePageRedirect('v2.7.0')(config);
        },
    });

    await checker.checkForUpdates();
    const info = await checker.checkForUpdates();

    assert.equal(apiCount(requests), 1);
    assert.equal(info.latestVersion, '2.7.0');
});

test('a network failure still retries the API before falling back', async (t) => {
    const { checker, requests } = setupUpdateChecker(t, {
        respond: (url, config) => {
            if (url === LATEST_RELEASE_URL) throw networkError();
            return releasePageRedirect('v2.7.0')(config);
        },
    });

    const info = await checker.checkForUpdates();

    assert.equal(apiCount(requests), 4);
    assert.equal(info.latestVersion, '2.7.0');
});
