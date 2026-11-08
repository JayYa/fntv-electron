const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { ESLint } = require('eslint');

// 平台判断只在 src/public/platform.ts 发生（eslint.config.mjs，CODING_STANDARDS.md）。
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
};

for (const [name, code] of Object.entries(forbidden)) {
    test(`outside platform.ts lint rejects ${name}`, async () => {
        const messages = await messagesFor(code);
        assert.ok(messages.some((message) => message.includes('platform.ts')), messages.join('\n'));
    });
}

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
