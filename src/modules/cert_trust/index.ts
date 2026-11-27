import { app, BrowserWindow, dialog, type MessageBoxOptions, type WebContents } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import * as log from '../logger';
import { createCertificateTrust, type RememberedHosts, type TrustAnswer } from './trust';

export type { CertificateFailureReason } from './trust';

let rememberedHostsCache: Set<string> | null = null;
let fallbackWindow: () => BrowserWindow | undefined = () => undefined;

function rememberedHostsFile(): string {
    const dir = app.getPath('userData');
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
    return path.join(dir, 'trusted-hosts.json');
}

function loadRememberedHosts(): Set<string> {
    if (rememberedHostsCache) return rememberedHostsCache;
    rememberedHostsCache = new Set<string>();
    try {
        const file = rememberedHostsFile();
        if (fs.existsSync(file)) {
            rememberedHostsCache = new Set(JSON.parse(fs.readFileSync(file, 'utf-8')) as string[]);
            log.info(`从文件加载了 ${rememberedHostsCache.size} 个信任主机`);
        }
    } catch (error) {
        log.error('加载信任主机列表失败:', error);
    }
    return rememberedHostsCache;
}

const rememberedHosts: RememberedHosts = {
    has: host => loadRememberedHosts().has(host),
    add(host) {
        const hosts = loadRememberedHosts();
        hosts.add(host);
        try {
            fs.writeFileSync(rememberedHostsFile(), JSON.stringify([...hosts], null, 2), 'utf-8');
            log.info(`保存了 ${hosts.size} 个信任主机到文件`);
        } catch (error) {
            log.error('保存信任主机列表失败:', error);
        }
    },
};

async function showTrustDialog(host: string, error: string, origin?: WebContents): Promise<TrustAnswer> {
    const parentWindow = (origin && BrowserWindow.fromWebContents(origin)) || BrowserWindow.getFocusedWindow() || fallbackWindow();
    const options: MessageBoxOptions = {
        type: 'warning',
        title: '证书安全警告',
        message: '检测到不受信任的SSL证书',
        detail: `域名: ${host}\n错误: ${error}\n\n此证书可能存在安全风险。您是否要信任此证书并继续访问？\n\n警告：只有在您确信该服务器是安全的情况下才选择信任。`,
        buttons: ['信任证书', '取消'],
        defaultId: 1,
        cancelId: 1,
        checkboxLabel: '记住此证书',
        checkboxChecked: false,
    };
    try {
        const result = parentWindow
            ? await dialog.showMessageBox(parentWindow, options)
            : await dialog.showMessageBox(options);
        const answer = { trust: result.response === 0, remember: result.checkboxChecked };
        log.info(answer.trust ? `用户选择信任证书，记住选择: ${answer.remember}` : '用户取消信任证书');
        return answer;
    } catch (dialogError) {
        log.error('显示证书信任对话框失败:', dialogError);
        return { trust: false, remember: false };
    }
}

const certificateTrust = createCertificateTrust<WebContents>({ askUser: showTrustDialog, remembered: rememberedHosts });

export const { isTrusted, confirmTrust, withCertificateTrust } = certificateTrust;

export function start(options: { fallbackWindow: () => BrowserWindow | undefined }): void {
    fallbackWindow = options.fallbackWindow;
    app.on('certificate-error', (event, webContents, url, error, _certificate, callback) => {
        event.preventDefault();
        if (!isTrusted(url)) log.warn('网页遇到不受信任的证书:', error);
        void confirmTrust(url, error, webContents).then(callback);
    });
}
