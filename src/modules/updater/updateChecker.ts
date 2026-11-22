import * as fs from 'node:fs';
import axios, { AxiosResponse } from 'axios';
import { dialog, shell, app } from 'electron';
import { getAppDownloadProxyConfig } from '../fn_config/settings';
import log from '../logger';
import {
    assetDownloadUrl,
    describeGitHubError,
    expectedAssetName,
    fetchLatestTagFromReleasePage,
    formatClock,
    isRetryable,
    rateLimitResetAt,
    releasePageUrl
} from './githubRelease';
import { formatReleaseNotes } from './releaseNotes';
import { DownloadProgress, InAppUpdate } from './inAppUpdate';
import { isPlaying, onPlaybackEnded } from '../playback/playbackState';
import { onQuitStarted } from '../quit/quitCoordinator';
import { currentArch, currentPlatform, inAppUpdateAvailability } from '../../public/platform';

let semver: any;
try {
    semver = require('semver');
} catch {
    semver = null;
}

const UPDATE_REPOSITORY = { owner: 'JayYa', repo: 'fntv-electron' } as const;

export interface UpdateInfo {
    hasUpdate: boolean;
    latestVersion?: string;
    downloadUrl?: string | null;
    releaseNotes?: string;
    publishedAt?: string;
    htmlUrl?: string;
}

export interface GitHubRelease {
    tag_name: string;
    body: string;
    published_at: string;
    html_url: string;
    assets: GitHubAsset[];
}

export interface GitHubAsset {
    name: string;
    browser_download_url: string;
}

export interface DialogResult {
    response: number;
}

function isWritableDir(dir: string): boolean {
    try {
        fs.accessSync(dir, fs.constants.W_OK);
        return true;
    } catch {
        return false;
    }
}

function delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

export class UpdateChecker {
    private currentVersion: string;
    private githubApiUrl: string;
    private maxRetries: number;
    private baseRetryDelay: number;
    private userAgent: string;
    private rateLimitedUntil: Date | null = null;
    private readonly inAppUpdate = new InAppUpdate({
        feedUrl: () => this.withDownloadProxy(
            `https://github.com/${UPDATE_REPOSITORY.owner}/${UPDATE_REPOSITORY.repo}/releases/latest/download/`
        ),
        releasePageUrl: releasePageUrl(UPDATE_REPOSITORY)
    });
    readonly downloadProgress: DownloadProgress = this.inAppUpdate;
    private cancelDeferredUpdateDialog: () => void = () => {};

    constructor() {
        this.currentVersion = app.getVersion();
        this.userAgent = `fntv-electron/${this.currentVersion}`;
        this.githubApiUrl = `https://api.github.com/repos/${UPDATE_REPOSITORY.owner}/${UPDATE_REPOSITORY.repo}/releases/latest`;
        this.maxRetries = 3;
        this.baseRetryDelay = 1000;
    }

    async checkForUpdates(): Promise<UpdateInfo> {
        let apiError: any = null;
        if (this.isRateLimited()) {
            log.info(`GitHub API 额度要到 ${formatClock(this.rateLimitedUntil as Date)} 才恢复，直接查 Release 页面`);
        } else {
            try {
                return await this.checkForUpdatesWithRetry();
            } catch (error: any) {
                if (error.response?.status === 404) {
                    log.info('更新源暂无 Release');
                    return { hasUpdate: false };
                }
                apiError = error;
                const resetAt = rateLimitResetAt(error);
                if (resetAt) {
                    this.rateLimitedUntil = resetAt;
                    log.warn(`GitHub API 额度已用完，预计 ${formatClock(resetAt)} 恢复`);
                }
            }
        }

        try {
            return await this.checkViaReleasePage();
        } catch (fallbackError: any) {
            log.error('Release 页面回退失败:', describeGitHubError(fallbackError));
            throw new Error(this.failureMessage(apiError));
        }
    }

