import { dialog, BrowserWindow, app } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import * as log from '../logger';
import { normalizeCertificateHost } from './host';

let trustedHostsCache: Set<string> | null = null;
let cacheLoaded = false;
const sessionTrustedHosts = new Set<string>();

function getTrustedHostsConfigPath(): string {
    const dir = app.getPath('userData');
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
    return path.join(dir, 'trusted-hosts.json');
}

function loadTrustedHostsFromFile(): Set<string> {
    const configPath = getTrustedHostsConfigPath();

    try {
        if (fs.existsSync(configPath)) {
            const data = fs.readFileSync(configPath, 'utf-8');
            const hostsArray = JSON.parse(data) as string[];
            log.info(`从文件加载了 ${hostsArray.length} 个信任主机`);
            return new Set(hostsArray);
        }
    } catch (error) {
        log.error('加载信任主机列表失败:', error);
    }

    log.info('创建新的信任主机列表');
    return new Set<string>();
}

function saveTrustedHostsToFile(trustedHosts: Set<string>): void {
    const configPath = getTrustedHostsConfigPath();

    try {
        const hostsArray = Array.from(trustedHosts);
        fs.writeFileSync(configPath, JSON.stringify(hostsArray, null, 2), 'utf-8');
        log.info(`保存了 ${hostsArray.length} 个信任主机到文件`);
    } catch (error) {
        log.error('保存信任主机列表失败:', error);
    }
}

function getTrustedHostsCache(): Set<string> {
    if (!cacheLoaded || trustedHostsCache === null) {
        trustedHostsCache = loadTrustedHostsFromFile();
        cacheLoaded = true;
        log.info('信任主机缓存已加载到内存');
    }
    return trustedHostsCache;
}

const normalizeHost = normalizeCertificateHost;

export function isTrusted(url: string): boolean {
    const host = normalizeHost(url);
    const trustedHosts = getTrustedHostsCache();
    return sessionTrustedHosts.has(host) || trustedHosts.has(host);
}

export function addTrustedHost(url: string): void {
    const host = normalizeHost(url);
    const trustedHosts = getTrustedHostsCache();

    trustedHosts.add(host);

    saveTrustedHostsToFile(trustedHosts);

    log.info(`已添加信任主机: ${host}`);
}

export function removeTrustedHost(url: string): void {
    const host = normalizeHost(url);
    const trustedHosts = getTrustedHostsCache();

    const deleted = trustedHosts.delete(host);

    if (deleted) {
        saveTrustedHostsToFile(trustedHosts);
        log.info(`已移除信任主机: ${host}`);
    } else {
        log.warn(`尝试移除不存在的信任主机: ${host}`);
    }
}

export function getTrustedHosts(): string[] {
    const trustedHosts = getTrustedHostsCache();
    return Array.from(trustedHosts);
}

export function clearTrustedHosts(): void {
    const trustedHosts = getTrustedHostsCache();

    trustedHosts.clear();

    saveTrustedHostsToFile(trustedHosts);

    log.info('已清空所有信任主机');
}

export function reloadTrustedHosts(): void {
    cacheLoaded = false;
    trustedHostsCache = null;
    getTrustedHostsCache();
    log.info('已重新加载信任主机列表');
}

export function getTrustedHostsCount(): number {
    const trustedHosts = getTrustedHostsCache();
    return trustedHosts.size;
}

export function isCacheLoaded(): boolean {
    return cacheLoaded;
}

export function addTrustedHosts(urls: string[]): void {
    const trustedHosts = getTrustedHostsCache();
    let addedCount = 0;

    for (const url of urls) {
        const host = normalizeHost(url);
        if (!trustedHosts.has(host)) {
            trustedHosts.add(host);
            addedCount++;
        }
    }

    if (addedCount > 0) {
        saveTrustedHostsToFile(trustedHosts);
        log.info(`批量添加了 ${addedCount} 个信任主机`);
    } else {
        log.info('没有新的主机需要添加');
    }
}

export function removeTrustedHosts(urls: string[]): void {
    const trustedHosts = getTrustedHostsCache();
    let removedCount = 0;

    for (const url of urls) {
        const host = normalizeHost(url);
        if (trustedHosts.delete(host)) {
            removedCount++;
        }
    }

    if (removedCount > 0) {
        saveTrustedHostsToFile(trustedHosts);
        log.info(`批量移除了 ${removedCount} 个信任主机`);
    } else {
        log.info('没有主机被移除');
    }
}

export async function showCertificateTrustDialog(
    url: string,
    error: string,
    parentWindow?: BrowserWindow
): Promise<boolean> {
    const host = normalizeHost(url);

    try {
        const result = parentWindow
            ? await dialog.showMessageBox(parentWindow, {
                type: 'warning',
                title: '证书安全警告',
                message: '检测到不受信任的SSL证书',
                detail: `域名: ${host}\n错误: ${error}\n\n此证书可能存在安全风险。您是否要信任此证书并继续访问？\n\n警告：只有在您确信该服务器是安全的情况下才选择信任。`,
                buttons: ['信任证书', '取消'],
                defaultId: 1,
                cancelId: 1,
                checkboxLabel: '记住此证书',
                checkboxChecked: false
            })
            : await dialog.showMessageBox({
                type: 'warning',
                title: '证书安全警告',
                message: '检测到不受信任的SSL证书',
                detail: `域名: ${host}\n错误: ${error}\n\n此证书可能存在安全风险。您是否要信任此证书并继续访问？\n\n警告：只有在您确信该服务器是安全的情况下才选择信任。`,
                buttons: ['信任证书', '取消'],
                defaultId: 1,
                cancelId: 1,
                checkboxLabel: '记住此证书',
                checkboxChecked: false
            });

        if (result.response === 0) {
            sessionTrustedHosts.add(host);
            if (result.checkboxChecked) {
                addTrustedHost(url);
            }
            log.info(`用户选择信任证书: ${host}, 记住选择: ${result.checkboxChecked}`);
            return true;
        } else {
            log.info(`用户取消信任证书: ${host}`);
            return false;
        }
    } catch (error) {
        log.error('显示证书信任对话框失败:', error);
        return false;
    }
}
