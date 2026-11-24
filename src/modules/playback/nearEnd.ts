export const NEAR_END_RATIO = 0.98;

export function isNearEnd(ts: number, duration: number): boolean {
    return duration > 0 && ts >= duration * NEAR_END_RATIO;
}

export function resumePosition(item: { ts: number; duration: number }): number {
    const { ts, duration } = item;
    const hasReliableDuration = duration > 0;
    return ts > 0 && hasReliableDuration && !isNearEnd(ts, duration) ? ts : 0;
}
