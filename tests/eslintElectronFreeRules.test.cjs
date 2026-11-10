const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { ESLint } = require('eslint');

// fn_api/core 和 Proxy 服务不能加载 electron，也不能经由 logger 这类模块间接加载（eslint.config.mjs）。
const eslint = new ESLint({ cwd: path.join(__dirname, '..') });

async function messagesFor(code, file) {
    const [result] = await eslint.lintText(code, { filePath: file });
    return result.messages.map((message) => message.message);
}

const CORE_FILE = 'src/modules/fn_api/core/example.ts';
const PROXY_FILE = 'src/modules/proxy_service/example.ts';

const forbidden = [
    [CORE_FILE, "import { app } from 'electron';\nexport const a = app;\n"],
    [CORE_FILE, "import log from '../../logger';\nexport const l = log;\n"],
    [CORE_FILE, "import { request } from '../request';\nexport const r = request;\n"],
    [CORE_FILE, "export * from '../api';\n"],
    [PROXY_FILE, "import { net } from 'electron';\nexport const n = net;\n"],
    [PROXY_FILE, "import log from '../logger';\nexport const l = log;\n"],
    [PROXY_FILE, "import { ApiService } from '../fn_api/api';\nexport const s = ApiService;\n"],
    [PROXY_FILE, "import { isTrusted } from '../cert_trust';\nexport const t = isTrusted;\n"],
];

for (const [file, code] of forbidden) {
    test(`lint rejects ${code.split('\n')[0]} in ${path.dirname(file)}`, async () => {
        const messages = await messagesFor(code, file);
        assert.ok(messages.some((message) => message.includes('electron')), messages.join('\n') || '(no messages)');
    });
}

test('lint allows Node built-ins, axios and the core layer in these modules', async () => {
    assert.deepEqual(await messagesFor("import * as http from 'node:http';\nimport axios from 'axios';\nimport { TtlCache } from './ttlCache';\nexport const x = [http, axios, TtlCache];\n", CORE_FILE), []);
    assert.deepEqual(await messagesFor("import { TtlCache } from '../fn_api/core/ttlCache';\nimport { forward } from './forward';\nexport const x = [TtlCache, forward];\n", PROXY_FILE), []);
});

test('lint still allows electron and logger in the main process layer of fn_api', async () => {
    assert.deepEqual(await messagesFor("import { app } from 'electron';\nimport log from '../logger';\nexport const x = [app, log];\n", 'src/modules/fn_api/example.ts'), []);
});
