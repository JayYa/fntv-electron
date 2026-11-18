import * as fs from 'node:fs';

export interface Rect {
    x: number;
    y: number;
    width: number;
    height: number;
}

export interface DisplayLayout {
    workAreas: Rect[];
    primaryWorkArea: Rect;
}

export interface WindowPlacement {
    bounds: Rect;
    maximized: boolean;
}

const DEFAULT_SIZE = { width: 1400, height: 800 };

function centeredIn(area: Rect, size: { width: number; height: number }): Rect {
    return {
        x: Math.round(area.x + (area.width - size.width) / 2),
        y: Math.round(area.y + (area.height - size.height) / 2),
        ...size,
    };
}

function isFiniteNumber(value: unknown): value is number {
    return typeof value === 'number' && Number.isFinite(value);
}

function parseSaved(value: unknown): WindowPlacement | null {
    if (typeof value !== 'object' || value === null) return null;
    const { bounds, maximized } = value as { bounds?: unknown; maximized?: unknown };
    if (typeof maximized !== 'boolean' || typeof bounds !== 'object' || bounds === null) return null;
    const { x, y, width, height } = bounds as Record<string, unknown>;
    if (![x, y, width, height].every(isFiniteNumber)) return null;
    if ((width as number) <= 0 || (height as number) <= 0) return null;
    return { bounds: { x, y, width, height } as Rect, maximized };
}

function readSaved(filePath: string): WindowPlacement | null {
    try {
        return parseSaved(JSON.parse(fs.readFileSync(filePath, 'utf8')));
    } catch {
        return null;
    }
}

function overlapArea(a: Rect, b: Rect): number {
    const width = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
    const height = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
    return width > 0 && height > 0 ? width * height : 0;
}

function mostOverlappingWorkArea(bounds: Rect, workAreas: Rect[]): Rect | null {
    let best: Rect | null = null;
    let bestArea = 0;
    for (const area of workAreas) {
        const overlap = overlapArea(bounds, area);
        if (overlap > bestArea) {
            best = area;
            bestArea = overlap;
        }
    }
    return best;
}

export function loadWindowPlacement(filePath: string, displays: DisplayLayout): WindowPlacement {
    const saved = readSaved(filePath);
    const area = saved && mostOverlappingWorkArea(saved.bounds, displays.workAreas);
    if (saved && area) return { bounds: shrinkToFit(saved.bounds, area), maximized: saved.maximized };
    const bounds = shrinkToFit(centeredIn(displays.primaryWorkArea, DEFAULT_SIZE), displays.primaryWorkArea);
    return { bounds, maximized: saved?.maximized ?? false };
}

function shrinkToFit(bounds: Rect, area: Rect): Rect {
    const fitted = { ...bounds };
    if (fitted.width > area.width) {
        fitted.width = area.width;
        fitted.x = area.x;
    }
    if (fitted.height > area.height) {
        fitted.height = area.height;
        fitted.y = area.y;
    }
    return fitted;
}

export function saveWindowPlacement(filePath: string, state: WindowPlacement): void {
    fs.writeFileSync(filePath, JSON.stringify(state));
}
