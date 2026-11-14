#!/usr/bin/env node
// 构建期清单断言（#221，契约见 docs/mpv-archive-contract.md“能力”一节）：固定的 MPV 归档解压后、打包前，
// 读归档根目录的 fntv-manifest.json，下面任何一条不成立就让构建失败：
//   清单读得出、formatVersion 在客户端认识的集合里（manifest.ts 的 readManifest）；
//   archiveVersion 等于 mpv-archive.json 固定的 tag（解压的确实是固定的归档）；
//   provides 满足客户端的 requires（capabilities.ts 的 unmetCapabilities）。
// 复用编译后的同步模块，所以要在 pnpm run compile 之后运行（build.yml 的 Check MPV archive manifest）。
//
// 用法：check-mpv-manifest.cjs [--archive <归档目录>] [--pin <mpv-archive.json>]
//   默认 third_party/fntv-mpv 和仓库根目录的 mpv-archive.json。
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const SYNC_DIR = path.join(ROOT, 'dest', 'main', 'common', 'mpvConfigSync');

function parseArgs(args) {
    const options = { archive: path.join(ROOT, 'third_party', 'fntv-mpv'), pin: path.join(ROOT, 'mpv-archive.json') };
    for (let index = 0; index < args.length; index += 2) {
        const key = args[index].replace(/^--/, '');
        if (!(key in options) || !args[index + 1]) throw new Error('用法：check-mpv-manifest.cjs [--archive <归档目录>] [--pin <mpv-archive.json>]');
        options[key] = path.resolve(args[index + 1]);
    }
    return options;
}

// 返回问题列表和读到的清单；没有问题时列表为空。
function checkPinnedManifest({ archive, pin }) {
    const { MANIFEST_FILE_NAME, readManifest } = require(path.join(SYNC_DIR, 'manifest.js'));
    const { describeUnmetCapability, unmetCapabilities } = require(path.join(SYNC_DIR, 'capabilities.js'));
    const pinnedTag = JSON.parse(fs.readFileSync(pin, 'utf8')).tag;
    const read = readManifest(path.join(archive, MANIFEST_FILE_NAME));
    if (!read.ok) return { problems: [`${read.reason}: ${read.detail}`] };

    const { manifest } = read;
    const problems = [];
    if (manifest.archiveVersion !== pinnedTag) {
        problems.push(`清单的 archiveVersion 是 ${manifest.archiveVersion}，mpv-archive.json 固定的是 ${pinnedTag}`);
    }
    for (const unmet of unmetCapabilities(manifest.provides)) {
        problems.push(`provides 不满足 requires: ${describeUnmetCapability(unmet)}`);
    }
    return { problems, manifest };
}

function main() {
    const options = parseArgs(process.argv.slice(2));
    const { problems, manifest } = checkPinnedManifest(options);
    if (problems.length > 0) {
        console.error(`MPV 归档清单不满足客户端（${options.archive}）：\n${problems.map(problem => `  - ${problem}`).join('\n')}`);
        process.exitCode = 1;
        return;
    }
    const provides = Object.entries(manifest.provides).map(([name, version]) => `${name}=${version}`).join(', ');
    console.log(`MPV 归档清单 ${manifest.archiveVersion}：formatVersion ${manifest.formatVersion}，provides ${provides}，满足客户端`);
}

if (require.main === module) {
    try {
        main();
    } catch (error) {
        console.error(error.message);
        process.exitCode = 1;
    }
}

module.exports = { checkPinnedManifest };
