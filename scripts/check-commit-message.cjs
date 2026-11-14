#!/usr/bin/env node
// 检查提交信息和 PR 标题是否符合 Conventional Commits。
// feat、fix、perf 的描述会被 release-please 写进用户可见的 CHANGELOG（release-please-config.json）。
//
// 用法：
//   check-commit-message.cjs <文件>      commit-msg hook，检查文件第一行有效内容
//   check-commit-message.cjs -           从 stdin 读，CI 检查 PR 标题
const fs = require('node:fs');

const TYPES = ['feat', 'fix', 'perf', 'docs', 'refactor', 'test', 'chore', 'ci', 'build', 'style', 'revert'];
const CONVENTIONAL = new RegExp(`^(${TYPES.join('|')})(\\([A-Za-z0-9._/-]+\\))?!?: \\S`);
// CI、构建、测试方面的改动不进 release（用户 2026-11-14 定的规则）。这些类型会进 CHANGELOG 并触发版本，
// 和下面的 scope 搭配时拒绝，改用同名的 ci、build、test 类型（它们在 release-please-config.json 里是 hidden）。
// 按 scope 而不按改动路径判定：CI 改动常常也改 package.json、CLAUDE.md，路径判定拦不住；按 scope 判定
// commit-msg hook 和 PR 标题检查都能用。deps 不在列：Renovate 对运行时依赖用 fix(deps)，这些依赖进安装包。
const RELEASE_TYPES = ['feat', 'fix', 'perf'];
const INTERNAL_SCOPES = ['ci', 'build', 'test', 'tests'];
const RELEASE_WITH_INTERNAL_SCOPE = new RegExp(`^(${RELEASE_TYPES.join('|')})\\((${INTERNAL_SCOPES.join('|')})\\)!?:`, 'i');
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
        'feat、fix、perf 的描述会进入用户可见的更新日志，写成用户能看懂的话（docs/adr/0003-release-gate.md）。',
    ].join('\n'));
}

function main(args) {
    if (args.length !== 1) {
        console.error('用法：check-commit-message.cjs <文件> | -');
        return 2;
    }

    const message = fs.readFileSync(args[0] === '-' ? 0 : args[0], 'utf8');
    const subject = subjectOf(message);
    if (RELEASE_WITH_INTERNAL_SCOPE.test(subject)) {
        const where = args[0] === '-' ? '标题' : '提交信息';
        console.error(`${where}把 CI、构建或测试方面的改动写成了会进 release 的类型：${JSON.stringify(subject)}`);
        console.error([
            `${RELEASE_TYPES.join('、')} 不能搭配 scope ${INTERNAL_SCOPES.join('、')}：这些改动不进 release，`,
            '改用 ci:、build:、test: 或 chore: 类型（release-please-config.json 里是 hidden），例如 ci: 新增 Check 汇总 job。',
        ].join('\n'));
        return 1;
    }
    if (isValid(subject)) return 0;
    report(subject, args[0] === '-' ? '标题' : '提交信息');
    hint();
    return 1;
}

process.exitCode = main(process.argv.slice(2));
