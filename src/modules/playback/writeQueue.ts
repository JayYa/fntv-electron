import log from '../logger';

/** 一次写入飞牛影视服务的操作：一次进度回传，或离开播放项时的收尾（最终进度、已观看）。 */
export interface WriteTask {
    itemGuid: string;
    /** 播放中的进度回传。积压时只保留最新的一条，被后来的写入取代 */
    progress: boolean;
    write(): Promise<unknown>;
}

interface Pending extends WriteTask {
    settle(): void;
}

/**
 * 一次播放的写入队列：按到达顺序一条一条写，前一条完成（或失败）才开始下一条，
 * 播放进度就不会被较早发出、较晚完成的请求倒退回去。
 *
 * 排队还没开始的进度回传会被取代：来了新的进度回传，或同一播放项的收尾。
 * 收尾从不被取代。返回的 Promise 在这条写完或被取代时兑现，不会 reject。
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
        const replaced = pending.filter(p => p.progress && (task.progress || p.itemGuid === task.itemGuid));
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