    async checkForUpdatesWithRetry(retryCount: number = 0): Promise<UpdateInfo> {
        try {
            log.info(`检查更新: 当前版本 ${this.currentVersion}${retryCount > 0 ? ` (重试 ${retryCount}/${this.maxRetries})` : ''}`);

            const response: AxiosResponse<GitHubRelease> = await axios.get(this.githubApiUrl, {
                timeout: 10000,
                headers: {
                    'User-Agent': this.userAgent
                }
            });

            const release = response.data;
            const latestVersion = release.tag_name.replace(/^v/, '');
            const downloadUrl = this.getDownloadUrl(release.assets, latestVersion);

            log.info(`最新版本: ${latestVersion}`);

            return {
                hasUpdate: this.isNewer(latestVersion),
                latestVersion,
                downloadUrl,
                releaseNotes: release.body,
                publishedAt: release.published_at,
                htmlUrl: release.html_url
            };
        } catch (error: any) {
            if (error.response?.status !== 404) {
                log.error(`检查更新失败 (尝试 ${retryCount + 1}/${this.maxRetries + 1}):`, describeGitHubError(error));
            }

            if (isRetryable(error) && retryCount < this.maxRetries) {
                const retryDelay = this.baseRetryDelay * Math.pow(2, retryCount);
                log.info(`等待 ${retryDelay}ms 后重试...`);
                await delay(retryDelay);
                return await this.checkForUpdatesWithRetry(retryCount + 1);
            }

            throw error;
        }
    }

    private async checkViaReleasePage(): Promise<UpdateInfo> {
        const tagName = await fetchLatestTagFromReleasePage(UPDATE_REPOSITORY, this.userAgent);
        const latestVersion = tagName.replace(/^v/, '');
        log.info(`Release 页面最新版本: ${latestVersion}`);

        const assetName = expectedAssetName(latestVersion);
        const assets: GitHubAsset[] = assetName
            ? [{ name: assetName, browser_download_url: assetDownloadUrl(UPDATE_REPOSITORY, tagName, assetName) }]
            : [];

        return {
            hasUpdate: this.isNewer(latestVersion),
            latestVersion,
            downloadUrl: this.getDownloadUrl(assets, latestVersion),
            releaseNotes: '更新说明暂时无法获取，请在 Release 页面查看。',
            htmlUrl: `https://github.com/${UPDATE_REPOSITORY.owner}/${UPDATE_REPOSITORY.repo}/releases/tag/${encodeURIComponent(tagName)}`
        };
    }

    private isRateLimited(): boolean {
        return this.rateLimitedUntil !== null && Date.now() < this.rateLimitedUntil.getTime();
    }

    private failureMessage(apiError: any): string {
        if (this.isRateLimited()) {
            return `GitHub 访问次数暂时用完，大约 ${formatClock(this.rateLimitedUntil as Date)} 之后可以重试。
也可以打开下载页面查看最新版本。`;
        }
        const reason = apiError?.response?.status ? `GitHub 返回 ${apiError.response.status}` : '无法连接 GitHub';
        return `检查更新失败：${reason}，请稍后重试，或打开下载页面查看最新版本。`;
    }

    private isNewer(latestVersion: string): boolean {
        if (semver) {
            return semver.gt(latestVersion, this.currentVersion);
        }
        return this.compareVersions(latestVersion, this.currentVersion) > 0;
    }

    compareVersions(version1: string, version2: string): number {
        const v1Parts = version1.split('.').map(Number);
        const v2Parts = version2.split('.').map(Number);
        
        const maxLength = Math.max(v1Parts.length, v2Parts.length);
        
        for (let i = 0; i < maxLength; i++) {
            const v1Part = v1Parts[i] || 0;
            const v2Part = v2Parts[i] || 0;
            
            if (v1Part > v2Part) return 1;
            if (v1Part < v2Part) return -1;
        }
        
        return 0;
    }

    getDownloadUrl(assets: GitHubAsset[], version: string): string | null {
        const platform = currentPlatform();
        const arch = currentArch();
        const assetName = expectedAssetName(version, platform, arch);
        if (!assetName) {
            log.warn(`没有为当前平台 ${platform} (${arch}) 构建的安装包`);
            return null;
        }

        const asset = (assets || []).find(candidate => candidate.name === assetName);
        if (!asset) {
            log.warn(`Release 里没有 ${assetName}`);
            log.info('可用的安装包:', (assets || []).map(candidate => candidate.name));
            return null;
        }
        log.info(`找到匹配的安装包: ${asset.name}`);
        return this.withDownloadProxy(asset.browser_download_url);
    }

    private withDownloadProxy(originalUrl: string): string {
        try {
            const proxyConfig = getAppDownloadProxyConfig();
            if (proxyConfig.enabled && proxyConfig.proxyUrl && proxyConfig.proxyUrl.trim() !== '') {
                if (originalUrl.includes('github.com')) {
                    const proxiedUrl = `${proxyConfig.proxyUrl.replace(/\/$/, '')}/${originalUrl}`;
                    log.info(`使用代理下载链接: ${proxiedUrl}`);
                    return proxiedUrl;
                }
            }
        } catch (error: any) {
            log.warn('获取代理配置失败，使用原始下载链接:', error.message);
        }

        log.info(`使用原始下载链接: ${originalUrl}`);
        return originalUrl;
    }

