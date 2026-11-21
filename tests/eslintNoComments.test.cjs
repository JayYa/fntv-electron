const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { ESLint } = require('eslint');

const ROOT = path.join(__dirname, '..');
const RULE = 'local/no-comments';

function linter(options) {
    return new ESLint({ cwd: ROOT, overrideConfig: { rules: { [RULE]: ['error', options] } }, fix: options.autofix === true });
}

async function lint(code, filePath, options = { baseline: {} }) {
    const [result] = await linter(options).lintText(code, { filePath });
    return { messages: result.messages.filter((message) => message.ruleId === RULE), output: result.output };
}

test('lint rejects comments in a file without a baseline entry', async () => {
    const { messages } = await lint('// 说明\nconst a = 1; /* 尾注 */\nexport { a };\n', 'src/main/example.ts');
    assert.equal(messages.length, 2);
    assert.match(messages[0].message, /ADR-0007/);
});

test('lint allows comments up to the baseline', async () => {
    const { messages } = await lint('// 说明\nexport const a = 1;\n', 'src/main/example.ts', { baseline: { 'src/main/example.ts': 1 } });
    assert.deepEqual(messages, []);
});

test('lint asks to tighten a baseline above the current count', async () => {
    const { messages } = await lint('export const a = 1;\n', 'src/main/example.ts', { baseline: { 'src/main/example.ts': 2 } });
    assert.equal(messages.length, 1);
    assert.match(messages[0].message, /comments:baseline/);
});

test('lint does not count directives as comments', async () => {
    const code = '/* exported restoreFocus */\n/* global window */\nfunction restoreFocus() { return window; }\n';
    assert.deepEqual((await lint(code, 'resource/login/example.js')).messages, []);
});

test('autofix removes whole-line comment runs, trailing comments and one surrounding blank line', async () => {
    const code = 'const a = 1;\n\n// 第一行\n// 第二行\n\nconst b = 2; // 尾注\nexport { a, b };\n';
    const { output } = await lint(code, 'src/main/example.ts', { baseline: {}, autofix: true });
    assert.equal(output, 'const a = 1;\n\nconst b = 2;\nexport { a, b };\n');
});
