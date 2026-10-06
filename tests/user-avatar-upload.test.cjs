const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const vm = require('node:vm');
const express = require('express');
const sharp = require('sharp');
const images = require('../lib/user-images');

const oldPhoto = '/uploads/avatars/11111111-2222-3333-4444-555555555555.webp';
const sample = (format = 'png', width = 80, height = 60) => sharp({ create: {
    width, height, channels: 4, background: { r: 140, g: 120, b: 60, alpha: 0.8 }
} }).toFormat(format).toBuffer();

async function tempStore(t) {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'madero-avatar-test-'));
    t.after(async () => {
        // Only exact files within this test's own fresh directory are removed.
        for (const file of await fs.readdir(directory)) await fs.unlink(path.join(directory, file));
        await fs.rmdir(directory);
    });
    return { directory, store: images.createImageStore(directory) };
}

test('avatars: real JPEG, PNG and WebP decode into safe unique paths, without metadata or upscaling', async t => {
    const { directory, store } = await tempStore(t);
    const urls = [];
    for (const format of ['jpeg', 'png', 'webp']) {
        const url = await store({ buffer: await sample(format), originalname: '../../avatar.html', mimetype: 'text/html' });
        assert.match(url, /^\/uploads\/avatars\/[a-f0-9-]{36}\.webp$/);
        urls.push(url);
        const metadata = await sharp(await fs.readFile(path.join(directory, path.basename(url)))).metadata();
        assert.equal(metadata.format, 'webp');
        assert.equal(metadata.width, 80);
        assert.equal(metadata.height, 60);
        assert.equal(metadata.exif, undefined);
        if (format !== 'jpeg') assert.equal(metadata.hasAlpha, true);
    }
    assert.equal(new Set(urls).size, 3);
});

test('avatars: photos are resized proportionally to at most 512px', async t => {
    const { directory, store } = await tempStore(t);
    const url = await store({ buffer: await sample('jpeg', 1600, 1200) });
    const metadata = await sharp(await fs.readFile(path.join(directory, path.basename(url)))).metadata();
    assert.equal(metadata.width, 512);
    assert.equal(metadata.height, 384);
});

test('avatars: fake JPG, SVG, GIF, empty, oversized and excessive pixel images never persist', async t => {
    const { directory, store } = await tempStore(t);
    for (const buffer of [null, Buffer.alloc(0), Buffer.from('<html>Not an image</html>'),
        Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20"></svg>'),
        await sample('gif'), Buffer.alloc(images.MAX_BYTES + 1), await sample('png', 5100, 5000)]) {
        await assert.rejects(store({ buffer, originalname: 'avatar.jpg', mimetype: 'image/jpeg' }), { code: 'USER_IMAGE_INVALID' });
    }
    assert.deepEqual(await fs.readdir(directory), []);
});

