const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { ESLint } = require('eslint');

// 平台判断只在 src/public/platform.ts 发生（eslint.config.mjs）。
const eslint = new ESLint({ cwd: path.join(__dirname, '..') });

async function messagesFor(code, file = 'src/main/example.ts') {
    const [result] = await eslint.lintText(code, { filePath: file });
    return result.messages.map((message) => message.message);
}

const forbidden = {
    'namespace import os.platform()': "import * as os from 'os';\nexport const p = os.platform();\n",
    'namespace import node:os os.arch()': "import * as os from 'node:os';\nexport const a = os.arch();\n",
    'default import os.platform()': "import os from 'os';\nexport const p = os.platform();\n",
    'namespace import under another name': "import * as nodeOs from 'os';\nexport const p = nodeOs.platform();\n",
    'default import under another name': "import system from 'node:os';\nexport const a = system.arch();\n",
    'named import platform': "import { platform } from 'os';\nexport const p = platform();\n",
    'renamed named import arch': "import { arch as cpu } from 'node:os';\nexport const a = cpu();\n",
    'require(os).platform()': "export const p = require('os').platform();\n",
    'destructured require arch': "const { arch } = require('node:os');\nexport const a = arch();\n",
    'process.platform': 'export const p = process.platform;\n',
    'comparing currentPlatform() at the call site': "import { currentPlatform } from '../public/platform';\nexport const w = currentPlatform() === 'win32';\n",
    'comparing currentPlatform() on the right': "import { currentPlatform } from '../public/platform';\nexport const m = 'darwin' !== currentPlatform();\n",
    'comparing currentArch() at the call site': "import { currentArch } from '../public/platform';\nexport const a = currentArch() === 'arm64';\n",
    'switching on currentPlatform()': "import { currentPlatform } from '../public/platform';\nexport function f(): number { switch (currentPlatform()) { case 'linux': return 1; default: return 0; } }\n",
};

for (const [name, code] of Object.entries(forbidden)) {
    test(`outside platform.ts lint rejects ${name}`, async () => {
        const messages = await messagesFor(code);
        assert.ok(messages.some((message) => message.includes('platform.ts')), messages.join('\n'));
    });
}

test('lint allows passing currentPlatform() to platform functions outside platform.ts', async () => {
    const code = "import { currentPlatform, platformBehavior } from '../public/platform';\nexport const b = platformBehavior(currentPlatform());\n";
    assert.deepEqual(await messagesFor(code), []);
});

test('lint allows other os functions outside platform.ts', async () => {
    assert.deepEqual(await messagesFor("import * as os from 'os';\nexport const h = os.homedir();\n"), []);
    assert.deepEqual(await messagesFor("import { tmpdir } from 'node:os';\nexport const t = tmpdir();\n"), []);
});

test('platform.ts itself may read the platform from os and still may not use module.exports =', async () => {
    const file = 'src/public/platform.ts';
    assert.deepEqual(await messagesFor("import * as os from 'os';\nexport const p = os.platform();\n", file), []);
    const messages = await messagesFor('module.exports = {};\n', file);
    assert.ok(messages.some((message) => message.includes('module.exports')), messages.join('\n'));
});
