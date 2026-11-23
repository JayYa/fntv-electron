import type { ApiService } from '../fn_api/api';
import type { ItemListRequest, PlayInfo, PlayListItem, PlayRecord } from '../fn_api/core/types';
import { EventData, EventHandler, EventType, Player, PlayErrorData, PlayExitData, PlayItem, PlayStatusData } from '../players/types';
import * as log from '../logger';
import { isNearEnd, resumePosition } from './nearEnd';
import type { PlayRequest } from './playRequest';
import type { PlaybackRun } from './playbackState';
import { createWriteQueue, WriteKind } from './writeQueue';

export type PlayApi = Pick<ApiService,
    'getPlayInfo' | 'getPlayInfoCached' | 'getEpisodeList' | 'getItemList'
    | 'savePlayRecord' | 'setWatched' | 'getVideoUrl' | 'getSubtitle' | 'downloadSubtitle'>;

/** 给这次播放列表建好的 Proxy 播放会话：按播放项（和播放源）给出播放地址。 */
export type PlaybackUrl = (itemGuid: string, sourceIndex?: number) => string;

/** 交给播放器的业务部分；MPV 程序路径、参数和音量由调用方补上。 */
export type PlayerOptions = {
    onEvent: EventHandler;
    resumePosition: (item: PlayItem) => number;
    loadSubtitles: (itemGuid: string) => Promise<string[]>;
};

export interface PlayDeps {
    /** 按当前登录连上飞牛影视服务；没有有效的当前登录时抛错。 */
    connect(): Promise<{
        fnapi: PlayApi;
        openProxySession(itemGuids: string[]): Promise<PlaybackUrl>;
    }>;
    /** 创建播放器；找不到 MPV 时返回 undefined（调用方负责提示用户）。 */
    launchPlayer(options: PlayerOptions): Player | undefined;
    /** MPV 异常退出后调用，例如刷新网页端。 */
    onAbnormalExit(): Promise<void>;
}

/**
 * 返回 play(request, run)：按播放请求开始这次播放，返回时已开始播放或已结束。
 * 无论成败都会结束 run：没开始播放时立即结束，开始了就在 MPV 退出、进度回传完成后结束。
 * 播放请求要先经 isPlayRequest 校验。
 */
export function createPlay(deps: PlayDeps): (request: PlayRequest, run: PlaybackRun) => Promise<void> {
    return async (request, run) => {
        let started = false;
        try {
            started = await startPlayback(deps, request, run);
        } finally {
            if (!started) {
                void run.ended();
            }
        }
    };
}

async function startPlayback(deps: PlayDeps, { id, sourceIndex, restart }: PlayRequest, run: PlaybackRun): Promise<boolean> {
    log.info('Play movie event received id:', id, ' index:', sourceIndex, ' restart:', restart === true);

    const { fnapi, openProxySession } = await deps.connect();

    const response = await fnapi.getPlayInfo(id);
    if (!response.success || !response.data) {
        log.error('获取播放信息失败:', response ? response.message : '未知错误');
        return false;
    }
    const info = response.data;
    log.info('获取播放信息成功:', { guid: info.guid, type: info.type, parent_guid: info.parent_guid || '' });

    let playList = await buildPlayList(fnapi, info);
    if (playList.length === 0) {
        log.warn('播放列表为空');
        return false;
    }

    const currentIndex = playList.findIndex(item => item.itemGuid === info.guid);
    if (currentIndex < 0) {
        throw new Error('当前播放项不在生成的播放列表中');
    }

    if (restart === true) {
        log.info('从头播放', { itemGuid: info.guid, previousTs: playList[currentIndex].ts });
        await clearPlayRecord(fnapi, info, playList[currentIndex].duration);
        playList[currentIndex] = { ...playList[currentIndex], ts: 0 };
    }

    const urlFor = await openProxySession(playList.map(item => item.itemGuid));
    const selectedSourceIndex = Number.isInteger(sourceIndex) && sourceIndex > 0 ? sourceIndex : 0;
    if (selectedSourceIndex > 0) {
        log.info(`使用指定的播放源索引: ${selectedSourceIndex}`);
    }
    playList = playList.map((item, index) => ({
        ...item,
        playLink: index === currentIndex ? urlFor(item.itemGuid, selectedSourceIndex) : urlFor(item.itemGuid),
    }));

    const player = deps.launchPlayer({
        onEvent: eventHandler(deps, fnapi, run),
        resumePosition,
        loadSubtitles: async (itemGuid) => fnapi.downloadSubtitle(await fnapi.getSubtitle(itemGuid)),
    });
    if (!player) {
        return false;
    }

    return run.start(player, () => player.playList(playList, currentIndex));
}

async function buildPlayList(fnapi: PlayApi, info: PlayInfo): Promise<PlayItem[]> {
    if (info.type === 'Episode' && info.parent_guid) {
        log.info('当前为剧集，尝试获取系列下的所有剧集进行播放');
        const episodeList = await fnapi.getEpisodeList(info.parent_guid);
        if (!episodeList.success || !episodeList.data) {
            log.error('获取剧集列表失败:', episodeList ? episodeList.message : '未知错误');
            return [];
        }
        return episodeList.data.map(fromListItem);
    }

    if (info.type === 'Video' && info.parent_guid) {
        log.info('当前为其他视频，添加到播放列表');
        const req: ItemListRequest = {
            parent_guid: info.parent_guid,
            exclude_folder: 1,
            sort_column: 'sort_title',
            sort_type: 'ASC',
        };
        const mediaList = await fnapi.getItemList(req);
        if (!mediaList.success || !mediaList.data || !mediaList.data.list) {
            log.error('获取媒体列表失败:', mediaList ? mediaList.message : '未知错误');
            return [];
        }
        log.info(`获取媒体列表成功，共 ${mediaList.data.list.length} 项`);
        return mediaList.data.list.map(fromListItem);
    }

    return [{
        itemGuid: info.guid,
        title: info.item.title,
        tvTitle: info.item.tv_title,
        seasonNumber: info.item.season_number,
        episodeNumber: info.item.episode_number,
        ts: info.ts,
        duration: info.item.duration,
        playLink: '',
    }];
}

