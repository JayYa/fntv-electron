import logger from '../core/logger';
import { registerHook, HookType } from '../core/hooks';
import {
    findItemGuid,
    getPlayButtonConfig,
    getSelectedSourceIndex,
    isSemanticPlayButton,
    sendPlayEvent,
} from '../core/playback';

function findDetailPlayButton(): HTMLElement | null {
    const candidates = Array.from(document.querySelectorAll<HTMLElement>('button, [role="button"]'));
    for (const candidate of candidates) {
        if (!isSemanticPlayButton(candidate)) continue;

        const className = typeof candidate.className === 'string' ? candidate.className.toLowerCase() : '';
        if (className.includes('play-mask') || className.includes('playmask')) continue;
        if (findItemGuid(candidate)) return candidate.closest<HTMLElement>('button, [role="button"]');
    }
    return null;
}

function playWithMpv(button: HTMLElement): boolean {
    const itemGuid = findItemGuid(button);
    if (!itemGuid) {
        logger.error('无法调用 MPV：未能从当前详情页提取 item_guid');
        return false;
    }
    return sendPlayEvent(itemGuid, getSelectedSourceIndex());
}

function interceptOriginalButton(button: HTMLElement): void {
    if (button.dataset.mpvDetailIntercepted === 'true') return;
    button.dataset.mpvDetailIntercepted = 'true';

    button.addEventListener('click', (event) => {
        const itemGuid = findItemGuid(button);
        if (!itemGuid) {
            logger.warn('未能识别播放项，保留飞牛影视原始播放行为');
            return;
        }

        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
        sendPlayEvent(itemGuid, getSelectedSourceIndex());
    }, true);
}

function injectMpvButton(referenceButton: HTMLElement): void {
    if (referenceButton.dataset.mpvButtonInjected === 'true') return;
    referenceButton.dataset.mpvButtonInjected = 'true';

    const button = referenceButton.cloneNode(false) as HTMLElement;
    button.textContent = 'MPV播放';
    button.dataset.customPlay = 'true';
    button.removeAttribute('data-mpv-detail-intercepted');
    button.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        playWithMpv(referenceButton);
    });
    referenceButton.insertAdjacentElement('afterend', button);
}

async function setupDetailPlayButton(): Promise<void> {
    const button = findDetailPlayButton();
    if (!button) return;

    const config = await getPlayButtonConfig();
    if (config.hideOriginalPlayButton) {
        interceptOriginalButton(button);
    } else {
        injectMpvButton(button);
    }
}

function handleSetup(): void {
    setupDetailPlayButton().catch((error: unknown) => {
        logger.error('设置 MPV 播放按钮失败:', error);
    });
}

registerHook(HookType.OnReady, handleSetup);
registerHook(HookType.OnDomChange, handleSetup);

export {};
