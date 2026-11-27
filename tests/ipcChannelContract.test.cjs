const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { useFakeElectron } = require('./helpers/fakeElectron.cjs');

const root = path.join(__dirname, '..');

function sourceFiles(dir, extension) {
    return fs.readdirSync(path.join(root, dir), { recursive: true })
        .filter((name) => name.endsWith(extension))
        .map((name) => fs.readFileSync(path.join(root, dir, name), 'utf8'));
}

function channels(sources, pattern) {
    const found = new Set();
    for (const source of sources) {
        for (const match of source.matchAll(pattern)) found.add(match.at(-1));
    }
    return found;
}

const sorted = (set) => [...set].sort();
const missing = (wanted, present) => sorted(wanted).filter((channel) => !present.has(channel));

const loginPageApi = fs.readFileSync(path.join(root, 'src', 'preload', 'loginPageApi.ts'), 'utf8');

function allowList(name) {
    const [, list] = loginPageApi.match(new RegExp(`${name} = new Set\\(\\[([^\\]]+)\\]`));
    return channels([list], /'([a-z-]+)'/g);
}

const loginPage = sourceFiles('resource/login', '.js');
const loginPageUses = (method) => channels(loginPage, new RegExp(`ipcRenderer\\.${method}\\('([a-z-]+)'`, 'g'));
const loginPageSends = loginPageUses('send');
const loginPageInvokes = new Set([...loginPageUses('invoke'), ...channels([loginPageApi], /invokeAllowed\('([a-z-]+)'/g)]);
const loginPageReceives = loginPageUses('(?:on|once|off)');

const preload = sourceFiles('src/preload', '.ts');
const webUiUses = (method) => channels(preload, new RegExp(`ipcRenderer\\.${method}\\('([a-z-]+)'`, 'g'));

const mainSends = channels(sourceFiles('src/main', '.ts'), /(?:event\.reply|webContents\.send)\('([a-z-]+)'/g);

function registerMainHandlers(t) {
    const testRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'fntv-ipc-contract-'));
    t.after(() => fs.rmSync(testRoot, { recursive: true, force: true }));
    t.mock.timers.enable({ apis: ['setInterval'] });
    const listened = new Set();
    const handled = new Set();
    useFakeElectron(t, {
        app: {
            getPath: () => testRoot,
            getAppPath: () => testRoot,
            getVersion: () => '0.0.0',
            getName: () => 'fntv',
            on() {},
            isPackaged: false,
            setPath() {},
            commandLine: { getSwitchValue: () => '' },
        },
        ipcMain: { on: (channel) => listened.add(channel), handle: (channel) => handled.add(channel), removeAllListeners() {} },
    });
    require('../dest/main/handlers/index.js').registerAllPlugins();
    return { listened, handled };
}

const sent = new Set([...loginPageSends, ...webUiUses('send')]);
const invoked = new Set([...loginPageInvokes, ...webUiUses('invoke')]);
const received = new Set([...loginPageReceives, ...webUiUses('(?:on|once|off)')]);

test('the preload allow lists hold exactly the channels the login page uses', () => {
    assert.deepEqual(sorted(allowList('SEND_CHANNELS')), sorted(loginPageSends));
    assert.deepEqual(sorted(allowList('INVOKE_CHANNELS')), sorted(loginPageInvokes));
    assert.deepEqual(sorted(allowList('RECEIVE_CHANNELS')), sorted(loginPageReceives));
});

test('every channel a page sends or invokes has a main process handler of the matching kind', (t) => {
    const { listened, handled } = registerMainHandlers(t);
    assert.deepEqual(missing(sent, listened), []);
    assert.deepEqual(missing(invoked, handled), []);
});

test('every main process handler is reached by a page', (t) => {
    const { listened, handled } = registerMainHandlers(t);
    assert.deepEqual(missing(listened, sent), []);
    assert.deepEqual(missing(handled, invoked), []);
});

test('every channel a page listens on is sent by the main process, and every channel it sends is listened on', () => {
    assert.deepEqual(missing(received, mainSends), []);
    assert.deepEqual(missing(mainSends, received), []);
});
