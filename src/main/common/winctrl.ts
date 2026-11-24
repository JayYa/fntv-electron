import { BrowserWindow } from 'electron';
import { shouldStartMaximized } from './mainwin';

export function unmaximizeWindow(mainWindow: BrowserWindow): void {
    if (mainWindow) mainWindow.unmaximize();
}

export function setFullScreen(mainWindow: BrowserWindow): void {
    if (mainWindow) mainWindow.maximize();
}

export function setupFullScreenToggle(mainWindow: BrowserWindow): void {
    mainWindow.webContents.on('before-input-event', (event, input) => {
        if (input.type === 'keyDown' && input.key === 'F11') {
            if (mainWindow.isMaximized()) {
                unmaximizeWindow(mainWindow);
            } else {
                setFullScreen(mainWindow);
            }
            event.preventDefault();
        }
    });
}

export function setupWindowShowEvents(mainWindow: BrowserWindow): void {
    mainWindow.once('ready-to-show', () => {
        if (shouldStartMaximized()) mainWindow.maximize();
        mainWindow.show();
    });
}
