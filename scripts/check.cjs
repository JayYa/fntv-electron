#!/usr/bin/env node
// 改完代码后的验证入口（pnpm run check），本地和 CI（ci.yml 的 test job）跑同一条命令。
// 依次跑文件大小检查、lint、knip、测试；一步失败也接着跑后面的，最后汇总每步结果，有一步失败就以 1 退出。
//
// 用法：check.cjs [--base <ref> | --no-file-size]
//   默认：文件大小检查对 origin/main 的合并基点（HEAD 相对合并基点改动的文件，读 HEAD 的内容；
//   未提交的改动不在内，暂存区由 pre-commit 钩子检查）。
//   --base <ref>：换一个对比的 ref。CI 的 PR 上传 HEAD^1（PR 合并提交的第一个父提交就是 base）。
//   --no-file-size：跳过文件大小检查。CI 只在 Linux 那一格的 PR 上跑它，其它格和 push 到 main 时跳过。
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const DEFAULT_BASE = 'origin/main';
const LOG_FILE = path.join(__dirname, '..', 'check.log');
const DETAIL_LINES = 60;

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

function stripAnsi(text) {
    return text.replace(/\x1b\[[0-9;]*m/g, '');
}

// Windows 上 pnpm 是 .cmd，要经 shell 才能运行，整条命令拼成一个字符串（它的参数里没有要转义的字符）。
function runCommand(file, args) {
    const viaShell = file === 'pnpm' && process.platform === 'win32';
    const env = process.stdout.isTTY ? { ...process.env, FORCE_COLOR: '1' } : process.env;
    const child = viaShell
        ? spawn([file, ...args].join(' '), { shell: true, env, stdio: ['inherit', 'pipe', 'pipe'] })
        : spawn(file, args, { env, stdio: ['inherit', 'pipe', 'pipe'] });
    const chunks = [];
    child.stdout.on('data', chunk => { process.stdout.write(chunk); chunks.push(chunk); });
    child.stderr.on('data', chunk => { process.stderr.write(chunk); chunks.push(chunk); });
    return new Promise(resolve => {
        child.on('error', error => resolve({ status: 1, output: `${Buffer.concat(chunks)}${error.message}\n` }));
        child.on('close', status => resolve({ status, output: Buffer.concat(chunks).toString('utf8') }));
    });
}

function display(step) {
    return [step.file === process.execPath ? 'node' : step.file, ...step.args].join(' ');
}

async function runSteps(steps, run = runCommand, log = text => process.stdout.write(text)) {
    const results = [];
    for (const step of steps) {
        if (step.skipped) {
            results.push({ name: step.name, result: 'skipped', seconds: 0, note: step.skipped });
            continue;
        }
        log(`\n== ${step.name}: ${display(step)}\n`);
        const start = Date.now();
        const { status, output } = await run(step.file, step.args);
        results.push({
            name: step.name,
            result: status === 0 ? 'passed' : 'failed',
            seconds: (Date.now() - start) / 1000,
            command: display(step),
            output: stripAnsi(output),
        });
    }
    return results;
}

function failureDetail({ name, output }) {
    const lines = output.trimEnd().split(/\r?\n/);
    const failing = lines.findIndex(line => /^✖ failing tests:/.test(line));
    const detail = name === 'test' && failing !== -1 ? lines.slice(failing + 1) : lines;
    const shown = detail.slice(0, DETAIL_LINES);
    const cut = detail.length - shown.length;
    return [`-- ${name} 失败：`, ...shown, ...(cut > 0 ? [`…另有 ${cut} 行，见 check.log`] : [])].join('\n');
}

function summary(results) {
    const width = Math.max(...results.map(({ name }) => name.length));
    const lines = results.map(({ name, result, seconds, note }) =>
        `  ${name.padEnd(width)}  ${result.padEnd(7)}  ${note ?? `${seconds.toFixed(1)}s`}`);
    const failedResults = results.filter(({ result }) => result === 'failed');
    const failed = failedResults.map(({ name }) => name);
    const verdict = failed.length === 0 ? 'check passed' : `check failed: ${failed.join(', ')}（完整输出见 check.log）`;
    const details = failedResults.map(result => `\n${failureDetail(result)}\n`).join('');
    return `${details}\n== summary\n${lines.join('\n')}\n${verdict}\n`;
}

function logText(results) {
    return results
        .filter(({ result }) => result !== 'skipped')
        .map(({ name, command, result, output }) => `== ${name}: ${command}（${result}）\n${output}`)
        .join('\n');
}

async function main(args) {
    let options;
    try {
        options = parseArgs(args);
    } catch (error) {
        process.stderr.write(`${error.message}\n`);
        return 2;
    }
    const results = await runSteps(stepsFor(options));
    const text = summary(results);
    fs.writeFileSync(LOG_FILE, `${logText(results)}${text}`);
    process.stdout.write(text);
    return results.some(({ result }) => result === 'failed') ? 1 : 0;
}

if (require.main === module) main(process.argv.slice(2)).then(code => { process.exitCode = code; });

module.exports = { logText, parseArgs, runSteps, stepsFor, summary };
