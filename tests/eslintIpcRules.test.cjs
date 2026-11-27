const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { ESLint } = require('eslint');

const eslint = new ESLint({ cwd: path.join(__dirname, '..'), overrideConfig: { rules: { 'local/no-comments': 'off' } } });

async function messagesFor(code, filePath) {
    const [result] = await eslint.lintText(code, { filePath });
    return result.messages.map((message) => message.message);
}

for (const method of ['handle', 'on', 'once']) {
    test(`lint rejects ipcMain.${method} outside the IPC adapter`, async () => {
        const code = `import { ipcMain } from 'electron';\nipcMain.${method}('channel', () => undefined);\n`;
        const messages = await messagesFor(code, 'src/main/example.ts');
        assert.ok(messages.some((message) => message.includes('src/main/ipc/adapter.ts')), messages.join('\n'));
    });
}

test('lint allows ipcMain registration inside the IPC adapter', async () => {
    const code = "import { ipcMain } from 'electron';\nipcMain.handle('channel', () => undefined);\n";
    assert.deepEqual(await messagesFor(code, 'src/main/ipc/adapter.ts'), []);
});

test('lint allows removing ipcMain listeners', async () => {
    const code = "import { ipcMain } from 'electron';\nipcMain.removeAllListeners('channel');\n";
    assert.deepEqual(await messagesFor(code, 'src/main/example.ts'), []);
});

for (const call of ["window.webContents.send('channel', 1)", "webContents.send('channel', 1)", "event.sender.send('channel', 1)", "event.reply('channel', 1)"]) {
    test(`lint rejects pushing to a page with ${call} outside the IPC adapter`, async () => {
        const code = `export function pushIt(window: any, webContents: any, event: any): void {\n    ${call};\n}\n`;
        const messages = await messagesFor(code, 'src/main/example.ts');
        assert.ok(messages.some((message) => message.includes('push')), messages.join('\n'));
        assert.deepEqual((await messagesFor(code, 'src/main/ipc/adapter.ts')).filter((message) => message.includes('push')), []);
    });
}

for (const method of ['send', 'invoke', 'on', 'once', 'off']) {
    test(`lint rejects ipcRenderer.${method} outside the preload IPC helper`, async () => {
        const code = `import { ipcRenderer } from 'electron';\nipcRenderer.${method}('channel', () => undefined);\n`;
        const messages = await messagesFor(code, 'src/preload/plugins/example.ts');
        assert.ok(messages.some((message) => message.includes('src/preload/core/ipc.ts')), messages.join('\n'));
        assert.deepEqual(await messagesFor(code, 'src/preload/core/ipc.ts'), []);
    });
}
