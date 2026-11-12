import axios, { AxiosResponse } from 'axios';
import { dialog, shell, app } from 'electron';
import { getAppDownloadProxyConfig } from '../fn_config/config';
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
import { InAppUpdate } from './inAppUpdate';
import { isPlaying, onPlaybackEnded } from '../playback/playbackState';
import { currentArch, currentPlatform, inAppUpdateAvailability } from '../../public/platform';

// 尝试获取semver模块
let semver: any;
try {
    semver = require('semver');
} catch {
    // 如果没有semver，使用简单的版本比较
    semver = null;
}

// 更新源：只在这里改
const UPDATE_REPOSITORY = { owner: 'JayYa', repo: 'fntv-electron' } as const;

// 类型定义
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

/**
 * 延时函数
 * @param ms - 延时毫秒数
 * @returns Promise<void>
 */
function delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

export class UpdateChecker {
    private currentVersion: string;
    private githubApiUrl: string;
    private maxRetries: number;
    private baseRetryDelay: number;
    private userAgent: string;
    // GitHub API 额度恢复前不再请求 API，只存在内存里
    private rateLimitedUntil: Date | null = null;
    // 应用内更新的 electron-updater 更新源：Release 的 latest/download/ 目录，里面有 latest.yml 和安装包
    private readonly inAppUpdate = new InAppUpdate({
        feedUrl: () => this.withDownloadProxy(
            `https://github.com/${UPDATE_REPOSITORY.owner}/${UPDATE_REPOSITORY.repo}/releases/latest/download/`
        ),
        releasePageUrl: releasePageUrl(UPDATE_REPOSITORY)
    });
    // 取消播放结束后再弹的新版本提示；没有推迟的提示时什么都不做
    private cancelDeferredUpdateDialog: () => void = () => {};

    constructor() {
        this.currentVersion = app.getVersion();
        this.userAgent = `fntv-electron/${this.currentVersion}`;
        this.githubApiUrl = `https://api.github.com/repos/${UPDATE_REPOSITORY.owner}/${UPDATE_REPOSITORY.repo}/releases/latest`;
        // 重试配置
        this.maxRetries = 3;
        this.baseRetryDelay = 1000; // 基础延迟1秒
    }

    /**
     * 检查是否有新版本。
     * 先查 GitHub API；API 失败或额度用完时改查 Release 页面的重定向。
     * @returns 更新信息
     */
    async checkForUpdates(): Promise<UpdateInfo> {
        let apiError: any = null;
        if (this.isRateLimited()) {
            log.info(`GitHub API 额度要到 ${formatClock(this.rateLimitedUntil as Date)} 才恢复，直接查 Release 页面`);
        } else {
            try {
                return await this.checkForUpdatesWithRetry();
            } catch (error: any) {
                // 仓库还没有 Release 时 GitHub 返回 404，这不是检查失败
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

    /**
     * 带梯度重试机制的 API 检查。只重试网络错误和 5xx，4xx 原样抛出：4xx 几秒内不会变，重试只会多耗额度。
     * @param retryCount - 当前重试次数
     * @returns 更新信息
     */
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
            const latestVersion = release.tag_name.replace(/^v/, ''); // 移除 'v' 前缀
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
                // 梯度延迟
                const retryDelay = this.baseRetryDelay * Math.pow(2, retryCount);
                log.info(`等待 ${retryDelay}ms 后重试...`);
                await delay(retryDelay);
                return await this.checkForUpdatesWithRetry(retryCount + 1);
            }

            throw error;
        }
    }

    /**
     * 从 Release 页面的重定向拿最新 tag，安装包链接按构建命名规则拼出
     */
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

    /**
     * 使用 semver 比较版本，如果没有semver则使用简单比较
     */
    private isNewer(latestVersion: string): boolean {
        if (semver) {
            return semver.gt(latestVersion, this.currentVersion);
        }
        return this.compareVersions(latestVersion, this.currentVersion) > 0;
    }

    /**
     * 简单的版本比较函数（用作semver的备用方案）
     * @param version1 
     * @param version2 
     * @returns 1 if version1 > version2, -1 if version1 < version2, 0 if equal
     */
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

    /**
     * 从 release assets 中找当前平台的安装包，文件名由 expectedAssetName 决定
     * @param assets - GitHub release assets
     * @param version - 不带 v 前缀的版本号
     * @returns 下载链接
     */
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

