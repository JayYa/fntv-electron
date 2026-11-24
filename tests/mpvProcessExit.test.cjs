const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const net = require('node:net');
const path = require('node:path');
const { EventEmitter, once } = require('node:events');
const { setTimeout: delay } = require('node:timers/promises');
const { useFakeModule } = require('./helpers/fakeElectron.cjs');

const NODE_MPV_DIR = path.dirname(require.resolve('node-mpv-2/package.json'));

function forgetNodeMpv() {
    Object.keys(require.cache)
        .filter((id) => id.startsWith(NODE_MPV_DIR))
        .forEach((id) => delete require.cache[id]);
}

function serveMpvIpc(t, socketPath) {
    const connections = [];
    const server = net.createServer((conn) => {
        connections.push(conn);
        let pending = '';
        conn.on('error', () => {});
        conn.on('data', (data) => {
            const lines = (pending + data.toString('utf8')).split('\n');
            pending = lines.pop();
            for (const line of lines.filter(Boolean)) {
                const { request_id, command } = JSON.parse(line);
                conn.write(`${JSON.stringify({ request_id, error: 'success', data: null })}\n`);
                if (command[0] === 'loadlist') {
                    setImmediate(() => connections.forEach((each) => each.write('{"event":"start-file"}\n{"event":"file-loaded"}\n')));
                }
            }
        });
    });
    t.after(async () => {
        for (const conn of connections) conn.destroy();
        await new Promise((resolve) => server.close(resolve));
        if (!socketPath.startsWith('\\\\')) fs.rmSync(socketPath, { force: true });
    });
    server.listen(socketPath);
    return once(server, 'listening');
}

function useFakeMpvProcess(t) {
    const spawned = [];
    const childProcess = {
        exec(_command, _options, callback) {
            setImmediate(() => callback(null, 'mpv 0.40.0', ''));
        },
        spawn(_binary, args) {
            const child = new EventEmitter();
            child.stdout = new EventEmitter();
            child.stderr = new EventEmitter();
            const socketPath = args.find((arg) => arg.startsWith('--input-ipc-server=')).split('=')[1];
            void serveMpvIpc(t, socketPath).then(() => child.stdout.emit('data', Buffer.from('Listening to IPC socket')));
            spawned.push(child);
            return child;
        },
    };
    forgetNodeMpv();
    useFakeModule(t, 'child_process', childProcess);
    t.after(forgetNodeMpv);
    return spawned;
}

test('MPV exiting with a code node-mpv does not report still ends the player once as an abnormal exit', async (t) => {
    const spawned = useFakeMpvProcess(t);
    const ply = require('../dest/modules/players/index.js');
    const events = [];
    const player = new ply.MpvPlayer({
        playerPath: '',
        onEvent: (type, data) => events.push({ type, code: data.code }),
        resumePosition: () => 0,
        loadSubtitles: async () => [],
    });
    t.after(() => player.stop());

    assert.equal(await player.playList([{ itemGuid: 'item-1', title: 'Episode 1', playLink: 'http://127.0.0.1/stream', ts: 0, duration: 100 }], 0), true);
    spawned[0].emit('close', 2, null);
    await delay(20);

    assert.deepEqual(events, [{ type: ply.EventType.EXIT, code: 2 }]);
});
