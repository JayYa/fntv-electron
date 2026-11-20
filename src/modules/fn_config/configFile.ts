import * as fs from 'fs';
import * as path from 'node:path';
import { app } from 'electron';
import { USER_DATA_PATH } from '../../public/constants';

const CONFIG_BACKUP_LIMIT = 3;

app.setPath('userData', USER_DATA_PATH);

/** config.json 的原始内容：凭据是磁盘上的值（密文或旧格式），设置项原样保存。 */
export type StoredConfig = Record<string, unknown>;

/** 登录历史里能用的一条：至少有地址和账号。 */
export interface StoredHistoryItem extends Record<string, unknown> {
    domain: string;
    account: string;
}

// 读取被频繁调用，同一条只记一次。
const loggedWarnings = new Set<string>();

export function warnOnce(message: string): void {
    if (loggedWarnings.has(message)) return;
    loggedWarnings.add(message);
    // 本文件加载时才设置 userData，静态引入会让 logger 先用默认目录初始化。
    (require('../logger') as typeof import('../logger')).warn(message);
}

function isObject(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

// 顶层不是对象的 JSON 和语法错误一样算损坏，读取和备份判定都走 SyntaxError 这条路。
export function parseConfig(text: string): StoredConfig {
    const stored: unknown = JSON.parse(text);
    if (!isObject(stored)) throw new SyntaxError('配置顶层不是对象');
    return stored;
}

function isHistoryItem(item: unknown): item is StoredHistoryItem {
    return isObject(item) && typeof item.domain === 'string' && typeof item.account === 'string';
}

function hasUnusableHistory(stored: { history?: unknown }): boolean {
    return stored.history !== undefined && stored.history !== null && !(Array.isArray(stored.history) && stored.history.every(isHistoryItem));
}

/** history 里能用的条目；history 缺失或为 null 时是 undefined，写回时这个字段被去掉。 */
export function usableHistory(stored: StoredConfig): StoredHistoryItem[] | undefined {
    const historyUnusable = hasUnusableHistory(stored);
    if (historyUnusable) warnOnce('配置里的 history 含无法使用的内容，读取时已跳过');
    return Array.isArray(stored.history) ? stored.history.filter(isHistoryItem) : historyUnusable ? [] : undefined;
}

function getConfigPath(): string {
    const dir = app.getPath('userData');
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
    return path.join(dir, 'config.json');
}

/** 文件不存在或内容损坏时返回 null；其它读取错误照常抛出。 */
export function readConfigFile(): StoredConfig | null {
    const p = getConfigPath();
    if (!fs.existsSync(p)) return null;
    try {
        return parseConfig(fs.readFileSync(p, 'utf-8'));
    } catch (error) {
        if (error instanceof SyntaxError) return null;
        throw error;
    }
}

export function writeConfigFile(stored: StoredConfig): void {
    replaceConfig(getConfigPath(), JSON.stringify(stored, null, 2));
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
function replaceConfig(configPath: string, content: string): void {
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