    /**
     * 开了应用更新下载加速时，GitHub 地址前加中转前缀（去掉前缀末尾的斜杠后拼上原地址）。
     * 安装包链接和应用内更新的更新源都按这条规则改写。
     */
    private withDownloadProxy(originalUrl: string): string {
        try {
            const proxyConfig = getAppDownloadProxyConfig();
            if (proxyConfig.enabled && proxyConfig.proxyUrl && proxyConfig.proxyUrl.trim() !== '') {
                // 如果原始URL包含github.com，则使用代理
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

    /** 应用内更新下载中返回 0 到 100 的整数，其它时候是 null。托盘的「检查更新」项显示它。 */
    downloadPercent(): number | null {
        return this.inAppUpdate.downloadPercent();
    }

    /** 应用内更新的下载进度变化时通知，下载结束时收到 null */
    onDownloadProgress(listener: (percent: number | null) => void): void {
        this.inAppUpdate.onDownloadProgress(listener);
    }

    /**
     * 显示更新对话框
     * @param updateInfo - 更新信息
     * @returns 用户是否选择立即更新
     */
    async showUpdateDialog(updateInfo: UpdateInfo): Promise<boolean> {
        const { latestVersion, releaseNotes, downloadUrl, htmlUrl } = updateInfo;
        const availability = inAppUpdateAvailability(currentPlatform(), app.isPackaged);
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
            case 0: // 下载并安装 / 立即下载
                if (availability.available) {
                    // 后台下载，不等它结束；失败由应用内更新自己弹框
                    this.inAppUpdate.downloadAndInstall().catch(error => {
                        log.error('应用内更新出错:', error);
                    });
                } else if (downloadUrl) {
                    shell.openExternal(downloadUrl);
                } else if (htmlUrl) {
                    shell.openExternal(htmlUrl);
                }
                return true;
            case 1: // 查看详情
                if (htmlUrl) {
                    shell.openExternal(htmlUrl);
                }
                return false;
            case 2: // 稍后提醒
            default:
                return false;
        }
    }

    /**
     * 显示没有更新的提示
     */
    async showNoUpdateDialog(): Promise<void> {
        await dialog.showMessageBox({
            type: 'info',
            title: '检查更新',
            message: '当前已是最新版本',
            detail: `当前版本: ${this.currentVersion}`,
            buttons: ['确定']
        });
    }

    /**
     * 显示检查更新失败的提示
     * @param error - 错误信息
     */
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

    /**
     * 自动检查更新（静默检查，只在有更新时提示）
     */
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
            // 自动检查失败时不显示错误提示，避免打扰用户
        }
    }

    /**
     * 播放结束后再弹新版本提示，只弹一次。之前推迟的提示由这次替换；
     * 客户端在播放结束前退出，或手动检查已经弹过提示时，不再弹。
     */
    private deferUpdateDialog(updateInfo: UpdateInfo): void {
        this.cancelDeferredUpdateDialog();
        const stopWaitingForPlayback = onPlaybackEnded(() => {
            this.cancelDeferredUpdateDialog();
            log.info('播放已结束，显示推迟的更新提示');
            this.showUpdateDialog(updateInfo).catch(error => log.error('显示推迟的更新提示失败:', error));
        });
        const dropOnQuit = () => {
            log.info('客户端退出，不再显示推迟的更新提示');
            this.cancelDeferredUpdateDialog();
        };
        app.once('before-quit', dropOnQuit);
        this.cancelDeferredUpdateDialog = () => {
            stopWaitingForPlayback();
            app.removeListener('before-quit', dropOnQuit);
            this.cancelDeferredUpdateDialog = () => {};
        };
    }

    /**
     * 手动检查更新（显示所有结果）
     */
    async manualCheckForUpdates(): Promise<void> {
        try {
            const updateInfo = await this.checkForUpdates();
            
            if (updateInfo.hasUpdate) {
                // 用户主动检查，播放中也照常弹框；推迟的提示就不用再弹了
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

// 单例实例
let instance: UpdateChecker | null = null;

/**
 * 获取 UpdateChecker 单例实例
 * @returns UpdateChecker 实例
 */
export function getInstance(): UpdateChecker {
    if (!instance) {
        instance = new UpdateChecker();
    }
    return instance;
}

/**
 * 重置单例实例（主要用于测试）
 */
export function resetInstance(): void {
    instance = null;
}
