/**
 * 「接近片尾」的唯一定义。
 */
export const NEAR_END_RATIO = 0.98;

/**
 * 判断某个播放进度是否已接近片尾。
 *
 * `duration <= 0` 一律返回 `false`：某些播放源（直链类）拿不到可靠时长，
 * 此时宁可漏判也不误判。
 *
 * @param ts 当前播放位置（秒）
 * @param duration 播放项总时长（秒）
 */
export function isNearEnd(ts: number, duration: number): boolean {
    return duration > 0 && ts >= duration * NEAR_END_RATIO;
}

/**
 * 打开播放项时续播的位置（秒），0 表示从头播。
 *
 * 只有播放进度大于 0、总时长可信（大于 0）且没接近片尾时才续播。
 */
export function resumePosition(item: { ts: number; duration: number }): number {
    const { ts, duration } = item;
    const hasReliableDuration = duration > 0;
    return ts > 0 && hasReliableDuration && !isNearEnd(ts, duration) ? ts : 0;
}
