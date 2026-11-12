'use strict';

// 安装包冒烟测试：按用户的方式装好或打开安装包，用 Playwright 启动客户端，只观察窗口、
// 页面、进程和日志，不引入任何源码。运行方式见同目录的 README.md。
//
// 环境变量：
//   FNTV_SMOKE_TARGET        目标平台，如 linux-x64，默认取当前机器（targets.cjs）
//   FNTV_SMOKE_INSTALLER_DIR 安装包所在目录，默认 release/
//   FNTV_SMOKE_EXECUTABLE    跳过安装，直接启动这个可执行文件（本地调试用）
//   FNTV_SMOKE_ARTIFACTS     截图和日志的输出目录，默认 smoke-artifacts/<目标>
//   FNTV_SMOKE_ALLOW_INSTALL 设为 1 时，本机已装同一 appId 的客户端也照样安装（targets.cjs）

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const { execFileSync, spawnSync } = require('node:child_process');
const os = require('node:os');
const path = require('node:path');
const { _electron: electron } = require('playwright-core');
const { resolveTarget, findInstaller } = require('./targets.cjs');

const root = path.resolve(__dirname, '..', '..');
const { version } = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const target = resolveTarget(process.env.FNTV_SMOKE_TARGET || `${process.platform}-${process.arch}`);
const artifactsDir = path.resolve(process.env.FNTV_SMOKE_ARTIFACTS || path.join(root, 'smoke-artifacts', target.id));

// Electron 在主进程未捕获异常时打到 stderr 的文字，以及 Node 未处理 Promise 拒绝的警告。
const UNCAUGHT_PATTERN = /Uncaught Exception|A JavaScript error occurred in the main process|UnhandledPromiseRejection/;
// Proxy 的日志经 IPC 由主进程写进 app.log，每行带这个标记（src/main/common/proxy.ts）。
const PROXY_LOG_MARK = '[Proxy]';
// Proxy 端口由系统分配，主进程在它就绪时把实际端口写进 app.log（src/main/common/proxy.ts）。
const PROXY_READY_PATTERN = /Proxy 已就绪，端口 (\d+)/g;

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

function fail(step, detail) {
    return `${step}失败：${detail}\n截图和日志：${artifactsDir}`;
}

async function poll(check, timeoutMs, intervalMs = 250) {
    const deadline = Date.now() + timeoutMs;
    let last;
    while (Date.now() < deadline) {
        last = await check();
        if (last.done) return last;
        await delay(intervalMs);
    }
    return last;
}

// 客户端退出后 Proxy 应随之退出，端口不再响应。
function waitProxyStopped(port, timeoutMs) {
    return poll(async () => {
        const response = await requestPlayVideo(port);
        return { done: Boolean(response.error), detail: JSON.stringify(response) };
    }, timeoutMs);
}

function readText(file) {
    return fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
}

// app.log 里最后一次“Proxy 已就绪”报告的端口，还没有时返回 undefined。
function readProxyPort(appLog) {
    const matches = [...readText(appLog).matchAll(PROXY_READY_PATTERN)];
    return matches.length ? Number(matches[matches.length - 1][1]) : undefined;
}

// Windows 上 kill 只结束客户端主进程，Proxy 子进程会留下来锁住安装目录、占着端口，要结束整个进程树。
function killProcessTree(child) {
    if (process.platform === 'win32') {
        spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
    } else {
        child.kill('SIGKILL');
    }
}

// 不带 session 的 playvideo：Proxy 在线时返回 400，不碰 NAS。只要有 HTTP 响应就说明 Proxy 在监听。
function requestPlayVideo(port) {
    return new Promise(resolve => {
        const request = http.get({ host: '127.0.0.1', port, path: '/api/v1/playvideo/smoke', timeout: 1000 }, response => {
            const chunks = [];
            response.on('data', chunk => chunks.push(chunk));
            response.on('end', () => resolve({ status: response.statusCode, body: Buffer.concat(chunks).toString('utf8') }));
        });
        request.on('timeout', () => request.destroy(new Error('timeout')));
        request.on('error', error => resolve({ error: error.code || error.message }));
    });
}

