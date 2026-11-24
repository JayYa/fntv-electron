import type { CreateMpvProcess } from './impl/mpvProcess';

export enum EventType {
    PROGRESS = 'progress',
    ERROR = 'error',
    EXIT = 'exit',
    ITEM_END = 'item_end',
}

export interface PlayItem {
    itemGuid: string;
    title: string;
    tvTitle: string;
    seasonNumber: number;
    episodeNumber: number;
    ts: number;
    duration: number;
    playLink: string;
}

export type PlayStatusData = {
    itemGuid: string;
    ts: number;
    duration: number;
    percentage: number;
}

export type PlayExitData = {
    code: number;
    status: PlayStatusData;
}

export type PlayErrorData = {
    message: string;
}

export type PlayerEvent =
    | [type: EventType.PROGRESS, data: PlayStatusData]
    | [type: EventType.ITEM_END, data: PlayStatusData]
    | [type: EventType.ERROR, data: PlayErrorData]
    | [type: EventType.EXIT, data: PlayExitData];

export type EventHandler = (...event: PlayerEvent) => void;

export type Config = {
    createMpvProcess: CreateMpvProcess;
    onEvent: EventHandler;
    onVolumeChange?: (volume: number) => void;
    resumePosition: (item: PlayItem) => number;
    loadSubtitles: (itemGuid: string) => Promise<string[]>;
}

export interface Player {
    playList(items: PlayItem[], pos: number): Promise<boolean>;
    stop(): void;
}
