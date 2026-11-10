const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { startFakeFnMedia, serveBytes } = require('./helpers/fakeFnMedia.cjs');
const { startFakeDirectLink, directLinkStream } = require('./helpers/fakeDirectLink.cjs');
const { startProxy, get, sessionInput } = require('./helpers/proxyService.cjs');
const { MIB, FILE, quarkSetup } = require('./helpers/quark.cjs');

test('quark returns exactly the requested range and asks the drive for the file size first', async (t) => {
    const { drive, play } = await quarkSetup(t);

    const response = await play({ Range: 'bytes=0-99' });

    assert.equal(response.status, 206);
    assert.equal(response.headers['content-range'], `bytes 0-99/${FILE.length}`);
    assert.equal(response.headers['content-length'], '100');
    assert.deepEqual(response.body, FILE.subarray(0, 100));
    assert.deepEqual(drive.requests.map((r) => r.headers.range), ['bytes=0-0', 'bytes=0-99']);
});

test('quark returns the bytes of the original file for any range, at most 10MiB per request', async (t) => {
    const { drive, play } = await quarkSetup(t);
    const total = FILE.length;
    const cases = [
        // [MPV 的 Range, 期望的起点, 期望的终点]
        [undefined, 0, 10 * MIB - 1],
        ['bytes=0-', 0, 10 * MIB - 1],
        ['bytes=12345-', 12345, 12345 + 10 * MIB - 1],
        ['bytes=1000000-1999999', 1000000, 1999999],
        [`bytes=${10 * MIB - 100}-${10 * MIB + 99}`, 10 * MIB - 100, 10 * MIB + 99],
        [`bytes=${total - 50}-`, total - 50, total - 1],
        [`bytes=${total - 10}-${total + 1000}`, total - 10, total - 1],
        [`bytes=${total - 1}-${total - 1}`, total - 1, total - 1],
    ];
    for (const [range, start, end] of cases) {
        const response = await play(range ? { Range: range } : {});

        assert.equal(response.status, 206, range);
        assert.equal(response.headers['content-range'], `bytes ${start}-${end}/${total}`, range);
        assert.equal(Number(response.headers['content-length']), end - start + 1, range);
        assert.ok(response.body.equals(FILE.subarray(start, end + 1)), range);
        assert.equal(drive.requests.at(-1).headers.range, `bytes=${start}-${end}`, range);
    }
});

// Go 只缓存成功的元信息，键是整个直链 URL。
test('quark asks the drive for the file size once per direct link, and again after a failure', async (t) => {
    let failMeta = true;
    const { drive, play } = await quarkSetup(t, {
        handler: (req, res) => {
            if (req.headers.range === 'bytes=0-0' && failMeta) {
                failMeta = false;
                res.statusCode = 503;
                return res.end();
            }
            return serveBytes(req, res, FILE);
        },
    });

    const failed = await play({ Range: 'bytes=0-9' });
    await play({ Range: 'bytes=0-9' });
    await play({ Range: 'bytes=100-109' });
    await play({ Range: 'bytes=200-' });

    assert.equal(failed.status, 500);
    assert.deepEqual(JSON.parse(failed.body.toString()), { error: 'failed to get meta' });
    assert.equal(drive.requests.filter((r) => r.headers.range === 'bytes=0-0').length, 2);
});

test('quark rejects a size answer that is not a 206 with a numeric total, and does not retry it', async (t) => {
    const answers = [
        (req, res) => { res.statusCode = 200; res.end('whole file'); },
        (req, res) => { res.writeHead(206, { 'Content-Range': 'bytes 0-0/*' }); res.end('x'); },
        (req, res) => { res.writeHead(206, { 'Content-Range': 'bytes 0-0' }); res.end('x'); },
        (req, res) => { res.writeHead(206); res.end('x'); },
        (req) => req.socket.destroy(),
    ];
    for (const [index, answer] of answers.entries()) {
        const { drive, play } = await quarkSetup(t, { handler: answer });

        const response = await play({ Range: 'bytes=0-9' });

        assert.equal(response.status, 500, String(index));
        assert.deepEqual(JSON.parse(response.body.toString()), { error: 'failed to get meta' }, String(index));
        assert.equal(drive.requests.length, 1, String(index));
    }
});

test('quark caches the file size per full direct link, query included', async (t) => {
    const drive = await startFakeDirectLink(t, { media: FILE });
    let sign = 0;
    const nas = await startFakeFnMedia(t, {
        streams: { 'item-1': ['media-1'], 'item-2': ['media-2'] },
        handlers: {
            stream: (req, res) => directLinkStream({ urls: [`${drive.origin}/quark.mkv?sign=${sign++}`], cloudType: 4 })(req, res),
        },
    });
    const { service } = await startProxy(t);
    const session = service.createPlaybackSession(sessionInput(nas, { itemGuids: ['item-1', 'item-2'] }));

    await get(service, `/api/v1/playvideo/item-1?session=${session}`, { Range: 'bytes=0-9' });
    await get(service, `/api/v1/playvideo/item-2?session=${session}`, { Range: 'bytes=0-9' });

    const metas = drive.requests.filter((r) => r.headers.range === 'bytes=0-0');
    assert.deepEqual(metas.map((r) => r.search), ['?sign=0', '?sign=1']);
});

