import * as fs from 'fs';
import * as path from 'node:path';
import type { Config, HistoryItem } from './config';

const CONFIG_BACKUP_LIMIT = 3;

// readConfig 被频繁调用，同一条只记一次。
const loggedWarnings = new Set<string>();

export function warnOnce(message: string): void {
    if (loggedWarnings.has(message)) return;
    loggedWarnings.add(message);
    // config.ts 加载时才设置 userData，静态引入会让 logger 先用默认目录初始化。
    (require('../logger') as typeof import('../logger')).warn(message);
}

function isObject(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

// 顶层不是对象的 JSON 和语法错误一样算损坏，读取和备份判定都走 SyntaxError 这条路。
export function parseConfig(text: string): Config {
    const stored: unknown = JSON.parse(text);
    if (!isObject(stored)) throw new SyntaxError('配置顶层不是对象');
    return stored;
}

export function isHistoryItem(item: unknown): item is HistoryItem {
    return isObject(item) && typeof item.domain === 'string' && typeof item.account === 'string';
}

export function hasUnusableHistory(stored: { history?: unknown }): boolean {
    return stored.history !== undefined && stored.history !== null && !(Array.isArray(stored.history) && stored.history.every(isHistoryItem));
}

// 这样的文件读出来会丢内容，被替换前要留底。
function isDamaged(configPath: string): boolean {
    if (!fs.existsSync(configPath)) return false;
    const text = fs.readFileSync(configPath, 'utf-8');
    try {
        return hasUnusableHistory(parseConfig(text));
    } catch {
        return true;
    }
}

// 用复制而不是改名：写入失败时 config.json 还在。备份含密文，只记文件名。
function backupConfig(configPath: string): void {
    const prefix = `${path.basename(configPath)}.corrupt-`;
    for (let stamp = Date.now(); ; stamp++) {
        try {
            fs.copyFileSync(configPath, path.join(path.dirname(configPath), prefix + stamp), fs.constants.COPYFILE_EXCL);
            warnOnce(`配置文件内容损坏，替换前已备份为 ${prefix + stamp}`);
            break;
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
        }
    }
    try {
        const dir = path.dirname(configPath);
        const backups = fs.readdirSync(dir).filter(name => name.startsWith(prefix)).sort();
        backups.slice(0, -CONFIG_BACKUP_LIMIT).forEach(name => fs.rmSync(path.join(dir, name)));
    } catch {
        // 备份已经落盘，清理旧备份失败不影响这次写入。
        warnOnce('清理旧配置备份失败');
    }
}

// 先写完临时文件再备份：写不下去时不占备份名额。rename 之前 config.json 始终是旧内容。
export function replaceConfig(configPath: string, content: string): void {
    const tempPath = `${configPath}.tmp`;
    const mode = fs.existsSync(configPath) ? fs.statSync(configPath).mode : undefined;
    try {
        const fd = fs.openSync(tempPath, 'w', mode);
        try {
            fs.writeFileSync(fd, content);
            fs.fsyncSync(fd);
        } finally {
            fs.closeSync(fd);
        }
        if (isDamaged(configPath)) backupConfig(configPath);
        fs.renameSync(tempPath, configPath);
    } catch (error) {
        fs.rmSync(tempPath, { force: true });
        throw error;
    }
}
