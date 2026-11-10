// 假的网盘直链服务：按 Range 提供媒体字节，记录收到的请求和时间。
// 另提供假飞牛影视服务的流信息处理器，让它把播放源说成直链媒体。
const http = require('node:http');
const https = require('node:https');
const { serveBytes, json, ok } = require('./fakeFnMedia.cjs');

// handler 优先，用来模拟失败或特殊响应。
async function startFakeDirectLink(t, { media, handler, tls } = {}) {
    const requests = [];
    const listener = (req, res) => {
        const url = new URL(req.url, 'http://fake');
        requests.push({ method: req.method, rawPath: req.url, path: url.pathname, search: url.search, headers: req.headers, at: Date.now() });
        if (handler) return handler(req, res);
        return serveBytes(req, res, media);
    };
    const server = tls ? https.createServer(tls, listener) : http.createServer(listener);
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    t.after(() => new Promise((resolve) => {
        server.closeAllConnections();
        server.close(resolve);
    }));
    const scheme = tls ? 'https' : 'http';
    return { origin: `${scheme}://127.0.0.1:${server.address().port}`, requests };
}

// 流信息：cloudType 为 null 时 cloud_storage_info 为 null；urls 为空时没有直链。
function directLinkStream({ urls, cloudType = 1, cookies = [], userAgents = [] }) {
    return (req, res) => json(res, ok({
        header: { 'User-Agent': userAgents, Cookie: cookies },
        cloud_storage_info: cloudType === null ? null : { cloud_storage_type: cloudType },
        direct_link_qualities: urls.map((url) => ({ url, expired_at: 0 })),
    }));
}

module.exports = { startFakeDirectLink, directLinkStream };
