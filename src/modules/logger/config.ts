export enum LogLevel {
    DEBUG = 0,
    INFO = 1,
    WARN = 2,
    ERROR = 3,
    NOFORMAT = 4
}

interface LogConfig {
    developmentLevel: LogLevel;
    productionLevel: LogLevel;
    maxFileSize: number;
    maxFiles: number;
    consoleOutput: boolean;
}

export const logConfig: LogConfig = {
    developmentLevel: LogLevel.DEBUG,
    productionLevel: LogLevel.INFO,
    maxFileSize: 10 * 1024 * 1024,
    maxFiles: 3,
    consoleOutput: true
};

export function getLogLevel(): LogLevel {
    if (process.env.NODE_ENV === 'production' || process.env.NODE_ENV === 'prod') {
        return logConfig.productionLevel;
    }
    if (process.env.NODE_ENV === 'development' || process.env.NODE_ENV === 'dev') {
        return logConfig.developmentLevel;
    }
    let isPackaged = false;
    try {
        const electron = require('electron');
        const { app } = electron;
        isPackaged = app ? app.isPackaged : false;
        
        return isPackaged ? logConfig.productionLevel : logConfig.developmentLevel;
    } catch {
        return logConfig.developmentLevel;
    }
}
