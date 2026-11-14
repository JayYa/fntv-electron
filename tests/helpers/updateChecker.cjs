const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Module = require('node:module');
const { EventEmitter } = require('node:events');
const { createQuittingApp, requestQuit, startQuitCoordinator } = require('./fakeQuitApp.cjs');
const axios = require('axios');

const LATEST_RELEASE_URL = 'https://api.github.com/repos/JayYa/fntv-electron/releases/latest';
const LATEST_RELEASE_PAGE = 'https://github.com/JayYa/fntv-electron/releases/latest';

// 替换 electron-updater 的 autoUpdater。只记录公开方法的调用和收到的 feed；
// 下载由测试推进：progress(percent)、finishDownload()、failDownload(error)，出错时和真实的一样先发 error 事件再 reject。
class FakeAutoUpdater extends EventEmitter {
    constructor({ app, events }) {
        super();
        this.autoDownload = true;
        this.autoInstallOnAppQuit = true;
        this.disableDifferentialDownload = true;
        this.feeds = [];
        this.downloads = 0;
        this.installs = [];
        this.checkResult = { isUpdateAvailable: true, updateInfo: { version: '2.7.0' } };
        this.pendingDownload = null;
        this.installError = null;
        // 客户端的 app 和测试共用的事件记录
        this.app = app;
        this.events = events;
    }

    setFeedURL(options) { this.feeds.push(options); }

    async checkForUpdates() { return this.checkResult; }

    downloadUpdate() {
        this.downloads += 1;
        return new Promise((resolve, reject) => { this.pendingDownload = { resolve, reject }; });
    }

    progress(percent) { this.emit('download-progress', { percent }); }

    finishDownload() {
        this.emit('update-downloaded', this.checkResult.updateInfo);
        this.pendingDownload.resolve(['installer.exe']);
    }

    failDownload(error) {
        this.emit('error', error);
        this.pendingDownload.reject(error);
    }

    // 和 electron-updater 的 BaseUpdater 一样：安装程序启动成功就在下一轮 app.quit()；
    // 启动前就失败（installError）时同步发 error 事件，不退出
    quitAndInstall(isSilent, isForceRunAfter) {
        this.installs.push({ isSilent, isForceRunAfter });
        this.events.push('install started');
        if (this.installError) {
            this.emit('error', this.installError);
            return;
        }
        setImmediate(() => this.app.quit());
    }
}

const nextTurn = () => new Promise((resolve) => setImmediate(resolve));

// 等到 condition() 为真，超时就失败。要断言的事会发生时用它。
async function waitFor(condition, timeoutMs = 2000) {
    const deadline = Date.now() + timeoutMs;
    while (!condition()) {
        if (Date.now() > deadline) {
            throw new Error(`等待超时（${timeoutMs}ms）：${condition}`);
        }
        await nextTurn();
    }
}

// 让更新流程里已排队的回调跑完。只用于断言某事「没有发生」：这时没有可等的条件，
// 只能给它足够的机会发生。20 轮远多于流程里最长的 await 链（约 6 层）。
async function settle() {
    for (let i = 0; i < 20; i += 1) {
        await nextTurn();
    }
}

// 加载编译后的 updateChecker，替换 electron、electron-updater 和 axios.get。
// respond(url, config) 返回 axios 响应或抛出错误；
// dialogResponse 是对话框点击的按钮序号，也可以是 (options) => 序号，按弹框内容决定点哪个；
// 返回 Promise 时弹框一直开着，直到它完成。
function setupUpdateChecker(t, { respond, version = '2.6.2', config = { downloadProxyEnabled: false }, dialogResponse = 2, isPackaged = true }) {
    const testRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'fntv-update-'));
    const paths = { home: testRoot, userData: path.join(testRoot, '.fntv') };
    fs.mkdirSync(paths.userData, { recursive: true });
    fs.writeFileSync(path.join(paths.userData, 'config.json'), JSON.stringify(config));

    const dialogs = [];
    const opened = [];
    const events = [];
    // app.quit() 像 Electron 那样发 before-quit（tests/helpers/fakeQuitApp.cjs），测试用 requestQuit(app) 模拟用户退出
    const electronMock = {
        app: createQuittingApp(events, {
            isPackaged,
            // 未打包时日志写在 getAppPath()/log
            getAppPath() { return testRoot; },
            getVersion() { return version; },
            getPath(name) { return paths[name]; },
            commandLine: { getSwitchValue() { return ''; } },
            setPath(name, value) { paths[name] = value; },
        }),
        dialog: {
            async showMessageBox(options) {
                dialogs.push(options);
                return { response: await (typeof dialogResponse === 'function' ? dialogResponse(options) : dialogResponse) };
            },
        },
        shell: {
            openExternal(url) { opened.push(url); },
        },
        safeStorage: {},
    };
    const updater = new FakeAutoUpdater({ app: electronMock.app, events });

    const originalLoad = Module._load;
    Module._load = function(request, parent, isMain) {
        if (request === 'electron') return electronMock;
        if (request === 'electron-updater') return { autoUpdater: updater };
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

    // 打包后日志写在 userData（~/.fntv）/logs；未打包时写在 getAppPath()/log
    const logFile = isPackaged ? path.join(paths.userData, 'logs', 'app.log') : path.join(testRoot, 'log', 'app.log');
    const logText = () => (fs.existsSync(logFile) ? fs.readFileSync(logFile, 'utf8') : '');

    return { checker: getInstance(), app: electronMock.app, events, dialogs, opened, requests, updater, logText };
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
    settle,
    waitFor,
    requestQuit,
    startQuitCoordinator,
    release,
    httpError,
    networkError,
    simulateHost,
};
