/**
 * 播放状态：记录 MPV 是否在播放（包括正在启动播放），播放结束时通知订阅者，
 * 也能停止播放并等这次退出的进度回传完成。
 *
 * 只有媒体播放插件通过 beginPlayback 写入状态，其它模块只读取、订阅或停止播放。
 */

/** 能停止的播放器。停止后播放器要报告退出，媒体播放插件随之调用 ended。 */
interface StoppablePlayer {
    stop(): void;
}

export interface PlaybackSession {
    /**
     * 播放器创建后、开始播放前调用。返回 false 表示启动期间已请求停止，
     * 媒体播放插件不要再开始播放，并调用 ended。
     */
    attach(player: StoppablePlayer): boolean;
    /**
     * 播放结束（MPV 退出），或启动失败。调用后立即不再算在播放；
     * report 是这次退出的进度回传，它完成后才算结束完成。重复调用只有第一次生效。
     */
    ended(report?: Promise<unknown>): void;
}

interface SessionState {
    player: StoppablePlayer | null;
    stopRequested: boolean;
    hasEnded: boolean;
    // 结束且退出的进度回传完成时兑现
    done: Promise<void>;
}

type EndedListener = () => void;

// 最近一次播放；它结束且退出的进度回传完成后清空
let current: SessionState | null = null;
const endedListeners = new Set<EndedListener>();

/** 媒体播放插件收到播放请求、开始启动播放时调用。 */
export function beginPlayback(): PlaybackSession {
    let markDone!: () => void;
    const state: SessionState = {
        player: null,
        stopRequested: false,
        hasEnded: false,
        done: new Promise<void>((resolve) => { markDone = resolve; }),
    };
    current = state;

    return {
        attach(player: StoppablePlayer): boolean {
            if (state.stopRequested || state.hasEnded) {
                return false;
            }
            state.player = player;
            return true;
        },
        ended(report?: Promise<unknown>): void {
            if (state.hasEnded) {
                return;
            }
            state.hasEnded = true;
            state.player = null;
            void Promise.resolve(report).catch(() => undefined).then(() => {
                markDone();
                if (current !== state) {
                    return;
                }
                current = null;
                endedListeners.forEach((listener) => listener());
            });
        },
    };
}

/** 当前是否在播放，包括正在启动播放。 */
export function isPlaying(): boolean {
    return current !== null && !current.hasEnded;
}

/** 订阅播放结束：退出的进度回传完成、且没有新的播放时通知。返回取消订阅的函数。 */
export function onPlaybackEnded(listener: EndedListener): () => void {
    endedListeners.add(listener);
    return () => {
        endedListeners.delete(listener);
    };
}

/**
 * 停止播放，并等这次退出的进度回传完成。没有播放时立即返回。
 * 正在启动播放时取消启动，等启动收尾完成。
 */
export async function stopPlaybackAndWait(): Promise<void> {
    const state = current;
    if (!state) {
        return;
    }
    if (!state.hasEnded) {
        state.stopRequested = true;
        state.player?.stop();
    }
    await state.done;
}