test('quark sends only the allowed MPV headers plus the direct link user agent and cookies', async (t) => {
    const { drive, play } = await quarkSetup(t, {}, { cookies: ['kps=abc', 'sign=1'], userAgents: ['quark-ua/2.0'] });

    await play({
        Range: 'bytes=5-9',
        'If-Range': '"etag-1"',
        'User-Agent': 'mpv 0.40',
        Cookie: 'mpv-cookie=1',
        Authorization: 'Bearer from-mpv',
        'X-Custom': 'leak',
    });

    assert.equal(drive.requests.length, 2);
    for (const { headers } of drive.requests) {
        assert.equal(headers['user-agent'], 'quark-ua/2.0');
        assert.equal(headers.cookie, 'kps=abc; sign=1');
        assert.equal(headers['if-range'], '"etag-1"');
        assert.equal(headers.authorization, undefined);
        assert.equal(headers['x-custom'], undefined);
        assert.equal(headers['x-forwarded-for'], undefined);
    }
    assert.deepEqual(drive.requests.map((r) => [r.path, r.search]), [['/quark.mkv', '?sign=secret-token'], ['/quark.mkv', '?sign=secret-token']]);
});

test('quark turns userinfo in the direct link into Basic authorization', async (t) => {
    const drive = await startFakeDirectLink(t, { media: FILE });
    const { host } = new URL(drive.origin);
    const nas = await startFakeFnMedia(t, {
        streams: { 'item-1': ['media-1'] },
        handlers: { stream: directLinkStream({ urls: [`http://user:pa%3Ass@${host}/quark.mkv`], cloudType: 4 }) },
    });
    const { service } = await startProxy(t);
    const session = service.createPlaybackSession(sessionInput(nas));

    const response = await get(service, `/api/v1/playvideo/item-1?session=${session}`, { Range: 'bytes=0-9' });

    assert.equal(response.status, 206);
    for (const { headers } of drive.requests) {
        assert.equal(headers.authorization, `Basic ${Buffer.from('user:pa:ss').toString('base64')}`);
    }
});

// Go 的缓存键是原始直链 URL：同一路径、账号不同的两个直链各取一次元信息。
test('quark asks again for the file size when only the account in the direct link differs', async (t) => {
    const drive = await startFakeDirectLink(t, { media: FILE });
    const { host } = new URL(drive.origin);
    const urls = { 'media-1': `http://alice:one@${host}/quark.mkv`, 'media-2': `http://bob:two@${host}/quark.mkv` };
    const nas = await startFakeFnMedia(t, {
        streams: { 'item-1': ['media-1'], 'item-2': ['media-2'] },
        handlers: {
            stream: (req, res, record) => directLinkStream({ urls: [urls[JSON.parse(record.body).media_guid]], cloudType: 4 })(req, res),
        },
    });
    const { service } = await startProxy(t);
    const session = service.createPlaybackSession(sessionInput(nas, { itemGuids: ['item-1', 'item-2'] }));

    await get(service, `/api/v1/playvideo/item-1?session=${session}`, { Range: 'bytes=0-9' });
    await get(service, `/api/v1/playvideo/item-2?session=${session}`, { Range: 'bytes=0-9' });

    const metaRequests = drive.requests.filter((r) => r.headers.range === 'bytes=0-0');
    assert.deepEqual(metaRequests.map((r) => Buffer.from(r.headers.authorization.slice(6), 'base64').toString()), ['alice:one', 'bob:two']);
});

test('quark answers an unsupported range or a start past the end with the Go 416', async (t) => {
    const { drive, play } = await quarkSetup(t);
    const total = FILE.length;
    const ranges = ['bytes=-500', 'bytes=0-1,5-6', 'items=0-', 'bytes=abc-', 'bytes=0-x', 'bytes=1-2-3', `bytes=${total}-`, `bytes=${total + 5}-${total + 9}`];
    for (const range of ranges) {
        const response = await play({ Range: range });

        assert.equal(response.status, 416, range);
        assert.equal(response.headers['content-range'], `bytes */${total}`, range);
        assert.equal(response.headers['content-type'], 'application/json; charset=utf-8', range);
        assert.deepEqual(JSON.parse(response.body.toString()), { error: 'Range not satisfiable' }, range);
    }
    // 只有第一次取了元信息，之后都命中缓存，也没有取数据。
    assert.deepEqual(drive.requests.map((r) => r.headers.range), ['bytes=0-0']);
});

