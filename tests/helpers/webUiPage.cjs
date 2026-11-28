const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { Window } = require('happy-dom');

const BUNDLE = path.resolve(__dirname, '..', '..', 'dest', 'preload', 'bundle.js');

function fakeIpcRenderer({ mpvPlayback }) {
    const sent = [];
    const snapshot = { appDownloadProxy: { enabled: false, proxyUrl: 'https://gh-proxy.com/' }, mpvPlayback, defaultProxyUrl: 'https://gh-proxy.com/' };

    return {
        sent,
        ipcRenderer: {
            invoke(channel, payload) {
                sent.push({ channel, payload });
                if (channel !== 'get-preferences') return Promise.resolve(undefined);
                return mpvPlayback === 'no reply' ? new Promise(() => {}) : Promise.resolve(snapshot);
            },
            on() {},
            off() {},
        },
    };
}

function settle() {
    return new Promise(resolve => setImmediate(resolve));
}

async function openWebUiPage(t, { url, html, mpvPlayback = true, readyState = 'loading' }) {
    const window = new Window({ url });
    t.after(() => window.happyDOM.close());
    const { document } = window;
    document.body.innerHTML = html;
    Object.defineProperty(document, 'readyState', { configurable: true, value: readyState });

    const { sent, ipcRenderer } = fakeIpcRenderer({ mpvPlayback });
    const context = vm.createContext({
        window,
        document,
        Element: window.Element,
        HTMLElement: window.HTMLElement,
        HTMLAnchorElement: window.HTMLAnchorElement,
        HTMLButtonElement: window.HTMLButtonElement,
        MouseEvent: window.MouseEvent,
        MutationObserver: window.MutationObserver,
        URL,
        console: { debug() {}, info() {}, warn() {}, error() {}, log() {} },
        setTimeout: (...args) => globalThis.setTimeout(...args),
        clearTimeout: (...args) => globalThis.clearTimeout(...args),
        require(name) {
            if (name !== 'electron') throw new Error(`preload bundle required ${name}`);
            return { ipcRenderer, contextBridge: { exposeInMainWorld() {} } };
        },
        module: { exports: {} },
    });
    vm.runInContext(fs.readFileSync(BUNDLE, 'utf8'), context);

    if (readyState === 'loading') {
        Object.defineProperty(document, 'readyState', { configurable: true, value: 'interactive' });
        document.dispatchEvent(new window.Event('DOMContentLoaded'));
    }
    await settle();

    function element(selector) {
        const found = document.querySelector(selector);
        if (!found) throw new Error(`no element matches ${selector}`);
        return found;
    }

    function dispatch(selector, event) {
        element(selector).dispatchEvent(event);
    }

    const page = {
        window,
        document,
        settle,
        plays: () => sent
            .filter(message => message.channel === 'play-movie')
            .map(message => JSON.parse(JSON.stringify(message.payload))),
        nativeClicks(selector) {
            const clicks = [];
            element(selector).addEventListener('click', event => clicks.push(event));
            return clicks;
        },
        pointerDown: selector => dispatch(selector, new window.PointerEvent('pointerdown', { bubbles: true, cancelable: true })),
        pointerCancel: selector => dispatch(selector, new window.PointerEvent('pointercancel', { bubbles: true })),
        pointerUp: selector => dispatch(selector, new window.PointerEvent('pointerup', { bubbles: true, cancelable: true })),
        click: selector => dispatch(selector, new window.MouseEvent('click', { bubbles: true, cancelable: true })),
        press(selector, key, { repeat = false } = {}) {
            dispatch(selector, new window.KeyboardEvent('keydown', { key, repeat, bubbles: true, cancelable: true }));
        },
        tap(selector) {
            page.pointerDown(selector);
            page.pointerUp(selector);
            page.click(selector);
        },
        async changeDom(html) {
            document.body.insertAdjacentHTML('beforeend', html);
            await settle();
        },
    };
    return page;
}

module.exports = { openWebUiPage };
