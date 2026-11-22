'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { execFileSync } = require('node:child_process');
const os = require('node:os');
const path = require('node:path');
const { _electron: electron } = require('playwright-core');
const { resolveTarget } = require('./targets.cjs');
const { resolveLaunch } = require('./launch.cjs');
const { delay, killProcessTree, poll, readProxyPort, readText, requestPlayVideo, waitProxyStopped } = require('./probes.cjs');

const root = path.resolve(__dirname, '..', '..');
const { version } = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const appDir = process.env.FNTV_SMOKE_APP_DIR ? path.resolve(process.env.FNTV_SMOKE_APP_DIR) : null;
const target = resolveTarget(process.env.FNTV_SMOKE_TARGET || `${process.platform}-${process.arch}`, appDir ? {} : process.env);
const artifactsDir = path.resolve(process.env.FNTV_SMOKE_ARTIFACTS || path.join(root, 'smoke-artifacts', target.id));
const PACKAGED_ONLY = '只对安装包成立';

const UNCAUGHT_PATTERN = /Uncaught Exception|A JavaScript error occurred in the main process|UnhandledPromiseRejection/;
const PROXY_LOG_MARK = '[Proxy]';
function fail(step, detail) {
    return `${step}失败：${detail}\n截图和日志：${artifactsDir}`;
}

