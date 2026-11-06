#!/usr/bin/env node
// pre-commit 检查：暂存区里 agent 写的文件不能超过 MAX_TOKENS。
// 读的是暂存内容，不是工作区。不受限的文件在 .gitattributes 里标 -agent-authored。
const { execFileSync } = require('node:child_process');

const MAX_TOKENS = 5000;
const BYTES_PER_TOKEN = 4;
const BINARY_SNIFF_BYTES = 8000;

function git(args) {
    return execFileSync('git', args, { maxBuffer: 1024 * 1024 * 1024 });
}

function stagedFiles() {
    return git(['diff', '--cached', '--name-only', '--diff-filter=ACMR', '-z'])
        .toString('utf8')
        .split('\0')
        .filter(Boolean);
}

function isAgentAuthored(file) {
    const output = git(['check-attr', '--cached', '-z', 'agent-authored', '--', file]).toString('utf8');
    return output.split('\0')[2] !== 'unset';
}

function isBinary(file) {
    return git(['cat-file', 'blob', `:${file}`]).subarray(0, BINARY_SNIFF_BYTES).includes(0);
}

function tokensOf(file) {
    const bytes = Number(git(['cat-file', '-s', `:${file}`]).toString('utf8').trim());
    return Math.ceil(bytes / BYTES_PER_TOKEN);
}

function oversizedFiles() {
    return stagedFiles()
        .map(file => ({ file, tokens: tokensOf(file) }))
        .filter(({ file, tokens }) => tokens > MAX_TOKENS && isAgentAuthored(file) && !isBinary(file));
}

function report(files) {
    const list = files.map(({ file, tokens }) => `  ${file}: ${tokens} tokens`).join('\n');
    return `提交被拒绝：下面的文件超过 ${MAX_TOKENS} tokens（字节数 / ${BYTES_PER_TOKEN}，即 ${MAX_TOKENS * BYTES_PER_TOKEN} 字节）。

${list}

按职责拆分这些文件：

1. 找出文件里能独立命名的部分：一组相关函数、一个类型、一组测试、一段样式。
2. 把这部分移到同目录的新文件，文件名写清它的职责。原文件只留入口和编排逻辑。
3. 按文件类型接回去：
   - TypeScript：新文件用 export，原文件用 import。纯判断逻辑放进可单测的模块。
   - 登录页 HTML 和 JS：脚本用 <script src>，样式用 <link rel="stylesheet">，都放在 resource/login/ 下。
   - 测试：按行为拆成多个 tests/*.test.cjs，共用的假对象放进 tests/helpers/。
4. 用 git grep 找全引用并更新，运行 pnpm run lint 和 pnpm test。
5. 重新 git add 原文件和新文件，再提交。

不要靠删注释、压缩代码或 --no-verify 过线。
如果文件不是 agent 写的（锁文件、生成文件），在 .gitattributes 里标 -agent-authored。
`;
}

const files = oversizedFiles();
if (files.length > 0) {
    process.stderr.write(report(files));
    process.exit(1);
}
