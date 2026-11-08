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
     * 带梯度重试机制的 API 检查。只重试网络错误和 5xx，4xx 原样抛出。
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
            const downloadUrl = this.getDownloadUrl(release.assets);

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
            downloadUrl: this.getDownloadUrl(assets),
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
     * 从 release assets 中获取适合当前平台的下载链接
     * @param assets - GitHub release assets
     * @returns 下载链接
     */
    getDownloadUrl(assets: GitHubAsset[]): string | null {
        if (!assets || assets.length === 0) {
            return null;
        }

        // 获取当前平台和架构信息
        const platform = process.platform;
        const arch = process.arch;
        
        log.info(`当前平台: ${platform}, 架构: ${arch}`);

        // 根据实际构建配置选择合适的安装包
        // 文件命名格式: FNMedia_${version}_${os}_${arch}.${ext}
        let patterns: RegExp[] = [];

        switch (platform) {
            case 'win32':
                // Windows: 仅支持 x64
                if (arch === 'x64') {
                    patterns = [
                        /FNMedia_.*_win_x64\.exe$/i,
                        /_win_x64\.exe$/i,
                        /win.*x64.*\.exe$/i
                    ];
                } else {
                    log.warn(`Windows 平台不支持架构: ${arch}, 仅支持 x64`);
                    return null;
                }
                break;
                
            case 'darwin':
                // macOS: 支持 x64 和 arm64
                if (arch === 'arm64') {
                    patterns = [
                        /FNMedia_.*_mac_arm64\.dmg$/i,
                        /_mac_arm64\.dmg$/i,
                        /mac.*arm64.*\.dmg$/i
                    ];
                } else if (arch === 'x64') {
                    patterns = [
                        /FNMedia_.*_mac_x64\.dmg$/i,
                        /_mac_x64\.dmg$/i,
                        /mac.*x64.*\.dmg$/i
                    ];
                } else {
                    log.warn(`macOS 平台不支持架构: ${arch}, 仅支持 x64 和 arm64`);
                    return null;
                }
                break;
                
            case 'linux':
                // Linux: 支持 x64 和 arm64
                if (arch === 'x64') {
                    patterns = [
                        /FNMedia_.*_linux_(?:x64|x86_64)\.AppImage$/i,
                        /_linux_(?:x64|x86_64)\.AppImage$/i,
                        /linux.*(?:x64|x86_64).*\.AppImage$/i
                    ];
                } else if (arch === 'arm64') {
                    patterns = [
                        /FNMedia_.*_linux_arm64\.AppImage$/i,
                        /_linux_arm64\.AppImage$/i,
                        /linux.*arm64.*\.AppImage$/i
                    ];
                } else {
                    log.warn(`Linux 平台不支持架构: ${arch}, 仅支持 x64 和 arm64`);
                    return null;
                }
                break;
                
            default:
                log.warn(`不支持的平台: ${platform}`);
                return null;
        }

        // 按优先级查找匹配的资源
        for (const pattern of patterns) {
            const asset = assets.find(asset => pattern.test(asset.name));
            if (asset) {
                log.info(`找到匹配的安装包: ${asset.name}`);
                
                // 获取原始下载链接
                const originalUrl = asset.browser_download_url;
                
                // 尝试获取代理配置并应用到下载链接
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
        }

        log.warn(`未找到适合当前平台 ${platform} (${arch}) 的安装包`);
        log.info('可用的安装包:', assets.map(asset => asset.name));
        return null;
    }

    /**
     * 显示更新对话框
     * @param updateInfo - 更新信息
     * @returns 用户是否选择立即更新
     */
    async showUpdateDialog(updateInfo: UpdateInfo): Promise<boolean> {
        const { latestVersion, releaseNotes, downloadUrl, htmlUrl } = updateInfo;
        
        const result: DialogResult = await dialog.showMessageBox({
            type: 'info',
            title: '发现新版本',
            message: `飞牛影视有新版本可用！`,
            detail: `当前版本: ${this.currentVersion}\n最新版本: ${latestVersion}\n\n更新内容:\n${formatReleaseNotes(releaseNotes)}`,
            buttons: ['立即下载', '查看详情', '稍后提醒'],
            defaultId: 0,
            cancelId: 2
        });

        switch (result.response) {
            case 0: // 立即下载
                if (downloadUrl) {
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
            
            if (updateInfo.hasUpdate) {
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
     * 手动检查更新（显示所有结果）
     */
    async manualCheckForUpdates(): Promise<void> {
        try {
            const updateInfo = await this.checkForUpdates();
            
            if (updateInfo.hasUpdate) {
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
