const test = require('node:test');
const assert = require('node:assert/strict');
const { storageConfig, uploadImage, publicImageUrl, checkCloudStorage } = require('../lib/cloud-images');
const env = { UPLOAD_STORAGE: 'supabase', SUPABASE_URL: 'https://example.supabase.co',
    SUPABASE_SERVICE_ROLE_KEY: 'test-server-secret' };
const filename = 'f1234567-1234-1234-1234-123456789abc.webp';

test('cloud images: Vercel requires configured HTTPS storage, local development remains local', () => {
    assert.equal(storageConfig({}), null);
    assert.throws(() => storageConfig({ VERCEL: '1', UPLOAD_STORAGE: 'local' }));
    for (const url of ['http://example.com', 'https://user:pass@example.com', 'https://example.com/path']) {
        assert.throws(() => storageConfig({ ...env, SUPABASE_URL: url }));
    }
    assert.throws(() => storageConfig({ ...env, SUPABASE_SERVICE_ROLE_KEY: '' }));
});

test('cloud images: upload stores encoded bytes without overwriting and returns existing application path', async () => {
    const config = storageConfig(env);
    const bytes = Buffer.from('encoded image');
    const result = await uploadImage(config, 'products', filename, bytes, async (url, options) => {
        assert.equal(url, `https://example.supabase.co/storage/v1/object/madero-uploads/products/${filename}`);
        assert.equal(options.body, bytes);
        assert.equal(options.headers['Content-Type'], 'image/webp');
        assert.equal(options.headers['x-upsert'], 'false');
        assert.equal(options.headers.Authorization, 'Bearer test-server-secret');
        assert.equal(options.redirect, 'error');
        return { ok: true };
    });
    assert.equal(result, '/uploads/products/' + filename);
    assert.equal(publicImageUrl(config, 'products', filename),
        `https://example.supabase.co/storage/v1/object/public/madero-uploads/products/${filename}`);
    for (const name of ['../secret', 'bad.webp', 'https://example.com']) {
        assert.throws(() => publicImageUrl(config, 'products', name));
    }
});

test('cloud images: failed remote writes never claim success or disclose credentials', async () => {
    for (const fetcher of [async () => ({ ok: false }), async () => { throw new Error(env.SUPABASE_SERVICE_ROLE_KEY); }]) {
        await assert.rejects(uploadImage(storageConfig(env), 'avatars', filename, Buffer.from('x'), fetcher), error => {
            assert.ok(!error.message.includes(env.SUPABASE_SERVICE_ROLE_KEY));
            return true;
        });
    }
});

test('cloud images: health requires an accessible public bucket', async () => {
    const config = storageConfig(env);
    await checkCloudStorage(config, async () => ({ ok: true, json: async () => ({ public: true }) }));
    await assert.rejects(checkCloudStorage(config, async () => ({ ok: true, json: async () => ({ public: false }) })));
});
