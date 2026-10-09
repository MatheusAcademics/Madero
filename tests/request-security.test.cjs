const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { createRequestSecurity, sameOriginRequest } = require('../lib/request-security');

function request(headers, protocol = 'https') {
    return { protocol, get: name => ({ host: 'madero.example', ...headers })[name] };
}

test('security: requires exact origin, rejects null/malformed origins and untrusted subdomains', () => {
    for (const origin of ['https://madero.example', 'https://madero.example:443']) {
        assert.equal(sameOriginRequest(request({ origin })), true);
    }
    for (const origin of ['null', 'broken', 'http://madero.example', 'https://evil.example',
        'https://sub.madero.example', 'https://madero.example.evil.test', 'https://user@madero.example']) {
        assert.equal(sameOriginRequest(request({ origin, 'sec-fetch-site': 'same-origin' })), false);
    }
});

test('security: same-origin Referer or Fetch Metadata support native forms, unidentified writes are rejected', () => {
    assert.equal(sameOriginRequest(request({ referer: 'https://madero.example/usuarios/login' })), true);
    assert.equal(sameOriginRequest(request({ 'sec-fetch-site': 'same-origin' })), true);
    for (const headers of [{}, { 'sec-fetch-site': 'cross-site' }, { 'sec-fetch-site': 'same-site' },
        { referer: 'https://evil.example', 'sec-fetch-site': 'same-origin' }]) {
        assert.equal(sameOriginRequest(request(headers)), false);
    }
});

async function harness(t, production = true) {
    const app = express();
    app.use(createRequestSecurity({ production }, { loginLimit: 2, registrationLimit: 2, writeLimit: 20 }));
    app.post('/usuarios/login', (req, res) => res.sendStatus(req.get('test-success') ? 200 : 401));
    app.post('/usuarios/cadastro', (req, res) => res.sendStatus(201));
    app.post('/produtos/criar', (req, res) => res.sendStatus(201));
    app.get('/usuarios/login', (req, res) => res.sendStatus(200));
    const server = await new Promise(resolve => {
        const value = app.listen(0, '127.0.0.1', () => resolve(value));
    });
    t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
    const url = 'http://127.0.0.1:' + server.address().port;
    const post = (route, headers = { origin: url }) => fetch(url + route, { method: 'POST', headers });
    return { url, post };
}

test('security: rejects cross-origin POST before routes, but leaves reads available', async t => {
    const { url, post } = await harness(t);
    assert.equal((await post('/produtos/criar', { origin: 'https://other.example' })).status, 403);
    assert.equal((await post('/produtos/criar', {})).status, 403);
    assert.equal((await post('/produtos/criar')).status, 201);
    assert.equal((await fetch(url + '/usuarios/login')).status, 200);
});

test('security: limits failed logins without blocking successful logins or registration', async t => {
    const { url, post } = await harness(t);
    for (let i = 0; i < 3; i++) {
        assert.equal((await post('/usuarios/login', { origin: url, 'test-success': '1' })).status, 200);
    }
    assert.equal((await post('/usuarios/login')).status, 401);
    assert.equal((await post('/usuarios/login')).status, 401);
    const blocked = await post('/usuarios/login');
    assert.equal(blocked.status, 429);
    assert.ok(blocked.headers.get('retry-after'));
    assert.ok(blocked.headers.get('ratelimit'));
    assert.equal((await post('/usuarios/cadastro')).status, 201);
});

test('security: registration limiter recognizes trailing slashes and case-insensitive Express routes', async t => {
    const { post } = await harness(t);
    assert.equal((await post('/usuarios/cadastro/')).status, 201);
    assert.equal((await post('/USUARIOS/CADASTRO')).status, 201);
    assert.equal((await post('/usuarios/cadastro')).status, 429);
});

test('security: existing local development forms remain compatible', async t => {
    const { post } = await harness(t, false);
    for (let i = 0; i < 3; i++) assert.equal((await post('/usuarios/cadastro', {})).status, 201);
});