// Real multipart and HTTP/static image serving, with an isolated DB mock. Never imports app.js or PostgreSQL.
async function appHarness(t, options = {}) {
    const { directory, store } = await tempStore(t);
    const calls = { sql: [], receives: 0, hashes: 0, saves: 0 };
    let record = { id_usuario: 9, nome: 'Pessoa Teste', usuario: 'pessoa', email: 'pessoa@example.invalid', telefone: null, foto: oldPhoto };
    const session = options.unauthenticated ? {} : { user: { id_usuario: options.otherUser ? 10 : 9, usuario: 'pessoa', foto: oldPhoto },
        save(done) { calls.saves++; done(); }, regenerate(done) { done(); } };
    const query = async (sql, values = []) => {
        sql = sql.trim();
        calls.sql.push({ sql, values: [...values] });
        if (/^SELECT COUNT/.test(sql)) return { rows: [{ total: '1' }] };
        if (/^SELECT u.id_usuario/.test(sql)) return { rows: [{ ...record, total_movimentacoes: '0' }] };
        if (/^SELECT/.test(sql)) return { rows: options.missing ? [] : [{ ...record, senha: 'mock-private-hash' }] };
        if (/^(INSERT|UPDATE)/.test(sql)) {
            if (options.failWrite) throw Object.assign(new Error('Private SQL diagnostic'), { code: options.errorCode || '08006', constraint: options.constraint });
            const photoIndex = /\bfoto = \$(\d+)/.exec(sql);
            if (photoIndex) record.foto = values[Number(photoIndex[1]) - 1];
            return { rows: [{ ...record }] };
        }
        throw new Error('Unexpected SQL');
    };
    const mod = { exports: {} };
    vm.runInNewContext(await fs.readFile(path.join(__dirname, '../routes/usuarios.js'), 'utf8'), {
        module: mod, Buffer, console: { error() {}, log() {} },
        require(name) {
            if (name === 'express') return express;
            if (name === 'bcrypt') return { async hash() { calls.hashes++; return 'mock-private-hash'; }, compareSync() { return true; } };
            if (name === '../conexao') return { query };
            if (name === '../lib/user-images') return { store, receive(req, res) { calls.receives++; return images.receive(req, res); } };
            throw new Error('Unexpected dependency: ' + name);
        }
    });
    const app = express();
    app.use(express.urlencoded({ extended: false }));
    app.use((req, res, next) => {
        req.session = session;
        res.render = (view, locals) => res.json({ view, ...locals });
        next();
    });
    app.use('/uploads/avatars', express.static(directory));
    app.use('/usuarios', mod.exports);
    const server = await new Promise(resolve => { const active = app.listen(0, '127.0.0.1', () => resolve(active)); });
    t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
    const origin = 'http://127.0.0.1:' + server.address().port;
    return { calls, directory, origin, session, setPhoto(photo) { record.foto = photo; }, async submit(route, { buffer, fields = {}, duplicate = false } = {}) {
        const editing = route.startsWith('/alterar');
        const body = new FormData();
        const defaults = { nome: 'Pessoa Teste', usuario: 'pessoa', email: 'pessoa@example.invalid', telefone: '',
            senha: editing ? '' : 'password-only-in-test', confirmar_senha: editing ? '' : 'password-only-in-test', ...fields };
        for (const [name, value] of Object.entries(defaults)) body.append(name, value);
        if (buffer) body.append('foto_arquivo', new Blob([buffer], { type: 'image/png' }), 'avatar.png');
        if (duplicate) body.append('foto_arquivo', new Blob([buffer], { type: 'image/png' }), 'other.png');
        return fetch(origin + '/usuarios' + route, { method: 'POST', body, redirect: 'manual' });
    } };
}
const writes = h => h.calls.sql.filter(({ sql }) => /^(INSERT|UPDATE)/.test(sql));

for (const route of ['/criar', '/alterar/9', '/cadastro']) {
    test(`avatar HTTP ${route}: valid photo persists and is served as real WebP`, async t => {
        const h = await appHarness(t, { unauthenticated: route === '/cadastro' });
        const res = await h.submit(route, { buffer: await sample(), fields: { foto: 'https://unsafe.example/other.jpg', remover_foto: '1' } });
        assert.equal(res.status, route === '/cadastro' ? 200 : 302);
        const write = writes(h)[0];
        const url = write.values.find(value => typeof value === 'string' && value.startsWith('/uploads/avatars/'));
        assert.match(url, /^\/uploads\/avatars\/[a-f0-9-]{36}\.webp$/);
        const response = await fetch(h.origin + url);
        assert.equal(response.status, 200);
        assert.match(response.headers.get('content-type'), /^image\/webp/);
        assert.equal((await sharp(Buffer.from(await response.arrayBuffer())).metadata()).width, 80);
        assert.doesNotMatch(JSON.stringify(write.values), /unsafe.example/);
        if (route.startsWith('/alterar')) {
            assert.equal(h.session.user.foto, url);
            assert.equal(h.session.user.nome, 'Pessoa Teste');
            assert.equal(h.calls.saves, 1);
            assert.doesNotMatch(write.sql, /senha\s*=/);
        }
    });

    test(`avatar HTTP ${route}: optional image ignores forged paths and does not require an upload`, async t => {
        const h = await appHarness(t);
        const res = await h.submit(route, { fields: { foto: '/uploads/avatars/99999999-1111-2222-3333-444444444444.webp' } });
        assert.equal(res.status, route === '/cadastro' ? 200 : 302);
        const write = writes(h)[0];
        assert.doesNotMatch(write.sql.split('RETURNING')[0], /\bfoto\b/);
        assert.equal(write.values.some(value => typeof value === 'string' && value.startsWith('/uploads/avatars/')), false);
        assert.deepEqual(await fs.readdir(h.directory), []);
        if (route.startsWith('/alterar')) assert.equal(h.session.user.foto, oldPhoto);
    });

    test(`avatar HTTP ${route}: malformed bytes, duplicate files and file size reject without writes`, async t => {
        const h = await appHarness(t);
        for (const options of [{ buffer: Buffer.from('<html>bad image</html>') },
            { buffer: Buffer.alloc(images.MAX_BYTES + 1) }, { buffer: await sample(), duplicate: true }]) {
            const res = await h.submit(route, options);
            assert.equal(res.status, 400);
            const data = await res.json();
            assert.ok(data.errors.foto_arquivo);
            assert.doesNotMatch(JSON.stringify(data), /mock-private-hash|password-only-in-test/);
            if (route.startsWith('/alterar')) assert.equal(data.values.foto, oldPhoto);
        }
        assert.equal(writes(h).length, 0);
        assert.deepEqual(await fs.readdir(h.directory), []);
    });

    test(`avatar HTTP ${route}: invalid fields retain safe draft and request reselection before persistence`, async t => {
        const h = await appHarness(t);
        const res = await h.submit(route, { buffer: await sample(), fields: { email: 'not-an-email' } });
        assert.equal(res.status, 400);
        const data = await res.json();
        assert.ok(data.uploadNotice);
        assert.equal(route === '/cadastro' ? data.email_digitado : data.values.email, 'not-an-email');
        assert.equal(writes(h).length, 0);
        assert.equal(h.calls.hashes, 0);
        assert.deepEqual(await fs.readdir(h.directory), []);
    });

    test(`avatar HTTP ${route}: DB failure never claims save and requests photo reselection`, async t => {
        const h = await appHarness(t, { failWrite: true });
        const res = await h.submit(route, { buffer: await sample() });
        assert.equal(res.status, route === '/cadastro' ? 500 : 503);
        const data = await res.json();
        assert.ok(data.uploadNotice);
        assert.ok(data.formError || data.mensagem_erro);
        assert.doesNotMatch(JSON.stringify(data), /Private SQL|mock-private-hash|password-only-in-test/);
        if (route.startsWith('/alterar')) assert.equal(data.values.foto, oldPhoto);
        assert.equal(h.session.user.foto, oldPhoto);
    });
}

