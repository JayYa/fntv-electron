#!/usr/bin/env node
// 改完代码后的验证入口（pnpm run check），本地和 CI（ci.yml 的 test job）跑同一条命令。
// 依次跑文件大小检查、lint、knip、测试；一步失败也接着跑后面的，最后汇总每步结果，有一步失败就以 1 退出。
//
// 用法：check.cjs [--base <ref> | --no-file-size]
//   默认：文件大小检查对 origin/main 的合并基点（HEAD 相对合并基点改动的文件，读 HEAD 的内容；
//   未提交的改动不在内，暂存区由 pre-commit 钩子检查）。
//   --base <ref>：换一个对比的 ref。CI 的 PR 上传 HEAD^1（PR 合并提交的第一个父提交就是 base）。
//   --no-file-size：跳过文件大小检查。CI 只在 Linux 那一格的 PR 上跑它，其它格和 push 到 main 时跳过。
const { spawnSync } = require('node:child_process');

const DEFAULT_BASE = 'origin/main';

function parseArgs(args) {
    if (args.length === 0) return { base: DEFAULT_BASE };
    if (args.length === 1 && args[0] === '--no-file-size') return { base: null };
    if (args.length === 2 && args[0] === '--base' && args[1]) return { base: args[1] };
    throw new Error('用法：check.cjs [--base <ref> | --no-file-size]');
}

// 每步是 { name, file, args }，跳过的步骤是 { name, skipped }。
// node 直接运行、不经 shell：Windows 的 cmd 会吞掉 HEAD^1 里的 ^。
function stepsFor({ base }) {
    return [
        base === null
            ? { name: 'file-size', skipped: '--no-file-size' }
            : { name: 'file-size', file: process.execPath, args: ['scripts/check-file-size.cjs', '--base', base] },
        { name: 'lint', file: 'pnpm', args: ['run', 'lint'] },
        { name: 'knip', file: 'pnpm', args: ['run', 'knip'] },
        { name: 'test', file: 'pnpm', args: ['test'] },
    ];
}

// Windows 上 pnpm 是 .cmd，要经 shell 才能运行，整条命令拼成一个字符串（它的参数里没有要转义的字符）。
function runCommand(file, args) {
    if (file === 'pnpm' && process.platform === 'win32') {
        return spawnSync([file, ...args].join(' '), { shell: true, stdio: 'inherit' }).status;
    }
    return spawnSync(file, args, { stdio: 'inherit' }).status;
}

function display(step) {
    return [step.file === process.execPath ? 'node' : step.file, ...step.args].join(' ');
}

// run(file, args) 返回退出码。返回每步的 { name, result, seconds }，result 是 passed、failed 或 skipped。
function runSteps(steps, run = runCommand, log = text => process.stdout.write(text)) {
    return steps.map(step => {
        if (step.skipped) return { name: step.name, result: 'skipped', seconds: 0, note: step.skipped };
        log(`\n== ${step.name}: ${display(step)}\n`);
        const start = Date.now();
        const status = run(step.file, step.args);
        return { name: step.name, result: status === 0 ? 'passed' : 'failed', seconds: (Date.now() - start) / 1000 };
    });
}

function summary(results) {
    const width = Math.max(...results.map(({ name }) => name.length));
    const lines = results.map(({ name, result, seconds, note }) =>
        `  ${name.padEnd(width)}  ${result.padEnd(7)}  ${note ?? `${seconds.toFixed(1)}s`}`);
    const failed = results.filter(({ result }) => result === 'failed').map(({ name }) => name);
    const verdict = failed.length === 0 ? 'check passed' : `check failed: ${failed.join(', ')}`;
    return `\n== summary\n${lines.join('\n')}\n${verdict}\n`;
}

function main(args) {
    let options;
    try {
        options = parseArgs(args);
    } catch (error) {
        process.stderr.write(`${error.message}\n`);
        return 2;
    }
    const results = runSteps(stepsFor(options));
    process.stdout.write(summary(results));
    return results.some(({ result }) => result === 'failed') ? 1 : 0;
}

if (require.main === module) process.exitCode = main(process.argv.slice(2));

module.exports = { parseArgs, runSteps, stepsFor, summary };
