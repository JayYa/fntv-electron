#!/usr/bin/env node
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const LINTED_EXTENSIONS = /\.(ts|js|cjs|mjs)$/;

function lintTargets() {
    const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
    const [command, ...targets] = manifest.scripts.lint.split(/\s+/);
    if (command !== 'eslint' || targets.length === 0) throw new Error(`package.json 的 lint 脚本不是 "eslint <路径…>"：${manifest.scripts.lint}`);
    return targets;
}

function isLintTarget(file, targets) {
    if (!LINTED_EXTENSIONS.test(file)) return false;
    return targets.some((target) => file === target || file.startsWith(`${target}/`));
}

function stagedFiles() {
    const output = execFileSync('git', ['diff', '--cached', '--name-only', '--diff-filter=ACMR', '-z'], { cwd: ROOT });
    return output.toString('utf8').split('\0').filter(Boolean);
}

function stagedContent(file) {
    return execFileSync('git', ['show', `:${file}`], { cwd: ROOT, maxBuffer: 1024 * 1024 * 1024 }).toString('utf8');
}

async function lintEntries(entries) {
    const { ESLint } = require('eslint');
    const eslint = new ESLint({ cwd: ROOT });
    const results = [];
    for (const { file, content } of entries) {
        const filePath = path.join(ROOT, file);
        if (await eslint.isPathIgnored(filePath)) continue;
        results.push(...await eslint.lintText(content, { filePath }));
    }
    const formatter = await eslint.loadFormatter('stylish');
    return {
        errorCount: results.reduce((sum, result) => sum + result.errorCount, 0),
        report: await formatter.format(results),
    };
}

async function main() {
    const targets = lintTargets();
    const entries = stagedFiles()
        .filter((file) => isLintTarget(file, targets))
        .map((file) => ({ file, content: stagedContent(file) }));
    if (entries.length === 0) return;
    const { errorCount, report } = await lintEntries(entries);
    if (report) process.stderr.write(report);
    if (errorCount > 0) {
        process.stderr.write(`提交被拒绝：暂存的文件有 ${errorCount} 个 lint 错误（检查的是暂存区内容）。\n`);
        process.exitCode = 1;
    }
}

if (require.main === module) {
    main().catch((error) => {
        process.stderr.write(`${error.stack ?? error}\n`);
        process.exitCode = 1;
    });
}

module.exports = { isLintTarget, lintEntries, lintTargets };
