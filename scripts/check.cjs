#!/usr/bin/env node
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

function pnpmCommand() {
    const entry = process.env.npm_execpath;
    if (!entry) throw new Error('找不到 pnpm 的入口（npm_execpath 未设置），请用 pnpm run check 运行');
    if (!/^pnpm/i.test(path.basename(entry))) throw new Error(`npm_execpath 指向 ${entry}，不是 pnpm，请用 pnpm run check 运行`);
    if (/\.[cm]?js$/i.test(entry)) return { file: process.execPath, args: [entry] };
    if (process.platform !== 'win32' || /\.exe$/i.test(entry)) return { file: entry, args: [] };
    throw new Error(`pnpm 的入口 ${entry} 既不是 JS 文件也不是 .exe，不经 shell 无法运行，请用 pnpm run check 运行`);
}

function runCommand(file, args) {
    const pnpm = file === 'pnpm' ? pnpmCommand() : null;
    const command = pnpm ? { file: pnpm.file, args: [...pnpm.args, ...args] } : { file, args };
    const env = process.stdout.isTTY ? { ...process.env, FORCE_COLOR: '1' } : process.env;
    const child = spawn(command.file, command.args, { env, stdio: ['inherit', 'pipe', 'pipe'] });
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
        pnpmCommand();
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
