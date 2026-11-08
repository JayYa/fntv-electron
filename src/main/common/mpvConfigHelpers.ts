import * as fs from 'node:fs';
import * as path from 'path';

interface PortableConfigPaths {
    appPath: string;
    isPackaged: boolean;
    resourcesPath: string;
}

interface BundledMpvPaths {
    appPath: string;
    execPath: string;
    isPackaged: boolean;
}

export function resolvePortableConfigDir(paths: PortableConfigPaths): string {
    const baseDir = paths.isPackaged
        ? path.dirname(paths.resourcesPath)
        : paths.appPath;
    return path.join(baseDir, 'third_party', 'fntv-mpv', 'portable_config');
}

export function resolveBundledMpvPath(paths: BundledMpvPaths): string {
    const baseDir = paths.isPackaged
        ? path.dirname(paths.execPath)
        : paths.appPath;
    return path.join(baseDir, 'third_party', 'fntv-mpv', 'mpv.exe');
}

// same-directory：用户配置就是便携配置（自选 mpv 是附带的 mpv），没有可同步的内容。
export type MpvConfigSyncResult = 'initialized' | 'updated' | 'same-directory';

const MANAGED_PLUGIN = 'uosc_danmaku';
const MANAGED_PLUGIN_ENTRY = 'main.lua';

// realpath 消掉 `..`、尾部分隔符、符号链接，Windows 上还统一大小写。不存在的目录不可能是已存在的来源。
function isSameDirectory(existingDir: string, otherDir: string): boolean {
    if (!fs.existsSync(otherDir)) {
        return false;
    }
    return fs.realpathSync.native(existingDir) === fs.realpathSync.native(otherDir);
}

function copyDirectoryRecursive(
    source: string,
    destination: string,
    overwrite: boolean = true,
): void {
    fs.mkdirSync(destination, { recursive: true });

    for (const item of fs.readdirSync(source, { withFileTypes: true })) {
        const sourcePath = path.join(source, item.name);
        const destinationPath = path.join(destination, item.name);
        if (item.isDirectory()) {
            copyDirectoryRecursive(sourcePath, destinationPath, overwrite);
        } else if (overwrite || !fs.existsSync(destinationPath)) {
            fs.copyFileSync(sourcePath, destinationPath);
        }
    }
}

export function synchronizeMpvConfig(
    portableConfigDir: string,
    mpvConfigDir: string,
): MpvConfigSyncResult {
    if (!fs.existsSync(portableConfigDir)) {
        throw new Error(`Portable config directory not found: ${portableConfigDir}`);
    }
    if (isSameDirectory(portableConfigDir, mpvConfigDir)) {
        return 'same-directory';
    }

    const scriptsDir = path.join(mpvConfigDir, 'scripts');
    if (!fs.existsSync(scriptsDir)) {
        // Existing user files may predate managed scripts; seed missing bundle files only.
        copyDirectoryRecursive(portableConfigDir, mpvConfigDir, false);
        assertPluginEntry(path.join(scriptsDir, MANAGED_PLUGIN));
        return 'initialized';
    }

    const sourcePluginDir = path.join(portableConfigDir, 'scripts', MANAGED_PLUGIN);
    if (!fs.existsSync(sourcePluginDir) || !fs.statSync(sourcePluginDir).isDirectory()) {
        throw new Error(`Managed MPV plugin not found: ${sourcePluginDir}`);
    }
    assertPluginEntry(sourcePluginDir);

    const destinationPluginDir = path.join(scriptsDir, MANAGED_PLUGIN);
    replaceDirectory(sourcePluginDir, destinationPluginDir, mpvConfigDir);
    assertPluginEntry(destinationPluginDir);
    return 'updated';
}

function assertPluginEntry(pluginDir: string): void {
    const entry = path.join(pluginDir, MANAGED_PLUGIN_ENTRY);
    if (!fs.existsSync(entry)) {
        throw new Error(`Managed MPV plugin entry missing: ${entry}`);
    }
}

// 先在用户配置下复制出完整的新目录，再换掉旧目录。复制失败时旧插件原样保留。
// 暂存目录放在用户配置根目录而不是 scripts 下，mpv 不会把它当脚本加载；同一磁盘上 rename 才可用。
function replaceDirectory(source: string, destination: string, stagingParent: string): void {
    const staging = fs.mkdtempSync(path.join(stagingParent, '.fntv-sync-'));
    const stagedCopy = path.join(staging, 'new');
    const previous = path.join(staging, 'old');
    try {
        copyDirectoryRecursive(source, stagedCopy);
        assertPluginEntry(stagedCopy);
        if (fs.existsSync(destination)) {
            fs.renameSync(destination, previous);
        }
        try {
            fs.renameSync(stagedCopy, destination);
        } catch (error) {
            if (fs.existsSync(previous)) {
                fs.renameSync(previous, destination);
            }
            throw error;
        }
    } finally {
        fs.rmSync(staging, { recursive: true, force: true });
    }
}
