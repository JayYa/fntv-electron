import { dialog, IpcMainEvent } from 'electron';
import * as ply from '../../../modules/players';
import * as fn from '../../../modules/fn_api/api';
import * as settings from '../../../modules/fn_config/settings';
import { registerHandler } from '../core/ipcHandler';
import * as log from '../../../modules/logger';
import { checkLibraryPageUrl } from '../../common/utils';
import { getMainWindow } from '../../common/mainwin';
import { currentConnection } from '../../common/currentLogin';
import { type MpvLaunch, mpvRuntime } from '../../common/mpvRuntime';
import { platformBehavior } from '../../../public/platform';
import { createPlaybackSession } from '../../common/proxy';
import { createProxyPlaybackUrl } from '../../common/proxySession';
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

async function refreshWindow(): Promise<void> {
    const currentURL = getMainWindow().webContents.getURL() || '';
    if (checkLibraryPageUrl(currentURL)) {
        return;
    }

    log.info('刷新当前窗口');
    getMainWindow().webContents.reloadIgnoringCache();
}

async function connect(): ReturnType<PlayDeps['connect']> {
    const { baseUrl, token, account, accessCookie, trustedHost } = await currentConnection();

    return {
        fnapi: new fn.ApiService(baseUrl, token),
        async openProxySession(itemGuids) {
            const playback = await createPlaybackSession({
                token,
                account,
                domain: baseUrl,
                accessCookie,
                skipVerify: trustedHost,
                useNasLocal: settings.getNasProxyEnabled(),
                itemGuids,
            });
            return (itemGuid, sourceIndex) => createProxyPlaybackUrl(playback, itemGuid, sourceIndex);
        },
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
        `--volume=${settings.getMpvVolume()}`,
    ];
    return new ply.MpvPlayer({
        ...options,
        createMpvProcess: ply.mpvProcessFactory({ binary: program.path, args: extraArgs, debug: true }),
        onVolumeChange: settings.setMpvVolume,
    });
}

const play = createPlay({
    connect,
    launchPlayer,
    async onAbnormalExit() {
        await new Promise(resolve => setTimeout(resolve, 50));
        await refreshWindow();
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
