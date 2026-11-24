const test = require('node:test');
const assert = require('node:assert/strict');
const { openWebUiPage } = require('./helpers/webUiPage.cjs');

const MOVIE = '0123456789abcdef0123456789abcdef';
const OTHER_MOVIE = 'fedcba9876543210fedcba9876543210';
const SHOW = 'abcdefabcdefabcdefabcdefabcdef01';

const HOME = 'https://nas.local/v';
const CARDS = `
    <a class="poster" href="/v/movie/${MOVIE}">
        <div class="play-mask"><button id="play-movie" class="play-mask__btn--play"></button></div>
    </a>
    <a class="poster" href="/v/movie/${OTHER_MOVIE}">
        <div class="play-mask"><button id="play-other" class="play-mask__btn--play"></button></div>
    </a>
`;

test('tapping a card play button plays that item once in MPV instead of the web player', async t => {
    const page = await openWebUiPage(t, { url: HOME, html: CARDS });
    const nativeClicks = page.nativeClicks('#play-movie');

    page.tap('#play-movie');

    assert.deepEqual(page.plays(), [{ id: MOVIE, sourceIndex: 0 }]);
    assert.equal(nativeClicks.length, 0);
});

test('a click without pointer events, as from assistive tools, also plays the card item', async t => {
    const page = await openWebUiPage(t, { url: HOME, html: CARDS });

    page.click('#play-movie');

    assert.deepEqual(page.plays(), [{ id: MOVIE, sourceIndex: 0 }]);
});

test('pressing one card play button and releasing over another plays nothing', async t => {
    const page = await openWebUiPage(t, { url: HOME, html: CARDS });

    page.pointerDown('#play-movie');
    page.pointerUp('#play-other');

    assert.deepEqual(page.plays(), []);
});

test('Enter and Space on a card play button play it, held-key repeats do not', async t => {
    const page = await openWebUiPage(t, { url: HOME, html: CARDS });

    page.press('#play-movie', 'Enter');
    page.press('#play-movie', 'Enter', { repeat: true });
    page.press('#play-other', ' ');
    page.press('#play-other', 'a');

    assert.deepEqual(page.plays(), [
        { id: MOVIE, sourceIndex: 0 },
        { id: OTHER_MOVIE, sourceIndex: 0 },
    ]);
});

test('with the MPV playback preference off the web player keeps every play entry', async t => {
    const page = await openWebUiPage(t, { url: HOME, html: CARDS, mpvPlayback: false });
    const nativeClicks = page.nativeClicks('#play-movie');

    page.tap('#play-movie');
    page.press('#play-movie', 'Enter');

    assert.deepEqual(page.plays(), []);
    assert.equal(nativeClicks.length, 1);
});

test('when the MPV playback preference does not arrive within 2 seconds MPV still takes over', async t => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const page = await openWebUiPage(t, { url: HOME, html: CARDS, mpvPlayback: 'no reply' });

    t.mock.timers.tick(2000);
    await page.settle();
    page.tap('#play-movie');

    assert.deepEqual(page.plays(), [{ id: MOVIE, sourceIndex: 0 }]);
});

const SHOW_PAGE = `https://nas.local/v/tv/${SHOW}`;
const ACTION_ROW = `
    <div class="relative flex h-[54px] shrink-0 items-center gap-2">
        <button id="main" class="semi-button !min-w-[150px] !rounded-full">第 1 季 第 3 集</button>
        <div id="favorite">收藏</div>
    </div>
`;
const SOURCES = `
    <div>
        <button data-source-index="0">1080p</button>
        <button data-source-index="1" aria-selected="true">4K</button>
    </div>
`;

test('the detail page main button plays the page item with the selected media source', async t => {
    const page = await openWebUiPage(t, { url: SHOW_PAGE, html: ACTION_ROW + SOURCES });
    const nativeClicks = page.nativeClicks('#main');

    page.tap('#main');

    assert.deepEqual(page.plays(), [{ id: SHOW, sourceIndex: 1 }]);
    assert.equal(nativeClicks.length, 0);
});

test('a detail page main button rendered after load is taken over too', async t => {
    const page = await openWebUiPage(t, { url: SHOW_PAGE, html: SOURCES });

    await page.changeDom(ACTION_ROW);
    page.tap('#main');

    assert.deepEqual(page.plays(), [{ id: SHOW, sourceIndex: 1 }]);
});

test('a detail page main button that is still loading plays nothing', async t => {
    const loading = ACTION_ROW
        .replace('<button id="main"', '<button id="main" disabled')
        .replace('第 1 季 第 3 集', '查询中');
    const page = await openWebUiPage(t, { url: SHOW_PAGE, html: loading });
    const nativeClicks = page.nativeClicks('#main');

    page.tap('#main');

    assert.deepEqual(page.plays(), []);
    assert.equal(nativeClicks.length, 0);
});

