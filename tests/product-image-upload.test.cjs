const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const vm = require('node:vm');
const express = require('express');
const sharp = require('sharp');
const images = require('../lib/product-images');

async function tempStore(t) {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'madero-image-test-'));
    t.after(async () => {
        // Remove only files in the exact directory this test created, never production uploads.
        for (const file of await fs.readdir(directory)) await fs.unlink(path.join(directory, file));
        await fs.rmdir(directory);
    });
    return { directory, store: images.createImageStore(directory) };
}
const sample = (format = 'png', width = 40, height = 30) => sharp({ create: {
    width, height, channels: 4, background: { r: 170, g: 130, b: 70, alpha: 0.7 }
} }).toFormat(format).toBuffer();

test('product images: JPG, PNG and WebP are decoded, normalized and saved under unique safe paths', async t => {
    const { directory, store } = await tempStore(t);
    const urls = new Set();
    for (const format of ['jpeg', 'png', 'webp']) {
        const url = await store({ buffer: await sample(format), originalname: '../../unsafe.html', mimetype: 'text/html' });
        assert.match(url, /^\/uploads\/products\/[a-f0-9-]{36}\.webp$/);
        urls.add(url);
        const metadata = await sharp(await fs.readFile(path.join(directory, path.basename(url)))).metadata();
        assert.equal(metadata.format, 'webp');
        assert.equal(metadata.width, 40);
        assert.equal(metadata.height, 30);
        assert.equal(metadata.exif, undefined);
        if (format !== 'jpeg') assert.equal(metadata.hasAlpha, true);
    }
    assert.equal(urls.size, 3);
    assert.equal((await fs.readdir(directory)).length, 3);
});

test('product images: large photos retain aspect ratio and are limited to 2400px', async t => {
    const { directory, store } = await tempStore(t);
    const url = await store({ buffer: await sample('jpeg', 3000, 1500) });
    const meta = await sharp(await fs.readFile(path.join(directory, path.basename(url)))).metadata();
    assert.equal(meta.width, 2400);
    assert.equal(meta.height, 1200);
});

test('product images: reject fake extensions, SVG, GIF, invalid bytes and over-limit files without persisting', async t => {
    const { directory, store } = await tempStore(t);
    for (const buffer of [null, Buffer.alloc(0), Buffer.from('<html>Recipe page</html>'),
        Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"></svg>'),
        Buffer.from('not an image'), Buffer.alloc(images.MAX_BYTES + 1), await sample('gif')]) {
        await assert.rejects(store({ buffer, originalname: 'safe.jpg', mimetype: 'image/jpeg' }), { code: 'PRODUCT_IMAGE_INVALID' });
    }
    assert.deepEqual(await fs.readdir(directory), []);
});

test('product images: reject excessive pixel dimensions even when compressed file is small', async t => {
    const { directory, store } = await tempStore(t);
    const buffer = await sample('png', 5100, 5000);
    assert.ok(buffer.length < images.MAX_BYTES);
    await assert.rejects(store({ buffer }), { code: 'PRODUCT_IMAGE_INVALID' });
    assert.deepEqual(await fs.readdir(directory), []);
});

