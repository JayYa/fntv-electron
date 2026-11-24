const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { watchPendingUpdates, stopWatchingPendingUpdates } = require('../dest/main/common/mpvConfigSync/pendingUpdates.js');

function setupWatch(t) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fntv-pending-'));
    t.mock.timers.enable({ apis: ['setTimeout'] });
    let changes = 0;
    t.after(() => {
        stopWatchingPendingUpdates();
        fs.rmSync(dir, { recursive: true, force: true });
    });
    return { dir, onChange: () => { changes += 1; }, changes: () => changes };
}

test('starting to watch recounts once even when no file event arrives', (t) => {
    const watch = setupWatch(t);
    watchPendingUpdates(watch.dir, watch.onChange);

    t.mock.timers.tick(199);
    assert.equal(watch.changes(), 0);
    t.mock.timers.tick(1);
    assert.equal(watch.changes(), 1);
});

test('watching the same directory again schedules no further recount', (t) => {
    const watch = setupWatch(t);
    watchPendingUpdates(watch.dir, watch.onChange);
    t.mock.timers.tick(200);

    watchPendingUpdates(watch.dir, watch.onChange);
    t.mock.timers.tick(1000);
    assert.equal(watch.changes(), 1);
});
