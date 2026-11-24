import type { ChildProcess } from 'child_process';
import NodeMpv from 'node-mpv-2';
import * as log from '../../logger';
import { MpvIpcSocket } from '../../../public/platform';
import { createPlaybackIpcSocket, removePlaybackIpcSocket } from './mpvIpcSocket';

export interface MpvProcessEvents {
    onProperty(property: string, value: unknown): void;
    onTimePosition(seconds: number): void;
    onSeek(seconds: number): void;
    onExit(code: number): void;
}

export interface MpvPlaybackInfo {
    path: string;
    duration: number;
    percentage: number;
}

export interface MpvProcess {
    start(): Promise<void>;
    stop(): void;
    loadPlaylist(file: string): Promise<void>;
    setProperty(property: string, value: string | number | boolean): Promise<void>;
    seekTo(seconds: number): Promise<void>;
    addSubtitles(file: string, title: string): Promise<void>;
    playbackInfo(): Promise<MpvPlaybackInfo>;
}

export type CreateMpvProcess = (events: MpvProcessEvents) => MpvProcess;

export interface MpvProcessOptions {
    binary: string;
    args: string[];
    debug: boolean;
}

export function mpvProcessFactory(options: MpvProcessOptions): CreateMpvProcess {
    return (events) => new NodeMpvProcess(options, events);
}

class NodeMpvProcess implements MpvProcess {
    private readonly mpv: NodeMpv;
    private ipcSocket: MpvIpcSocket | null;
    private started = false;
    private stopRequested = false;
    private exited = false;
    private exitReported = false;
    private watchingExit = false;
    private killSent = false;

    constructor(options: MpvProcessOptions, private readonly events: MpvProcessEvents) {
        this.ipcSocket = createPlaybackIpcSocket();
        this.mpv = new NodeMpv({
            debug: options.debug,
            binary: options.binary.length > 0 ? options.binary : undefined,
            socket: this.ipcSocket.path,
            auto_restart: false,
        }, [...options.args]);
        this.forwardEvents();
    }

    async start(): Promise<void> {
        try {
            await this.mpv.start();
        } catch (error) {
            this.terminate();
            throw error;
        }
        if (this.stopRequested) {
            this.kill();
            throw new Error('MPV 启动期间已停止');
        }
        this.started = true;
        this.watchExit();
    }

    stop(): void {
        if (this.stopRequested || this.exited) return;
        this.stopRequested = true;
        if (this.started) {
            this.terminate();
            return;
        }
        this.kill();
    }

    async loadPlaylist(file: string): Promise<void> {
        this.ensureRunning();
        await this.mpv.loadPlaylist(file, 'replace');
    }

    async setProperty(property: string, value: string | number | boolean): Promise<void> {
        this.ensureRunning();
        await this.mpv.setProperty(property, value);
    }

    async seekTo(seconds: number): Promise<void> {
        this.ensureRunning();
        await this.mpv.goToPosition(seconds);
    }

    async addSubtitles(file: string, title: string): Promise<void> {
        this.ensureRunning();
        await this.mpv.addSubtitles(file, 'select', title);
    }

    async playbackInfo(): Promise<MpvPlaybackInfo> {
        this.ensureRunning();
        const [duration, percentage, path] = await Promise.all([
            this.mpv.getDuration().catch(() => 0),
            this.mpv.getPercentPosition().catch(() => 0),
            this.mpv.getFilename().catch(() => ''),
        ]);
        return { path: String(path), duration, percentage };
    }

    private isRunning(): boolean {
        return this.started && !this.stopRequested && !this.exited;
    }

    private ensureRunning(): void {
        if (!this.isRunning()) {
            throw new Error('MPV 未在运行');
        }
    }

    private forwardEvents(): void {
        this.mpv.on('stopped', () => log.info('MPV 播放结束'));
        this.mpv.on('status', (status) => {
            if (this.isRunning()) {
                this.events.onProperty(status.property, status.value);
            }
        });
        this.mpv.on('timeposition', (seconds: number) => {
            if (this.isRunning()) {
                this.events.onTimePosition(seconds);
            }
        });
        this.mpv.on('seek', (position) => {
            if (this.isRunning()) {
                this.events.onSeek(position.end);
            }
        });
    }

    private childProcess(): ChildProcess | undefined {
        return (this.mpv as unknown as { mpvPlayer?: ChildProcess }).mpvPlayer;
    }

    private watchExit(): void {
        const child = this.childProcess();
        if (!child || this.watchingExit) return;
        this.watchingExit = true;
        child.once('exit', (code: number | null) => this.processExited(code));
    }

    private processExited(code: number | null): void {
        this.exited = true;
        void this.removeIpcSocket().then(() => this.reportExit(code));
    }

    private reportExit(code: number | null): void {
        if (!this.started || this.exitReported) return;
        this.exitReported = true;
        const exitCode = this.stopRequested ? 0 : (code ?? 1);
        if (exitCode !== 0) {
            log.error(`MPV 异常退出 (code ${exitCode})`);
        }
        this.events.onExit(exitCode);
    }

    private terminate(): void {
        if (!this.mpv.isRunning()) {
            this.kill();
            return;
        }
        this.watchExit();
        this.mpv.quit().catch((error: unknown) => {
            log.debug('退出 MPV 失败，改为结束进程:', error);
            this.kill();
        });
    }

    private kill(): void {
        const child = this.childProcess();
        if (!child || this.killSent) return;
        if (child.exitCode !== null || child.signalCode !== null) {
            this.processExited(child.exitCode);
            return;
        }
        child.on('error', (error) => log.warn('结束 MPV 进程失败:', error.message));
        this.watchExit();
        this.killSent = true;
        if (!child.kill()) {
            log.warn('结束 MPV 进程失败');
            void this.removeIpcSocket();
        }
    }

    private removeIpcSocket(): Promise<void> {
        const socket = this.ipcSocket;
        this.ipcSocket = null;
        return removePlaybackIpcSocket(socket, (error) => log.debug('清理 MPV IPC socket 失败:', error));
    }
}