// Isolated HTTP app with real multipart parsing and image processing. Never loads app.js or PostgreSQL.
async function appHarness(t, options = {}) {
    const { directory, store } = await tempStore(t);
    const calls = { sql: [], receive: 0 };
    const product = { id_produto: 17, nome_produto: 'Pao', estoque: '7.00', estoque_minimo: '2.00',
        valor: '8.50', imagem: '/img/old.jpg', id_categoria: 4 };
    const categories = [{ id_categoria: 4, nome: 'Ingredientes' }];
    const query = async (sql, values = []) => {
        sql = sql.trim();
        calls.sql.push({ sql, values: [...values] });
        if (options.failWrite && /^(INSERT INTO produtos|UPDATE produtos)/.test(sql)) throw new Error('Database unavailable');
        if (/^SELECT id_categoria, nome/.test(sql)) return { rows: categories };
        if (/^SELECT id_categoria /.test(sql)) return { rows: [{ id_categoria: 4 }] };
        if (/^SELECT id_usuario /.test(sql)) return { rows: [{ id_usuario: 9 }] };
        if (/^SELECT produtos.id_produto/.test(sql)) return { rows: [product] };
        if (/^(INSERT INTO produtos|UPDATE produtos)/.test(sql)) return { rows: [{ id_produto: 17 }] };
        if (/^(BEGIN|COMMIT|ROLLBACK|INSERT INTO movimentacoes)/.test(sql)) return { rows: [] };
        throw new Error('Unexpected SQL: ' + sql);
    };
    const mod = { exports: {} };
    vm.runInNewContext(await fs.readFile(path.join(__dirname, '../routes/produtos.js'), 'utf8'), {
        module: mod, URL, Date, console: { error() {}, log() {} },
        require(name) {
            if (name === 'express') return express;
            if (name === '../conexao') return { query, connect: async () => ({ query, release() {} }) };
            if (name === '../lib/product-images') return { store, receive: (req, res) => { calls.receive++; return images.receive(req, res); } };
            throw new Error('Unexpected dependency: ' + name);
        }
    });
    const app = express();
    app.use(express.urlencoded({ extended: false }));
    app.use((req, res, next) => {
        req.session = options.unauthenticated ? {} : { user: { id_usuario: 9 } };
        res.render = (view, locals) => res.json({ view, ...locals });
        next();
    });
    app.use('/uploads/products', express.static(directory));
    app.use('/produtos', mod.exports);
    const server = await new Promise(resolve => { const server = app.listen(0, '127.0.0.1', () => resolve(server)); });
    t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
    const origin = 'http://127.0.0.1:' + server.address().port;
    return { calls, directory, origin, async submit({ edit = false, buffer, filename = 'foto.png', type = 'image/png', fields = {}, duplicate = false } = {}) {
        const body = new FormData();
        const defaults = { [edit ? 'nome_produto' : 'nome']: 'Pao', id_categoria: '4', estoque_minimo: '2', valor: '8,50', imagem: '', ...(!edit ? { estoque: '7' } : {}), ...fields };
        for (const [name, value] of Object.entries(defaults)) body.append(name, value);
        if (buffer) body.append('imagem_arquivo', new Blob([buffer], { type }), filename);
        if (duplicate) body.append('imagem_arquivo', new Blob([buffer], { type }), 'outra.png');
        return fetch(origin + (edit ? '/produtos/alterar/17' : '/produtos/cadastro'), { method: 'POST', body, redirect: 'manual' });
    } };
}
const writes = calls => calls.sql.filter(({ sql }) => /^(INSERT|UPDATE|DELETE)/.test(sql));