// Go 不理会小于起点的终点，照样从起点取最多 10MiB。
test('quark ignores an end before the start, like Go', async (t) => {
    const { play } = await quarkSetup(t);

    const response = await play({ Range: 'bytes=100-50' });

    assert.equal(response.status, 206);
    assert.equal(response.headers['content-range'], `bytes 100-${100 + 10 * MIB - 1}/${FILE.length}`);
    assert.ok(response.body.equals(FILE.subarray(100, 100 + 10 * MIB)));
});

test('quark shares the cached file size across playback sessions', async (t) => {
    const { drive, nas, service, play } = await quarkSetup(t);
    const other = service.createPlaybackSession(sessionInput(nas, { account: 'bob' }));

    await play({ Range: 'bytes=0-9' });
    await get(service, `/api/v1/playvideo/item-1?session=${other}`, { Range: 'bytes=10-19' });

    assert.deepEqual(drive.requests.map((r) => r.headers.range), ['bytes=0-0', 'bytes=0-9', 'bytes=10-19']);
});

// Go 没有分片并发上限也没有预取：每个 MPV 请求各对应一次取数据，同时进行。
test('quark fetches concurrent MPV requests from the drive at the same time, one fetch each', async (t) => {
    let active = 0;
    let peak = 0;
    const { drive, play } = await quarkSetup(t, {
        handler: (req, res) => {
            if (req.headers.range === 'bytes=0-0') return serveBytes(req, res, FILE);
            active += 1;
            peak = Math.max(peak, active);
            setTimeout(() => {
                active -= 1;
                serveBytes(req, res, FILE);
            }, 200);
        },
    });
    await play({ Range: 'bytes=0-0' });

    const responses = await Promise.all([0, 1, 2].map((index) => play({ Range: `bytes=${index * MIB}-${index * MIB + 9}` })));

    assert.equal(peak, 3);
    responses.forEach((response, index) => assert.ok(response.body.equals(FILE.subarray(index * MIB, index * MIB + 10))));
    assert.equal(drive.requests.length, 1 + 1 + 3);
});

test('quark stops fetching from the drive when MPV disconnects', async (t) => {
    let driveClosed;
    const closed = new Promise((resolve) => { driveClosed = resolve; });
    const { service, nas } = await quarkSetup(t, {
        handler: (req, res) => {
            if (req.headers.range === 'bytes=0-0') return serveBytes(req, res, FILE);
            res.on('close', driveClosed);
            res.writeHead(206, { 'Content-Length': 10 * MIB });
            res.write(FILE.subarray(0, 1024));
        },
    });
    const session = service.createPlaybackSession(sessionInput(nas));

    const request = http.get({ host: '127.0.0.1', port: service.port, path: `/api/v1/playvideo/item-1?session=${session}` });
    request.on('error', () => {});
    const response = await new Promise((resolve) => request.on('response', resolve));
    await new Promise((resolve) => response.once('data', resolve));
    request.destroy();

    await closed;
});

// 测试 CA 不在 Node 自带和系统的证书库里；会话的 skipVerify 只对 NAS 生效。
test('quark verifies the direct link certificate even when the session skips verification', async (t) => {
    const tlsDir = path.join(__dirname, 'fixtures', 'tls');
    const tls = { key: fs.readFileSync(path.join(tlsDir, 'nas-key.pem')), cert: fs.readFileSync(path.join(tlsDir, 'nas.pem')) };
    const drive = await startFakeDirectLink(t, { media: FILE, tls });
    const nas = await startFakeFnMedia(t, {
        streams: { 'item-1': ['media-1'] },
        handlers: { stream: directLinkStream({ urls: [`${drive.origin}/quark.mkv`], cloudType: 4 }) },
    });
    const { service } = await startProxy(t);
    const session = service.createPlaybackSession(sessionInput(nas, { skipVerify: true }));

    const response = await get(service, `/api/v1/playvideo/item-1?session=${session}`, { Range: 'bytes=0-9' });

    assert.equal(response.status, 500);
    assert.deepEqual(JSON.parse(response.body.toString()), { error: 'failed to get meta' });
    assert.equal(drive.requests.length, 0);
});

test('quark logs never contain the direct link query, cookies or session', async (t) => {
    const { logs, play } = await quarkSetup(t, {}, { cookies: ['kps=abc'] });

    await play({ Range: 'bytes=0-9' });
    await play({ Range: 'items=0-' });

    const text = logs.join('\n');
    assert.ok(logs.includes('info 启用云存储直连: type=4'), text);
    for (const secret of ['secret-token', 'kps=abc', 'nas-token', 'gateway=granted', 'quark.mkv']) {
        assert.ok(!text.includes(secret), text);
    }
});
