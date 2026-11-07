#!/usr/bin/env node
// 检查提交信息和 PR 标题是否符合 Conventional Commits。
// feat、fix、perf 的描述会被 release-please 写进用户可见的 CHANGELOG（release-please-config.json）。
//
// 用法：
//   check-commit-message.cjs <文件>      commit-msg hook，检查文件第一行有效内容
//   check-commit-message.cjs -           从 stdin 读，CI 检查 PR 标题
//   check-commit-message.cjs --range A..B  检查范围内每个非合并提交的标题
const fs = require('node:fs');
const { execFileSync } = require('node:child_process');

const TYPES = ['feat', 'fix', 'perf', 'docs', 'refactor', 'test', 'chore', 'ci', 'build', 'style', 'revert'];
const CONVENTIONAL = new RegExp(`^(${TYPES.join('|')})(\\([A-Za-z0-9._/-]+\\))?!?: \\S`);
// git 自己生成的标题，以及 rebase --autosquash 用的标记。
const GENERATED = /^(Merge |Revert "|(fixup|squash|amend)! )/;

function subjectOf(message) {
    return message
        .split(/\r?\n/)
        .map(line => line.trim())
        .find(line => line !== '' && !line.startsWith('#')) || '';
}

function isValid(subject) {
    return CONVENTIONAL.test(subject) || GENERATED.test(subject);
}

function report(subject, where) {
    console.error(`${where}不符合 Conventional Commits：${JSON.stringify(subject)}`);
}

function hint() {
    console.error([
        '格式：type(scope): 描述，scope 可省略。',
        `type：${TYPES.join('、')}。`,
        'feat、fix、perf 的描述会进入用户可见的更新日志，写成用户能看懂的话（CODING_STANDARDS.md 的“提交”）。',
    ].join('\n'));
}

function subjectsInRange(range) {
    return execFileSync('git', ['log', '--no-merges', '--format=%H %s', range], { encoding: 'utf8' })
        .split('\n')
        .filter(Boolean)
        .map(line => ({ sha: line.slice(0, 40), subject: line.slice(41) }));
}

function main(args) {
    if (args[0] === '--range' && args[1]) {
        const bad = subjectsInRange(args[1]).filter(({ subject }) => !isValid(subject));
        bad.forEach(({ sha, subject }) => report(subject, `提交 ${sha.slice(0, 7)} 的标题`));
        if (bad.length > 0) hint();
        return bad.length === 0 ? 0 : 1;
    }

    if (args.length !== 1) {
        console.error('用法：check-commit-message.cjs <文件> | - | --range A..B');
        return 2;
    }

    const message = fs.readFileSync(args[0] === '-' ? 0 : args[0], 'utf8');
    const subject = subjectOf(message);
    if (isValid(subject)) return 0;
    report(subject, args[0] === '-' ? '标题' : '提交信息');
    hint();
    return 1;
}

process.exitCode = main(process.argv.slice(2));
