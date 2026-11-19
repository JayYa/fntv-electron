import log from '../logger';

/**
 * 写入的种类：
 * - progress：播放中的进度回传。积压时只保留最新的一条
 * - final：离开播放项时的收尾，写它的最终播放进度（和已观看）。取代同一播放项还在排队的进度回传
 * - other：不写播放进度的操作，例如 MPV 异常退出后刷新网页端。只排在前面的写入之后，不取代任何写入
 */
export type WriteKind = 'progress' | 'final' | 'other';

export interface WriteTask {
    itemGuid: string;
    kind: WriteKind;
    write(): Promise<unknown>;
}

function replaces(task: WriteTask, queued: WriteTask): boolean {
    if (queued.kind !== 'progress') return false;
    return task.kind === 'progress' || (task.kind === 'final' && task.itemGuid === queued.itemGuid);
}

interface Pending extends WriteTask {
    settle(): void;
}

/**
 * 一次播放的写入队列：按到达顺序一条一条写，前一条完成（或失败）才开始下一条，
 * 播放进度就不会被较早发出、较晚完成的请求倒退回去。
 *
 * 排队还没开始的进度回传会被取代，规则见 WriteKind；只有进度回传会被取代。
 * 返回的 Promise 在这条写完或被取代时兑现，不会 reject。
 */
export function createWriteQueue(): (task: WriteTask) => Promise<void> {
    let pending: Pending[] = [];
    let running = false;

    async function drain(): Promise<void> {
        running = true;
        while (pending.length > 0) {
            const task = pending.shift()!;
            try {
                await task.write();
            } catch (err) {
                log.error('写入播放进度异常:', err instanceof Error ? err.message : String(err));
            } finally {
                task.settle();
            }
        }
        running = false;
    }

    return (task) => {
        const replaced = pending.filter(p => replaces(task, p));
        pending = pending.filter(p => !replaced.includes(p));
        replaced.forEach(p => p.settle());

        return new Promise<void>((resolve) => {
            pending.push({ ...task, settle: resolve });
            if (!running) {
                void drain();
            }
        });
    };
}
