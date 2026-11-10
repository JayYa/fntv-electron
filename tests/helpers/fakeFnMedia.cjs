// 假的飞牛影视服务：返回流列表和流信息，按 Range 提供媒体字节，记录收到的请求。
const http = require('node:http');
const https = require('node:https');

function json(res, body) {
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(JSON.stringify(body));
}

function ok(data) {
    return { code: 0, msg: '', data };
}

function readBody(req) {
    return new Promise((resolve) => {
        const chunks = [];
        req.on('data', (chunk) => chunks.push(chunk));
        req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    });
}

// 按单段 Range 返回 206，没有 Range 返回 200。
function serveBytes(req, res, bytes, extraHeaders = {}) {
    res.setHeader('Content-Type', 'video/mp4');
    res.setHeader('Accept-Ranges', 'bytes');
    for (const [name, value] of Object.entries(extraHeaders)) res.setHeader(name, value);
    const match = /^bytes=(\d+)-(\d*)$/.exec(req.headers.range || '');
    if (!match) {
        res.setHeader('Content-Length', bytes.length);
        res.end(bytes);
        return;
    }
    const start = Number(match[1]);
    const end = match[2] === '' ? bytes.length - 1 : Math.min(Number(match[2]), bytes.length - 1);
    if (start >= bytes.length) {
        res.statusCode = 416;
        res.setHeader('Content-Range', `bytes */${bytes.length}`);
        res.end();
        return;
    }
    res.statusCode = 206;
    res.setHeader('Content-Range', `bytes ${start}-${end}/${bytes.length}`);
    res.setHeader('Content-Length', end - start + 1);
    res.end(bytes.subarray(start, end + 1));
}

// media: { [mediaGuid]: Buffer }；streams: { [itemGuid]: mediaGuid[] }。
// handlers 里的同名处理器优先，用来模拟失败或特殊响应。
async function startFakeFnMedia(t, { media = {}, streams = {}, handlers = {}, tls } = {}) {
    const requests = [];
    const listener = async (req, res) => {
        const url = new URL(req.url, 'http://fake');
        const body = await readBody(req);
        const record = { method: req.method, path: url.pathname, search: url.search, headers: req.headers, body };
        requests.push(record);

        const listMatch = /^\/v\/api\/v1\/stream\/list\/(.+)$/.exec(url.pathname);
        const rangeMatch = /^\/v\/api\/v1\/media\/range\/(.+)$/.exec(url.pathname);
        if (listMatch) {
            if (handlers.streamList) return handlers.streamList(req, res, record);
            const mediaGuids = streams[listMatch[1]] || [];
            return json(res, ok({ video_streams: mediaGuids.map((media_guid) => ({ media_guid })) }));
        }
        if (url.pathname === '/v/api/v1/stream' && req.method === 'POST') {
            if (handlers.stream) return handlers.stream(req, res, record);
            return json(res, ok({ header: { 'User-Agent': [], Cookie: [] }, cloud_storage_info: null, direct_link_qualities: [] }));
        }
        if (rangeMatch) {
            if (handlers.media) return handlers.media(req, res, record);
            const bytes = media[rangeMatch[1]];
            if (!bytes) {
                res.statusCode = 404;
                return res.end();
            }
            return serveBytes(req, res, bytes);
        }
        res.statusCode = 404;
        res.end();
    };
    const server = tls ? https.createServer(tls, listener) : http.createServer(listener);
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    t.after(() => new Promise((resolve) => {
        server.closeAllConnections();
        server.close(resolve);
    }));
    const scheme = tls ? 'https' : 'http';
    return {
        domain: `${scheme}://127.0.0.1:${server.address().port}`,
        requests,
        mediaRequests: () => requests.filter((request) => request.path.startsWith('/v/api/v1/media/range/')),
    };
}

module.exports = { startFakeFnMedia, serveBytes, json, ok };
