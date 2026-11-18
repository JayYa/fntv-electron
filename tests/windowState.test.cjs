const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { loadWindowPlacement, saveWindowPlacement } = require('../dest/main/common/windowState');

const primary = { x: 0, y: 0, width: 1920, height: 1040 };
const secondary = { x: 1920, y: 0, width: 2560, height: 1400 };

function stateFile(t) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fntv-window-state-'));
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    return path.join(dir, 'window-state.json');
}

test('first launch opens the default size centered on the primary display', (t) => {
    const placement = loadWindowPlacement(stateFile(t), { workAreas: [primary], primaryWorkArea: primary });

    assert.deepEqual(placement, {
        bounds: { x: 260, y: 120, width: 1400, height: 800 },
        maximized: false,
    });
});

test('the saved size, position and maximized state come back on the next launch', (t) => {
    const file = stateFile(t);
    const saved = { bounds: { x: 2100, y: 80, width: 1600, height: 900 }, maximized: true };

    saveWindowPlacement(file, saved);

    assert.deepEqual(loadWindowPlacement(file, { workAreas: [primary, secondary], primaryWorkArea: primary }), saved);
});

test('a window saved on a display that is gone opens at the default size on the primary display', (t) => {
    const file = stateFile(t);
    saveWindowPlacement(file, { bounds: { x: 2100, y: 80, width: 1600, height: 900 }, maximized: true });

    assert.deepEqual(loadWindowPlacement(file, { workAreas: [primary], primaryWorkArea: primary }), {
        bounds: { x: 260, y: 120, width: 1400, height: 800 },
        maximized: true,
    });
});

test('a window larger than its display shrinks to fit that display', (t) => {
    const file = stateFile(t);
    const laptop = { x: 0, y: 0, width: 1366, height: 728 };
    saveWindowPlacement(file, { bounds: { x: 100, y: 50, width: 2400, height: 1300 }, maximized: false });

    assert.deepEqual(loadWindowPlacement(file, { workAreas: [laptop], primaryWorkArea: laptop }), {
        bounds: laptop,
        maximized: false,
    });
});

test('the default window shrinks to fit a primary display smaller than it', (t) => {
    const small = { x: 0, y: 0, width: 1280, height: 680 };

    assert.deepEqual(loadWindowPlacement(stateFile(t), { workAreas: [small], primaryWorkArea: small }), {
        bounds: small,
        maximized: false,
    });
});

for (const [name, content] of [
    ['truncated JSON', '{"bounds":{"x":10'],
    ['missing bounds', '{"maximized":true}'],
    ['non-numeric size', '{"bounds":{"x":0,"y":0,"width":"big","height":900},"maximized":false}'],
    ['zero width', '{"bounds":{"x":0,"y":0,"width":0,"height":900},"maximized":false}'],
    ['non-boolean maximized', '{"bounds":{"x":0,"y":0,"width":1000,"height":900},"maximized":"yes"}'],
]) {
    test(`a state file with ${name} falls back to the default window`, (t) => {
        const file = stateFile(t);
        fs.writeFileSync(file, content);

        assert.deepEqual(loadWindowPlacement(file, { workAreas: [primary], primaryWorkArea: primary }), {
            bounds: { x: 260, y: 120, width: 1400, height: 800 },
            maximized: false,
        });
    });
}
