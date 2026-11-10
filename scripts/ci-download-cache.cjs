#!/usr/bin/env node
// CI 的 Electron 和打包下载缓存：算缓存 key，打包前整理 @electron/get 的缓存目录，找出被新 key 取代的旧缓存。
// 由 .github/actions/install-dependencies（keys）和 build.yml（prepare-packaging）调用，
// cache-warm.yml 用 keys 查 main 上的缓存是否存在，用 stale 找出 main 上该删的旧缓存。
// key 只取 package.json 和锁文件里的版本号，安装依赖之前也能算出来。
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const EXACT_VERSION = /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/;

function exactVersion(packageJson, name) {
    const version = packageJson.devDependencies?.[name] ?? packageJson.dependencies?.[name];
    if (!EXACT_VERSION.test(version ?? '')) {
        throw new Error(`package.json: ${name} must be pinned to an exact version, got ${version}`);
    }
    return version;
}

// electron-builder 实际下载用的是 app-builder-lib，版本在锁文件 packages 段的 `  app-builder-lib@<版本>:` 行。
function appBuilderLibVersion(lockfile) {
    const versions = [...new Set([...lockfile.matchAll(/^ {2}app-builder-lib@(\d[^:(\s]*)[:(]/gm)].map(match => match[1]))];
    if (versions.length !== 1) {
        throw new Error(`pnpm-lock.yaml: expected one app-builder-lib version, got ${versions.join(', ') || 'none'}`);
    }
    return versions[0];
}

// runnerOs 是 Actions 的 runner.os：Linux、Windows、macOS。
function cacheKeys(runnerOs, dir = root) {
    if (!runnerOs) throw new Error('RUNNER_OS is not set');
    const packageJson = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
    const electron = exactVersion(packageJson, 'electron');
    const builder = exactVersion(packageJson, 'electron-builder');
    const appBuilderLib = appBuilderLibVersion(fs.readFileSync(path.join(dir, 'pnpm-lock.yaml'), 'utf8'));
    // v2：打包缓存不再含宿主架构的 Electron zip（build.yml）。路径变了，actions/cache 读不到旧条目，换前缀以示区分。
    const packagingPrefix = `packaging-v2-${runnerOs}-`;
    const packagingElectronPrefix = `${packagingPrefix}electron-${electron}-`;
    return {
        'electron-version': electron,
        'electron-key': `electron-${runnerOs}-${electron}`,
        'packaging-key': `${packagingElectronPrefix}electron-builder-${builder}-app-builder-lib-${appBuilderLib}`,
        'packaging-electron-prefix': packagingElectronPrefix,
        'packaging-prefix': packagingPrefix,
    };
}

// main 上被当前 key 取代的旧 Electron 下载缓存和打包缓存。caches 是 Actions API 返回的 { id, key }。
// 当前 key 已在 caches 里时，同一平台、同一类的其它 key 才算旧的：先存新的再删旧的，
// 新 key 没存成时旧缓存还能经 restore-keys 用上。打包缓存也认换前缀之前的 packaging-<os>-。
function staleCaches(runnerOs, caches, dir = root) {
    const keys = cacheKeys(runnerOs, dir);
    const present = new Set(caches.map(cache => cache.key));
    const kinds = [
        { current: keys['electron-key'], prefixes: [`electron-${runnerOs}-`] },
        { current: keys['packaging-key'], prefixes: [keys['packaging-prefix'], `packaging-${runnerOs}-`] },
    ].filter(kind => present.has(kind.current));
    return caches.filter(cache => kinds.some(kind =>
        cache.key !== kind.current && kind.prefixes.some(prefix => cache.key.startsWith(prefix))));
}

// @electron/get 不传 cacheRoot 时的默认目录（env-paths('electron').cache），和 app-builder-lib 的
// defaultElectronGetCacheRoot 相同。workflow 里缓存的三个目录就是它在三个平台上的值。
function electronCacheRoot(platform = process.platform, home = os.homedir(), env = process.env) {
    if (platform === 'darwin') return path.join(home, 'Library', 'Caches', 'electron');
    if (platform === 'win32') return path.join(env.LOCALAPPDATA || path.join(home, 'AppData', 'Local'), 'electron', 'Cache');
    return path.join(env.XDG_CACHE_HOME || path.join(home, '.cache'), 'electron');
}

function filesUnder(dir) {
    if (!fs.existsSync(dir)) return [];
    return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
        const file = path.join(dir, entry.name);
        return entry.isDirectory() ? filesUnder(file) : [file];
    });
}

