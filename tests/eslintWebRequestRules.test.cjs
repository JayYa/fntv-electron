const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { ESLint } = require('eslint');

const eslint = new ESLint({ cwd: path.join(__dirname, '..'), overrideConfig: { rules: { 'local/no-comments': 'off' } } });

async function messagesFor(code, filePath) {
    const [result] = await eslint.lintText(code, { filePath });
    return result.messages.map((message) => message.message);
}

const LISTENER = "import { session } from 'electron';\nsession.defaultSession.webRequest.onBeforeRequest({ urls: ['*://*/*'] }, (_details, callback) => callback({}));\n";

for (const filePath of ['src/main/example.ts', 'src/modules/quit/quitCoordinator.ts', 'src/public/platform/index.ts']) {
    test(`lint rejects webRequest.onBeforeRequest in ${filePath}`, async () => {
        const messages = await messagesFor(LISTENER, filePath);
        assert.ok(messages.some((message) => message.includes('registerBeforeRequest')), messages.join('\n'));
    });
}

test('lint allows webRequest.onBeforeRequest inside the interceptor module', async () => {
    assert.deepEqual(await messagesFor(LISTENER, 'src/main/handlers/core/interceptor.ts'), []);
});

test('the interceptor module keeps the other src restrictions', async () => {
    const messages = await messagesFor("import { app } from 'electron';\napp.on('before-quit', () => undefined);\n", 'src/main/handlers/core/interceptor.ts');
    assert.ok(messages.some((message) => message.includes('before-quit')), messages.join('\n'));
});