test('avatar HTTP: protected routes authenticate and validate ID before parsing uploads', async t => {
    for (const route of ['/criar', '/alterar/9']) {
        const h = await appHarness(t, { unauthenticated: true });
        const res = await h.submit(route, { buffer: await sample() });
        assert.equal(res.status, 302);
        assert.equal(res.headers.get('location'), '/usuarios/login');
        assert.equal(h.calls.receives, 0);
        assert.equal(h.calls.sql.length, 0);
        assert.deepEqual(await fs.readdir(h.directory), []);
    }
    const invalid = await appHarness(t);
    assert.equal((await invalid.submit('/alterar/0', { buffer: await sample() })).status, 404);
    assert.equal(invalid.calls.receives, 0);
    assert.equal(invalid.calls.sql.length, 0);
});

test('avatar HTTP: explicit removal clears DB/session only, preserving saved files and password', async t => {
    const h = await appHarness(t);
    const res = await h.submit('/alterar/9', { fields: { remover_foto: '1' } });
    assert.equal(res.status, 302);
    assert.match(writes(h)[0].sql, /foto = \$5/);
    assert.equal(writes(h)[0].values[4], null);
    assert.equal(h.session.user.foto, '');
    assert.doesNotMatch(writes(h)[0].sql, /senha\s*=/);
});

test('avatar HTTP: changing another user never replaces the signed-in avatar', async t => {
    const h = await appHarness(t, { otherUser: true });
    assert.equal((await h.submit('/alterar/9', { buffer: await sample() })).status, 302);
    assert.equal(h.session.user.foto, oldPhoto);
    assert.equal(h.calls.saves, 0);
});

test('avatar HTTP: deleted record returns 404 without persisting photo', async t => {
    const h = await appHarness(t, { missing: true });
    assert.equal((await h.submit('/alterar/9', { buffer: await sample() })).status, 404);
    assert.equal(writes(h).length, 0);
    assert.deepEqual(await fs.readdir(h.directory), []);
});

test('avatar HTTP: list, edit and login expose only allowlisted local avatar paths', async t => {
    const h = await appHarness(t);
    for (const foto of [oldPhoto, 'javascript:alert(1)', 'https://example.com/photo.jpg', '/uploads/avatars/../../private.webp', '/uploads/products/file.webp', null]) {
        h.setPhoto(foto);
        const expected = foto === oldPhoto ? oldPhoto : '';
        const edit = await (await fetch(h.origin + '/usuarios/alterar/9')).json();
        assert.equal(edit.values.foto, expected);
        const list = await (await fetch(h.origin + '/usuarios/listar')).json();
        assert.equal(list.usuarios[0].foto, expected);
        assert.doesNotMatch(JSON.stringify(edit) + JSON.stringify(list), /mock-private-hash/);
        const res = await fetch(h.origin + '/usuarios/login', { method: 'POST',
            body: new URLSearchParams({ usuario: 'pessoa', senha: 'password-only-in-test' }), redirect: 'manual' });
        assert.equal(res.status, 302);
        assert.equal(h.session.user.foto, expected);
    }
});
