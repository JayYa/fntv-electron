'use strict';

// 实验用诊断脚本（不合入）：连续 3 次直接启动安装包里的客户端（不经 Playwright），记录从 spawn 到
// stderr 出现 "Debugger listening"（Node 检查器就绪）和 "DevTools listening"（Chromium 就绪，
// Playwright 的 electron.launch 等的就是这两行）的耗时，期间每秒采样客户端和 Rosetta 守护进程 oahd 的 CPU。
// 第 1 次远慢于第 2、3 次、且第 1 次时 oahd 占满 CPU，说明慢在 Rosetta 首次转译。

const { spawn, execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { resolveTarget, findInstaller } = require('./targets.cjs');

const target = resolveTarget(process.env.FNTV_SMOKE_TARGET);
const LIMIT_MS = 240000;

function sample(pid) {
    try {
        return execFileSync('ps', ['-Ao', 'pid,ppid,%cpu,rss,comm'], { encoding: 'utf8' })
            .split('\n').filter(line => /oahd|fntv|飞牛|Electron|Helper/.test(line) || line.trim().startsWith(`${pid} `))
            .map(line => line.trim().replace(/\s+/g, ' ')).join(' | ');
    } catch (error) {
        return `ps failed: ${error.message}`;
    }
}

function launchOnce(executablePath, round) {
    return new Promise(resolve => {
        const home = fs.mkdtempSync(path.join(os.tmpdir(), 'fntv-diag-'));
        const started = Date.now();
        const marks = {};
        const child = spawn(executablePath, ['--inspect=0', '--remote-debugging-port=0'], {
            cwd: home,
            env: { ...process.env, ...target.environment(home) },
            detached: true,
        });
        let stderr = '';
        const onData = chunk => {
            const text = chunk.toString('utf8');
            stderr += text;
            for (const line of text.split(/\r?\n/).filter(Boolean)) {
                console.log(`[round ${round} +${Date.now() - started}ms] ${line.slice(0, 200)}`);
            }
            if (!marks.debugger && /Debugger listening/.test(stderr)) marks.debugger = Date.now() - started;
            if (!marks.devtools && /DevTools listening/.test(stderr)) {
                marks.devtools = Date.now() - started;
                finish('ready');
            }
        };
        child.stdout.on('data', onData);
        child.stderr.on('data', onData);
        const sampler = setInterval(() => console.log(`[round ${round} +${Date.now() - started}ms] ps: ${sample(child.pid)}`), 1000);
        const timer = setTimeout(() => finish('timeout'), LIMIT_MS);
        child.once('exit', (code, signal) => finish(`exited code=${code} signal=${signal}`));
        let done = false;
        function finish(reason) {
            if (done) return;
            done = true;
            clearInterval(sampler);
            clearTimeout(timer);
            try { process.kill(-child.pid, 'SIGKILL'); } catch { /* 已退出 */ }
            setTimeout(() => {
                try { execFileSync('pkill', ['-9', '-f', 'third_party/proxy/proxy']); } catch { /* 没有残留 */ }
                fs.rmSync(home, { recursive: true, force: true });
                console.log(`::notice::diag ${target.id} round ${round}: ${reason}, Debugger listening at ${marks.debugger ?? '-'}ms, DevTools listening at ${marks.devtools ?? '-'}ms`);
                resolve();
            }, 2000);
        }
    });
}

(async () => {
    console.log(`arch -x86_64 check: ${(() => { try { execFileSync('/usr/bin/arch', ['-x86_64', '/usr/bin/true']); return 'ok'; } catch (e) { return e.message; } })()}`);
    console.log(`sw_vers: ${execFileSync('sw_vers', { encoding: 'utf8' }).replace(/\n/g, ' ')}`);
    console.log(`oah cache: ${(() => { try { return execFileSync('sudo', ['du', '-sh', '/var/db/oah'], { encoding: 'utf8' }).trim(); } catch (e) { return e.message; } })()}`);
    const installation = target.install(findInstaller(target, path.resolve(process.env.FNTV_SMOKE_INSTALLER_DIR || 'release')));
    console.log(`file: ${execFileSync('file', [installation.executablePath], { encoding: 'utf8' }).trim()}`);
    try {
        for (const round of [1, 2, 3]) await launchOnce(installation.executablePath, round);
    } finally {
        installation.uninstall();
    }
    console.log(`oah cache after: ${(() => { try { return execFileSync('sudo', ['du', '-sh', '/var/db/oah'], { encoding: 'utf8' }).trim(); } catch (e) { return e.message; } })()}`);
})();
