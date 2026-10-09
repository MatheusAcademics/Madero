const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs/promises');
const vm = require('node:vm');
const express = require('express');
const session = require('express-session');
const sharp = require('sharp');
const runtime = require('../lib/runtime-config');

async function fixture(t) {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'madero-runtime-app-test-'));
    await runtime.prepareUploadStorage(directory);
    t.after(async () => {
        for (const subdir of ['products', 'avatars']) {
            const target = path.join(directory, subdir);
            for (const filename of await fs.readdir(target)) await fs.unlink(path.join(target, filename));
            await fs.rmdir(target);
        }
        await fs.rmdir(directory);
    });
    return directory;
}

async function harness(t, overrides = {}) {
    const uploadDir = await fixture(t);
    const config = { ...runtime.loadRuntimeConfig({ NODE_ENV: overrides.production === false ? 'development' : 'production',
        SESSION_SECRET: 'runtime-tests-use-isolated-fixture-only'.repeat(2), UPLOAD_DIR: uploadDir }),
        port: 0, host: '127.0.0.1' };
    const calls = { queries: [], store: null, sessions: 0, logs: [], poolClosed: 0, storeClosed: 0 };
    const pool = { query: async sql => {
        calls.queries.push(sql);
        if (overrides.databaseUnavailable) throw new Error('private database details must not be exposed');
        return { rows: [{ '?column?': 1 }] };
    }, end: async () => { calls.poolClosed++; } };
    class FakePgStore extends session.MemoryStore {
        constructor(options) { super(); calls.store = options; }
        async close() { calls.storeClosed++; }
    }
    const routes = express.Router();
    routes.get('/test-session', (req, res) => { req.session.user = { id_usuario: 1 }; res.send('ok'); });
    routes.get('/test-error', (req, res, next) => next(new Error('password=private-test-marker')));
    routes.post('/test-write', (req, res) => res.status(201).send('created'));
    const appModule = { exports: {} };
    const appSource = await fs.readFile(path.join(__dirname, '..', 'app.js'), 'utf8');
    const isolatedRequire = name => {
        if (name === 'dotenv') return { config() {} };
        if (name === './conexao') return pool;
        if (name === './lib/runtime-config') return { ...runtime, loadRuntimeConfig: () => config,
            checkUploadStorage: directory => overrides.storageUnavailable ? Promise.reject(new Error('private mount path')) : runtime.checkUploadStorage(directory) };
        if (name === 'connect-pg-simple') return () => FakePgStore;
        if (name.startsWith('./routes/')) return routes;
        if (name === './middleware/auth') return (req, res, next) => req.session.user ? next() : res.redirect('/usuarios/login');
        if (name === './lib/request-security') return require('../lib/request-security');
        return require(name);
    };
    const signalHandlers = new Map();
    const processFixture = { env: {}, once(name, handler) { signalHandlers.set(name, handler); }, exit() {} };
    vm.runInNewContext(appSource, { module: appModule, exports: appModule.exports, require: isolatedRequire,
        __dirname: path.join(__dirname, '..'), process: processFixture,
        console: { log: (...args) => calls.logs.push(args), error: (...args) => calls.logs.push(args) }, setTimeout, clearTimeout });
    const app = appModule.exports;
    // Importing the module must not start a server or query the database.
    assert.equal(calls.queries.length, 0);
    assert.equal(typeof app.start, 'function');
    const server = overrides.start ? await app.start() : await new Promise(resolve => {
        const value = app.listen(0, '127.0.0.1', () => resolve(value));
    });
    t.after(() => new Promise(resolve => {
        if (!server.listening) return resolve();
        server.close(resolve);
        server.closeAllConnections();
    }));
    return { app, calls, uploadDir, server, signalHandlers, processFixture,
        url: 'http://127.0.0.1:' + server.address().port };
}

test('runtime app: startup checks the existing session table and shutdown closes resources exactly once', async t => {
    const { calls, server, signalHandlers, processFixture } = await harness(t, { start: true });
    assert.deepEqual(calls.queries, ['SELECT 1', 'SELECT sid FROM public.user_sessions LIMIT 0']);
    assert.equal(server.listening, true);
    assert.equal(typeof signalHandlers.get('SIGTERM'), 'function');
    assert.equal(typeof signalHandlers.get('SIGINT'), 'function');
    const closed = new Promise(resolve => server.once('close', resolve));
    signalHandlers.get('SIGTERM')();
    signalHandlers.get('SIGINT')();
    await closed;
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(calls.storeClosed, 1);
    assert.equal(calls.poolClosed, 1);
    assert.equal(processFixture.exitCode, 0);
});

test('runtime app: production refuses to listen when its database preflight fails', async t => {
    await assert.rejects(harness(t, { start: true, databaseUnavailable: true }));
});

