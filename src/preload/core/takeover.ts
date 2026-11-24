import { ipcRenderer } from 'electron';
import { isMpvPlaybackEnabled } from '../../modules/fn_config/playbackPreference';
import { HookType, registerHook } from './hooks';
import logger from './logger';
import { cardPlayButtonEntry, continueWatchingMenuEntry, detailMainButtonEntry, type PlayEntry } from './playEntries';

const PREFERENCE_TIMEOUT_MS = 2000;

function readMpvPlaybackPreference(): Promise<boolean> {
    return new Promise((resolve) => {
        const timeout = setTimeout(() => {
            ipcRenderer.off('play-button-config-info', handler);
            resolve(true);
        }, PREFERENCE_TIMEOUT_MS);

        const handler = (_event: Electron.IpcRendererEvent, data?: { hideOriginalPlayButton?: unknown }) => {
            clearTimeout(timeout);
            ipcRenderer.off('play-button-config-info', handler);
            resolve(isMpvPlaybackEnabled(data?.hideOriginalPlayButton));
        };

        ipcRenderer.once('play-button-config-info', handler);
        ipcRenderer.send('get-play-button-config');
    });
}

interface Hit {
    entry: PlayEntry;
    element: HTMLElement;
}

function suppressNative(event: Event): void {
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
}

function interceptPlayEntries(entries: PlayEntry[]): void {
    let pressed: Hit | null = null;
    let handled: HTMLElement | null = null;

    function locate(target: EventTarget | null): Hit | null {
        if (!(target instanceof Element)) return null;
        for (const entry of entries) {
            const element = entry.find(target);
            if (element) return { entry, element };
        }
        return null;
    }

    function play(hit: Hit): void {
        const request = hit.entry.take(hit.element);
        if (request) ipcRenderer.send('play-movie', request);
    }

    function handlePointerDown(event: PointerEvent): void {
        const hit = locate(event.target);
        if (event.target instanceof Element) {
            for (const entry of entries) {
                if (entry !== hit?.entry) entry.pressedElsewhere?.(event.target);
            }
        }
        if (!hit) {
            pressed = null;
            return;
        }
        if (!hit.entry.ready()) return;

        pressed = hit;
        suppressNative(event);
    }

    function handlePointerUp(event: PointerEvent): void {
        const hit = locate(event.target);
        const shouldPlay = Boolean(hit && hit.element === pressed?.element);
        pressed = null;
        if (!hit || !hit.entry.ready()) return;

        suppressNative(event);
        if (!shouldPlay) return;

        const { element } = hit;
        handled = element;
        setTimeout(() => {
            if (handled === element) handled = null;
        }, 0);
        play(hit);
    }

    function handleClick(event: MouseEvent): void {
        const hit = locate(event.target);
        if (!hit) return;

        if (handled === hit.element) {
            handled = null;
            suppressNative(event);
            return;
        }
        if (!hit.entry.ready()) return;

        suppressNative(event);
        play(hit);
    }

    function handleKeyDown(event: KeyboardEvent): void {
        if (event.key === 'Escape') {
            if (pressed?.entry.cancel) pressed = null;
            for (const entry of entries) entry.cancel?.();
            return;
        }
        if (event.repeat || (event.key !== 'Enter' && event.key !== ' ')) return;

        const hit = locate(event.target);
        if (!hit || !hit.entry.keyboard) return;

        suppressNative(event);
        play(hit);
    }

    document.addEventListener('pointerdown', handlePointerDown, true);
    document.addEventListener('pointerup', handlePointerUp, true);
    document.addEventListener('pointercancel', () => {
        pressed = null;
    }, true);
    document.addEventListener('click', handleClick, true);
    document.addEventListener('keydown', handleKeyDown, true);
}

export function startTakeover(): void {
    const enabled = readMpvPlaybackPreference();
    const detailMainButton = detailMainButtonEntry();

    function recognizeDetailMainButton(): void {
        enabled
            .then((on) => {
                if (on) detailMainButton.recognize();
            })
            .catch((error: unknown) => logger.error('识别详情页播放键失败:', error));
    }
    registerHook(HookType.OnReady, recognizeDetailMainButton);
    registerHook(HookType.OnDomChange, recognizeDetailMainButton);

    enabled
        .then((on) => {
            if (!on) {
                logger.info('MPV 播放接管未启用: 配置为网页播放');
                return;
            }
            logger.info('MPV 播放接管已启用');
            interceptPlayEntries([detailMainButton, cardPlayButtonEntry(), continueWatchingMenuEntry()]);
        })
        .catch((error: unknown) => logger.error('初始化 MPV 播放接管失败:', error));
}
