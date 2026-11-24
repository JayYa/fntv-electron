const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { ESLint } = require('eslint');

const ROOT = path.join(__dirname, '..');
const RULE = 'local/no-comments';
const eslint = new ESLint({ cwd: ROOT });

async function lint(code, filePath) {
    const [result] = await eslint.lintText(code, { filePath });
    return result.messages.filter((message) => message.ruleId === RULE);
}

test('lint rejects line and block comments', async () => {
    const messages = await lint('// 说明\nconst a = 1; /* 尾注 */\nexport { a };\n', 'src/main/example.ts');
    assert.equal(messages.length, 2);
    assert.match(messages[0].message, /ADR-0007/);
});

test('lint does not count directives as comments', async () => {
    const code = '/* exported restoreFocus */\n/* global window */\nfunction restoreFocus() { return window; }\n';
    assert.deepEqual(await lint(code, 'resource/login/example.js'), []);
});
