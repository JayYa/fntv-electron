import * as fs from 'fs';
import * as path from 'path';
import { logConfig, getLogLevel, LogLevel } from './config';
import { maskLogArguments, maskError, maskStringByPatterns } from './masking';

let app: any;
try {
    const electron = require('electron');
    app = electron.app;
} catch {
    app = null;
}

const LogLevelNames: Record<LogLevel, string> = {
    [LogLevel.DEBUG]: 'DEBUG',
    [LogLevel.INFO]: 'INFO',
    [LogLevel.WARN]: 'WARN',
    [LogLevel.ERROR]: 'ERROR',
    [LogLevel.NOFORMAT]: 'NOFORMAT'
};

interface FileInfo {
    name: string;
    path: string;
    mtime: Date;
}

export class Logger {
    private logLevel: LogLevel;
    private maxFileSize: number;
    private maxFiles: number;
    private logDir: string;
    private currentLogFile: string;

    constructor() {
        this.logLevel = getLogLevel();
        this.maxFileSize = logConfig.maxFileSize;
        this.maxFiles = logConfig.maxFiles;
        this.logDir = this.getLogDirectory();
        this.currentLogFile = path.join(this.logDir, 'app.log');

        this.ensureLogDirectory();

        this.cleanupOldLogs();
    }

    private getLogDirectory(): string {
        if (app) {
            const isPackaged = app.isPackaged;

            if (isPackaged) {
                const { USER_DATA_PATH } = require('../../public/constants') as typeof import('../../public/constants');
                return path.join(USER_DATA_PATH, 'logs');
            } else {
                const appPath = app.getAppPath();
                return path.join(appPath, 'log');
            }
        } else {
            return path.join(process.cwd(), 'log');
        }
    }

    private ensureLogDirectory(): void {
        try {
            if (!fs.existsSync(this.logDir)) {
                fs.mkdirSync(this.logDir, { recursive: true });
            }
        } catch (error) {
            console.error('创建日志目录失败:', (error as Error).message);
        }
    }

    private checkLogRotation(): void {
        try {
            if (fs.existsSync(this.currentLogFile)) {
                const stats = fs.statSync(this.currentLogFile);
                if (stats.size >= this.maxFileSize) {
                    this.rotateLogFile();
                }
            }
        } catch (error) {
            console.error('检查日志轮转失败:', (error as Error).message);
        }
    }

    private rotateLogFile(): void {
        try {
            const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
            const rotatedFile = path.join(this.logDir, `app-${timestamp}.log`);

            if (fs.existsSync(this.currentLogFile)) {
                fs.renameSync(this.currentLogFile, rotatedFile);
            }

            this.cleanupOldLogs();
        } catch (error) {
            console.error('轮转日志文件失败:', (error as Error).message);
        }
    }

    private cleanupOldLogs(): void {
        try {
            const files: FileInfo[] = fs.readdirSync(this.logDir)
                .filter(file => file.startsWith('app-') && file.endsWith('.log'))
                .map(file => ({
                    name: file,
                    path: path.join(this.logDir, file),
                    mtime: fs.statSync(path.join(this.logDir, file)).mtime
                }))
                .sort((a, b) => b.mtime.getTime() - a.mtime.getTime());

            if (files.length > this.maxFiles - 1) {
                const filesToDelete = files.slice(this.maxFiles - 1);
                filesToDelete.forEach(file => {
                    try {
                        fs.unlinkSync(file.path);
                    } catch (error) {
                        console.error(`删除旧日志文件失败: ${file.name}`, (error as Error).message);
                    }
                });
            }
        } catch (error) {
            console.error('清理旧日志文件失败:', (error as Error).message);
        }
    }

    private formatBeijingTime(): string {
        const now = new Date();
        const beijingTime = new Date(now.getTime() + 8 * 60 * 60 * 1000);

        const year = beijingTime.getUTCFullYear();
        const month = String(beijingTime.getUTCMonth() + 1).padStart(2, '0');
        const day = String(beijingTime.getUTCDate()).padStart(2, '0');
        const hours = String(beijingTime.getUTCHours()).padStart(2, '0');
        const minutes = String(beijingTime.getUTCMinutes()).padStart(2, '0');
        const seconds = String(beijingTime.getUTCSeconds()).padStart(2, '0');
        const milliseconds = String(beijingTime.getUTCMilliseconds()).padStart(3, '0');

        return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}.${milliseconds}`;
    }

    private formatMessage(level: LogLevel, message: string, ...args: any[]): string {
        const timestamp = this.formatBeijingTime();
        const levelName = LogLevelNames[level];

        const maskedArgs = maskLogArguments(message, ...args);
        const [maskedMessage, ...restMaskedArgs] = maskedArgs;

        const formattedArgs = restMaskedArgs.length > 0 ? ' ' + restMaskedArgs.map(arg =>
            typeof arg === 'object' ? JSON.stringify(arg) : String(arg)
        ).join(' ') : '';

        return `[${timestamp}] [${levelName}] ${maskedMessage}${formattedArgs}`;
    }

    private writeToFile(formattedMessage: string): void {
        try {
            this.checkLogRotation();

            fs.appendFileSync(this.currentLogFile, formattedMessage + '\n', 'utf8');
        } catch (error) {
            console.error('写入日志文件失败:', (error as Error).message);
        }
    }

    public log(level: LogLevel, message: string, ...args: any[]): void {
        if (level >= this.logLevel) {
            const formattedMessage = level === LogLevel.NOFORMAT
                ? maskStringByPatterns(message)
                : this.formatMessage(level, message, ...args);

            this.writeToFile(formattedMessage);

            if (logConfig.consoleOutput && (!app || !app.isPackaged)) {
                switch (level) {
                    case LogLevel.DEBUG:
                        console.log(formattedMessage);
                        break;
                    case LogLevel.INFO:
                    case LogLevel.NOFORMAT:
                        console.info(formattedMessage);
                        break;
                    case LogLevel.WARN:
                        console.warn(formattedMessage);
                        break;
                    case LogLevel.ERROR:
                        console.error(formattedMessage);
                        break;
                }
            }
        }
    }

    public debug(message: string, ...args: any[]): void {
        this.log(LogLevel.DEBUG, message, ...args);
    }

    public info(message: string, ...args: any[]): void {
        this.log(LogLevel.INFO, message, ...args);
    }

    public warn(message: string, ...args: any[]): void {
        this.log(LogLevel.WARN, message, ...args);
    }

    public error(message: string, ...args: any[]): void {
        const processedArgs = args.map(arg => {
            if (arg instanceof Error) {
                return maskError(arg);
            }
            return arg;
        });

        this.log(LogLevel.ERROR, message, ...processedArgs);
    }

    public noformat(message: string): void {
        this.log(LogLevel.NOFORMAT, message);
    }

    public setLogLevel(level: LogLevel): void {
        this.logLevel = level;
    }

    public getCurrentLogFile(): string {
        return this.currentLogFile;
    }

    public getLogDir(): string {
        return this.logDir;
    }
}

export const logger = new Logger();

export { LogLevel };
