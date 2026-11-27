import * as fs from 'fs';
import * as path from 'node:path';
import { app } from 'electron';
import { USER_DATA_PATH } from '../../public/constants';
import * as log from '../logger';

const CONFIG_BACKUP_LIMIT = 3;

app.setPath('userData', USER_DATA_PATH);

type StoredConfig = Record<string, unknown>;

export type ConfigValues<Key extends string> = { [K in Key]?: unknown };

export interface ConfigSection<Key extends string> {
    read(): ConfigValues<Key> | null;
    write(values: ConfigValues<Key>): void;
}

const loggedWarnings = new Set<string>();

export function warnOnce(message: string): void {
    if (loggedWarnings.has(message)) return;
    loggedWarnings.add(message);
    log.warn(message);
}

function isObject(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseConfig(text: string): StoredConfig {
    const stored: unknown = JSON.parse(text);
    if (!isObject(stored)) throw new SyntaxError('配置顶层不是对象');
    return stored;
}

function getConfigPath(): string {
    const dir = app.getPath('userData');
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
    return path.join(dir, 'config.json');
}

function readConfigFile(): StoredConfig | null {
    const p = getConfigPath();
    if (!fs.existsSync(p)) return null;
    try {
        return parseConfig(fs.readFileSync(p, 'utf-8'));
    } catch (error) {
        if (error instanceof SyntaxError) return null;
        throw error;
    }
}

function writeConfigFile(stored: StoredConfig): void {
    replaceConfig(getConfigPath(), JSON.stringify(stored, null, 2));
}

function isDamaged(configPath: string): boolean {
    if (!fs.existsSync(configPath)) return false;
    try {
        parseConfig(fs.readFileSync(configPath, 'utf-8'));
        return false;
    } catch {
        return true;
    }
}

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
        warnOnce('清理旧配置备份失败');
    }
}

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

const ownedKeys = new Set<string>();

export function configSection<const Key extends string>(keys: readonly Key[]): ConfigSection<Key> {
    const taken = keys.filter(key => ownedKeys.has(key));
    if (taken.length > 0) throw new Error(`配置键已有拥有方: ${taken.join(', ')}`);
    keys.forEach(key => ownedKeys.add(key));
    const owns = (key: string): key is Key => (keys as readonly string[]).includes(key);
    return {
        read() {
            const stored = readConfigFile();
            if (!stored) return null;
            const values: ConfigValues<Key> = {};
            for (const key of keys) {
                if (key in stored) values[key] = stored[key];
            }
            return values;
        },
        write(values) {
            const foreign = Object.keys(values).filter(key => !owns(key));
            if (foreign.length > 0) throw new Error(`配置键不归这一块: ${foreign.join(', ')}`);
            const stored = readConfigFile() ?? {};
            for (const key of keys) {
                if (values[key] === undefined) {
                    delete stored[key];
                } else {
                    stored[key] = values[key];
                }
            }
            writeConfigFile(stored);
        },
    };
}
