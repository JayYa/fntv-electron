import * as log from '../logger';

interface StoppablePlayer {
    stop(): void;
}

export interface PlaybackRun {
    start(player: StoppablePlayer, play: () => Promise<boolean>): Promise<boolean>;
    ended(report?: Promise<unknown>): Promise<void>;
}

interface RunState {
    player: StoppablePlayer | null;
    stopRequested: boolean;
    hasEnded: boolean;
    done: Promise<void>;
}

type EndedListener = () => void;

const STOP_PLAYBACK_TIMEOUT_MS = 5000;

let current: RunState | null = null;
const endedListeners = new Set<EndedListener>();

export function beginPlayback(): PlaybackRun | null {
    if (isPlaying()) {
        return null;
    }
    let markDone!: () => void;
    const state: RunState = {
        player: null,
        stopRequested: false,
        hasEnded: false,
        done: new Promise<void>((resolve) => { markDone = resolve; }),
    };
    current = state;

    return {
        start(player: StoppablePlayer, play: () => Promise<boolean>): Promise<boolean> {
            if (state.stopRequested || state.hasEnded) {
                log.info(`启动播放期间已请求停止或播放已结束，不再开始播放（stopRequested=${state.stopRequested}，hasEnded=${state.hasEnded}）`);
                return Promise.resolve(false);
            }
            state.player = player;
            return play();
        },
        ended(report?: Promise<unknown>): Promise<void> {
            if (state.hasEnded) {
                return state.done;
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
            return state.done;
        },
    };
}

export function isPlaying(): boolean {
    return current !== null && !current.hasEnded;
}

export function onPlaybackEnded(listener: EndedListener): () => void {
    endedListeners.add(listener);
    return () => {
        endedListeners.delete(listener);
    };
}

export async function stopPlaybackAndWait(): Promise<void> {
    const state = current;
    if (!state) {
        return;
    }
    let timer: NodeJS.Timeout | undefined;
    const timedOut = new Promise<void>((resolve) => {
        timer = setTimeout(() => {
            log.warn(`停止播放后等进度回传超时，继续（已等 ${STOP_PLAYBACK_TIMEOUT_MS}ms，hasEnded=${state.hasEnded}）`);
            resolve();
        }, STOP_PLAYBACK_TIMEOUT_MS);
    });
    try {
        if (!state.hasEnded) {
            state.stopRequested = true;
            state.player?.stop();
        }
        await Promise.race([state.done, timedOut]);
    } finally {
        clearTimeout(timer);
    }
}
