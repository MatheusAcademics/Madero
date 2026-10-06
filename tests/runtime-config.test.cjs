const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs/promises');
const { loadRuntimeConfig, uploadDirectory, prepareUploadStorage, checkUploadStorage } = require('../lib/runtime-config');

test('runtime: development defaults bind to all interfaces without a fixed session secret', () => {
    const first = loadRuntimeConfig({});
    const second = loadRuntimeConfig({});
    assert.equal(first.port, 3000);
    assert.equal(first.host, '0.0.0.0');
    assert.equal(first.trustProxyHops, 0);
    assert.notEqual(first.sessionSecret, second.sessionSecret);
    assert.ok(Buffer.byteLength(first.sessionSecret) >= 32);
    assert.equal(first.cookie.secure, false);
    assert.equal(first.cookie.httpOnly, true);
    assert.equal(first.cookie.sameSite, 'lax');
    assert.equal(first.sessionName, 'madero.sid');
});

test('runtime: production refuses missing or weak SESSION_SECRET without echoing its value', () => {
    for (const secret of [undefined, '', 'example-only-short-secret']) {
        assert.throws(() => loadRuntimeConfig({ NODE_ENV: 'production', SESSION_SECRET: secret }), error => {
            assert.match(error.message, /SESSION_SECRET/);
            if (secret) assert.equal(error.message.includes(secret), false);
            return true;
        });
    }
});

test('runtime: production uses one proxy and HTTPS-only session cookies', () => {
    const config = loadRuntimeConfig({ NODE_ENV: 'production', SESSION_SECRET: 'x'.repeat(48), PORT: '10000' });
    assert.equal(config.port, 10000);
    assert.equal(config.cookie.secure, true);
    assert.equal(config.cookie.maxAge, 1200000);
    assert.equal(config.trustProxyHops, 1);
});

test('runtime: configured port and proxy hop count are bounded integers, never broad trust booleans', () => {
    for (const port of ['0', '-1', '65536', '80abc', '12.5', 'Infinity']) {
        assert.throws(() => loadRuntimeConfig({ PORT: port }), /PORT/);
    }
    for (const hops of ['true', '*', '-1', '11', '1.5']) {
        assert.throws(() => loadRuntimeConfig({ TRUST_PROXY_HOPS: hops }), /TRUST_PROXY_HOPS/);
    }
    assert.equal(loadRuntimeConfig({ PORT: '443', HOST: '127.0.0.1', TRUST_PROXY_HOPS: '2' }).host, '127.0.0.1');
    assert.equal(loadRuntimeConfig({ TRUST_PROXY_HOPS: '2' }).trustProxyHops, 2);
});

test('runtime: upload directory is absolute and remains stable outside the process cwd', () => {
    assert.equal(uploadDirectory({}), path.resolve(__dirname, '..', 'public', 'uploads'));
    assert.equal(uploadDirectory({ UPLOAD_DIR: 'data/uploads' }), path.resolve(__dirname, '..', 'data', 'uploads'));
    const explicit = path.join(os.tmpdir(), 'madero-deploy-example');
    assert.equal(uploadDirectory({ UPLOAD_DIR: explicit }), explicit);
});

test('runtime: startup prepares both upload directories without modifying existing files', async t => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'madero-runtime-test-'));
    t.after(async () => {
        await fs.unlink(path.join(directory, 'products', 'existing.txt'));
        await fs.rmdir(path.join(directory, 'products'));
        await fs.rmdir(path.join(directory, 'avatars'));
        await fs.rmdir(directory);
    });
    await assert.rejects(checkUploadStorage(directory));
    await prepareUploadStorage(directory);
    await fs.writeFile(path.join(directory, 'products', 'existing.txt'), 'preserve this test fixture');
    await prepareUploadStorage(directory);
    await checkUploadStorage(directory);
    assert.equal(await fs.readFile(path.join(directory, 'products', 'existing.txt'), 'utf8'), 'preserve this test fixture');
});
