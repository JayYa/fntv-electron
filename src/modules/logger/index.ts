import { logger } from './logger';

export function debug(message: string, ...args: any[]): void {
    logger.debug(message, ...args);
}

export function info(message: string, ...args: any[]): void {
    logger.info(message, ...args);
}

export function warn(message: string, ...args: any[]): void {
    logger.warn(message, ...args);
}

export function error(message: string, ...args: any[]): void {
    logger.error(message, ...args);
}

export function getLogFile(): string {
    return logger.getCurrentLogFile();
}
