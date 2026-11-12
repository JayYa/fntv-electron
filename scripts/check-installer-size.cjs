'use strict';

// 安装包体积门禁：build.yml 打包后运行，核对本平台每个安装包不超过 scripts/installer-size-budget.json 的预算。
// 用法：node scripts/check-installer-size.cjs <platform> [安装包目录，默认 release]
//
// - 预算按冒烟测试目标写（tests/smoke/targets.cjs 的 TARGETS），单位字节，用目标的 installerPattern 找安装包。
// - 失败的情况：超出预算；本平台某个目标没有安装包或有多个；目录里有安装包对不上任何目标（新加了平台或架构，
//   先在 targets.cjs 和预算文件里加上）；预算文件缺目标或有多余的目标。
// - 结果表写进 $GITHUB_STEP_SUMMARY（有这个环境变量时）。设了 GH_TOKEN 和 GITHUB_REPOSITORY 时，再用 gh 取
//   最新 Release 的同目标资产，列出变化量；取不到不算失败。
// - 预算取实测值加约 2.5%，只降不升。安装包确实要变大时（例如 Electron 大版本升级），在 PR 里改预算文件，
//   评审时能看到。预算文件不放 build/：那里的文件曾经整个打进 app.asar。

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const { TARGETS } = require('../tests/smoke/targets.cjs');

const BUDGET_FILE = path.join(__dirname, 'installer-size-budget.json');
const INSTALLER_EXTENSIONS = ['.exe', '.dmg', '.AppImage'];

function megabytes(bytes) {
    return `${(bytes / 1e6).toFixed(2)} MB`;
}

function signedMegabytes(bytes) {
    return `${bytes > 0 ? '+' : bytes < 0 ? '−' : '±'}${megabytes(Math.abs(bytes))}`;
}

// 最新正式 Release 的资产（名字和字节数）。取不到时返回 null，只影响“对比上个 Release”一列。
function latestReleaseAssets(env) {
    if (!env.GH_TOKEN || !env.GITHUB_REPOSITORY) return null;
    const result = spawnSync('gh', ['release', 'view', '--repo', env.GITHUB_REPOSITORY, '--json', 'tagName,assets'], {
        encoding: 'utf8',
        env,
    });
    if (result.error || result.status !== 0) {
        console.log(`::warning::cannot read the latest release, skipping the comparison: ${result.error?.message ?? result.stderr.trim()}`);
        return null;
    }
    const { tagName, assets } = JSON.parse(result.stdout);
    return { tagName, assets: assets.map(asset => ({ name: asset.name, size: asset.size })) };
}

function check(platform, dir, env) {
    const errors = [];
    const budgets = JSON.parse(fs.readFileSync(BUDGET_FILE, 'utf8'));

    const targetIds = Object.keys(TARGETS);
    for (const id of targetIds.filter(id => !Number.isInteger(budgets[id]))) {
        errors.push(`${path.basename(BUDGET_FILE)} has no budget for smoke target ${id}`);
    }
    for (const id of Object.keys(budgets).filter(id => !targetIds.includes(id))) {
        errors.push(`${path.basename(BUDGET_FILE)} has a budget for ${id}, which is not a smoke target`);
    }

    const platformTargets = targetIds.filter(id => TARGETS[id].platform === platform);
    if (platformTargets.length === 0) {
        errors.push(`no smoke target is built on platform ${platform}`);
    }

    const installers = (fs.existsSync(dir) ? fs.readdirSync(dir) : [])
        .filter(name => INSTALLER_EXTENSIONS.some(ext => name.endsWith(ext)));
    for (const name of installers.filter(name => !targetIds.some(id => TARGETS[id].installerPattern.test(name)))) {
        errors.push(`${name} matches no smoke target, so it has no size budget`);
    }

    const previous = latestReleaseAssets(env);
    const rows = [];
    for (const id of platformTargets) {
        const { installerPattern } = TARGETS[id];
        const matches = installers.filter(name => installerPattern.test(name));
        if (matches.length !== 1) {
            errors.push(`${id}: expected one installer matching ${installerPattern} in ${dir}, found ${matches.length}: ${matches.join(', ')}`);
            continue;
        }
        const [name] = matches;
        const size = fs.statSync(path.join(dir, name)).size;
        const budget = budgets[id];
        const before = previous?.assets.find(asset => installerPattern.test(asset.name));
        const ok = Number.isInteger(budget) && size <= budget;
        if (Number.isInteger(budget) && !ok) {
            errors.push(`${name} is ${size} bytes (${megabytes(size)}), over the ${id} budget of ${budget} bytes (${megabytes(budget)}) by ${size - budget} bytes`);
        }
        rows.push([
            ok ? '✅' : '❌',
            id,
            `\`${name}\``,
            `${megabytes(size)}<br>${size}`,
            Number.isInteger(budget) ? `${megabytes(budget)}<br>${budget}` : '—',
            Number.isInteger(budget) ? signedMegabytes(budget - size) : '—',
            before ? `${signedMegabytes(size - before.size)}（${previous.tagName}：${megabytes(before.size)}）` : '—',
        ]);
    }

    const summary = [
        `### Installer size (${platform})`,
        '',
        '| | Target | Installer | Size | Budget | Headroom | vs. latest release |',
        '| --- | --- | --- | ---: | ---: | ---: | --- |',
        ...rows.map(row => `| ${row.join(' | ')} |`),
        '',
        ...errors.map(error => `- ❌ ${error}`),
        `Budgets: \`scripts/installer-size-budget.json\`, measured size plus about 2.5%. Lower them when installers shrink; raise them only in a PR that explains why.`,
        '',
    ].join('\n');
    return { errors, rows, summary };
}

function main() {
    const [platform, dir = 'release'] = process.argv.slice(2);
    if (!platform) {
        console.error('usage: node scripts/check-installer-size.cjs <platform> [installer directory]');
        process.exit(2);
    }
    const { errors, summary } = check(platform, path.resolve(dir), process.env);
    console.log(summary);
    if (process.env.GITHUB_STEP_SUMMARY) {
        fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${summary}\n`);
    }
    for (const error of errors) console.log(`::error::${error}`);
    process.exit(errors.length > 0 ? 1 : 0);
}

main();