describe(`installer smoke test (${target.id})`, () => {
    let home;
    let isolation;
    let installation;
    let app;
    let child;
    let page;
    let mainOutput = '';
    let launchedAt;
    let proxyPort;

    before(async () => {
        fs.rmSync(artifactsDir, { recursive: true, force: true });
        fs.mkdirSync(artifactsDir, { recursive: true });

        home = fs.mkdtempSync(path.join(os.tmpdir(), 'fntv-smoke-'));
        isolation = target.isolation(home);
        if (isolation.realProfile) {
            // 用 CI 机器真实的用户目录（targets.cjs 的 windowsIsolation），已有内容时测试会改写它，
            // 结束时还会删掉，也分不清日志是不是这次写的。
            const existing = [isolation.userDataDir, isolation.electronUserDataDir].filter(dir => fs.existsSync(dir));
            assert.deepEqual(existing, [], fail('启动前检查', `这些目录应当不存在：${existing.join(', ')}`));
        }
        installation = process.env.FNTV_SMOKE_EXECUTABLE
            ? { executablePath: path.resolve(process.env.FNTV_SMOKE_EXECUTABLE), uninstall() {} }
            : target.install(findInstaller(target, path.resolve(process.env.FNTV_SMOKE_INSTALLER_DIR || path.join(root, 'release'))));

        const outputFile = fs.createWriteStream(path.join(artifactsDir, 'main-process.log'));
        try {
            app = await electron.launch({
                executablePath: installation.executablePath,
                // 工作目录放在临时目录，像从桌面图标启动一样，不依赖仓库目录。
                cwd: home,
                env: { ...process.env, ...target.environment(home) },
                args: isolation.args,
                timeout: 60000,
            });
        } catch (error) {
            throw new Error(fail('启动客户端', `${error.message}
主进程可能停在错误弹窗上，原因看 logs/app.log`));
        }
        launchedAt = Date.now();
        child = app.process();
        for (const stream of [child.stdout, child.stderr]) {
            stream.on('data', chunk => {
                mainOutput += chunk.toString('utf8');
                outputFile.write(chunk);
            });
        }
        child.once('exit', () => outputFile.end());

        // 主进程在 new BrowserWindow 期间收到的 app.evaluate 会以“Resulting promise was garbage
        // collected”失败。主窗口页面出现说明主进程已经从创建窗口的同步代码里返回，之后才在主进程里执行代码。
        // 主进程在窗口出现前抛异常时，Electron 默认弹错误框，不一定打印 UNCAUGHT_PATTERN 能匹配的文字，
        // 超时报错附上主进程输出的末尾，原因多半在里面或在 logs/app.log。
        page = await app.firstWindow({ timeout: 30000 }).catch(error => {
            throw new Error(fail('主窗口打开', `30 秒内没有创建主窗口：${error.message}
主进程输出末尾：
${mainOutput.slice(-4000)}`));
        });

        // 主窗口出现后才装监听，更早的异常只能靠 stderr 里的 UNCAUGHT_PATTERN 发现。
        await app.evaluate(() => {
            globalThis.__fntvSmokeErrors = [];
            const record = kind => error => globalThis.__fntvSmokeErrors.push(`${kind}: ${(error && error.stack) || error}`);
            process.on('uncaughtException', record('uncaughtException'));
            process.on('unhandledRejection', record('unhandledRejection'));
        });
    });

    after(async () => {
        if (page && !page.isClosed()) {
            await page.screenshot({ path: path.join(artifactsDir, 'screenshot.png') }).catch(() => {});
        }
        if (child && child.exitCode === null && child.signalCode === null) {
            await Promise.race([app.close(), delay(15000)]).catch(() => {});
            killProcessTree(child);
        }
        if (isolation) {
            const logsDir = isolation.logDir;
            if (fs.existsSync(logsDir)) {
                fs.cpSync(logsDir, path.join(artifactsDir, 'logs'), { recursive: true });
                const appLog = path.join(logsDir, 'app.log');
                if (fs.existsSync(appLog)) {
                    const proxyLines = fs.readFileSync(appLog, 'utf8').split(/\r?\n/)
                        .filter(line => line.includes(PROXY_LOG_MARK));
                    fs.writeFileSync(path.join(artifactsDir, 'proxy.log'), proxyLines.join('\n') + '\n');
                }
            }
        }
        if (installation) installation.uninstall();
        if (isolation?.realProfile) {
            for (const dir of [isolation.userDataDir, isolation.electronUserDataDir]) {
                fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5 });
            }
        }
        if (home) fs.rmSync(home, { recursive: true, force: true, maxRetries: 5 });
    });

    it('opens a visible main window', async () => {
        const result = await poll(async () => {
            const windows = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()
                .map(window => ({ visible: window.isVisible(), bounds: window.getBounds() })));
            return { done: windows.some(window => window.visible), windows };
        }, 30000);
        assert.ok(result.done, fail('主窗口打开', `30 秒内没有可见窗口：${JSON.stringify(result.windows)}`));
    });

    it('runs the client natively as a process of the target architecture', async t => {
        // 目标 id 的后半段是架构（targets.cjs）。
        const expected = target.id.split('-').pop();
        const actual = await app.evaluate(() => process.arch);
        t.diagnostic(`client process.arch=${actual}, test runner process.arch=${process.arch}`);
        assert.equal(actual, expected, fail('进程架构检查', `客户端进程架构应为 ${expected}，实际是 ${actual}`));
        // macOS 上还要确认机器本身就是这个架构，客户端是原生运行：darwin-x64 在 Intel 机器上测，不经 Rosetta
        // （targets.cjs 的 darwin-x64）。hw.optional.arm64 在 Apple Silicon 上是 1，Rosetta 转译的进程读到的也是 1；
        // Intel 机器上没有这个键，-i 让 sysctl 输出空。
        if (target.platform === 'macos') {
            const appleSilicon = execFileSync('sysctl', ['-in', 'hw.optional.arm64'], { encoding: 'utf8' }).trim() === '1';
            const hardware = appleSilicon ? 'arm64' : 'x64';
            t.diagnostic(`hardware=${hardware}`);
            assert.equal(hardware, expected, fail('进程架构检查', `客户端应在 ${expected} 机器上原生运行，这台机器是 ${hardware}`));
        }
    });

    it('renders the login page with its form and the packaged version', async () => {
        for (const selector of ['#domain', '#username', '#password', '#loginBtn']) {
            await page.locator(selector).waitFor({ state: 'visible', timeout: 30000 }).catch(error => {
                throw new Error(fail('登录页渲染', `${selector} 不可见：${error.message}`));
            });
        }
        // 版本号由主进程经 preload 发给页面，显示正确说明 preload 和 IPC 都工作。
        const versionText = page.locator('#versionText');
        await versionText.filter({ hasText: `版本 ${version}` }).waitFor({ timeout: 15000 }).catch(async () => {
            throw new Error(fail('登录页渲染', `版本号应为“版本 ${version}”，实际是“${await versionText.textContent()}”`));
        });
        await page.screenshot({ path: path.join(artifactsDir, 'screenshot.png') });
    });

    it('starts a Proxy that answers HTTP', async t => {
        const appLog = path.join(isolation.logDir, 'app.log');
        const result = await poll(async () => {
            const port = readProxyPort(appLog);
            if (!port) return { done: false, detail: 'app.log 里还没有“Proxy 已就绪，端口 N”' };
            const response = await requestPlayVideo(port);
            return { done: Boolean(response.status), port, detail: `端口 ${port}：${JSON.stringify(response)}` };
        }, 20000);
        assert.ok(result.done, fail('Proxy 在线检查', `20 秒内 Proxy 没有 HTTP 响应：${result.detail}，Proxy 日志见 proxy.log`));
        proxyPort = result.port;
        t.diagnostic(`proxy port=${proxyPort}`);
    });

    it('writes app.log under ~/.fntv/logs', async () => {
        const appLog = path.join(isolation.logDir, 'app.log');
        const result = await poll(async () => ({ done: fs.existsSync(appLog) }), 10000);
        assert.ok(result.done, fail('日志位置检查', `10 秒内 ${appLog} 没有出现`));
    });

    it('leaves no logs directory under the Electron default userData', t => {
        // 日志器曾在 config.ts 改 userData 之前取目录，日志落在 Electron 默认的 userData 下（#87）。
        // 本地 Windows 带 --user-data-dir，两个目录重合，这条在 CI 上检查（targets.cjs 的 windowsIsolation）。
        if (!isolation.electronUserDataDir) {
            t.skip('Electron 默认 userData 和 ~/.fntv 是同一个目录，这里分不出来，在 CI 上检查');
            return;
        }
        const stray = path.join(isolation.electronUserDataDir, 'logs');
        assert.equal(fs.existsSync(stray), false, fail('日志位置检查', `${stray} 不应存在，日志应只写在 ${isolation.logDir}`));
    });

    it('loads the main window icon from the packaged file', async () => {
        // 主进程创建主窗口前把图标路径写进 app.log（src/main/common/mainwin.ts）。Linux 和 macOS 上
        // nativeImage 读不了 ICO，曾经一直用 icon.ico，窗口没有图标（#74）。
        const appLog = path.join(isolation.logDir, 'app.log');
        const result = await poll(async () => {
            const text = fs.existsSync(appLog) ? fs.readFileSync(appLog, 'utf8') : '';
            const match = /主窗口图标: (.+?)\r?$/m.exec(text);
            return { done: Boolean(match), iconPath: match && match[1] };
        }, 10000);
        assert.ok(result.done, fail('主窗口图标检查', `10 秒内 ${appLog} 里没有“主窗口图标:”这一行`));
        const icon = await app.evaluate(({ nativeImage }, iconPath) => {
            const image = nativeImage.createFromPath(iconPath);
            return { empty: image.isEmpty(), size: image.getSize() };
        }, result.iconPath);
        assert.equal(icon.empty, false, fail('主窗口图标检查', `${result.iconPath} 加载后是空图像`));
        console.log(`::notice::smoke ${target.id} window icon: ${result.iconPath} ${icon.size.width}x${icon.size.height}`);
    });

    it('keeps a single window-all-closed listener', async () => {
        // 客户端曾有两个监听，Windows 和 Linux 上一个直接退出、一个只在 isQuiting 时退出（#76）。
        // Electron 在加载客户端代码前自己注册一个（lib/browser/init.ts），只在它是唯一监听时 app.quit()，
        // 不算客户端的。按函数源码认出它：源码里查 listenerCount('window-all-closed')（Electron 45 起事件名用反引号）。认不出时它会被算进来，
        // 断言失败而不是漏掉重复的监听。
        const sources = await app.evaluate(({ app: electronApp }) =>
            electronApp.listeners('window-all-closed').map((listener) => listener.toString()));
        const isElectronDefault = (source) => /listenerCount\(\s*["'`]window-all-closed["'`]\s*\)/.test(source);
        const own = sources.filter((source) => !isElectronDefault(source));
        assert.equal(own.length, 1, fail('window-all-closed 监听检查',
            `客户端应有 1 个监听，实际是 ${own.length} 个（含 Electron 自带的共 ${sources.length} 个）：\n${own.join('\n---\n')}`));
    });

    it('raises no uncaught exception in the main process', async () => {
        // 启动 3 秒后有一次自动检查更新（src/main/main.ts），等它跑过再看。
        await delay(Math.max(0, launchedAt + 8000 - Date.now()));
        const recorded = await app.evaluate(() => globalThis.__fntvSmokeErrors);
        const printed = mainOutput.split(/\r?\n/).filter(line => UNCAUGHT_PATTERN.test(line));
        assert.deepEqual([...recorded, ...printed], [], fail('主进程异常检查', '主进程有未捕获异常，完整输出见 main-process.log'));
    });

    it('stops the Proxy when the client quits', async () => {
        await page?.screenshot({ path: path.join(artifactsDir, 'screenshot.png') }).catch(() => {});
        const exited = await Promise.race([app.close().then(() => true), delay(20000).then(() => false)]);
        assert.ok(exited, fail('退出客户端', '20 秒内客户端没有退出'));
        // 在线检查失败时没有端口可查，这一条也跟着失败，不去探测一个猜的端口。
        assert.ok(proxyPort, fail('退出后 Proxy 检查', '没有拿到 Proxy 端口，先看 Proxy 在线检查'));
        const result = await waitProxyStopped(proxyPort, 10000);
        assert.ok(result.done, fail('退出后 Proxy 检查', `客户端退出 10 秒后端口 ${proxyPort} 仍有响应：${result.detail}`));
    });
});
