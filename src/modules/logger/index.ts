import { logger, LogLevel } from './logger';

type LogMethod = (message: string, ...args: any[]) => void;

interface ILogger {
    debug: LogMethod;
    info: LogMethod;
    warn: LogMethod;
    error: LogMethod;
    noformat(message: string): void;
    log: LogMethod;
    d: LogMethod;
    i: LogMethod;
    w: LogMethod;
    e: LogMethod;
    logError(message: string, error?: any, ...extraArgs: any[]): void;
    getLogger(): typeof logger;
    setLogLevel(level: LogLevel): void;
    getLogFile(): string;
    getLogDir(): string;
}

const loggerInterface: ILogger = {
    debug: (message: string, ...args: any[]) => logger.debug(message, ...args),
    info: (message: string, ...args: any[]) => logger.info(message, ...args),
    warn: (message: string, ...args: any[]) => logger.warn(message, ...args),
    error: (message: string, ...args: any[]) => logger.error(message, ...args),
    noformat: (message: string) => logger.noformat(message),
    log: (message: string, ...args: any[]) => logger.info(message, ...args),
    
    getLogger: () => logger,
    
    setLogLevel: (level: LogLevel) => logger.setLogLevel(level),
    
    getLogFile: () => logger.getCurrentLogFile(),
    getLogDir: () => logger.getLogDir(),
    
    d: (message: string, ...args: any[]) => logger.debug(message, ...args),
    i: (message: string, ...args: any[]) => logger.info(message, ...args),
    w: (message: string, ...args: any[]) => logger.warn(message, ...args),
    e: (message: string, ...args: any[]) => logger.error(message, ...args),
    
    logError: (message: string, error?: any, ...extraArgs: any[]) => {
        if (error instanceof Error) {
            logger.error(message, error, ...extraArgs);
        } else {
            logger.error(message, error, ...extraArgs);
        }
    }
};

export = loggerInterface;
