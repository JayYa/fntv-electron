'use strict';

// 安装包冒烟测试：按用户的方式装好或打开安装包，用 Playwright 启动客户端，只观察窗口、
// 页面、进程和日志，不引入任何源码。运行方式见 TESTING_STANDARDS.md 的“冒烟测试”。
//
// 环境变量：
//   FNTV_SMOKE_TARGET        目标平台，如 linux-x64，默认取当前机器（targets.cjs）
//   FNTV_SMOKE_INSTALLER_DIR 安装包所在目录，默认 release/
//   FNTV_SMOKE_EXECUTABLE    跳过安装，直接启动这个可执行文件（本地调试用）
//   FNTV_SMOKE_ARTIFACTS     截图和日志的输出目录，默认 smoke-artifacts/<目标>

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { _electron: electron } = require('playwright-core');
const { resolveTarget, findInstaller } = require('./targets.cjs');

const root = path.resolve(__dirname, '..', '..');
const { version } = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const target = resolveTarget(process.env.FNTV_SMOKE_TARGET || `${process.platform}-${process.arch}`);
const artifactsDir = path.resolve(process.env.FNTV_SMOKE_ARTIFACTS || path.join(root, 'smoke-artifacts', target.id));

// Proxy 固定监听这个地址（src/main/common/proxyHealth.ts、src/modules/proxy/main.go）。
const PROXY_PORT = 22345;
// Electron 在主进程未捕获异常时打到 stderr 的文字，以及 Node 未处理 Promise 拒绝的警告。
const UNCAUGHT_PATTERN = /Uncaught Exception|A JavaScript error occurred in the main process|UnhandledPromiseRejection/;
// 日志里 Electron 自己写的行以 [时间] [级别] 开头，其余是 Proxy 的原样输出。
const ELECTRON_LOG_LINE = /^\[\d{4}-\d{2}-\d{2} [\d:.]+\] \[[A-Z]+\] /;

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

function requestProxyHealth(secret) {
    return new Promise(resolve => {
        const headers = secret ? { 'X-FNTV-Proxy-Secret': secret } : {};
        const request = http.get({ host: '127.0.0.1', port: PROXY_PORT, path: '/health', headers, timeout: 1000 }, response => {
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
    let installation;
    let app;
    let child;
    let page;
    let mainOutput = '';
    let launchedAt;

    before(async () => {
        fs.rmSync(artifactsDir, { recursive: true, force: true });
        fs.mkdirSync(artifactsDir, { recursive: true });

        const occupied = await requestProxyHealth();
        assert.ok(occupied.error, fail('启动前检查', `端口 ${PROXY_PORT} 已被占用，先关掉本机正在运行的客户端`));

        home = fs.mkdtempSync(path.join(os.tmpdir(), 'fntv-smoke-'));
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
                args: target.args ? target.args(home) : [],
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
        page = await app.firstWindow({ timeout: 30000 }).catch(error => {
            throw new Error(fail('主窗口打开', `30 秒内没有创建主窗口：${error.message}`));
        });

        // 主窗口出现后才装监听，更早的异常靠 stderr 里的 UNCAUGHT_PATTERN 发现。
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
            child.kill('SIGKILL');
        }
        if (home) {
            const logsDir = target.logDir(home);
            if (fs.existsSync(logsDir)) {
                fs.cpSync(logsDir, path.join(artifactsDir, 'logs'), { recursive: true });
                const appLog = path.join(logsDir, 'app.log');
                if (fs.existsSync(appLog)) {
                    const proxyLines = fs.readFileSync(appLog, 'utf8').split(/\r?\n/)
                        .filter(line => line.trim() && (!ELECTRON_LOG_LINE.test(line) || line.includes('Proxy stderr')));
                    fs.writeFileSync(path.join(artifactsDir, 'proxy.log'), proxyLines.join('\n') + '\n');
                }
            }
        }
        if (installation) installation.uninstall();
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

    it('runs the client as a process of the target architecture', async t => {
        // 目标 id 的后半段是架构（targets.cjs）。macOS x64 包在 Apple Silicon 上跑，这里是 x64 就说明它经 Rosetta 运行。
        const expected = target.id.split('-').pop();
        const actual = await app.evaluate(() => process.arch);
        t.diagnostic(`client process.arch=${actual}, test runner process.arch=${process.arch}`);
        assert.equal(actual, expected, fail('进程架构检查', `客户端进程架构应为 ${expected}，实际是 ${actual}`));
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

    it('starts a Proxy that passes the health check', async () => {
        const secretFile = path.join(target.userDataDir(home), 'proxy-secret');
        const result = await poll(async () => {
            const secret = fs.existsSync(secretFile) ? fs.readFileSync(secretFile, 'utf8') : null;
            if (!secret) return { done: false, detail: `${secretFile} 不存在` };
            const response = await requestProxyHealth(secret);
            let payload = null;
            try { payload = JSON.parse(response.body); } catch { /* 下面按响应原文报错 */ }
            const healthy = response.status === 200 && payload?.service === 'fntv-proxy' && payload?.protocol === 2;
            return { done: healthy, detail: JSON.stringify(response) };
        }, 20000);
        assert.ok(result.done, fail('Proxy 健康检查', `20 秒内没有通过：${result.detail}，Proxy 输出见 proxy.log`));
    });

    it('raises no uncaught exception in the main process', async () => {
        // 启动 3 秒后有一次自动更新检查（src/main/main.ts），等它跑过再看。
        await delay(Math.max(0, launchedAt + 8000 - Date.now()));
        const recorded = await app.evaluate(() => globalThis.__fntvSmokeErrors);
        const printed = mainOutput.split(/\r?\n/).filter(line => UNCAUGHT_PATTERN.test(line));
        assert.deepEqual([...recorded, ...printed], [], fail('主进程异常检查', '主进程有未捕获异常，完整输出见 main-process.log'));
    });

    it('stops the Proxy when the client quits', async () => {
        await page?.screenshot({ path: path.join(artifactsDir, 'screenshot.png') }).catch(() => {});
        const exited = await Promise.race([app.close().then(() => true), delay(20000).then(() => false)]);
        assert.ok(exited, fail('退出客户端', '20 秒内客户端没有退出'));
        const result = await poll(async () => {
            const response = await requestProxyHealth();
            return { done: Boolean(response.error), detail: JSON.stringify(response) };
        }, 10000);
        assert.ok(result.done, fail('退出后 Proxy 检查', `客户端退出 10 秒后端口 ${PROXY_PORT} 仍有响应：${result.detail}`));
    });
});
