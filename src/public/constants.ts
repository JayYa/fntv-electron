import * as path from 'node:path';
import { app } from 'electron';

// 默认是 ~/.fntv（CODING_STANDARDS.md 的“稳定标识”）。启动参数带 --user-data-dir 时改用它，
// 冒烟测试靠它把用户数据放进临时目录：Windows 上 app.getPath('home') 不认 USERPROFILE（tests/smoke/targets.cjs）。
// 这是 Chromium 自己的开关，Electron 在 JS 运行前就把 userData 改到同一目录，日志和 Chromium 数据也跟着
// 进临时目录，所以不能改名。相对路径按工作目录转成绝对路径，和 Chromium 一致，app.setPath 只接受绝对路径。
const userDataDirSwitch = app.commandLine.getSwitchValue('user-data-dir');
export const USER_DATA_PATH: string = userDataDirSwitch ? path.resolve(userDataDirSwitch) : path.join(app.getPath('home'), '.fntv');
