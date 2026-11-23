const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { useFakeElectron, useFakeModule } = require('./fakeElectron.cjs');
const { EventEmitter } = require('node:events');
const { createQuittingApp, requestQuit, startQuitCoordinator } = require('./fakeQuitApp.cjs');
const axios = require('axios');

const LATEST_RELEASE_URL = 'https://api.github.com/repos/JayYa/fntv-electron/releases/latest';
const LATEST_RELEASE_PAGE = 'https://github.com/JayYa/fntv-electron/releases/latest';

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

async function waitFor(condition, timeoutMs = 2000) {
    const deadline = Date.now() + timeoutMs;
    while (!condition()) {
        if (Date.now() > deadline) {
            throw new Error(`等待超时（${timeoutMs}ms）：${condition}`);
        }
        await nextTurn();
    }
}

async function settle() {
    for (let i = 0; i < 20; i += 1) {
        await nextTurn();
    }
}

function setupUpdateChecker(t, { respond, version = '2.6.2', config = { downloadProxyEnabled: false }, dialogResponse = 2, isPackaged = true }) {
    const testRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'fntv-update-'));
    const paths = { home: testRoot, userData: path.join(testRoot, '.fntv') };
    fs.mkdirSync(paths.userData, { recursive: true });
    fs.writeFileSync(path.join(paths.userData, 'config.json'), JSON.stringify(config));

    const dialogs = [];
    const opened = [];
    const events = [];
    const electronMock = {
        app: createQuittingApp(events, {
            isPackaged,
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
        powerMonitor: new EventEmitter(),
    };
    const updater = new FakeAutoUpdater({ app: electronMock.app, events });

    useFakeElectron(t, electronMock);
    useFakeModule(t, 'electron-updater', { autoUpdater: updater });

    const requests = [];
    const originalGet = axios.get;
    axios.get = async (url, requestConfig) => {
        requests.push(url);
        return respond(url, requestConfig);
    };

    const { getInstance } = require('../../dest/modules/updater/updateChecker.js');

    t.after(() => {
        axios.get = originalGet;
        fs.rmSync(testRoot, { recursive: true, force: true });
    });

    const logFile = isPackaged ? path.join(paths.userData, 'logs', 'app.log') : path.join(testRoot, 'log', 'app.log');
    const logText = () => (fs.existsSync(logFile) ? fs.readFileSync(logFile, 'utf8') : '');

    return {
        checker: getInstance(), app: electronMock.app, powerMonitor: electronMock.powerMonitor,
        events, dialogs, opened, requests, updater, logText,
    };
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

function runAsAppImage(t, appImageDir) {
    const original = process.env.APPIMAGE;
    if (appImageDir === undefined) {
        delete process.env.APPIMAGE;
    } else {
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

module.exports = {
    runAsAppImage,
    tempDir,
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