for (const edit of [false, true]) {
    const operation = edit ? 'edit' : 'create';
    test(`product upload HTTP ${operation}: file takes priority over URL and is served as an actual image`, async t => {
        const h = await appHarness(t);
        const res = await h.submit({ edit, buffer: await sample(), fields: { imagem: 'javascript:invalid()' } });
        assert.equal(res.status, 302);
        assert.match(res.headers.get('location'), /^\/produtos\/listar\?mensagem=/);
        const saved = writes(h.calls).find(({ sql }) => sql.startsWith(edit ? 'UPDATE' : 'INSERT INTO produtos'));
        const url = saved.values[edit ? 3 : 4];
        assert.match(url, /^\/uploads\/products\/.*\.webp$/);
        const image = await fetch(h.origin + url);
        assert.equal(image.status, 200);
        assert.match(image.headers.get('content-type'), /^image\/webp/);
        assert.equal((await sharp(Buffer.from(await image.arrayBuffer())).metadata()).width, 40);
        if (edit) assert.doesNotMatch(saved.sql, /\bestoque\s*=|movimentacoes/);
        else assert.ok(h.calls.sql.some(({ sql }) => sql === 'COMMIT'));
    });

    test(`product upload HTTP ${operation}: optional file keeps direct links and blank images working`, async t => {
        const h = await appHarness(t);
        for (const imagem of ['', '/uploads/products/existing.webp', 'https://example.com/photo.jpg']) {
            assert.equal((await h.submit({ edit, fields: { imagem } })).status, 302);
            const saved = writes(h.calls).filter(({ sql }) => sql.startsWith(edit ? 'UPDATE' : 'INSERT INTO produtos')).at(-1);
            assert.equal(saved.values[edit ? 3 : 4], imagem);
        }
        assert.deepEqual(await fs.readdir(h.directory), []);
    });

    test(`product upload HTTP ${operation}: malformed image leaves data and old image untouched`, async t => {
        const h = await appHarness(t);
        const res = await h.submit({ edit, buffer: Buffer.from('<html>not a photo</html>'), fields: { imagem: '/img/old.jpg' } });
        assert.equal(res.status, 400);
        const data = await res.json();
        assert.ok(data.errors.imagem_arquivo);
        assert.ok(data.uploadNotice);
        assert.equal(data.values[edit ? 'nome_produto' : 'nome'], 'Pao');
        assert.equal(data.values.imagem, '/img/old.jpg');
        assert.equal(writes(h.calls).length, 0);
        assert.deepEqual(await fs.readdir(h.directory), []);
        if (!edit) assert.ok(h.calls.sql.some(({ sql }) => sql === 'ROLLBACK'));
    });

    test(`product upload HTTP ${operation}: size and file-count errors are friendly and never write`, async t => {
        const h = await appHarness(t);
        for (const options of [{ buffer: Buffer.alloc(images.MAX_BYTES + 1) }, { buffer: await sample(), duplicate: true }]) {
            const res = await h.submit({ edit, ...options });
            assert.equal(res.status, 400);
            const data = await res.json();
            assert.ok(data.errors.imagem_arquivo);
            assert.equal(data.values[edit ? 'nome_produto' : 'nome'], 'Pao');
        }
        assert.equal(writes(h.calls).length, 0);
        assert.deepEqual(await fs.readdir(h.directory), []);
    });

    test(`product upload HTTP ${operation}: invalid form preserves draft and requests file reselection without persisting`, async t => {
        const h = await appHarness(t);
        const res = await h.submit({ edit, buffer: await sample(), fields: { valor: '-1' } });
        assert.equal(res.status, 400);
        const data = await res.json();
        assert.ok(data.errors.valor);
        assert.ok(data.uploadNotice);
        assert.equal(data.values.valor, '-1');
        assert.equal(writes(h.calls).length, 0);
        assert.deepEqual(await fs.readdir(h.directory), []);
    });

    test(`product upload HTTP ${operation}: failed database write retains uploaded image in the retry draft`, async t => {
        const h = await appHarness(t, { failWrite: true });
        const res = await h.submit({ edit, buffer: await sample() });
        assert.equal(res.status, 503);
        const data = await res.json();
        assert.ok(data.formError);
        assert.match(data.values.imagem, /^\/uploads\/products\/.*\.webp$/);
        assert.equal(data.uploadNotice, '');
        const savedImage = await fetch(h.origin + data.values.imagem);
        assert.equal(savedImage.status, 200);
        await savedImage.arrayBuffer();
    });

    test(`product upload HTTP ${operation}: authentication is checked before parsing or persisting files`, async t => {
        const h = await appHarness(t, { unauthenticated: true });
        assert.equal((await h.submit({ edit, buffer: await sample() })).status, 401);
        assert.equal(h.calls.receive, 0);
        assert.equal(h.calls.sql.length, 0);
        assert.deepEqual(await fs.readdir(h.directory), []);
    });
}
