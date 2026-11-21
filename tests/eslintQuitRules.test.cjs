const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { ESLint } = require('eslint');

// before-quit 和系统关机信号只在退出协调模块里监听，其它模块向它注册（eslint.config.mjs）。
const eslint = new ESLint({ cwd: path.join(__dirname, '..'), overrideConfig: { rules: { 'local/no-comments': 'off' } } });
const COORDINATOR = 'src/modules/quit/quitCoordinator.ts';

async function messagesFor(code, file = 'src/main/example.ts') {
    const [result] = await eslint.lintText(code, { filePath: file });
    return result.messages.map((message) => message.message);
}

const forbidden = {
    'app.on': "import { app } from 'electron';\napp.on('before-quit', () => {});\n",
    'app.once': "import { app } from 'electron';\napp.once('before-quit', () => {});\n",
    'app.prependListener': "import { app } from 'electron';\napp.prependListener('before-quit', () => {});\n",
    'app.prependOnceListener': "import { app } from 'electron';\napp.prependOnceListener('before-quit', () => {});\n",
    'app.addListener': "import { app } from 'electron';\napp.addListener('before-quit', () => {});\n",
    'electron.app.on': "import * as electron from 'electron';\nelectron.app.on('before-quit', () => {});\n",
    'a template literal event name': "import { app } from 'electron';\napp.on(`before-quit`, () => {});\n",
};

for (const [name, code] of Object.entries(forbidden)) {
    test(`lint rejects listening to before-quit outside the quit coordinator: ${name}`, async () => {
        const messages = await messagesFor(code);
        assert.ok(messages.some((message) => message.includes('quitCoordinator')), messages.join('\n') || '没有报错');
    });
}

test('lint allows the quit coordinator to listen to before-quit', async () => {
    assert.deepEqual(await messagesFor("import { app } from 'electron';\napp.on('before-quit', () => {});\n", COORDINATOR), []);
});

test('lint allows other app events outside the quit coordinator', async () => {
    const code = "import { app } from 'electron';\napp.on('window-all-closed', () => {});\napp.once('will-quit', () => {});\n";
    assert.deepEqual(await messagesFor(code), []);
});

// 系统关机信号也只在退出协调模块监听（#192）
const forbiddenShutdown = {
    'win.on session-end': "declare const win: Electron.BrowserWindow;\nwin.on('session-end', () => {});\n",
    'win.once session-end as a template literal': 'declare const win: Electron.BrowserWindow;\nwin.once(`session-end`, () => {});\n',
    'powerMonitor.on shutdown': "import { powerMonitor } from 'electron';\npowerMonitor.on('shutdown', () => {});\n",
    'electron.powerMonitor.prependListener shutdown': "import * as electron from 'electron';\nelectron.powerMonitor.prependListener('shutdown', () => {});\n",
};

for (const [name, code] of Object.entries(forbiddenShutdown)) {
    test(`lint rejects listening to system shutdown outside the quit coordinator: ${name}`, async () => {
        const messages = await messagesFor(code);
        assert.ok(messages.some((message) => message.includes('quitCoordinator')), messages.join('\n') || '没有报错');
    });
}

test('lint allows the quit coordinator to listen to system shutdown', async () => {
    const code = "import { powerMonitor } from 'electron';\ndeclare const win: Electron.BrowserWindow;\n"
        + "win.on('session-end', () => {});\npowerMonitor.on('shutdown', () => {});\n";
    assert.deepEqual(await messagesFor(code, COORDINATOR), []);
});

test('lint allows other emitters to use an event named shutdown', async () => {
    const code = "import { EventEmitter } from 'node:events';\nconst proxy = new EventEmitter();\nproxy.on('shutdown', () => {});\n";
    assert.deepEqual(await messagesFor(code), []);
});

test('the source tree registers before-quit and system shutdown only in the quit coordinator', async () => {
    const results = await eslint.lintFiles(['src/**/*.ts']);
    const offenders = results.flatMap((result) => result.messages
        .filter((message) => message.message.includes('quitCoordinator'))
        .map((message) => `${path.relative(path.join(__dirname, '..'), result.filePath)}:${message.line}`));
    assert.deepEqual(offenders, []);
});

const QUIT_EVENT_STRINGS = [/before-quit/, /session-end/, /(['"`])shutdown\1/];

function quitEventStringsOutsideCoordinator(root) {
    const files = fs.readdirSync(path.join(root, 'src'), { recursive: true, withFileTypes: true })
        .filter((entry) => entry.isFile())
        .map((entry) => path.relative(root, path.join(entry.parentPath, entry.name)).split(path.sep).join('/'));
    return files
        .filter((file) => file !== COORDINATOR)
        .filter((file) => {
            const source = fs.readFileSync(path.join(root, file), 'utf8');
            return QUIT_EVENT_STRINGS.some((pattern) => pattern.test(source));
        })
        .sort();
}

test('quit event names held in variables outside the quit coordinator are reported by file', (t) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'quit-event-strings-'));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    const write = (file, source) => {
        fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
        fs.writeFileSync(path.join(root, file), source);
    };
    write(COORDINATOR, "app.on('before-quit', f);\nwin.on('session-end', f);\npowerMonitor.on('shutdown', f);\n");
    write('src/main/beforeQuit.ts', "const e = 'before-quit';\napp.on(e, f);\n");
    write('src/main/sessionEnd.ts', 'const e = `session-end`;\nwin.on(e, f);\n');
    write('src/main/shutdown.ts', 'const e = "shutdown";\npowerMonitor.on(e, f);\n');
    write('src/main/proxy.ts', 'export async function shutdownProxyProcess() {}\nconst SHUTDOWN_TIMEOUT_MS = 5000;\n');

    assert.deepEqual(quitEventStringsOutsideCoordinator(root), [
        'src/main/beforeQuit.ts',
        'src/main/sessionEnd.ts',
        'src/main/shutdown.ts',
    ]);
});

test('the source tree mentions before-quit and system shutdown event names only in the quit coordinator', () => {
    assert.deepEqual(quitEventStringsOutsideCoordinator(path.join(__dirname, '..')), []);
});
