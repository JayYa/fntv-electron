import * as log from '../logger';

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
