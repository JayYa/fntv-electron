const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { ESLint } = require('eslint');

// IPC 处理器只能经 registerHandler 注册（eslint.config.mjs）。
const eslint = new ESLint({ cwd: path.join(__dirname, '..'), overrideConfig: { rules: { 'local/no-comments': 'off' } } });

async function messagesFor(code, filePath) {
    const [result] = await eslint.lintText(code, { filePath });
    return result.messages.map((message) => message.message);
}

for (const method of ['handle', 'on', 'once']) {
    test(`lint rejects ipcMain.${method} outside the IPC handler module`, async () => {
        const code = `import { ipcMain } from 'electron';\nipcMain.${method}('channel', () => undefined);\n`;
        const messages = await messagesFor(code, 'src/main/example.ts');
        assert.ok(messages.some((message) => message.includes('registerHandler')), messages.join('\n'));
    });
}

test('lint allows ipcMain registration inside the IPC handler module', async () => {
    const code = "import { ipcMain } from 'electron';\nipcMain.handle('channel', () => undefined);\nipcMain.on('channel', () => undefined);\n";
    assert.deepEqual(await messagesFor(code, 'src/main/handlers/core/ipcHandler.ts'), []);
});

test('lint allows removing ipcMain listeners', async () => {
    const code = "import { ipcMain } from 'electron';\nipcMain.removeAllListeners('channel');\n";
    assert.deepEqual(await messagesFor(code, 'src/main/example.ts'), []);
});
