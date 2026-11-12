'use strict';

// installer.smoke.cjs 从外部观察客户端用的辅助函数：轮询、读日志、探测 Proxy 端口、结束进程树。
// 只用 Node 内置模块，不引入客户端源码。

const fs = require('node:fs');
const http = require('node:http');
const { spawnSync } = require('node:child_process');

// Proxy 端口由系统分配，主进程在它就绪时把实际端口写进 app.log（src/main/common/proxy.ts）。
const PROXY_READY_PATTERN = /Proxy 已就绪，端口 (\d+)/g;

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

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

function readText(file) {
    return fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
}

// app.log 里最后一次“Proxy 已就绪”报告的端口，还没有时返回 undefined。
function readProxyPort(appLog) {
    const matches = [...readText(appLog).matchAll(PROXY_READY_PATTERN)];
    return matches.length ? Number(matches[matches.length - 1][1]) : undefined;
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

// 客户端退出后 Proxy 应随之退出，端口不再响应。
function waitProxyStopped(port, timeoutMs) {
    return poll(async () => {
        const response = await requestPlayVideo(port);
        return { done: Boolean(response.error), detail: JSON.stringify(response) };
    }, timeoutMs);
}

// Windows 上 kill 只结束客户端主进程，Proxy 子进程会留下来锁住安装目录、占着端口，要结束整个进程树。
function killProcessTree(child) {
    if (process.platform === 'win32') {
        spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
    } else {
        child.kill('SIGKILL');
    }
}

module.exports = { delay, poll, readText, readProxyPort, requestPlayVideo, waitProxyStopped, killProcessTree };
