#!/usr/bin/env node
const { execFileSync } = require('node:child_process');

const MAX_TOKENS = 5000;
const WARN_TOKENS = MAX_TOKENS * 0.8;
const BYTES_PER_TOKEN = 4;
const BINARY_SNIFF_BYTES = 8000;

function git(args) {
    return execFileSync('git', args, { maxBuffer: 1024 * 1024 * 1024 });
}

function splitZ(buffer) {
    return buffer.toString('utf8').split('\0').filter(Boolean);
}

const stagedSource = {
    files: () => splitZ(git(['diff', '--cached', '--name-only', '--diff-filter=ACMR', '-z'])),
    object: file => `:${file}`,
    attrArgs: ['--cached'],
    verdict: '提交被拒绝',
    annotate: false,
};

function pullRequestSource(base) {
    return {
        files: () => splitZ(git(['diff', '--name-only', '--diff-filter=ACMR', '-z', `${base}...HEAD`])),
        object: file => `HEAD:${file}`,
        attrArgs: ['--source', 'HEAD'],
        verdict: '检查未通过',
        annotate: true,
    };
}

function sourceFromArgs(args) {
    if (args.length === 0) return stagedSource;
    if (args.length === 2 && args[0] === '--base' && args[1]) return pullRequestSource(args[1]);
    process.stderr.write('用法：check-file-size.cjs [--base <ref>]\n');
    process.exit(2);
}

function classify(source) {
    const isAgentAuthored = file =>
        splitZ(git(['check-attr', ...source.attrArgs, '-z', 'agent-authored', '--', file]))[2] !== 'unset';
    const isBinary = file =>
        git(['cat-file', 'blob', source.object(file)]).subarray(0, BINARY_SNIFF_BYTES).includes(0);
    const tokensOf = file =>
        Math.ceil(Number(git(['cat-file', '-s', source.object(file)]).toString('utf8').trim()) / BYTES_PER_TOKEN);

    const flagged = source.files()
        .map(file => ({ file, tokens: tokensOf(file) }))
        .filter(({ file, tokens }) => tokens > WARN_TOKENS && isAgentAuthored(file) && !isBinary(file));
    return {
        oversized: flagged.filter(({ tokens }) => tokens > MAX_TOKENS),
        warned: flagged.filter(({ tokens }) => tokens <= MAX_TOKENS),
    };
}

function percentOf(tokens) {
    return Math.floor((tokens / MAX_TOKENS) * 100);
}

function listOf(files, describe) {
    return files.map(({ file, tokens }) => `  ${file}: ${describe(tokens)}`).join('\n');
}

function oversizeReport(files, verdict) {
    return `${verdict}：下面的文件超过 ${MAX_TOKENS} tokens（字节数 / ${BYTES_PER_TOKEN}，即 ${MAX_TOKENS * BYTES_PER_TOKEN} 字节）。

${listOf(files, tokens => `${tokens} tokens`)}

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

function warningReport(files) {
    return `提醒：下面的文件已超过上限 ${MAX_TOKENS} tokens 的 ${percentOf(WARN_TOKENS)}%，这次不拦，下次改动前考虑按职责拆分。

${listOf(files, tokens => `${tokens} tokens（${percentOf(tokens)}%）`)}

`;
}

function escapeData(value) {
    return value.replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
}

function escapeProperty(value) {
    return escapeData(value).replace(/:/g, '%3A').replace(/,/g, '%2C');
}

function annotations(oversized, warned) {
    const line = (level, file, message) => `::${level} file=${escapeProperty(file)}::${escapeData(message)}\n`;
    return [
        ...oversized.map(({ file, tokens }) => line('error', file, `${tokens} tokens，超过上限 ${MAX_TOKENS} tokens`)),
        ...warned.map(({ file, tokens }) =>
            line('warning', file, `${tokens} tokens，已到上限 ${MAX_TOKENS} tokens 的 ${percentOf(tokens)}%`)),
    ].join('');
}

const source = sourceFromArgs(process.argv.slice(2));
const { oversized, warned } = classify(source);

if (source.annotate) process.stdout.write(annotations(oversized, warned));
if (warned.length > 0) process.stderr.write(warningReport(warned));
if (oversized.length > 0) {
    process.stderr.write(oversizeReport(oversized, source.verdict));
    process.exit(1);
}