test('other elements in the detail page action row stay with the web UI', async t => {
    const page = await openWebUiPage(t, { url: SHOW_PAGE, html: ACTION_ROW });
    const nativeClicks = page.nativeClicks('#favorite');

    page.tap('#favorite');

    assert.deepEqual(page.plays(), []);
    assert.equal(nativeClicks.length, 1);
});

const CONTINUE_WATCHING = `
    <div class="card" data-item-guid="${MOVIE}"><div id="more" aria-haspopup="true">更多</div></div>
    <div class="card" data-item-guid="${OTHER_MOVIE}"><div id="more-other" aria-haspopup="true">更多</div></div>
    <ul class="semi-dropdown-menu">
        <li role="menuitem" id="continue">继续播放</li>
        <li role="menuitem" id="restart">从头开始播放</li>
        <li role="menuitem" id="remove">移除</li>
    </ul>
`;

function nextTask() {
    return new Promise(resolve => setTimeout(resolve, 10));
}

test('continue playing in a card menu plays that card item in MPV and closes the menu', async t => {
    const page = await openWebUiPage(t, { url: HOME, html: CONTINUE_WATCHING });
    const nativeClicks = page.nativeClicks('#continue');
    const outsidePresses = [];
    page.document.addEventListener('mousedown', event => {
        if (event.target === page.document.body) outsidePresses.push(event);
    });

    page.pointerDown('#more');
    page.tap('#continue');
    await nextTask();

    assert.deepEqual(page.plays(), [{ id: MOVIE, sourceIndex: 0 }]);
    assert.equal(nativeClicks.length, 0);
    assert.equal(outsidePresses.length, 1);
});

test('restart in a card menu asks MPV to play the item from the start', async t => {
    const page = await openWebUiPage(t, { url: HOME, html: CONTINUE_WATCHING });

    page.pointerDown('#more');
    page.tap('#restart');

    assert.deepEqual(page.plays(), [{ id: MOVIE, sourceIndex: 0, restart: true }]);
});

test('the menu plays the item of the card whose menu was opened last', async t => {
    const page = await openWebUiPage(t, { url: HOME, html: CONTINUE_WATCHING });

    page.pointerDown('#more');
    page.pointerDown('#more-other');
    page.tap('#continue');

    assert.deepEqual(page.plays(), [{ id: OTHER_MOVIE, sourceIndex: 0 }]);
});

test('menu items other than continue and restart stay with the web UI', async t => {
    const page = await openWebUiPage(t, { url: HOME, html: CONTINUE_WATCHING });
    const nativeClicks = page.nativeClicks('#remove');

    page.pointerDown('#more');
    page.tap('#remove');

    assert.deepEqual(page.plays(), []);
    assert.equal(nativeClicks.length, 1);
});

test('after Escape or a press outside the menu its items stay with the web UI', async t => {
    const forgetters = [
        page => page.press('#continue', 'Escape'),
        page => page.pointerDown('#remove'),
    ];
    for (const forget of forgetters) {
        const page = await openWebUiPage(t, { url: HOME, html: CONTINUE_WATCHING });
        const nativeClicks = page.nativeClicks('#continue');

        page.pointerDown('#more');
        forget(page);
        page.tap('#continue');

        assert.deepEqual(page.plays(), []);
        assert.equal(nativeClicks.length, 1);
    }
});

test('the opened card menu is remembered for 30 seconds', async t => {
    const cases = [[29_999, [{ id: MOVIE, sourceIndex: 0 }]], [30_000, []]];
    for (const [waitMs, plays] of cases) {
        const page = await openWebUiPage(t, { url: HOME, html: CONTINUE_WATCHING });
        t.mock.timers.enable({ apis: ['setTimeout'] });

        page.pointerDown('#more');
        t.mock.timers.tick(waitMs);
        page.tap('#continue');
        t.mock.timers.reset();

        assert.deepEqual(page.plays(), plays, `after ${waitMs} ms`);
    }
});

test('pressing a card play button while a card menu is open forgets the menu', async t => {
    const page = await openWebUiPage(t, { url: HOME, html: CARDS + CONTINUE_WATCHING });
    const nativeClicks = page.nativeClicks('#continue');

    page.pointerDown('#more');
    page.tap('#play-other');
    page.tap('#continue');

    assert.deepEqual(page.plays(), [{ id: OTHER_MOVIE, sourceIndex: 0 }]);
    assert.equal(nativeClicks.length, 1);
});
