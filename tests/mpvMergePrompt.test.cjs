// 待合并更新的提示：同步结果加已确认的冲突 -> 是否弹窗、列哪些文件、用哪种文案（#223）。
const test = require('node:test');
const assert = require('node:assert/strict');
const { mergePrompt, mergePromptText } = require('../dest/main/common/mpvConfigSync/mergePrompt.js');

const INPUT_NEW = { path: 'input.conf', sha256: 'a'.repeat(64) };
const UOSC_NEW = { path: 'script-opts/uosc.conf', sha256: 'b'.repeat(64) };

function synced({ conflicts = [], acknowledgedConflicts = [], hadInstallRecord = true } = {}) {
    return {
        status: 'synced',
        archiveVersion: 'v2',
        hadInstallRecord,
        files: [],
        conflicts,
        provides: {},
        acknowledgedConflicts,
    };
}

test('a sync without conflicts shows no prompt', () => {
    assert.deepEqual(mergePrompt(synced()), { show: false, conflicts: [], migration: false });
});

test('skipped or failed syncs show no prompt', () => {
    assert.equal(mergePrompt({ status: 'skipped', reason: 'same-directory', detail: 'x' }).show, false);
    assert.equal(mergePrompt({ status: 'failed', error: new Error('boom'), files: [] }).show, false);
});

test('new conflicts are prompted and listed', () => {
    const prompt = mergePrompt(synced({ conflicts: [INPUT_NEW, UOSC_NEW] }));
    assert.deepEqual(prompt, { show: true, conflicts: [INPUT_NEW, UOSC_NEW], migration: false });
});

test('conflicts already acknowledged with the same new version are not prompted again', () => {
    const prompt = mergePrompt(synced({ conflicts: [INPUT_NEW, UOSC_NEW], acknowledgedConflicts: [INPUT_NEW] }));
    assert.deepEqual(prompt, { show: true, conflicts: [UOSC_NEW], migration: false });

    const allAcknowledged = mergePrompt(synced({ conflicts: [INPUT_NEW], acknowledgedConflicts: [INPUT_NEW] }));
    assert.equal(allAcknowledged.show, false);
    assert.deepEqual(allAcknowledged.conflicts, []);
});

test('a new .fntv-new for an acknowledged file (new version hash changed) is prompted again', () => {
    const newerInput = { path: 'input.conf', sha256: 'c'.repeat(64) };
    const prompt = mergePrompt(synced({ conflicts: [newerInput], acknowledgedConflicts: [INPUT_NEW] }));
    assert.deepEqual(prompt, { show: true, conflicts: [newerInput], migration: false });
});

test('conflicts found without an install record use the one-time migration wording', () => {
    const prompt = mergePrompt(synced({ conflicts: [INPUT_NEW], hadInstallRecord: false }));
    assert.deepEqual(prompt, { show: true, conflicts: [INPUT_NEW], migration: true });

    const migration = mergePromptText(prompt);
    assert.match(migration.detail, /一次性迁移/);
    assert.ok(migration.detail.includes('input.conf.fntv-new'));
    // 两种合并方式都要讲到：把改动搬到新文件，或者保留自己的、删掉 .fntv-new。
    assert.match(migration.detail, /搬/);
    assert.match(migration.detail, /删掉/);

    const regular = mergePromptText(mergePrompt(synced({ conflicts: [INPUT_NEW, UOSC_NEW] })));
    assert.doesNotMatch(regular.detail, /一次性迁移/);
    assert.ok(regular.detail.includes('input.conf.fntv-new'));
    assert.ok(regular.detail.includes('script-opts/uosc.conf.fntv-new'));
    assert.match(regular.message, /2 个/);
});
