const test = require('node:test');
const assert = require('node:assert/strict');
const { resolveFnConnectBaseUrl } = require('../dest/main/handlers/core/fnConnect.js');

test('keeps the FN ID path while the relay stays on 5ddd.com', () => {
    assert.equal(
        resolveFnConnectBaseUrl('https://5ddd.com/demo123/v', 'https://5ddd.com/demo123'),
        'https://5ddd.com/demo123',
    );
});

test('uses the redirected NAS origin including its port', () => {
    assert.equal(
        resolveFnConnectBaseUrl('https://192.0.2.10:5667/v/login', 'https://5ddd.com/demo123'),
        'https://192.0.2.10:5667',
    );
});
