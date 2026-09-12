import type { PlayItem } from '../players/types';

/**
 * 「从头播放」对播放项的唯一改动：把续播位置归零。
 *
 * 播放器只依据 `PlayItem.ts` 决定是否恢复上次位置，所以 `ts = 0` 即等价于
 * "不做续播 seek"。清除服务端播放进度是从头播放的另一半语义，由调用方另行处理，
 * 本函数只负责本地播放项。
 *
 * 与「接近片尾」时重新打开从头播不同：后者不改动播放项，也不清进度。
 *
 * @param item 播放项
 * @param restart 是否从头播放
 * @returns restart 为真时返回 `ts` 归零的副本（其余字段不变）；为假时原样返回
 */
export function applyRestart(item: PlayItem, restart: boolean): PlayItem {
    if (!restart) {
        return item;
    }
    return { ...item, ts: 0 };
}
