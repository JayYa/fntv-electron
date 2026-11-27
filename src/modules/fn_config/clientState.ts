import { configSection } from './configFile';

const section = configSection(['mpvVolume', 'trayNotificationShown']);

const clampVolume = (volume: number): number => Math.min(100, Math.max(0, Math.round(volume)));

export function mpvVolume(): number {
    const volume = section.read()?.mpvVolume;
    return typeof volume === 'number' && Number.isFinite(volume) ? clampVolume(volume) : 70;
}

export function setMpvVolume(volume: number): void {
    if (!Number.isFinite(volume)) {
        throw new Error('MPV音量必须是有限数值');
    }
    section.write({ ...section.read(), mpvVolume: clampVolume(volume) });
}

export function trayNotificationShown(): boolean {
    return section.read()?.trayNotificationShown === true;
}

export function markTrayNotificationShown(): void {
    section.write({ ...section.read(), trayNotificationShown: true });
}
