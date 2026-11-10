// 夸克：网盘的各种响应（忽略 Range、其它状态码、网络错误、低速和停顿）。
const test = require('node:test');
const assert = require('node:assert/strict');
const { serveBytes } = require('./helpers/fakeFnMedia.cjs');
const { ignoringRange, slowly } = require('./helpers/fakeDirectLink.cjs');
const { MIB, FILE, quarkSetup, sizeThen } = require('./helpers/quark.cjs');

// Go 把 200 的 body 从第 0 字节开始当成起点处的字节，这里修掉（U-03）。
test('quark returns the right bytes when the drive ignores Range and answers 200', async (t) => {
    const { play } = await quarkSetup(t, { handler: sizeThen(ignoringRange(FILE)) });
    const cases = [['bytes=0-99', 0, 99], ['bytes=5000000-5000099', 5000000, 5000099], [`bytes=${12 * MIB}-`, 12 * MIB, 22 * MIB - 1]];
    for (const [range, start, end] of cases) {
        const response = await play({ Range: range });

        assert.equal(response.status, 206, range);
        assert.equal(response.headers['content-type'], 'video/x-matroska', range);
        assert.equal(response.headers['accept-ranges'], 'bytes', range);
        assert.equal(response.headers['content-range'], `bytes ${start}-${end}/${FILE.length}`, range);
        assert.equal(Number(response.headers['content-length']), end - start + 1, range);
        assert.ok(response.body.equals(FILE.subarray(start, end + 1)), range);
    }
});

test('quark returns another drive status with its body and content type only, without retrying', async (t) => {
    for (const status of [403, 416, 500, 302]) {
        const { drive, play } = await quarkSetup(t, {
            handler: sizeThen((req, res) => {
                res.writeHead(status, { 'Content-Type': 'text/plain', 'X-Drive': 'secret', 'Set-Cookie': 'a=1', Location: '/elsewhere' });
                res.end(`drive says ${status}`);
            }),
        });

        const response = await play({ Range: 'bytes=0-' });

        assert.equal(response.status, status);
        assert.equal(response.headers['content-type'], 'text/plain');
        assert.equal(response.body.toString(), `drive says ${status}`);
        for (const name of ['x-drive', 'set-cookie', 'location']) assert.equal(response.headers[name], undefined, name);
        assert.equal(drive.requests.length, 2, String(status));
    }
});

test('quark answers 502 when the drive fails before sending headers', async (t) => {
    const { drive, play } = await quarkSetup(t, { handler: sizeThen((req) => req.socket.destroy()) });

    const response = await play({ Range: 'bytes=0-' });

    assert.equal(response.status, 502);
    assert.deepEqual(JSON.parse(response.body.toString()), { error: 'upstream unavailable' });
    assert.equal(drive.requests.length, 2);
});

// Go 把网盘的全部响应头原样转给 MPV，这里去掉逐跳头和 Set-Cookie（U-14）。
test('quark passes the drive response headers to MPV without hop-by-hop headers or Set-Cookie', async (t) => {
    const { play } = await quarkSetup(t, {
        handler: sizeThen((req, res) => serveBytes(req, res, FILE, {
            'Set-Cookie': ['track=1', 'sid=2'],
            Connection: 'keep-alive, X-Hop',
            'Keep-Alive': 'timeout=99',
            'X-Hop': 'drop',
            ETag: '"quark-etag"',
            'Cache-Control': 'private',
        })),
    });

    const response = await play({ Range: 'bytes=0-9' });

    assert.equal(response.status, 206);
    assert.deepEqual(response.body, FILE.subarray(0, 10));
    assert.equal(response.headers.etag, '"quark-etag"');
    assert.equal(response.headers['cache-control'], 'private');
    assert.equal(response.headers['content-type'], 'video/mp4');
    for (const name of ['set-cookie', 'x-hop']) assert.equal(response.headers[name], undefined, name);
    // Node 服务器自己会给 MPV 写 Keep-Alive，只要不是网盘的那个值。
    assert.notEqual(response.headers['keep-alive'], 'timeout=99');
});

// Go 的 60 秒总超时连 body 一起算，低速时 10MiB 会被中途切断；这里改为空闲超时（U-06）。测试把空闲超时缩短到 300 毫秒。
test('quark keeps a slow but steady transfer going past the idle timeout', async (t) => {
    const { play } = await quarkSetup(t, { handler: sizeThen(slowly(FILE, { chunkSize: 64 * 1024, intervalMs: 100 })) }, {}, { quarkIdleTimeoutMs: 300 });
    const started = Date.now();

    const response = await play({ Range: `bytes=0-${MIB - 1}` });

    assert.ok(Date.now() - started > 1000);
    assert.equal(response.status, 206);
    assert.ok(response.body.equals(FILE.subarray(0, MIB)));
});

test('quark cuts the MPV connection when the drive stops sending in the middle of a chunk', async (t) => {
    const { play } = await quarkSetup(t, {
        handler: sizeThen(slowly(FILE, { chunkSize: 64 * 1024, intervalMs: 50, stallAfter: 256 * 1024 })),
    }, {}, { quarkIdleTimeoutMs: 300 });

    await assert.rejects(play({ Range: `bytes=0-${MIB - 1}` }));
});

test('quark answers 502 when the drive sends no headers within the idle timeout', async (t) => {
    const { play } = await quarkSetup(t, {
        handler: sizeThen(slowly(FILE, { chunkSize: MIB, intervalMs: 10, headerDelayMs: 2000 })),
    }, {}, { quarkIdleTimeoutMs: 300 });

    const response = await play({ Range: 'bytes=0-99' });

    assert.equal(response.status, 502);
    assert.deepEqual(JSON.parse(response.body.toString()), { error: 'upstream unavailable' });
});
