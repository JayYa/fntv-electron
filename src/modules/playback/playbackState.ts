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
    playerStarted: boolean;
    stopRequested: boolean;
    hasEnded: boolean;
    done: Promise<void>;
    markDone: () => void;
}

type EndedListener = () => void;

const STOP_PLAYBACK_TIMEOUT_MS = 5000;

let current: RunState | null = null;
const endedListeners = new Set<EndedListener>();

export async function runPlayback(body: (run: PlaybackRun) => Promise<void>): Promise<boolean> {
    if (isPlaying()) {
        return false;
    }
    let markDone!: () => void;
    const done = new Promise<void>((resolve) => { markDone = resolve; });
    const state: RunState = {
        player: null,
        playerStarted: false,
        stopRequested: false,
        hasEnded: false,
        done,
        markDone,
    };
    current = state;

    const run: PlaybackRun = {
        async start(player: StoppablePlayer, play: () => Promise<boolean>): Promise<boolean> {
            if (state.stopRequested || state.hasEnded) {
                log.info(`启动播放期间已请求停止或播放已结束，不再开始播放（stopRequested=${state.stopRequested}，hasEnded=${state.hasEnded}）`);
                return false;
            }
            state.player = player;
            const played = await play();
            state.playerStarted = played;
            return played;
        },
        ended(report?: Promise<unknown>): Promise<void> {
            if (state.hasEnded) {
                return state.done;
            }
            markEnded(state);
            void Promise.resolve(report).catch(() => undefined).then(() => releaseCurrent(state));
            return state.done;
        },
    };

    try {
        await body(run);
    } finally {
        if (!state.playerStarted) {
            void run.ended();
        }
    }
    return true;
}

function markEnded(state: RunState): void {
    state.hasEnded = true;
    state.player = null;
}

function releaseCurrent(state: RunState): void {
    state.markDone();
    if (current !== state) {
        return;
    }
    current = null;
    endedListeners.forEach((listener) => listener());
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
            if (state.hasEnded) {
                log.warn(`停止播放后等进度回传超时，继续（已等 ${STOP_PLAYBACK_TIMEOUT_MS}ms）`);
            } else {
                log.warn(`停止播放后播放器 ${STOP_PLAYBACK_TIMEOUT_MS}ms 内没有退出，强制结束这次播放`);
                markEnded(state);
                releaseCurrent(state);
            }
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
