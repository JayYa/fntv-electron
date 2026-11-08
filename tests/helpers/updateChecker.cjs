const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Module = require('node:module');
const axios = require('axios');

const LATEST_RELEASE_URL = 'https://api.github.com/repos/JayYa/fntv-electron/releases/latest';
const LATEST_RELEASE_PAGE = 'https://github.com/JayYa/fntv-electron/releases/latest';

// 加载编译后的 updateChecker，替换 electron 和 axios.get。
// respond(url, config) 返回 axios 响应或抛出错误；dialogResponse 是对话框点击的按钮序号。
function setupUpdateChecker(t, { respond, version = '2.6.2', config = { downloadProxyEnabled: false }, dialogResponse = 2 }) {
    const testRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'fntv-update-'));
    const paths = { home: testRoot, userData: path.join(testRoot, '.fntv') };
    fs.mkdirSync(paths.userData, { recursive: true });
    fs.writeFileSync(path.join(paths.userData, 'config.json'), JSON.stringify(config));

    const dialogs = [];
    const opened = [];
    const electronMock = {
        app: {
            isPackaged: true,
            getVersion() { return version; },
            getPath(name) { return paths[name]; },
            commandLine: { getSwitchValue() { return ''; } },
            setPath(name, value) { paths[name] = value; },
        },
        dialog: {
            async showMessageBox(options) {
                dialogs.push(options);
                return { response: dialogResponse };
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
    axios.get = async (url, requestConfig) => {
        requests.push(url);
        return respond(url, requestConfig);
    };

    const compiledModules = Object.keys(require.cache).filter((id) => id.includes(`${path.sep}dest${path.sep}`));
    compiledModules.forEach((id) => delete require.cache[id]);
    const { getInstance } = require('../../dest/modules/updater/updateChecker.js');

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
        status: 200,
        headers: {},
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

function httpError(status, { headers = {}, data = { message: 'Not Found' } } = {}) {
    return new axios.AxiosError(
        `Request failed with status code ${status}`,
        'ERR_BAD_REQUEST',
        {},
        {},
        { status, headers, data },
    );
}

function networkError() {
    return new axios.AxiosError('connect ECONNREFUSED', 'ECONNREFUSED', {}, {});
}

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

module.exports = {
    LATEST_RELEASE_URL,
    LATEST_RELEASE_PAGE,
    setupUpdateChecker,
    release,
    httpError,
    networkError,
    simulateHost,
};
