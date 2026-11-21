export interface Logger {
    debug: (...args: any[]) => void;
    info: (...args: any[]) => void;
    warn: (...args: any[]) => void;
    error: (...args: any[]) => void;
    log: (...args: any[]) => void;
    d: (...args: any[]) => void;
    i: (...args: any[]) => void;
    w: (...args: any[]) => void;
    e: (...args: any[]) => void;
}

export interface PlayMovieData {
    id: string;
    sourceIndex: number;
    restart?: boolean;
}

export interface LoginPageApi {
    send: (channel: string, ...args: unknown[]) => void;
    on: (channel: string, listener: (...args: any[]) => void) => void;
    once: (channel: string, listener: (...args: any[]) => void) => void;
    off: (channel: string, listener: (...args: any[]) => void) => void;
    openExternal: (url: string) => Promise<void>;
}

declare global {
    interface Window {
        log: Logger;
        logger: Logger;
        electronAPI: LoginPageApi;
    }
    
    namespace NodeJS {
        interface Global {
            log: Logger;
            logger: Logger;
        }
    }
    
    var log: Logger;
    var logger: Logger;
}

export {};
