import logger from '../core/logger';
import { registerHook, HookType } from '../core/hooks';
import {
    findItemGuid,
    getPlayButtonConfig,
    findSemanticPlayButton,
    sendPlayEvent,
} from '../core/playback';

let initialized = false;

function isCardPlayButton(button: HTMLElement): boolean {
    if (button.dataset.mpvDetailIntercepted === 'true') return false;

    const className = typeof button.className === 'string' ? button.className.toLowerCase() : '';
    if (className.includes('play-mask') || className.includes('playmask')) return true;

    return Boolean(button.closest('[class*="poster" i], [class*="card" i], a[href]'));
}

function dispatchOriginalClick(button: HTMLElement): void {
    button.dataset.allowOriginalPlay = 'true';
    button.click();
    queueMicrotask(() => delete button.dataset.allowOriginalPlay);
}

function showPlayChoice(button: HTMLElement, itemGuid: string): void {
    document.getElementById('play-choice-modal')?.remove();

    const overlay = document.createElement('div');
    overlay.id = 'play-choice-modal';
    overlay.style.cssText = 'position:fixed;inset:0;z-index:100000;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.55);backdrop-filter:blur(8px)';

    const panel = document.createElement('div');
    panel.style.cssText = 'min-width:320px;padding:24px;border:1px solid rgba(255,255,255,.18);border-radius:16px;background:#202124;color:#fff;box-shadow:0 16px 48px rgba(0,0,0,.4)';

    const title = document.createElement('h3');
    title.textContent = '选择播放方式';
    title.style.cssText = 'margin:0 0 20px;text-align:center;font-size:18px';

    const actions = document.createElement('div');
    actions.style.cssText = 'display:flex;gap:12px;justify-content:center';

    const createButton = (text: string, primary = false) => {
        const action = document.createElement('button');
        action.type = 'button';
        action.textContent = text;
        action.style.cssText = `padding:10px 18px;border:0;border-radius:10px;cursor:pointer;color:#fff;background:${primary ? '#6875f5' : '#3c4043'}`;
        return action;
    };

    const original = createButton('网页播放');
    const mpv = createButton('MPV播放', true);
    const cancel = createButton('取消');

    original.addEventListener('click', () => {
        overlay.remove();
        dispatchOriginalClick(button);
    });
    mpv.addEventListener('click', () => {
        overlay.remove();
        sendPlayEvent(itemGuid);
    });
    cancel.addEventListener('click', () => overlay.remove());
    overlay.addEventListener('click', (event) => {
        if (event.target === overlay) overlay.remove();
    });

    actions.append(original, mpv, cancel);
    panel.append(title, actions);
    overlay.append(panel);
    document.body.append(overlay);
}

async function handleCardPlay(event: MouseEvent): Promise<void> {
    const target = event.target;
    if (!(target instanceof Element)) return;

    const button = findSemanticPlayButton(target);
    if (!button || !isCardPlayButton(button) || button.dataset.allowOriginalPlay === 'true') return;

    const itemGuid = findItemGuid(button);
    if (!itemGuid) {
        logger.warn('未能识别卡片播放项，保留飞牛影视原始播放行为');
        return;
    }

    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();

    const config = await getPlayButtonConfig();
    if (config.hideOriginalPlayButton) {
        sendPlayEvent(itemGuid);
    } else {
        showPlayChoice(button, itemGuid);
    }
}

function setupDelegatedPlayHandler(): void {
    if (initialized) return;
    initialized = true;
    document.addEventListener('click', (event) => {
        handleCardPlay(event).catch((error: unknown) => {
            logger.error('处理卡片 MPV 播放失败:', error);
        });
    }, true);
}

registerHook(HookType.OnReady, setupDelegatedPlayHandler);

export {};
