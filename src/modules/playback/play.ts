/**
 * 播放模块：一次播放从拼播放列表到 MPV 退出、进度回传完成的全部业务规则。
 *
 * - 播放列表：剧集是同一季的所有集，其它视频是同一文件夹下的所有视频，其余只有当前播放项
 * - 续播和接近片尾（nearEnd.ts），从头播放
 * - 进度回传，播放项结束时标记已观看；同一次播放的写入按顺序进行（writeQueue.ts）
 * - 和播放状态模块接线：开始播放、MPV 退出时带上进度回传结束这次播放
 *
 * 不依赖 Electron。当前登录、Proxy、MPV 程序和窗口都由调用方经 PlayDeps 提供。
 */

import type { ApiService } from '../fn_api/api';
import type { ItemListRequest, PlayInfo, PlayListItem, PlayRecord } from '../fn_api/core/types';
import { EventData, EventHandler, EventType, Player, PlayErrorData, PlayExitData, PlayItem, PlayStatusData } from '../players/types';
import log from '../logger';
import { isNearEnd, resumePosition } from './nearEnd';
import type { PlayRequest } from './playRequest';
import type { PlaybackRun } from './playbackState';
import { createWriteQueue } from './writeQueue';

/** 播放用到的飞牛影视服务调用。 */
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
                run.ended();
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
    if (!playList) {
        return false;
    }
    if (playList.length === 0) {
        log.warn('播放列表为空');
        return false;
    }

    const currentIndex = playList.findIndex(item => item.itemGuid === info.guid);
    if (currentIndex < 0) {
        throw new Error('当前播放项不在生成的播放列表中');
    }

    // 从头播放：先尽力清除播放进度（失败不阻断），再把当前项 ts 归零，就不会续播
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

    // 启动期间已请求停止播放（例如应用内更新要安装）时不打开 MPV，返回 false；契约见 PlaybackRun.start
    return run.start(player, () => player.playList(playList, currentIndex));
}

// 返回 undefined 表示取列表失败
async function buildPlayList(fnapi: PlayApi, info: PlayInfo): Promise<PlayItem[] | undefined> {
    if (info.type === 'Episode' && info.parent_guid) {
        log.info('当前为剧集，尝试获取系列下的所有剧集进行播放');
        const episodeList = await fnapi.getEpisodeList(info.parent_guid);
        if (!episodeList.success || !episodeList.data) {
            log.error('获取剧集列表失败:', episodeList ? episodeList.message : '未知错误');
            return undefined;
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
            return undefined;
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

/** 播放进度回传和从头播放清零共用同一份记录结构，只有 ts 不同。 */
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

/**
 * 回传一次播放进度。失败只记日志并返回 false：不抛出、不重试、不提示用户，不影响播放。
 */
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

/**
 * 从头播放的一半：写一条 ts = 0 的播放进度。已观看不清除。
 * 尽力而为：失败只记日志，不阻断播放。
 */
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

/**
 * 离开一个播放项：先回传最终播放进度，再判定是否标记已观看。
 *
 * 顺序不可颠倒：已观看必须后写，否则可能被随后的进度记录覆盖。
 * 进度回传失败不阻止已观看判定，它只依赖播放器实测的 ts / duration。整条链路只记日志、不抛异常。
 */
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
    // 这次播放的写入排成一条队列，顺序见 writeQueue.ts
    const enqueue = createWriteQueue();

    return async (type: EventType, data: EventData) => {
        switch (type) {
            case EventType.PROGRESS: {
                // 先拷贝：回传要先 await 查播放信息，不依赖播放器之后不再改这个对象
                const progress = { ...(data as PlayStatusData) };
                if (progress.itemGuid.length === 0) {
                    log.info('process itemguid is empty');
                    return;
                }
                await enqueue({ itemGuid: progress.itemGuid, kind: 'progress', write: () => reportPlayRecord(fnapi, progress) });
                break;
            }

            case EventType.ITEM_END: {
                // 播放器只报告「这一项结束了」，是否算已观看在这里判定
                const endedItem = { ...(data as PlayStatusData) };
                log.info('播放项结束:', endedItem);
                await enqueue({ itemGuid: endedItem.itemGuid, kind: 'final', write: () => finishPlayItem(fnapi, endedItem) });
                break;
            }

            case EventType.ERROR:
                log.error('MPV error:', String((data as PlayErrorData).message));
                break;

            case EventType.EXIT: {
                // 播放器同步发出退出事件，这里同步结束这次播放；排在前面的写入和收尾都完成后，播放状态模块再通知订阅者
                const exit = data as PlayExitData;
                // 只有正常退出会写最终播放进度；异常退出不写，排队的进度回传要照常写完
                const kind = exit.code === 0 ? 'final' : 'other';
                const report = enqueue({ itemGuid: exit.status.itemGuid, kind, write: () => handleExit(deps, fnapi, exit) });
                run.ended(report);
                await report;
                break;
            }

            default:
                log.debug('收到播放器事件:', type);
                break;
        }
    };
}

// MPV 退出后的收尾：异常退出交给调用方（刷新网页端），正常退出回传最终进度与已观看
async function handleExit(deps: PlayDeps, fnapi: PlayApi, event: PlayExitData): Promise<void> {
    if (event.code !== 0) {
        log.error(`播放器异常退出 (code ${event.code})`);
        await deps.onAbnormalExit();
        return;
    }

    log.info('MPV exited with code:', event.code);
    log.info('最后播放位置:', event.status);
    await finishPlayItem(fnapi, event.status);
}
