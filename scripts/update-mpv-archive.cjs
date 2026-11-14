#!/usr/bin/env node
// 把构建固定的 MPV 归档换成 JayYa/fntv-mpv-config 的另一个 Release。
// 定时 workflow（update-mpv-archive.yml）和手工升级都用它，改的地方只有一份：
//   .github/workflows/build.yml 的 MPV_CONFIG_TAG、MPV_CONFIG_ASSET、MPV_CONFIG_SHA256；
//   README.md 准备步骤里的 tag 和资产名；docs/external-runtime.md 里的 tag。
// 资产名和 sha256 只取 Release API 给的（资产名不按 tag 推算，sha256 用资产的 digest），不下载归档。
// 三处是否一致由 tests/mpvArchiveCache.test.cjs 把关。
//
// 用法：
//   update-mpv-archive.cjs              取最新正式 Release，tag 比 build.yml 固定的新才改
//   update-mpv-archive.cjs --tag <tag>  取指定 tag 的 Release，不比较新旧（也用于回滚）
// 设了 GH_TOKEN 或 GITHUB_TOKEN 时带上它调 API。设了 GITHUB_OUTPUT 时写 updated、previous-tag、
// tag、asset、sha256，updated 为 false 时其余只有 previous-tag。
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const BUILD_YML = '.github/workflows/build.yml';
const README = 'README.md';
const RUNTIME_DOC = 'docs/external-runtime.md';
const TAG_PATTERN = /^fntv-mpv-v(\d{8}_\d{6})$/;
// 资产名会进 build.yml 的 env 和下载地址，只收这些字符。
const ASSET_PATTERN = /^[A-Za-z0-9._-]+\.zip$/;

function read(root, file) {
    return fs.readFileSync(path.join(root, file), 'utf8');
}

function envLine(name) {
    return new RegExp(`^(\\s+${name}:[ \\t]*)(\\S+)[ \\t]*$`, 'm');
}

// build.yml build job 的 env 是唯一来源。
function readPinnedArchive(root = ROOT) {
    const text = read(root, BUILD_YML);
    const value = name => {
        const match = text.match(envLine(name));
        if (!match) throw new Error(`${BUILD_YML} 里找不到 ${name}`);
        return match[2];
    };
    return {
        repo: value('MPV_CONFIG_REPO'),
        tag: value('MPV_CONFIG_TAG'),
        asset: value('MPV_CONFIG_ASSET'),
        sha256: value('MPV_CONFIG_SHA256'),
    };
}

function tagTime(tag) {
    const match = tag.match(TAG_PATTERN);
    if (!match) throw new Error(`tag 格式不是 fntv-mpv-v<yyyyMMdd_HHmmss>：${tag}`);
    return match[1];
}

function isNewerTag(candidate, pinned) {
    return tagTime(candidate) > tagTime(pinned);
}

// Release 里恰好一个 .zip 资产，且 GitHub 给了 sha256 digest。
function archiveFromRelease(release) {
    const tag = release.tag_name;
    tagTime(tag);
    const zips = (release.assets ?? []).filter(asset => asset.name.endsWith('.zip'));
    if (zips.length !== 1) {
        throw new Error(`${tag} 应恰好有一个 .zip 资产，实际：${zips.map(asset => asset.name).join(', ') || '无'}`);
    }
    const [asset] = zips;
    if (!ASSET_PATTERN.test(asset.name)) throw new Error(`资产名含不允许的字符：${asset.name}`);
    const digest = /^sha256:([0-9a-f]{64})$/.exec(asset.digest ?? '');
    if (!digest) throw new Error(`${tag} 的资产 ${asset.name} 没有 sha256 digest：${asset.digest}`);
    return { tag, asset: asset.name, sha256: digest[1] };
}

function replaceAll(text, from, to, file, what) {
    const count = text.split(from).length - 1;
    if (count === 0) throw new Error(`${file} 里找不到${what} ${from}`);
    return text.split(from).join(to);
}

// 先算好三个文件的新内容，全部成功才写，不会只改一半。
function pinArchive(root, next) {
    const current = readPinnedArchive(root);
    let build = read(root, BUILD_YML);
    for (const [name, value] of [['MPV_CONFIG_TAG', next.tag], ['MPV_CONFIG_ASSET', next.asset], ['MPV_CONFIG_SHA256', next.sha256]]) {
        build = build.replace(envLine(name), (_, prefix) => `${prefix}${value}`);
    }
    let readme = replaceAll(read(root, README), current.tag, next.tag, README, ' tag');
    readme = replaceAll(readme, current.asset, next.asset, README, '资产名');
    const runtimeDoc = replaceAll(read(root, RUNTIME_DOC), current.tag, next.tag, RUNTIME_DOC, ' tag');
    fs.writeFileSync(path.join(root, BUILD_YML), build);
    fs.writeFileSync(path.join(root, README), readme);
    fs.writeFileSync(path.join(root, RUNTIME_DOC), runtimeDoc);
}

async function fetchRelease(repo, tag, token) {
    const url = tag
        ? `https://api.github.com/repos/${repo}/releases/tags/${encodeURIComponent(tag)}`
        : `https://api.github.com/repos/${repo}/releases/latest`;
    const headers = { Accept: 'application/vnd.github+json', 'User-Agent': 'fntv-electron-update-mpv-archive' };
    if (token) headers.Authorization = `Bearer ${token}`;
    const response = await fetch(url, { headers, signal: AbortSignal.timeout(30_000) });
    if (!response.ok) throw new Error(`${url} 返回 ${response.status}`);
    return response.json();
}

function parseArgs(args) {
    if (args.length === 0) return { tag: null };
    if (args.length === 2 && args[0] === '--tag' && args[1]) return { tag: args[1] };
    throw new Error('用法：update-mpv-archive.cjs [--tag <tag>]');
}

function writeOutputs(file, outputs) {
    if (!file) return;
    fs.appendFileSync(file, Object.entries(outputs).map(([key, value]) => `${key}=${value}\n`).join(''));
}

// 返回 { updated, previous, next }。deps 供测试替换网络和目录。
async function run(args, deps = {}) {
    const { root = ROOT, env = process.env, fetch: getRelease = fetchRelease, log = text => console.log(text) } = deps;
    const { tag } = parseArgs(args);
    const previous = readPinnedArchive(root);
    const next = archiveFromRelease(await getRelease(previous.repo, tag, env.GH_TOKEN || env.GITHUB_TOKEN));
    if (tag && next.tag !== tag) throw new Error(`请求的是 ${tag}，API 返回 ${next.tag}`);

    const same = next.tag === previous.tag && next.asset === previous.asset && next.sha256 === previous.sha256;
    const updated = !same && (tag !== null || isNewerTag(next.tag, previous.tag));
    if (updated) {
        pinArchive(root, next);
        log(`MPV 归档 ${previous.tag} -> ${next.tag}（${next.asset}，sha256 ${next.sha256}）`);
        writeOutputs(env.GITHUB_OUTPUT, { updated: true, 'previous-tag': previous.tag, ...next });
    } else {
        log(`MPV 归档保持 ${previous.tag}，Release 上是 ${next.tag}`);
        writeOutputs(env.GITHUB_OUTPUT, { updated: false, 'previous-tag': previous.tag });
    }
    return { updated, previous, next };
}

if (require.main === module) {
    run(process.argv.slice(2)).catch(error => {
        console.error(error.message);
        process.exitCode = 1;
    });
}

module.exports = { archiveFromRelease, isNewerTag, pinArchive, readPinnedArchive, run };
