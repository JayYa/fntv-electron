import logger from '../core/logger';
import {
    findItemGuid,
    getPlayButtonConfig,
    getSelectedSourceIndex,
    findSemanticPlayButton,
    sendPlayEvent,
} from '../core/playback';

let initialized = false;
let pressedPlayButton: HTMLElement | null = null;
let handledPointerButton: HTMLElement | null = null;

function isCardPlayButton(button: HTMLElement): boolean {
    if (button.dataset.mpvDetailIntercepted === 'true') return false;

    const className = typeof button.className === 'string' ? button.className.toLowerCase() : '';
    if (className.includes('play-mask') || className.includes('playmask')) return true;

    return Boolean(button.closest('[class*="poster" i], [class*="card" i], a[href]'));
}

function findManagedPlayButton(target: EventTarget | null): HTMLElement | null {
    if (!(target instanceof Element)) return null;

    // 已被 playButton.ts 打标的详情页主键优先拦截，不依赖文案/图标规则：
    // tv/season 详情页的主键文案（如「第 1 季 第 3 集」「未知集」）不满足 findSemanticPlayButton
    // 的文本匹配，只靠语义规则会漏拦，导致网页端原生播放器被拉起。
    const marked = target.closest<HTMLElement>('[data-mpv-detail-intercepted="true"]');
    if (marked) return marked.dataset.customPlay === 'true' ? null : marked;

    const button = findSemanticPlayButton(target);
    if (!button) return null;
    return isCardPlayButton(button) ? button : null;
}

function suppressNativePlayback(event: Event): void {
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
}

// 详情页主键加载中（disabled、文案「查询中」）时不触发播放。
function isDisabledButton(button: HTMLElement): boolean {
    return button.hasAttribute('disabled') || button.getAttribute('aria-disabled') === 'true';
}

function playManagedButton(button: HTMLElement): void {
    if (button.dataset.mpvDetailIntercepted === 'true' && isDisabledButton(button)) return;

    const itemGuid = button.dataset.mpvDetailIntercepted === 'true'
        ? findItemGuid(null)
        : findItemGuid(button);
    if (!itemGuid) {
        logger.error('无法调用 MPV：未能识别播放项');
        return;
    }

    const sourceIndex = button.dataset.mpvDetailIntercepted === 'true'
        ? getSelectedSourceIndex()
        : 0;
    sendPlayEvent(itemGuid, sourceIndex);
}

function handlePointerDown(event: PointerEvent): void {
    const button = findManagedPlayButton(event.target);
    if (!button) return;

    pressedPlayButton = button;
    suppressNativePlayback(event);
}

function handlePointerUp(event: PointerEvent): void {
    const button = findManagedPlayButton(event.target);
    const shouldPlay = Boolean(button && button === pressedPlayButton);
    pressedPlayButton = null;
    if (!button) return;

    suppressNativePlayback(event);
    if (!shouldPlay) return;

    handledPointerButton = button;
    setTimeout(() => {
        if (handledPointerButton === button) handledPointerButton = null;
    }, 0);
    playManagedButton(button);
}

function handleClick(event: MouseEvent): void {
    const button = findManagedPlayButton(event.target);
    if (!button) return;

    suppressNativePlayback(event);
    if (handledPointerButton === button) {
        handledPointerButton = null;
        return;
    }

    playManagedButton(button);
}

// 键盘 Enter/Space 触发与鼠标一致：捕获阶段拦截，避免网页端原生播放器响应。
function handleKeyDown(event: KeyboardEvent): void {
    if (event.repeat) return;
    if (event.key !== 'Enter' && event.key !== ' ') return;

    const button = findManagedPlayButton(event.target);
    if (!button) return;

    suppressNativePlayback(event);
    playManagedButton(button);
}

async function setupDelegatedPlayHandler(): Promise<void> {
    if (initialized) return;

    const config = await getPlayButtonConfig();
    if (!config.hideOriginalPlayButton) return;

    initialized = true;
    document.addEventListener('pointerdown', handlePointerDown, true);
    document.addEventListener('pointerup', handlePointerUp, true);
    document.addEventListener('pointercancel', () => {
        pressedPlayButton = null;
    }, true);
    document.addEventListener('click', handleClick, true);
    document.addEventListener('keydown', handleKeyDown, true);
}

// 只有用户明确启用时才由 MPV 接管；读取失败时保留原生播放。
setupDelegatedPlayHandler().catch((error: unknown) => {
    logger.error('初始化 MPV 播放接管失败:', error);
});

export {};
