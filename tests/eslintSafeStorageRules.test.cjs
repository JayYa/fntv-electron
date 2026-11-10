const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { ESLint } = require('eslint');

// safeStorage 的同步方法在 Electron 46 删除，lint 拦住新增调用（eslint.config.mjs）。
const eslint = new ESLint({ cwd: path.join(__dirname, '..') });

async function messagesFor(code) {
    const [result] = await eslint.lintText(code, { filePath: 'src/main/example.ts' });
    return result.messages.map((message) => message.message);
}

for (const method of ['isEncryptionAvailable', 'encryptString', 'decryptString']) {
    test(`lint rejects safeStorage.${method}`, async () => {
        const messages = await messagesFor(`import { safeStorage } from 'electron';\nexport const f = () => safeStorage.${method};\n`);
        assert.ok(messages.some((message) => message.includes(`${method}Async`) || message.includes('isAsyncEncryptionAvailable')), messages.join('\n'));
    });
}

test('lint allows the async safeStorage API and getSelectedStorageBackend', async () => {
    const code = [
        "import { safeStorage } from 'electron';",
        'export const a = () => safeStorage.isAsyncEncryptionAvailable();',
        "export const e = () => safeStorage.encryptStringAsync('x');",
        'export const d = (b: Buffer) => safeStorage.decryptStringAsync(b);',
        'export const s = () => safeStorage.getSelectedStorageBackend();',
        '',
    ].join('\n');
    assert.deepEqual(await messagesFor(code), []);
});
