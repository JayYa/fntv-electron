import * as path from 'node:path';
import { app } from 'electron';

const userDataDirSwitch = app.commandLine.getSwitchValue('user-data-dir');
export const USER_DATA_PATH: string = userDataDirSwitch ? path.resolve(userDataDirSwitch) : path.join(app.getPath('home'), '.fntv');
