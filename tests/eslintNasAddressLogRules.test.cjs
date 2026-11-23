const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { ESLint } = require('eslint');

const eslint = new ESLint({ cwd: path.join(__dirname, '..'), overrideConfig: { rules: { 'local/no-comments': 'off' } } });

async function addressMessages(code, filePath = 'src/main/example.ts') {
    const [result] = await eslint.lintText(`import * as log from './logger';\n${code}\n`, { filePath });
    return result.messages.filter((message) => message.ruleId === 'nas/no-address-log').map((message) => message.message);
}

const REJECTED = {
    'template literal': 'log.info(`登录 ${baseUrl}`);',
    'extra argument': "log.warn('无效的域名格式:', domain);",
    'object property value': "log.info('已建立当前登录', { domain: baseUrl });",
    'member property': 'log.error(`授权失败 ${trust.targetOrigin}`);',
    'URL host': 'log.info(`主机 ${new URL(url).host}`);',
    'string concatenation': "log.info('主机 ' + nasHost);",
    'injected logger': 'context.log.warn(`重定向到 ${newBaseUrl}`);',
    'named logger': 'logger.info(`信任 ${hostname}`);',
};

for (const [shape, code] of Object.entries(REJECTED)) {
    test(`lint rejects a NAS address in a log call: ${shape}`, async () => {
        const messages = await addressMessages(code);
        assert.equal(messages.length, 1, messages.join('\n'));
        assert.match(messages[0], /完整 NAS 地址不进日志/);
    });
}

const ALLOWED = {
    'comparison result': 'log.info(`已确认目标: ${trust.targetOrigin !== null}`);',
    'masking function': 'log.info(`域名 ${maskDomain(domain)}`);',
    'describe function': 'log.warn(`重定向 ${describeOriginChange(baseUrl, newBaseUrl)}`);',
    'object key only': "log.info('已建立当前登录', { domain: true });",
    'plural collection': 'log.info(`加载了 ${trustedHosts.size} 个信任主机`);',
    'not a logger': 'console.info(`x ${baseUrl}`); cache.info(baseUrl);',
};

for (const [shape, code] of Object.entries(ALLOWED)) {
    test(`lint allows a log call without a NAS address: ${shape}`, async () => {
        assert.deepEqual(await addressMessages(code), []);
    });
}
