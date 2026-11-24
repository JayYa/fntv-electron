'use strict';

const fs = require('node:fs');
const http = require('node:http');
const { spawnSync } = require('node:child_process');

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

function waitProxyStopped(port, timeoutMs) {
    return poll(async () => {
        const response = await requestPlayVideo(port);
        return { done: Boolean(response.error), detail: JSON.stringify(response) };
    }, timeoutMs);
}

function readText(file) {
    return fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
}

function readProxyPort(appLog) {
    const matches = [...readText(appLog).matchAll(PROXY_READY_PATTERN)];
    return matches.length ? Number(matches[matches.length - 1][1]) : undefined;
}

function killProcessTree(child) {
    if (process.platform === 'win32') {
        spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
    } else {
        child.kill('SIGKILL');
    }
}

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

module.exports = { delay, killProcessTree, poll, readProxyPort, readText, requestPlayVideo, waitProxyStopped };
