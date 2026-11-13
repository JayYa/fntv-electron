const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { useFakeElectron } = require('./helpers/fakeElectron.cjs');
const { openLoginPage } = require('./helpers/loginPage.cjs');

// 在临时 userData 里加载编译后的配置模块和配置 IPC 插件；storedConfig 为 undefined 时不建 config.json
function setupMain(t, storedConfig) {
    const testRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'fntv-download-proxy-'));
    const paths = { home: testRoot, userData: path.join(testRoot, '.fntv') };
    const ipcMain = new EventEmitter();
    const electronMock = {
        ipcMain,
        app: {
            isPackaged: false,
            getAppPath() { return testRoot; },
            getPath(name) { return paths[name]; },
            commandLine: { getSwitchValue() { return ''; } },
            setPath(name, value) { paths[name] = value; },
        },
        safeStorage: {},
    };
    useFakeElectron(t, electronMock);
    t.after(() => fs.rmSync(testRoot, { recursive: true, force: true }));

    fs.mkdirSync(paths.userData, { recursive: true });
    const configPath = path.join(paths.userData, 'config.json');
    if (storedConfig !== undefined) {
        fs.writeFileSync(configPath, JSON.stringify(storedConfig));
    }
    return {
        ipcMain,
        configPath,
        config: require('../dest/modules/fn_config/config.js'),
        loadConfigPlugin: () => require('../dest/main/handlers/plugins/config.js'),
    };
}

// 打开登录页，把它发出的应用更新下载加速请求交给主进程的配置插件，回复再送回页面
function openConnectedLoginPage(ipcMain) {
    const page = openLoginPage();
    let delivered = 0;
    const deliver = () => {
        while (delivered < page.sent.length) {
            const { channel, payload } = page.sent[delivered];
            delivered += 1;
            if (channel === 'get-download-proxy' || channel === 'set-download-proxy') {
                ipcMain.emit(channel, { reply: (replyChannel, data) => page.receive(replyChannel, data) }, payload);
            }
        }
    };
    page.load();
    deliver();
    return {
        proxyUrlInput: () => page.input('proxyUrlInput'),
        clearProxyUrlAndSave() {
            page.click('proxySettingsBtn');
            page.input('proxyUrlInput').value = '';
            page.click('proxySaveBtn');
            deliver();
        },
    };
}

test('the app download proxy uses the built-in relay when no address was ever saved', (t) => {
    const { config } = setupMain(t, undefined);

    assert.deepEqual(config.getAppDownloadProxyConfig(), {
        enabled: false,
        proxyUrl: config.DEFAULT_DOWNLOAD_PROXY_URL,
    });
});

for (const unusable of ['', '   ', 42, null]) {
    test(`a saved relay address ${JSON.stringify(unusable)} reads as the built-in relay`, (t) => {
        const { config } = setupMain(t, { downloadProxyEnabled: true, downloadProxy: unusable });

        assert.equal(config.getAppDownloadProxyConfig().proxyUrl, config.DEFAULT_DOWNLOAD_PROXY_URL);
    });
}

for (const legacy of ['https://ghfast.top', 'https://ghfast.top/', '  https://ghfast.top/  ']) {
    test(`a saved legacy default relay ${JSON.stringify(legacy)} reads as the built-in relay without rewriting the config file`, (t) => {
        const { config, configPath } = setupMain(t, { downloadProxyEnabled: true, downloadProxy: legacy });
        const before = fs.readFileSync(configPath, 'utf8');

        assert.deepEqual(config.getAppDownloadProxyConfig(), {
            enabled: true,
            proxyUrl: config.DEFAULT_DOWNLOAD_PROXY_URL,
        });
        assert.equal(fs.readFileSync(configPath, 'utf8'), before);
    });
}

for (const custom of ['https://relay.example.test/', 'https://ghfast.top/gh/', 'https://ghfast.top.example.test']) {
    test(`a saved custom relay ${JSON.stringify(custom)} is returned as saved`, (t) => {
        const { config } = setupMain(t, { downloadProxyEnabled: true, downloadProxy: custom });

        assert.equal(config.getAppDownloadProxyConfig().proxyUrl, custom);
    });
}

test('the settings panel shows the built-in relay when no address was ever saved', (t) => {
    const { ipcMain, config, loadConfigPlugin } = setupMain(t, undefined);
    loadConfigPlugin().init();

    const page = openConnectedLoginPage(ipcMain);

    assert.equal(page.proxyUrlInput().value, config.DEFAULT_DOWNLOAD_PROXY_URL);
    assert.equal(page.proxyUrlInput().placeholder, config.DEFAULT_DOWNLOAD_PROXY_URL);
});

test('saving an empty relay address still shows the built-in relay, also after reopening the page', (t) => {
    const { ipcMain, config, loadConfigPlugin } = setupMain(t, { downloadProxyEnabled: true, downloadProxy: 'https://relay.example.test/' });
    loadConfigPlugin().init();
    const page = openConnectedLoginPage(ipcMain);
    assert.equal(page.proxyUrlInput().value, 'https://relay.example.test/');

    page.clearProxyUrlAndSave();

    assert.equal(page.proxyUrlInput().value, config.DEFAULT_DOWNLOAD_PROXY_URL);
    assert.equal(openConnectedLoginPage(ipcMain).proxyUrlInput().value, config.DEFAULT_DOWNLOAD_PROXY_URL);
    assert.equal(config.getAppDownloadProxyConfig().proxyUrl, config.DEFAULT_DOWNLOAD_PROXY_URL);
});
