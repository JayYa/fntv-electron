import * as path from 'path';

interface PortableConfigPaths {
    appPath: string;
    isPackaged: boolean;
    resourcesPath: string;
}

interface BundledMpvPaths {
    appPath: string;
    execPath: string;
    isPackaged: boolean;
}

export function resolvePortableConfigDir(paths: PortableConfigPaths): string {
    const baseDir = paths.isPackaged
        ? path.dirname(paths.resourcesPath)
        : paths.appPath;
    return path.join(baseDir, 'third_party', 'fntv-mpv', 'portable_config');
}

export function resolveBundledMpvPath(paths: BundledMpvPaths): string {
    const baseDir = paths.isPackaged
        ? path.dirname(paths.execPath)
        : paths.appPath;
    return path.join(baseDir, 'third_party', 'fntv-mpv', 'mpv.exe');
}

const FNTV_UOSC_MARKERS = [
    'button:danmaku',
    'button:danmaku_delay',
    'button:skip_cfg_btn',
];

export function upgradeFntvUoscConfig(content: string): string {
    const lines = content.split(/\r?\n/);
    const controlsIndex = lines.findIndex(line => line.startsWith('controls='));
    if (controlsIndex < 0) return content;

    const controls = lines[controlsIndex];
    const isManagedFntvControls = FNTV_UOSC_MARKERS.every(marker => controls.includes(marker));
    if (!isManagedFntvControls) return content;

    let changed = false;
    if (!controls.split(',').includes('play-pause')) {
        lines[controlsIndex] = controls.replace('controls=menu,gap,', 'controls=menu,gap,play-pause,gap,');
        changed = lines[controlsIndex] !== controls;
    }

    const persistencyIndex = lines.findIndex(line => line === 'controls_persistency=idle');
    if (persistencyIndex >= 0) {
        lines[persistencyIndex] = 'controls_persistency=paused';
        changed = true;
    }

    if (!changed) return content;
    const newline = content.includes('\r\n') ? '\r\n' : '\n';
    return lines.join(newline);
}
