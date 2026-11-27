const assert = require('node:assert/strict');
const { pathToFileURL } = require('node:url');

const MAIN_WINDOW = { getOSProcessId: () => process.pid };

const PAGES = {
    loginPage: () => pathToFileURL(require('../../dest/main/common/loginPage.js').LOGIN_PAGE_PATH).href,
    webUi: () => 'https://nas.example:5667/v',
};

function fakeIpcMain() {
    const handlers = new Map();
    const ipcMain = {
        handle(channel, handler) {
            assert.ok(!handlers.has(channel), `${channel} is registered twice`);
            handlers.set(channel, handler);
        },
        on(channel) { throw new Error(`ipcMain.on(${channel}) bypasses the IPC adapter`); },
        removeAllListeners() {},
    };

    function register(...handlerMaps) {
        const { registerChannels } = require('../../dest/main/ipc/adapter.js');
        registerChannels(Object.assign({}, ...handlerMaps), { isMainWindow: (sender) => sender === MAIN_WINDOW });
    }

    function invoke(channel, payload, { from = 'loginPage', frameUrl } = {}) {
        const handler = handlers.get(channel);
        assert.ok(handler, `no handler for ${channel}`);
        const event = {
            sender: from === 'otherWindow' ? {} : MAIN_WINDOW,
            senderFrame: frameUrl === null ? null : { url: frameUrl ?? (PAGES[from] ?? PAGES.webUi)() },
        };
        return handler(event, payload === undefined ? undefined : structuredClone(payload));
    }

    async function deliverTo(page) {
        let next;
        while ((next = page.pending().find(({ channel }) => handlers.has(channel)))) {
            let result;
            try {
                result = await invoke(next.channel, next.payload);
            } catch (error) {
                await page.reject(next.channel, error);
                continue;
            }
            await page.resolve(next.channel, result);
        }
    }

    return { ipcMain, handlers, register, invoke, deliverTo, MAIN_WINDOW };
}

module.exports = { fakeIpcMain };
