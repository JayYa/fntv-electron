const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { ESLint } = require('eslint');

const eslint = new ESLint({ cwd: path.join(__dirname, '..'), overrideConfig: { rules: { 'local/no-comments': 'off' } } });

async function messagesFor(code, filePath = 'tests/example.test.cjs') {
    const [result] = await eslint.lintText(code, { filePath });
    return result.messages.map((message) => message.message);
}

const REPLACE_LOAD = [
    "const Module = require('node:module');",
    'const originalLoad = Module._load;',
    "Module._load = (request, ...rest) => (request === 'electron' ? {} : originalLoad(request, ...rest));",
    '',
].join('\n');

test('lint rejects a test that replaces Module._load itself', async () => {
    const messages = await messagesFor(REPLACE_LOAD);
    assert.ok(messages.length > 0 && messages.every((message) => message.includes('useFakeElectron')), messages.join('\n'));
});

test('lint rejects the bracket form of Module._load', async () => {
    const messages = await messagesFor("const Module = require('node:module');\nModule['_load'] = () => ({});\n");
    assert.ok(messages.some((message) => message.includes('useFakeElectron')), messages.join('\n'));
});

test('the fake electron helper may replace Module._load', async () => {
    assert.deepEqual(await messagesFor(REPLACE_LOAD, 'tests/helpers/fakeElectron.cjs'), []);
});
