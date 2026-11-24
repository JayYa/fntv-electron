const http = require('node:http');
const https = require('node:https');
const { serveBytes, json, ok } = require('./fakeFnMedia.cjs');

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

function directLinkStream({ urls, cloudType = 1, cookies = [], userAgents = [] }) {
    return (req, res) => json(res, ok({
        header: { 'User-Agent': userAgents, Cookie: cookies },
        cloud_storage_info: cloudType === null ? null : { cloud_storage_type: cloudType },
        direct_link_qualities: urls.map((url) => ({ url, expired_at: 0 })),
    }));
}

function ignoringRange(media) {
    return (req, res) => {
        res.setHeader('Content-Type', 'video/x-matroska');
        res.setHeader('Content-Length', media.length);
        res.end(media);
    };
}

function slowly(media, { chunkSize, intervalMs, stallAfter = Infinity, headerDelayMs = 0 }) {
    return (req, res) => {
        const match = /^bytes=(\d+)-(\d*)$/.exec(req.headers.range || '');
        const start = match ? Number(match[1]) : 0;
        const end = match && match[2] !== '' ? Math.min(Number(match[2]), media.length - 1) : media.length - 1;
        const body = media.subarray(start, end + 1);
        const timers = [];
        res.on('close', () => timers.forEach(clearTimeout));
        timers.push(setTimeout(() => {
            res.writeHead(match ? 206 : 200, {
                'Content-Type': 'video/mp4',
                'Content-Length': body.length,
                ...(match ? { 'Content-Range': `bytes ${start}-${end}/${media.length}` } : {}),
            });
            let sent = 0;
            const tick = () => {
                if (sent >= stallAfter) return;
                const piece = body.subarray(sent, Math.min(sent + chunkSize, body.length, stallAfter));
                sent += piece.length;
                if (sent >= body.length) return res.end(piece);
                res.write(piece);
                timers.push(setTimeout(tick, intervalMs));
            };
            tick();
        }, headerDelayMs));
    };
}

module.exports = { startFakeDirectLink, directLinkStream, ignoringRange, slowly };
