const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { ESLint } = require('eslint');

// before-quit 只在退出协调模块里监听，其它模块向它注册（eslint.config.mjs）。
const eslint = new ESLint({ cwd: path.join(__dirname, '..') });
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

test('the source tree registers before-quit only in the quit coordinator', async () => {
    const results = await eslint.lintFiles(['src/**/*.ts']);
    const offenders = results.flatMap((result) => result.messages
        .filter((message) => message.message.includes('quitCoordinator'))
        .map((message) => `${path.relative(path.join(__dirname, '..'), result.filePath)}:${message.line}`));
    assert.deepEqual(offenders, []);
});
