const test = require('node:test');
const assert = require('node:assert/strict');
const { createCertificateTrust } = require('../dest/modules/cert_trust/trust.js');

const NAS = 'https://nas.example:5667';

function world({ answers = [], remembered = [] } = {}) {
    const prompts = [];
    const rememberedHosts = new Set(remembered);
    const pendingAnswers = [...answers];
    const trust = createCertificateTrust({
        prompt: (host, error, origin) => {
            prompts.push({ host, error, origin });
            const answer = pendingAnswers.shift() ?? 'cancel';
            return typeof answer === 'function' ? answer() : Promise.resolve(answer);
        },
        remembered: {
            has: host => rememberedHosts.has(host),
            add: host => rememberedHosts.add(host),
        },
    });
    return { trust, prompts, rememberedHosts };
}

const TRUST = { trust: true, remember: false };
const TRUST_AND_REMEMBER = { trust: true, remember: true };
const CANCEL = { trust: false, remember: false };

function attempts(...results) {
    const calls = [];
    const attempt = async () => {
        calls.push(calls.length + 1);
        const next = results.shift();
        return next === 'certificate' ? { ok: false, certificateError: 'net::ERR_CERT_AUTHORITY_INVALID' } : { ok: true, value: next };
    };
    return { attempt, calls };
}

test('a certificate failure asks once, and after the user trusts it the request is retried once and succeeds', async () => {
    const { trust, prompts } = world({ answers: [TRUST] });
    const { attempt, calls } = attempts('certificate', 'token');

    assert.deepEqual(await trust.withCertificateTrust(NAS, attempt), { ok: true, value: 'token' });
    assert.deepEqual(prompts.map(p => [p.host, p.error]), [['nas.example:5667', 'net::ERR_CERT_AUTHORITY_INVALID']]);
    assert.equal(calls.length, 2);
});

test('a certificate that still fails after the user trusts it is reported without asking or retrying again', async () => {
    const { trust, prompts } = world({ answers: [TRUST] });
    const { attempt, calls } = attempts('certificate', 'certificate');

    assert.deepEqual(await trust.withCertificateTrust(NAS, attempt), { ok: false, reason: 'still-untrusted' });
    assert.equal(prompts.length, 1);
    assert.equal(calls.length, 2);
});

test('cancelling stops this request without retrying, and the next request asks again', async () => {
    const { trust, prompts } = world({ answers: [CANCEL, TRUST] });

    const first = attempts('certificate');
    assert.deepEqual(await trust.withCertificateTrust(NAS, first.attempt), { ok: false, reason: 'declined' });
    assert.equal(first.calls.length, 1);
    assert.equal(trust.isTrusted(NAS), false);

    const second = attempts('certificate', 'token');
    assert.deepEqual(await trust.withCertificateTrust(NAS, second.attempt), { ok: true, value: 'token' });
    assert.equal(prompts.length, 2);
});

test('a certificate trusted for this run is not asked about again, but is not remembered', async () => {
    const { trust, prompts, rememberedHosts } = world({ answers: [TRUST] });

    assert.equal(await trust.confirmTrust(NAS, 'error'), true);
    assert.equal(await trust.confirmTrust(`${NAS}/v`, 'error'), true);

    assert.equal(prompts.length, 1);
    assert.equal(trust.isTrusted(NAS), true);
    assert.deepEqual([...rememberedHosts], []);
});

test('a certificate trusted with "remember" is kept across restarts, and a remembered host is not asked about', async () => {
    const first = world({ answers: [TRUST_AND_REMEMBER] });
    assert.equal(await first.trust.confirmTrust(NAS, 'error'), true);
    assert.deepEqual([...first.rememberedHosts], ['nas.example:5667']);

    const afterRestart = world({ remembered: [...first.rememberedHosts] });
    assert.equal(afterRestart.trust.isTrusted(NAS), true);
    assert.equal(await afterRestart.trust.confirmTrust(NAS, 'error'), true);
    assert.deepEqual(afterRestart.prompts, []);
});

test('requests to the same host while a prompt is open share that one prompt', async () => {
    let answer;
    const { trust, prompts } = world({ answers: [() => new Promise(resolve => { answer = resolve; })] });

    const both = Promise.all([trust.confirmTrust(NAS, 'error'), trust.confirmTrust(`${NAS}/other`, 'error')]);
    answer(TRUST);

    assert.deepEqual(await both, [true, true]);
    assert.equal(prompts.length, 1);
});

test('a prompt that fails to show counts as cancelled, and the next request asks again', async () => {
    const { trust, prompts } = world({ answers: [() => Promise.reject(new Error('no display')), TRUST] });

    assert.equal(await trust.confirmTrust(NAS, 'error'), false);
    assert.equal(await trust.confirmTrust(NAS, 'error'), true);
    assert.equal(prompts.length, 2);
});

test('the prompt is told which window the request came from', async () => {
    const { trust, prompts } = world({ answers: [TRUST] });

    await trust.confirmTrust(NAS, 'error', 'fn-connect-window');

    assert.equal(prompts[0].origin, 'fn-connect-window');
});
