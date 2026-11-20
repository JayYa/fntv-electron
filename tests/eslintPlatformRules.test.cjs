const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { ESLint } = require('eslint');

const eslint = new ESLint({ cwd: path.join(__dirname, '..') });
const PLATFORM_INDEX = 'src/public/platform/index.ts';

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
    'navigator.platform': "export const isMac = navigator.platform.startsWith('Mac');\n",
    'comparing currentPlatform() at the call site': "import { currentPlatform } from '../public/platform';\nexport const w = currentPlatform() === 'win32';\n",
    'comparing currentArch() at the call site': "import { currentArch } from '../public/platform';\nexport const a = currentArch() === 'arm64';\n",
    'comparing a stored platform': "import { currentPlatform } from '../public/platform';\nconst p = currentPlatform();\nexport const w = p === 'win32';\n",
    'comparing a platform on the right': "export function f(p: string): boolean { return 'darwin' !== p; }\n",
    'switching on a platform': "export function f(p: string): number { switch (p) { case 'linux': return 1; default: return 0; } }\n",
};

for (const [name, code] of Object.entries(forbidden)) {
    test(`outside the platform index lint rejects ${name}`, async () => {
        const messages = await messagesFor(code);
        assert.ok(messages.some((message) => message.includes('src/public/platform')), messages.join('\n'));
    });
}

test('lint allows passing currentPlatform() to platform functions', async () => {
    const code = "import { currentPlatform, platformBehavior } from '../public/platform';\nexport const b = platformBehavior(currentPlatform());\n";
    assert.deepEqual(await messagesFor(code), []);
});

test('lint allows comparing behavior fields and other strings', async () => {
    assert.deepEqual(await messagesFor("export function f(t: string): boolean { return t === 'hiddenInset'; }\n"), []);
});

test('lint allows other os functions', async () => {
    assert.deepEqual(await messagesFor("import * as os from 'os';\nexport const h = os.homedir();\n"), []);
    assert.deepEqual(await messagesFor("import { tmpdir } from 'node:os';\nexport const t = tmpdir();\n"), []);
});

test('the platform index may read the platform and still may not compare it or use module.exports =', async () => {
    assert.deepEqual(await messagesFor("import * as os from 'os';\nexport const p = os.platform();\n", PLATFORM_INDEX), []);
    const exportsMessages = await messagesFor('module.exports = {};\n', PLATFORM_INDEX);
    assert.ok(exportsMessages.some((message) => message.includes('module.exports')), exportsMessages.join('\n'));
    const compareMessages = await messagesFor("export const w = process.platform === 'win32';\n", PLATFORM_INDEX);
    assert.ok(compareMessages.some((message) => message.includes('src/public/platform')), compareMessages.join('\n'));
});

test('platform implementation files may not read the platform', async () => {
    const messages = await messagesFor('export const p = process.platform;\n', 'src/public/platform/win32.ts');
    assert.ok(messages.some((message) => message.includes('src/public/platform')), messages.join('\n'));
});