function fromListItem(item: PlayListItem): PlayItem {
    return {
        itemGuid: item.guid,
        title: item.title,
        tvTitle: item.tv_title,
        seasonNumber: item.season_number,
        episodeNumber: item.episode_number,
        ts: item.ts,
        duration: item.duration,
        playLink: '',
    };
}

function buildPlayRecord(fnapi: PlayApi, info: PlayInfo, itemGuid: string, ts: number, duration: number): PlayRecord {
    return {
        item_guid: itemGuid,
        media_guid: info.media_guid,
        video_guid: info.video_guid,
        audio_guid: info.audio_guid,
        subtitle_guid: info.subtitle_guid,
        play_link: new URL(fnapi.getVideoUrl(info.media_guid)).hostname,
        ts,
        duration,
    };
}

async function reportPlayRecord(fnapi: PlayApi, status: PlayStatusData): Promise<boolean> {
    try {
        const resp = await fnapi.getPlayInfoCached(status.itemGuid);
        if (!resp.success || !resp.data) {
            log.error('获取播放信息失败:', resp ? resp.message : '未知错误');
            return false;
        }

        const record = buildPlayRecord(fnapi, resp.data, status.itemGuid, status.ts, status.duration);
        log.info('播放进度更新:', { item_guid: record.item_guid, ts: record.ts, duration: record.duration });

        const recorded = await fnapi.savePlayRecord(record);
        if (!recorded.success) {
            log.error('回传播放进度失败:', recorded.message || '未知错误');
            return false;
        }
        return true;
    } catch (err) {
        log.error('回传播放进度异常:', err instanceof Error ? err.message : String(err));
        return false;
    }
}

async function clearPlayRecord(fnapi: PlayApi, info: PlayInfo, duration: number): Promise<void> {
    try {
        const record = buildPlayRecord(fnapi, info, info.guid, 0, duration);
        log.info('从头播放，清零服务端播放进度:', { item_guid: record.item_guid, duration: record.duration });

        const recorded = await fnapi.savePlayRecord(record);
        if (!recorded.success) {
            log.warn('清零播放进度失败:', recorded.message || '未知错误');
        }
    } catch (err) {
        log.warn('清零播放进度异常:', err instanceof Error ? err.message : String(err));
    }
}

async function finishPlayItem(fnapi: PlayApi, status: PlayStatusData): Promise<void> {
    if (status.itemGuid.length === 0) {
        return;
    }

    await reportPlayRecord(fnapi, status);

    if (!isNearEnd(status.ts, status.duration)) {
        return;
    }

    try {
        const watchedResp = await fnapi.setWatched(status.itemGuid);
        if (!watchedResp.success) {
            log.error('标记已观看失败:', watchedResp.message || '未知错误');
            return;
        }
        log.info('已标记为已观看:', status.itemGuid);
    } catch (err) {
        log.error('标记已观看异常:', err instanceof Error ? err.message : String(err));
    }
}

function eventHandler(deps: PlayDeps, fnapi: PlayApi, run: PlaybackRun) {
    const enqueue = createWriteQueue();

    return async (type: EventType, data: EventData) => {
        switch (type) {
            case EventType.PROGRESS: {
                const progress = { ...(data as PlayStatusData) };
                if (progress.itemGuid.length === 0) {
                    log.info('process itemguid is empty');
                    return;
                }
                await enqueue({ itemGuid: progress.itemGuid, kind: 'progress', write: () => reportPlayRecord(fnapi, progress) });
                break;
            }

            case EventType.ITEM_END: {
                const endedItem = { ...(data as PlayStatusData) };
                log.info('播放项结束:', endedItem);
                await enqueue({ itemGuid: endedItem.itemGuid, kind: 'final', write: () => finishPlayItem(fnapi, endedItem) });
                break;
            }

            case EventType.ERROR:
                log.error('MPV error:', String((data as PlayErrorData).message));
                break;

            case EventType.EXIT: {
                const exit = data as PlayExitData;
                await run.ended(enqueue({ itemGuid: exit.status.itemGuid, kind: exitWriteKind(exit), write: () => handleExit(deps, fnapi, exit) }));
                break;
            }

            default:
                log.debug('收到播放器事件:', type);
                break;
        }
    };
}

function isAbnormalExit(event: PlayExitData): boolean {
    return event.code !== 0;
}

// 异常退出不写最终播放进度，不能取代排队的进度回传
function exitWriteKind(event: PlayExitData): WriteKind {
    return isAbnormalExit(event) ? 'other' : 'final';
}

async function handleExit(deps: PlayDeps, fnapi: PlayApi, event: PlayExitData): Promise<void> {
    if (isAbnormalExit(event)) {
        log.error(`播放器异常退出 (code ${event.code})`);
        await deps.onAbnormalExit();
        return;
    }

    log.info('MPV exited with code:', event.code);
    log.info('最后播放位置:', event.status);
    await finishPlayItem(fnapi, event.status);
}