    async showUpdateDialog(updateInfo: UpdateInfo): Promise<boolean> {
        const { latestVersion, releaseNotes, downloadUrl, htmlUrl } = updateInfo;
        const percent = this.inAppUpdate.percent();
        if (percent !== null) {
            await dialog.showMessageBox({
                type: 'info',
                title: '检查更新',
                message: `新版本正在下载（${percent}%）`,
                detail: `当前版本: ${this.currentVersion}\n最新版本: ${latestVersion}\n\n下载完成后会提示安装。`,
                buttons: ['确定']
            });
            return false;
        }
        const availability = inAppUpdateAvailability(currentPlatform(), app.isPackaged, process.env.APPIMAGE, isWritableDir);
        if (!availability.available) {
            log.info(`手动更新：${availability.reason}`);
        }

        const result: DialogResult = await dialog.showMessageBox({
            type: 'info',
            title: '发现新版本',
            message: `飞牛影视有新版本可用！`,
            detail: `当前版本: ${this.currentVersion}\n最新版本: ${latestVersion}\n\n更新内容:\n${formatReleaseNotes(releaseNotes)}`,
            buttons: [availability.available ? '下载并安装' : '立即下载', '查看详情', '稍后提醒'],
            defaultId: 0,
            cancelId: 2
        });

        switch (result.response) {
            case 0:
                if (availability.available) {
                    this.inAppUpdate.downloadAndInstall().catch(error => {
                        log.error('应用内更新出错:', error);
                    });
                } else if (downloadUrl) {
                    shell.openExternal(downloadUrl);
                } else if (htmlUrl) {
                    shell.openExternal(htmlUrl);
                }
                return true;
            case 1:
                if (htmlUrl) {
                    shell.openExternal(htmlUrl);
                }
                return false;
            case 2:
            default:
                return false;
        }
    }

    async showNoUpdateDialog(): Promise<void> {
        await dialog.showMessageBox({
            type: 'info',
            title: '检查更新',
            message: '当前已是最新版本',
            detail: `当前版本: ${this.currentVersion}`,
            buttons: ['确定']
        });
    }

    async showUpdateErrorDialog(error: string): Promise<void> {
        const result: DialogResult = await dialog.showMessageBox({
            type: 'error',
            title: '检查更新失败',
            message: '无法检查更新',
            detail: error,
            buttons: ['打开下载页面', '确定'],
            defaultId: 1,
            cancelId: 1
        });
        if (result.response === 0) {
            shell.openExternal(releasePageUrl(UPDATE_REPOSITORY));
        }
    }

    async autoCheckForUpdates(): Promise<void> {
        try {
            const updateInfo = await this.checkForUpdates();
            
            if (updateInfo.hasUpdate && isPlaying()) {
                log.info('发现新版本，MPV 正在播放，播放结束后再显示更新提示');
                this.deferUpdateDialog(updateInfo);
            } else if (updateInfo.hasUpdate) {
                log.info('发现新版本，显示更新提示');
                await this.showUpdateDialog(updateInfo);
            } else {
                log.info('当前已是最新版本');
            }
        } catch (error: any) {
            log.error('自动检查更新失败:', error.message);
        }
    }

    private deferUpdateDialog(updateInfo: UpdateInfo): void {
        this.cancelDeferredUpdateDialog();
        const stopWaitingForPlayback = onPlaybackEnded(() => {
            this.cancelDeferredUpdateDialog();
            log.info('播放已结束，显示推迟的更新提示');
            this.showUpdateDialog(updateInfo).catch(error => log.error('显示推迟的更新提示失败:', error));
        });
        const stopWaitingForQuit = onQuitStarted(() => {
            log.info('客户端退出，不再显示推迟的更新提示');
            this.cancelDeferredUpdateDialog();
        });
        this.cancelDeferredUpdateDialog = () => {
            stopWaitingForPlayback();
            stopWaitingForQuit();
            this.cancelDeferredUpdateDialog = () => {};
        };
    }

    async manualCheckForUpdates(): Promise<void> {
        try {
            const updateInfo = await this.checkForUpdates();
            
            if (updateInfo.hasUpdate) {
                this.cancelDeferredUpdateDialog();
                await this.showUpdateDialog(updateInfo);
            } else {
                await this.showNoUpdateDialog();
            }
        } catch (error: any) {
            await this.showUpdateErrorDialog(error.message);
        }
    }
}

let instance: UpdateChecker | null = null;

export function getInstance(): UpdateChecker {
    if (!instance) {
        instance = new UpdateChecker();
    }
    return instance;
}

export function resetInstance(): void {
    instance = null;
}
