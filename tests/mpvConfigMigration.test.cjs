const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const {
    resolveBundledMpvPath,
    resolvePortableConfigDir,
    upgradeFntvUoscConfig,
} = require('../dest/main/common/mpvConfigHelpers.js');

test('resolves the packaged mpv executable next to the application executable', () => {
    assert.equal(
        resolveBundledMpvPath({
            appPath: path.join('C:', 'app', 'resources', 'app.asar'),
            execPath: path.join('C:', 'app', 'FNMedia.exe'),
            isPackaged: true,
        }),
        path.join('C:', 'app', 'third_party', 'fntv-mpv', 'mpv.exe'),
    );
});

test('resolves packaged extraFiles next to the resources directory on every platform', () => {
    assert.equal(
        resolvePortableConfigDir({
            appPath: path.join('C:', 'app', 'resources', 'app.asar'),
            isPackaged: true,
            resourcesPath: path.join('C:', 'app', 'resources'),
        }),
        path.join('C:', 'app', 'third_party', 'fntv-mpv', 'portable_config'),
    );
});

test('adds play-pause and paused persistency to the known fntv uosc layout', () => {
    const current = [
        'controls=menu,gap,subtitles,button:danmaku,button:danmaku_delay,button:skip_cfg_btn,gap,fullscreen',
        'controls_persistency=idle',
    ].join('\n');
    assert.equal(
        upgradeFntvUoscConfig(current),
        [
            'controls=menu,gap,play-pause,gap,subtitles,button:danmaku,button:danmaku_delay,button:skip_cfg_btn,gap,fullscreen',
            'controls_persistency=paused',
        ].join('\n'),
    );
});

test('does not overwrite custom uosc controls', () => {
    const custom = 'controls=menu,gap,subtitles,audio,fullscreen\ncontrols_persistency=idle';
    assert.equal(upgradeFntvUoscConfig(custom), custom);
});

test('keeps an already upgraded fntv layout stable', () => {
    const upgraded = [
        'controls=menu,gap,play-pause,gap,button:danmaku,button:danmaku_delay,button:skip_cfg_btn',
        'controls_persistency=paused',
    ].join('\r\n');
    assert.equal(upgradeFntvUoscConfig(upgraded), upgraded);
});