// 缓存经 restore-keys 从旧版本的 key 恢复时，带着旧版本的 zip，删掉，免得每次保存都越积越大。
function pruneStaleElectron(cacheRoot, version) {
    const stale = filesUnder(cacheRoot).filter(file => {
        const name = path.basename(file);
        const zip = name.match(/^electron-v(.+?)-[a-z0-9]+-[a-z0-9]+\.zip$/);
        const sums = name.match(/^SHASUMS256\.txt-(.+)$/);
        const fileVersion = zip?.[1] ?? sums?.[1];
        return fileVersion !== undefined && fileVersion !== version;
    });
    for (const file of stale) fs.rmSync(file);
    return stale;
}

// @electron/get 即使命中缓存的 zip，也每次联网重新下载 SHASUMS256.txt 来校验（cacheMode Bypass），
// GitHub 504 时打包照样失败。app-builder-lib 26.18.0 会读缓存根目录下的 SHASUMS256.txt-<版本>，
// 有对应条目时离线校验。内容取自 electron 包自带的 checksums.json，和 postinstall 校验用的是同一份。
function seedChecksums(cacheRoot, checksumsFile) {
    const version = JSON.parse(fs.readFileSync(path.join(path.dirname(checksumsFile), 'package.json'), 'utf8')).version;
    const checksums = JSON.parse(fs.readFileSync(checksumsFile, 'utf8'));
    const lines = Object.entries(checksums).map(([file, sha256]) => `${sha256} *${file}`);
    if (lines.length === 0) throw new Error(`${checksumsFile} has no checksums`);
    const file = path.join(cacheRoot, `SHASUMS256.txt-${version}`);
    fs.mkdirSync(cacheRoot, { recursive: true });
    fs.writeFileSync(file, `${lines.join('\n')}\n`);
    return { file, version };
}

function writeOutputs(outputs) {
    const text = Object.entries(outputs).map(([name, value]) => `${name}=${value}\n`).join('');
    if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, text);
    process.stdout.write(text);
}

function main(command) {
    if (command === 'keys') {
        writeOutputs(cacheKeys(process.env.RUNNER_OS));
    } else if (command === 'prepare-packaging') {
        const cacheRoot = electronCacheRoot();
        const checksumsFile = require.resolve('electron/checksums.json', { paths: [process.cwd()] });
        const { file, version } = seedChecksums(cacheRoot, checksumsFile);
        for (const stale of pruneStaleElectron(cacheRoot, version)) console.log(`Removed stale ${stale}`);
        console.log(`Seeded ${file}`);
    } else if (command === 'stale') {
        // stdin 每行 "<id>\t<key>"，输出同样格式的旧缓存。
        const caches = fs.readFileSync(0, 'utf8').split(/\r?\n/).filter(Boolean).map(line => {
            const [id, key] = line.split('\t');
            return { id, key };
        });
        for (const { id, key } of staleCaches(process.env.RUNNER_OS, caches)) process.stdout.write(`${id}\t${key}\n`);
    } else {
        throw new Error(`usage: ci-download-cache.cjs keys|prepare-packaging|stale, got ${command}`);
    }
}

if (require.main === module) main(process.argv[2]);

module.exports = { appBuilderLibVersion, cacheKeys, electronCacheRoot, pruneStaleElectron, seedChecksums, staleCaches };
