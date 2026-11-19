// 播放器事件类型枚举
export enum EventType {
    PROGRESS = 'progress',
    ERROR = 'error',
    EXIT = 'exit',
    // 一个播放项结束了它的播放（播放器切到下一项）。
    // 只陈述事实，不含"看完了"的价值判断——是否够格标记已观看由业务层判定。
    ITEM_END = 'item_end',
}

export interface PlayItem {
    itemGuid: string;
    title: string;
    tvTitle: string;
    seasonNumber: number;
    episodeNumber: number;
    ts: number;
    duration: number;
    playLink: string;
}

// 播放状态数据
export type PlayStatusData = {
    itemGuid: string;
    ts: number;
    duration: number;
    percentage: number;
}

// 播放器退出数据接口
export type PlayExitData = {
    code: number;
    status: PlayStatusData;
}

// 播放器错误数据接口
export type PlayErrorData = {
    message: string;
}

export type EventData = PlayStatusData | PlayExitData | PlayErrorData;

// 事件处理器类型
export type EventHandler = (type: EventType, data: EventData) => void;

export type Config = {
    playerPath: string;
    debug?: boolean;
    extraArgs?: string[];
    onEvent: EventHandler;
    onVolumeChange?: (volume: number) => void;
    /** 播放项开始播放时调用，返回要跳转到的位置（秒），0 表示从头播，不跳转。 */
    resumePosition: (item: PlayItem) => number;
    /** 播放项开始播放时调用，返回要加载的字幕文件路径。 */
    loadSubtitles: (itemGuid: string) => Promise<string[]>;
}

export interface Player {
    /** 按顺序播放 items，从第 pos 项开始；MPV 启动并加载播放列表后返回 true。 */
    playList(items: PlayItem[], pos: number): Promise<boolean>;
    /** 停止播放；播放器随即报告 EXIT。 */
    stop(): void;
    isPlaying(): boolean;
}
