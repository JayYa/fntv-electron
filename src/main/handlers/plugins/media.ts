import { dialog, IpcMainEvent } from 'electron';
import * as ply from '../../../modules/players';
import * as fn from '../../../modules/fn_api/api';
import * as clientState from '../../../modules/fn_config/clientState';
import { registerHandler } from '../core/ipcHandler';
import * as log from '../../../modules/logger';
import { mainWindow } from '../../common/mainWindow';
import { currentConnection } from '../../common/currentLogin';
import { type MpvLaunch, mpvRuntime } from '../../common/mpvRuntime';
import { platformBehavior } from '../../../public/platform';
import { proxy } from '../../common/proxy';
import { isPlayRequest } from '../../../modules/playback/playRequest';
import { createPlay, PlayDeps, PlayerOptions } from '../../../modules/playback/play';
import * as playbackState from '../../../modules/playback/playbackState';

function getProgramOrNotify(): MpvLaunch | undefined {
    const program = mpvRuntime.program();
    if (program) {
        log.info(`MPV 播放器路径: ${program.path}`);
        return program;
    }
    const message = platformBehavior().mpvNotFoundMessage;
    dialog.showErrorBox('错误', message);
    log.error(message);
    return undefined;
}

async function connect(): ReturnType<PlayDeps['connect']> {
    const connection = await currentConnection();

    return {
        fnapi: new fn.ApiService(connection.baseUrl, connection.token),
        openPlaybackSession: (itemGuids) => proxy.openPlaybackSession(connection, itemGuids),
    };
}

function launchPlayer(options: PlayerOptions): ply.Player | undefined {
    const program = getProgramOrNotify();
    if (!program) {
        return undefined;
    }

    const extraArgs = [
        ...program.args,
        '--force-window=immediate',
        '--border=no',
        '--network-timeout=180',
        `--volume=${clientState.mpvVolume()}`,
    ];
    return new ply.MpvPlayer({
        ...options,
        createMpvProcess: ply.mpvProcessFactory({ binary: program.path, args: extraArgs, debug: true }),
        onVolumeChange: clientState.setMpvVolume,
    });
}

const play = createPlay({
    connect,
    launchPlayer,
    async onAbnormalExit() {
        await new Promise(resolve => setTimeout(resolve, 50));
        mainWindow.reloadWebUi();
    },
});

async function handlePlayMovie(_event: IpcMainEvent, request: unknown): Promise<void> {
    if (!isPlayRequest(request)) {
        log.warn('忽略无效的播放请求：缺少播放项 id');
        return;
    }

    const accepted = await playbackState.runPlayback((run) => play(request, run));
    if (!accepted) {
        log.warn('播放器正在启动或播放，忽略重复播放请求');
    }
}

function init(): void {
    registerHandler('play-movie', handlePlayMovie);
}

export {
    init
};