describe(`${appDir ? 'unpackaged' : 'installer'} smoke test (${target.id})`, () => {
    let home;
    let isolation;
    let installation;
    let logDir;
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
            const existing = [isolation.userDataDir, isolation.electronUserDataDir].filter(dir => fs.existsSync(dir));
            assert.deepEqual(existing, [], fail('启动前检查', `这些目录应当不存在：${existing.join(', ')}`));
        }
        installation = resolveLaunch({ target, appDir, root });
        logDir = installation.logDir || isolation.logDir;

        const outputFile = fs.createWriteStream(path.join(artifactsDir, 'main-process.log'));
        try {
            app = await electron.launch({
                executablePath: installation.executablePath,
                cwd: home,
                env: { ...process.env, ...target.environment(home), ...installation.env },
                args: [...isolation.args, ...(installation.args || [])],
                timeout: 60000,
            });
        } catch (error) {
            throw new Error(fail('启动客户端', `${error.message}
主进程可能停在错误弹窗上，原因看 ${path.join(logDir, 'app.log')}`));
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

        page = await app.firstWindow({ timeout: 30000 }).catch(error => {
            throw new Error(fail('主窗口打开', `30 秒内没有创建主窗口：${error.message}
主进程输出末尾：
${mainOutput.slice(-4000)}`));
        });

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
        if (logDir) {
            const logsDir = logDir;
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
        if (appDir) {
            t.skip(`${PACKAGED_ONLY}：未打包时启动的是 node_modules 里宿主架构的 Electron，和安装包的目标架构无关`);
            return;
        }
        const expected = target.id.split('-').pop();
        const actual = await app.evaluate(() => process.arch);
        t.diagnostic(`client process.arch=${actual}, test runner process.arch=${process.arch}`);
        assert.equal(actual, expected, fail('进程架构检查', `客户端进程架构应为 ${expected}，实际是 ${actual}`));
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
        const versionText = page.locator('#versionText');
        await versionText.filter({ hasText: `版本 ${version}` }).waitFor({ timeout: 15000 }).catch(async () => {
            throw new Error(fail('登录页渲染', `版本号应为“版本 ${version}”，实际是“${await versionText.textContent()}”`));
        });
        await page.screenshot({ path: path.join(artifactsDir, 'screenshot.png') });
    });

    it('starts a Proxy that answers HTTP', async t => {
        const appLog = path.join(logDir, 'app.log');
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

    it('writes app.log under ~/.fntv/logs', async t => {
        if (appDir) {
            t.skip(`${PACKAGED_ONLY}：未打包时日志器写到 <应用目录>/log（src/modules/logger/logger.ts），不进 ~/.fntv`);
            return;
        }
        const appLog = path.join(isolation.logDir, 'app.log');
        const result = await poll(async () => ({ done: fs.existsSync(appLog) }), 10000);
        assert.ok(result.done, fail('日志位置检查', `10 秒内 ${appLog} 没有出现`));
    });

    it('leaves no logs directory under the Electron default userData', t => {
        if (appDir) {
            t.skip(`${PACKAGED_ONLY}：未打包时日志不在 userData 下，查不出日志器取目录过早（#87）`);
            return;
        }
        if (!isolation.electronUserDataDir) {
            t.skip('Electron 默认 userData 和 ~/.fntv 是同一个目录，这里分不出来，在 CI 上检查');
            return;
        }
        const stray = path.join(isolation.electronUserDataDir, 'logs');
        assert.equal(fs.existsSync(stray), false, fail('日志位置检查', `${stray} 不应存在，日志应只写在 ${isolation.logDir}`));
    });

    it('loads the main window icon from the packaged file', async () => {
        const appLog = path.join(logDir, 'app.log');
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

    it('synchronizes the MPV user config by the packaged manifest', async t => {
        if (appDir && !fs.existsSync(path.join(appDir, 'third_party', 'fntv-mpv', 'fntv-manifest.json'))) {
            t.skip('未打包且仓库里没有解压 MPV 归档（ci.yml 不下载它），安装包上检查');
            return;
        }
        const { tag } = JSON.parse(fs.readFileSync(path.join(root, 'mpv-archive.json'), 'utf8'));
        const appLog = path.join(logDir, 'app.log');
        const synced = `MPV 配置已按清单 ${tag} 同步`;
        const result = await poll(async () => {
            const text = readText(appLog);
            return { done: text.includes(synced) || text.includes('跳过同步'), text };
        }, 10000);
        const related = result.text.split(/\r?\n/).filter(line => /MPV (配置|归档|插件)/.test(line)).join('\n');
        assert.ok(result.text.includes(synced), fail('MPV 配置同步检查', `${appLog} 里没有“${synced}”：\n${related}`));
        assert.doesNotMatch(result.text, /MPV 插件不满足客户端要求的能力/, fail('MPV 能力检查', related));
    });

    it('keeps a single window-all-closed listener', async () => {
        const sources = await app.evaluate(({ app: electronApp }) =>
            electronApp.listeners('window-all-closed').map((listener) => listener.toString()));
        const isElectronDefault = (source) => /listenerCount\(\s*["'`]window-all-closed["'`]\s*\)/.test(source);
        const own = sources.filter((source) => !isElectronDefault(source));
        assert.equal(own.length, 1, fail('window-all-closed 监听检查',
            `客户端应有 1 个监听，实际是 ${own.length} 个（含 Electron 自带的共 ${sources.length} 个）：\n${own.join('\n---\n')}`));
    });

    it('raises no uncaught exception in the main process', async () => {
        await delay(Math.max(0, launchedAt + 8000 - Date.now()));
        const recorded = await app.evaluate(() => globalThis.__fntvSmokeErrors);
        const printed = mainOutput.split(/\r?\n/).filter(line => UNCAUGHT_PATTERN.test(line));
        assert.deepEqual([...recorded, ...printed], [], fail('主进程异常检查', '主进程有未捕获异常，完整输出见 main-process.log'));
    });

    it('stops the Proxy when the client quits', async () => {
        await page?.screenshot({ path: path.join(artifactsDir, 'screenshot.png') }).catch(() => {});
        const exited = await Promise.race([app.close().then(() => true), delay(20000).then(() => false)]);
        assert.ok(exited, fail('退出客户端', '20 秒内客户端没有退出'));
        assert.ok(proxyPort, fail('退出后 Proxy 检查', '没有拿到 Proxy 端口，先看 Proxy 在线检查'));
        const result = await waitProxyStopped(proxyPort, 10000);
        assert.ok(result.done, fail('退出后 Proxy 检查', `客户端退出 10 秒后端口 ${proxyPort} 仍有响应：${result.detail}`));
    });
});
