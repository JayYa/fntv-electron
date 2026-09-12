const test = require('node:test');
const assert = require('node:assert/strict');
const { extractItemGuidFromUrl, isItemGuid, detectDetailRoute } = require('../dest/preload/core/playTarget.js');

const GUID = '0123456789abcdef0123456789abcdef';

test('extracts item guid from legacy routes', () => {
    assert.equal(extractItemGuidFromUrl(`https://nas.local/v/movie/${GUID}`), GUID);
    assert.equal(extractItemGuidFromUrl(`https://nas.local/v/tv/episode/${GUID}?tab=info`), GUID);
    assert.equal(extractItemGuidFromUrl(`https://nas.local/v/other/${GUID}/`), GUID);
});

test('extracts item guid from current generic and hash routes', () => {
    assert.equal(extractItemGuidFromUrl(`https://nas.local/v/detail/${GUID}`), GUID);
    assert.equal(extractItemGuidFromUrl(`https://nas.local/#/v/video/${GUID}`), GUID);
    assert.equal(extractItemGuidFromUrl(`https://nas.local/player?item_guid=${GUID}`), GUID);
});

test('supports prefixed and UUID identifiers without accepting unrelated pages', () => {
    const prefixed = `fv_${GUID}`;
    const uuid = '123e4567-e89b-42d3-a456-426614174000';
    assert.equal(extractItemGuidFromUrl(`https://nas.local/v/item/${prefixed}`), prefixed);
    assert.equal(extractItemGuidFromUrl(`https://nas.local/v/play/${uuid}`), uuid);
    assert.equal(extractItemGuidFromUrl('https://nas.local/v/library'), null);
    assert.equal(isItemGuid(prefixed), true);
    assert.equal(isItemGuid('library'), false);
});

test('extracts item guid from tv and season routes via explicit route markers', () => {
    // 使用非 hex 标识，确保命中的是显式路由匹配而不是 32 位 hex 兜底
    const opaque = 'series-id-42';
    assert.equal(extractItemGuidFromUrl(`https://nas.local/v/tv/${opaque}`), opaque);
    assert.equal(extractItemGuidFromUrl(`https://nas.local/v/tv/season/${opaque}`), opaque);
    assert.equal(extractItemGuidFromUrl(`https://nas.local/v/tv/${GUID}`), GUID);
    assert.equal(extractItemGuidFromUrl(`https://nas.local/v/tv/season/${GUID}?tab=episodes`), GUID);
    assert.equal(extractItemGuidFromUrl(`https://nas.local/#/v/tv/season/${GUID}`), GUID);
    assert.equal(extractItemGuidFromUrl(`https://nas.local/v/tv/episode/${GUID}`), GUID);
});

test('detectDetailRoute recognizes the four detail page kinds', () => {
    assert.equal(detectDetailRoute(`https://nas.local/v/movie/${GUID}`), 'movie');
    assert.equal(detectDetailRoute(`https://nas.local/v/other/${GUID}`), 'other');
    assert.equal(detectDetailRoute(`https://nas.local/v/tv/${GUID}`), 'tv');
    assert.equal(detectDetailRoute(`https://nas.local/v/tv/season/${GUID}`), 'season');
});

test('detectDetailRoute supports hash routes, query strings and trailing slashes', () => {
    assert.equal(detectDetailRoute(`https://nas.local/#/v/tv/${GUID}`), 'tv');
    assert.equal(detectDetailRoute(`https://nas.local/#/v/tv/season/${GUID}?tab=episodes`), 'season');
    assert.equal(detectDetailRoute(`https://nas.local/v/movie/${GUID}?from=home`), 'movie');
    assert.equal(detectDetailRoute(`https://nas.local/v/other/${GUID}/`), 'other');
    assert.equal(detectDetailRoute(`/v/movie/${GUID}`), 'movie');
});

test('detectDetailRoute returns null for non-detail pages', () => {
    assert.equal(detectDetailRoute(`https://nas.local/v/folder/${GUID}`), null);
    assert.equal(detectDetailRoute(`https://nas.local/v/person/${GUID}`), null);
    assert.equal(detectDetailRoute(`https://nas.local/v/video/${GUID}`), null);
    assert.equal(detectDetailRoute('https://nas.local/v/library'), null);
    assert.equal(detectDetailRoute(`https://nas.local/v/tv/episode/${GUID}`), null);
    assert.equal(detectDetailRoute('https://nas.local/v/tv'), null);
    assert.equal(detectDetailRoute('https://nas.local/v/tv/season'), null);
    assert.equal(detectDetailRoute('https://nas.local/'), null);
    assert.equal(detectDetailRoute(''), null);
});
