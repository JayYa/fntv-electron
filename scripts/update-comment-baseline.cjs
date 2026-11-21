#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const { ESLint } = require('eslint');

const ROOT = path.join(__dirname, '..');
const BASELINE_FILE = path.join(ROOT, 'lint', 'comment-baseline.json');
const RULE = 'local/no-comments';

function lintTargets() {
    const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
    return pkg.scripts.lint.trim().split(/\s+/).slice(1);
}

async function currentCounts() {
    const eslint = new ESLint({ cwd: ROOT, overrideConfig: { rules: { [RULE]: ['error', { baseline: {} }] } } });
    const counts = {};
    for (const result of await eslint.lintFiles(lintTargets())) {
        const count = result.messages.filter((message) => message.ruleId === RULE).length;
        if (count > 0) counts[path.relative(ROOT, result.filePath).split(path.sep).join('/')] = count;
    }
    return counts;
}

function grown(previous, current) {
    return Object.entries(current)
        .filter(([file, count]) => count > (previous[file] ?? 0))
        .map(([file, count]) => `${file}: ${previous[file] ?? 0} -> ${count}`);
}

function sorted(counts) {
    return Object.fromEntries(Object.keys(counts).sort().map((file) => [file, counts[file]]));
}

async function main(args) {
    const init = args.includes('--init');
    const previous = fs.existsSync(BASELINE_FILE) ? JSON.parse(fs.readFileSync(BASELINE_FILE, 'utf8')) : {};
    const current = await currentCounts();
    const growth = init ? [] : grown(previous, current);
    if (growth.length > 0) {
        process.stderr.write(`注释基线只降不升，这些文件的注释变多了，删掉新加的注释（/delete-comment）：\n${growth.join('\n')}\n`);
        return 1;
    }
    fs.writeFileSync(BASELINE_FILE, `${JSON.stringify(sorted(current), null, 4)}\n`);
    const total = Object.values(current).reduce((sum, count) => sum + count, 0);
    process.stdout.write(`${Object.keys(current).length} 个文件，共 ${total} 条注释。\n`);
    return 0;
}

if (require.main === module) {
    main(process.argv.slice(2)).then((code) => { process.exitCode = code; }, (error) => {
        process.stderr.write(`${error.stack}\n`);
        process.exitCode = 1;
    });
}
