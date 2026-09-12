/**
 * 继续观看卡片「更多」菜单项文案 → 播放动作的唯一分类规则。
 *
 * 纯函数，不依赖 DOM / electron，便于在 `dest/` 上直接单测。
 * 只识别两条播放类文案；「移除」「删除」等非播放项一律返回 `null`，
 * 调用方据此决定是否接管。
 */
export type MenuAction = 'continue' | 'restart';

const MENU_ACTIONS: ReadonlyArray<readonly [string, MenuAction]> = [
    ['继续播放', 'continue'],
    ['从头开始播放', 'restart'],
];

/**
 * 归一化：去掉所有空白（含文案内部空白）并统一小写，
 * 以容忍网页端渲染时插入的图标间隔、换行或大小写差异。
 */
function normalizeLabel(label: string): string {
    return label.replace(/\s+/g, '').toLowerCase();
}

/**
 * 把菜单项文案分类为播放动作。
 *
 * - 「继续播放」→ `'continue'`
 * - 「从头开始播放」→ `'restart'`
 * - 其他（含空值）→ `null`
 */
export function classifyMenuAction(label: string | null | undefined): MenuAction | null {
    if (typeof label !== 'string') return null;

    const normalized = normalizeLabel(label);
    if (!normalized) return null;

    for (const [text, action] of MENU_ACTIONS) {
        if (normalized === normalizeLabel(text)) return action;
    }
    return null;
}
