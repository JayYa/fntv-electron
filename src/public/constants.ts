import * as path from 'node:path';
import { app } from 'electron';

// 默认是 ~/.fntv（CODING_STANDARDS.md 的“稳定标识”）。启动参数带 --user-data-dir 时改用它，
// 冒烟测试靠它把用户数据放进临时目录：Windows 上 app.getPath('home') 不认 USERPROFILE（tests/smoke/targets.cjs）。
export const USER_DATA_PATH: string = app.commandLine.getSwitchValue('user-data-dir') || path.join(app.getPath('home'), '.fntv');