test('runtime app: production security is mounted before routes while native same-origin forms work', async t => {
    const { url } = await harness(t);
    const crossSite = await fetch(url + '/usuarios/test-write', {
        method: 'POST', headers: { Origin: 'https://unrelated.example' }
    });
    assert.equal(crossSite.status, 403);
    const sameSite = await fetch(url + '/usuarios/test-write', { method: 'POST', headers: { Origin: url } });
    assert.equal(sameSite.status, 201);
});

test('runtime app: production uses the existing pool and migration-managed session table', async t => {
    const { calls } = await harness(t);
    assert.equal(calls.store.tableName, 'user_sessions');
    assert.equal(calls.store.schemaName, 'public');
    assert.equal(calls.store.createTableIfMissing, false);
    assert.equal(typeof calls.store.pool.query, 'function');
});

test('runtime app: health check verifies DB and uploads without creating sessions or leaking details', async t => {
    const { url, calls } = await harness(t);
    const result = await fetch(url + '/healthz');
    assert.equal(result.status, 200);
    assert.deepEqual(await result.json(), { status: 'ok' });
    assert.equal(result.headers.get('set-cookie'), null);
    assert.equal(result.headers.get('cache-control'), 'no-store');
    assert.deepEqual(calls.queries, ['SELECT 1']);
});

test('runtime app: unhealthy DB or storage returns only a generic 503', async t => {
    for (const overrides of [{ databaseUnavailable: true }, { storageUnavailable: true }]) {
        const { url } = await harness(t, overrides);
        const result = await fetch(url + '/healthz');
        assert.equal(result.status, 503);
        assert.deepEqual(await result.json(), { status: 'unavailable' });
    }
});

test('runtime app: session cookies are HTTPS-only behind the configured proxy, logout clears the same name', async t => {
    const { url, app } = await harness(t);
    assert.equal(app.get('trust proxy'), 1);
    const result = await fetch(url + '/usuarios/test-session', { headers: { 'X-Forwarded-Proto': 'https' } });
    const cookie = result.headers.get('set-cookie');
    assert.match(cookie, /^madero\.sid=/);
    for (const flag of ['HttpOnly', 'Secure', 'SameSite=Lax']) assert.ok(cookie.includes(flag));
    const logout = await fetch(url + '/logout', { headers: { Cookie: cookie.split(';')[0], 'X-Forwarded-Proto': 'https' }, redirect: 'manual' });
    assert.equal(logout.status, 302);
    assert.match(logout.headers.get('set-cookie'), /^madero\.sid=;/);
    assert.equal(logout.headers.get('location'), '/');
});

test('runtime app: local development keeps HTTP logins working without a PostgreSQL session store', async t => {
    const { url, calls } = await harness(t, { production: false });
    assert.equal(calls.store, null);
    const result = await fetch(url + '/usuarios/test-session');
    assert.match(result.headers.get('set-cookie'), /^madero\.sid=/);
    assert.equal(result.headers.get('set-cookie').includes('Secure'), false);
});

test('runtime app: errors never return or log raw private exception data', async t => {
    const { url, calls } = await harness(t);
    const result = await fetch(url + '/usuarios/test-error');
    assert.equal(result.status, 500);
    assert.doesNotMatch(await result.text(), /private-test-marker|password=|Error:/);
    assert.equal(JSON.stringify(calls.logs).includes('private-test-marker'), false);
});

test('runtime app: images uploaded to the configured disk retain public URLs and are served as WebP', async t => {
    const { url, uploadDir } = await harness(t);
    const buffer = await sharp({ create: { width: 20, height: 20, channels: 3, background: '#aa7744' } }).png().toBuffer();
    for (const [moduleName, kind] of [['product-images', 'products'], ['user-images', 'avatars']]) {
        const source = await fs.readFile(path.join(__dirname, '..', 'lib', moduleName + '.js'), 'utf8');
        const imageModule = { exports: {} };
        vm.runInNewContext(source, { module: imageModule, exports: imageModule.exports, Buffer,
            __dirname: path.join(__dirname, '..', 'lib'), require: name => name === './runtime-config'
                ? { uploadDirectory: () => uploadDir } : require(name) });
        const imageUrl = await imageModule.exports.store({ buffer });
        assert.ok(imageUrl.startsWith('/uploads/' + kind + '/'));
        await fs.access(path.join(uploadDir, kind, path.basename(imageUrl)));
        const result = await fetch(url + imageUrl);
        assert.equal(result.status, 200);
        assert.match(result.headers.get('content-type'), /image\/webp/);
        assert.equal(result.headers.get('x-content-type-options'), 'nosniff');
        assert.equal(result.headers.get('x-powered-by'), null);
        const meta = await sharp(Buffer.from(await result.arrayBuffer())).metadata();
        assert.equal(meta.format, 'webp');
    }
});
