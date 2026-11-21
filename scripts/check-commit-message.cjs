#!/usr/bin/env node
const fs = require('node:fs');

const TYPES = ['feat', 'fix', 'perf', 'docs', 'refactor', 'test', 'chore', 'ci', 'build', 'style', 'revert'];
const CONVENTIONAL = new RegExp(`^(${TYPES.join('|')})(\\([A-Za-z0-9._/-]+\\))?!?: \\S`);
const RELEASE_TYPES = ['feat', 'fix', 'perf'];
const INTERNAL_SCOPES = ['ci', 'build', 'test', 'tests'];
const RELEASE_WITH_INTERNAL_SCOPE = new RegExp(`^(${RELEASE_TYPES.join('|')})\\((${INTERNAL_SCOPES.join('|')})\\)!?:`, 'i');
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
