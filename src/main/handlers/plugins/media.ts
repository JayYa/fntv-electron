import { dialog, IpcMainEvent } from 'electron';
import * as ply from '../../../modules/players';
import * as fn from '../../../modules/fn_api/api';
import * as settings from '../../../modules/fn_config/settings';
import { readCurrentLogin } from '../../../modules/fn_config/loginStore';
import { registerHandler } from '../core/ipcHandler';
import * as log from '../../../modules/logger';
import { isTrusted } from '../../../modules/cert_trust';
import { checkLibraryPageUrl } from '../../common/utils';
import { getMainWindow } from '../../common/mainwin';
import { getCurrentMpvPlayer, getMpvConfigDir } from './mpvConfig';
import { MpvPlayer, platformBehavior } from '../../../public/platform';
import { createPlaybackSession } from '../../common/proxy';
import { createProxyPlaybackUrl } from '../../common/proxySession';
import { getAccessCookieHeader } from '../../../modules/fn_api/accessGrant';
import { isPlayRequest } from '../../../modules/playback/playRequest';
import { createPlay, PlayDeps, PlayerOptions } from '../../../modules/playback/play';
import * as playbackState from '../../../modules/playback/playbackState';

function getPlayerOrNotify(): MpvPlayer | undefined {
    const player = getCurrentMpvPlayer();
    if (player) {
        log.info(`MPV 播放器路径: ${player.path}`);
        return player;
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
    const login = await readCurrentLogin();
    if (!login?.domain || !login.token || !login.account) {
        throw new Error('无法找到有效的服务器登录配置');
    }
    const { domain, token, account } = login;

    const fnapi = new fn.ApiService(domain, token);

    return {
        fnapi,
        async openProxySession(itemGuids) {
            const playback = await createPlaybackSession({
                token,
                account,
                domain,
                accessCookie: getAccessCookieHeader(domain),
                skipVerify: isTrusted(domain),
                useNasLocal: settings.getNasProxyEnabled(),
                itemGuids,
            });
            return (itemGuid, sourceIndex) => createProxyPlaybackUrl(playback, itemGuid, sourceIndex);
        },
    };
}

function launchPlayer(options: PlayerOptions): ply.Player | undefined {
    const mpv = getPlayerOrNotify();
    if (!mpv) {
        return undefined;
    }

    const extraArgs = [
        '--force-window=immediate',
        '--border=no',
        '--network-timeout=180',
        `--volume=${settings.getMpvVolume()}`,
    ];
    if (mpv.bundled) {
        extraArgs.push(`--config-dir=${getMpvConfigDir()}`);
    }

    return new ply.MpvPlayer({
        ...options,
        playerPath: mpv.path,
        extraArgs,
        debug: true,
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

    const run = playbackState.beginPlayback();
    if (!run) {
        log.warn('播放器正在启动或播放，忽略重复播放请求');
        return;
    }

    await play(request, run);
}

function init(): void {
    registerHandler('play-movie', handlePlayMovie);
}

export {
    init
};
