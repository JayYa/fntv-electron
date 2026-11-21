#!/usr/bin/env node
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
