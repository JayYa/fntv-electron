export type MenuAction = 'continue' | 'restart';

const MENU_ACTIONS: ReadonlyArray<readonly [string, MenuAction]> = [
    ['继续播放', 'continue'],
    ['从头开始播放', 'restart'],
];

function normalizeLabel(label: string): string {
    return label.replace(/\s+/g, '').toLowerCase();
}

export function classifyMenuAction(label: string | null | undefined): MenuAction | null {
    if (typeof label !== 'string') return null;

    const normalized = normalizeLabel(label);
    if (!normalized) return null;

    for (const [text, action] of MENU_ACTIONS) {
        if (normalized === normalizeLabel(text)) return action;
    }
    return null;
}
