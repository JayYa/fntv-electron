/**
 * 播放事件数据。请求来自远程页面里的 preload，主进程使用前要校验。
 */
export interface PlayRequest {
    id: string;
    sourceIndex: number; // 可选，播放源
    restart?: boolean; // 从头播放：清除服务端进度并从 0 秒拉起播放器
}

export function isPlayRequest(request: unknown): request is PlayRequest {
    if (typeof request !== 'object' || request === null) return false;
    const { id } = request as { id?: unknown };
    return typeof id === 'string' && id.trim() !== '';
}
