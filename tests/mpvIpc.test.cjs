const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const { once } = require('node:events');
const { setTimeout: delay } = require('node:timers/promises');

const NodeMpv = require('node-mpv-2');
const { currentPlatform, mpvIpcSocket } = require('../dest/public/platform.js');
const { createPlaybackIpcSocket, removePlaybackIpcSocket } = require('../dest/modules/players/impl/mpvIpcSocket.js');

// 假的 MPV JSON IPC 服务端：每个请求按 request_id 回 success，mpv-version 探测回一个版本号。
// node-mpv-2 的 start() 连上已有的 MPV 时直接接管，不启动子进程，测试借这条路径驱动库的公开接口。
async function startFakeMpv(t) {
    const socket = mpvIpcSocket(currentPlatform(), os.tmpdir(), `test-${process.pid}-${crypto.randomBytes(4).toString('hex')}`);
    const connections = [];
    const server = net.createServer((conn) => {
        connections.push(conn);
        let pending = '';
        conn.on('error', () => {});
        conn.on('data', (data) => {
            const lines = (pending + data.toString('utf8')).split('\n');
            pending = lines.pop();
            for (const line of lines.filter(Boolean)) {
                const request = JSON.parse(line);
                const [name, property] = request.command;
                const reply = { request_id: request.request_id, error: 'success', data: null };
                if (name === 'get_property' && property === 'mpv-version') reply.data = 'mpv 0.40.0';
                if (name === 'get_property' && property === 'pause') reply.data = false;
                if (name === 'get_property' && property === 'media-title') reply.data = '第一集：开端';
                conn.write(`${JSON.stringify(reply)}\n`);
            }
        });
    });
    server.listen(socket.path);
    await once(server, 'listening');
    t.after(async () => {
        for (const conn of connections) conn.destroy();
        await new Promise((resolve) => server.close(resolve));
        if (socket.isFile) fs.rmSync(socket.path, { force: true });
    });

    const mpv = new NodeMpv({ socket: socket.path, time_update: 3600 });
    await mpv.start();
    // start() 的探测连接一直不关，最后一个连接才是库的主连接。
    const main = connections[connections.length - 1];
    return { mpv, main, connections };
}

// 把一条消息按字节切成两段，中间停一下，让客户端分两次收到 data。
async function writeInTwoChunks(conn, message, splitAt) {
    const bytes = Buffer.from(`${JSON.stringify(message)}\n`, 'utf8');
    conn.write(bytes.subarray(0, splitAt));
    await delay(50);
    conn.write(bytes.subarray(splitAt));
}

test('an MPV event split across two socket chunks is delivered once, intact', async (t) => {
    const { mpv, main } = await startFakeMpv(t);
    const status = once(mpv, 'status');

    await writeInTwoChunks(main, { event: 'property-change', id: 3, name: 'volume', data: 55 }, 20);

    assert.deepEqual((await status)[0], { property: 'volume', value: 55 });
});

test('a UTF-8 character split between chunks is not corrupted', async (t) => {
    const { mpv, main } = await startFakeMpv(t);
    const status = once(mpv, 'status');
    const message = { event: 'property-change', id: 7, name: 'media-title', data: '第一集：开端' };
    const prefix = Buffer.byteLength(JSON.stringify(message).split('第')[0]);

    // 从“第”字的 3 个 UTF-8 字节中间切开。
    await writeInTwoChunks(main, message, prefix + 1);

    assert.deepEqual((await status)[0], { property: 'media-title', value: '第一集：开端' });
});

test('a reply split across chunks resolves the pending request', async (t) => {
    const { mpv, main } = await startFakeMpv(t);
    // 主连接改成手动回复：先收下请求，再分两段回。
    main.removeAllListeners('data');
    const request = once(main, 'data');
    const title = mpv.getProperty('media-title');
    const { request_id } = JSON.parse((await request)[0].toString('utf8'));

    await writeInTwoChunks(main, { request_id, error: 'success', data: '第一集：开端' }, 10);

    assert.equal(await title, '第一集：开端');
});

test('a seek finishes when playback-restart reaches the observer socket in two chunks', async (t) => {
    const { mpv, main, connections } = await startFakeMpv(t);
    const seek = once(mpv, 'seek');
    const before = connections.length;

    // 收到 seek 事件后库另开一个连接等 playback-restart。
    main.write(`${JSON.stringify({ event: 'seek' })}\n`);
    while (connections.length === before) await delay(10);
    await writeInTwoChunks(connections[connections.length - 1], { event: 'playback-restart' }, 8);

    assert.deepEqual(Object.keys((await seek)[0]).sort(), ['end', 'start']);
});

test('every playback gets a different IPC address', () => {
    const first = createPlaybackIpcSocket();
    const second = createPlaybackIpcSocket();
    assert.notEqual(first.path, second.path);
    assert.notEqual(first.path, currentPlatform() === 'win32' ? '\\\\.\\pipe\\mpvserver' : '/tmp/node-mpv.sock');
});

async function waitUntil(condition) {
    for (let i = 0; i < 100 && !condition(); i++) await delay(10);
}

test('removing the IPC address deletes a socket file and leaves a named pipe alone', async (t) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fntv-mpv-ipc-'));
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    const socketFile = path.join(dir, 'socket.sock');
    const pipeLike = path.join(dir, 'pipe');
    fs.writeFileSync(socketFile, '');
    fs.writeFileSync(pipeLike, '');
    const errors = [];

    removePlaybackIpcSocket({ path: socketFile, isFile: true }, (error) => errors.push(error));
    removePlaybackIpcSocket({ path: pipeLike, isFile: false }, (error) => errors.push(error));
    removePlaybackIpcSocket(null, (error) => errors.push(error));
    await waitUntil(() => !fs.existsSync(socketFile));

    assert.equal(fs.existsSync(socketFile), false);
    assert.equal(fs.existsSync(pipeLike), true);
    assert.deepEqual(errors, []);
});

test('removing a socket file that MPV already deleted is not an error', async () => {
    const errors = [];
    const gone = { path: path.join(os.tmpdir(), `fntv-mpv-gone-${process.pid}.sock`), isFile: true };
    removePlaybackIpcSocket(gone, (error) => errors.push(error));
    await delay(50);
    assert.deepEqual(errors, []);
});
