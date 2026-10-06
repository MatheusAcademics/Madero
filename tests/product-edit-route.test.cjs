const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../routes/produtos.js'), 'utf8');
const original = { id_produto: 17, nome_produto: 'Queijo', estoque: '12.50', estoque_minimo: '3.00', valor: '18.90', imagem: '/img/queijo.jpg', id_categoria: 4, nome_categoria: 'Ingredientes' };
const validBody = { nome_produto: 'Queijo fresco', estoque_minimo: '5,50', valor: '20,90', imagem: '/img/fresco.jpg', id_categoria: '4' };

// All SQL is mocked. These tests do not touch real records, balances or sequences.
function harness({ product = original, categories = [{ id_categoria: 4, nome: 'Ingredientes' }], updated = [{ id_produto: 17 }], failAt = '', failure = Object.assign(new Error('Private database diagnostic'), { code: 'TEST_DB_ERROR', detail: 'Sensitive values' }) } = {}) {
    const handlers = new Map();
    const calls = [];
    const errors = [];
    vm.runInNewContext(source, {
        module: { exports: {} }, URL, console: { error: (...args) => errors.push(args), log() {} },
        require(name) {
            if (name === 'express') return { Router: () => ({
                get(route, handler) { handlers.set('GET ' + route, handler); },
                post(route, handler) { handlers.set('POST ' + route, handler); }
            }) };
            if (name === '../conexao') return {
                async query(sql, values) {
                    sql = sql.trim();
                    const stage = /^UPDATE produtos\b/.test(sql) ? 'update'
                        : /^SELECT\b/.test(sql) && /\bFROM produtos\b/.test(sql) ? 'product'
                            : /^SELECT\b/.test(sql) && /\bFROM categorias\b/.test(sql) ? 'categories' : '';
                    calls.push({ sql, values: values ? Array.from(values) : [], stage });
                    assert.ok(stage, 'Unexpected SQL: ' + sql);
                    if (stage === failAt) throw failure;
                    return { rows: stage === 'product' ? (product ? [product] : []) : stage === 'categories' ? categories : updated };
                },
                connect() { assert.fail('Editing metadata does not create a transaction or opening movement.'); }
            };
            throw new Error('Unexpected dependency: ' + name);
        }
    }, { filename: 'routes/produtos.js' });
    return {
        calls, errors, handlers,
        async invoke({ method = 'POST', id = '17', body = validBody, session = { user: { id_usuario: 9 } } } = {}) {
            const res = {
                statusCode: 200,
                status(code) { this.statusCode = code; return this; },
                render(view, locals) { this.view = view; this.locals = JSON.parse(JSON.stringify(locals)); return this; },
                redirect(location) { this.statusCode = 302; this.location = location; return this; },
                send(text) { this.text = text; return this; }
            };
            await handlers.get(method + ' /alterar/:id_produto')({ params: { id_produto: id }, body, session }, res);
            return res;
        }
    };
}

const mutations = state => state.calls.filter(call => /^(INSERT|UPDATE|DELETE)\b/.test(call.sql));
const update = state => state.calls.find(call => call.stage === 'update');

test('product edit route: GET returns original product, sorted categories and explicit editable values', async () => {
    const state = harness();
    const res = await state.invoke({ method: 'GET' });
    assert.equal(res.statusCode, 200);
    assert.equal(res.view, 'alterar_produto');
    assert.equal(res.locals.mainClass, 'main-product-edit');
    assert.equal(res.locals.productId, '17');
    assert.deepEqual(res.locals.produto, original);
    assert.deepEqual(res.locals.values, { nome_produto: 'Queijo', estoque_minimo: '3.00', valor: '18.90', imagem: '/img/queijo.jpg', id_categoria: '4' });
    assert.deepEqual(res.locals.errors, {});
    assert.equal(res.locals.formError, '');
    assert.equal(res.locals.loadError, '');
    assert.equal(res.locals.submitted, false);
    assert.equal(res.locals.notFound, false);
    assert.match(state.calls.find(call => call.stage === 'product').sql, /LEFT JOIN categorias/);
    assert.match(state.calls.find(call => call.stage === 'categories').sql, /ORDER BY nome ASC, id_categoria ASC/);
    assert.equal(mutations(state).length, 0);
});

test('product edit route: malformed product IDs return a styled 404 without any SQL', async () => {
    for (const id of ['', '0', '-1', '1.5', '1e2', '2147483648', '17 OR 1=1', ['17'], null]) {
        for (const method of ['GET', 'POST']) {
            const state = harness();
            const res = await state.invoke({ method, id });
            assert.equal(res.statusCode, 404, method + ': ' + id);
            assert.equal(res.view, 'alterar_produto');
            assert.equal(res.locals.notFound, true);
            assert.equal(res.locals.produto, null);
            assert.equal(state.calls.length, 0);
        }
    }
});

test('product edit route: missing record is distinct from a database error on both methods', async () => {
    for (const method of ['GET', 'POST']) {
        const state = harness({ product: null });
        const res = await state.invoke({ method });
        assert.equal(res.statusCode, 404);
        assert.equal(res.locals.notFound, true);
        assert.equal(res.locals.produto, null);
        assert.equal(res.locals.loadError, '');
        assert.equal(mutations(state).length, 0);
    }
});

test('product edit route: database load failures return styled 503 without exposing diagnostics', async () => {
    for (const failAt of ['product', 'categories']) {
        for (const method of ['GET', 'POST']) {
            const state = harness({ failAt });
            const res = await state.invoke({ method });
            assert.equal(res.statusCode, 503, method + ': ' + failAt);
            assert.equal(res.view, 'alterar_produto');
            assert.equal(res.locals.notFound, false);
            assert.ok(res.locals.loadError || res.locals.formError);
            assert.doesNotMatch(JSON.stringify(res.locals), /Private|Sensitive|TEST_DB_ERROR/);
            assert.doesNotMatch(JSON.stringify(state.errors), /Private|Sensitive/);
            assert.equal(mutations(state).length, 0);
            if (method === 'POST') {
                assert.deepEqual(res.locals.values, validBody);
                assert.equal(res.locals.submitted, true);
            }
        }
    }
});

test('product edit route: invalid POST sessions are rejected before reading or updating records', async () => {
    for (const session of [null, {}, { user: null }, { user: {} }, ...[0, -1, 1.5, '1e2', '2147483648', [9], {}].map(id_usuario => ({ user: { id_usuario } }))]) {
        const state = harness();
        const res = await state.invoke({ session });
        assert.equal(res.statusCode, 401);
        assert.equal(state.calls.length, 0);
    }
});

test('product edit route: missing and non-string fields preserve an editable invalid draft', async () => {
    for (const body of [null, {}, Object.fromEntries(Object.keys(validBody).map(key => [key, ['unexpected']]))]) {
        const state = harness();
        const res = await state.invoke({ body });
        assert.equal(res.statusCode, 400);
        assert.equal(res.locals.submitted, true);
        assert.deepEqual(res.locals.values, Object.fromEntries(Object.keys(validBody).map(key => [key, ''])));
        for (const field of ['nome_produto', 'estoque_minimo', 'valor', 'id_categoria']) assert.ok(res.locals.errors[field]);
        assert.equal(mutations(state).length, 0);
    }
});

test('product edit route: blank or overlong names are not saved or silently truncated', async () => {
    for (const nome_produto of ['', '  ', 'é'.repeat(101)]) {
        const state = harness();
        const res = await state.invoke({ body: { ...validBody, nome_produto } });
        assert.equal(res.statusCode, 400);
        assert.ok(res.locals.errors.nome_produto);
        assert.equal(res.locals.values.nome_produto, nome_produto.trim());
        assert.equal(mutations(state).length, 0);
    }
    const state = harness();
    assert.equal((await state.invoke({ body: { ...validBody, nome_produto: '  ' + 'é'.repeat(100) + '  ' } })).statusCode, 302);
    assert.ok(update(state).values.includes('é'.repeat(100)));
});

test('product edit route: decimal validation rejects overflow, rounding, negatives and expressions', async () => {
    for (const field of ['estoque_minimo', 'valor']) {
        for (const value of ['', '-1', '+1', '1e2', 'NaN', 'Infinity', '.25', '1.', '0.001', '0,001', '10.000,00', '10000000000', '9999999999.999', '2 OR 1=1', 2, null, ['2']]) {
            const state = harness();
            const res = await state.invoke({ body: { ...validBody, [field]: value } });
            assert.equal(res.statusCode, 400, field + ': ' + value);
            assert.ok(res.locals.errors[field]);
            assert.equal(mutations(state).length, 0);
        }
    }
});

test('product edit route: comma and point normalize exactly without floating-point arithmetic', async () => {
    for (const [value, normalized] of [['0', '0'], ['0,00', '0.00'], ['0.01', '0.01'], ['1,2', '1.2'], ['001.50', '1.50'], ['9999999999,99', '9999999999.99']]) {
        const state = harness();
        const res = await state.invoke({ body: { ...validBody, estoque_minimo: value, valor: value } });
        assert.equal(res.statusCode, 302);
        assert.equal(update(state).values.filter(item => item === normalized).length, 2);
    }
});

test('product edit route: category must be a valid positive integer and exist in loaded options', async () => {
    for (const id_categoria of ['', '0', '-1', '1.5', '1e2', '2147483648', '4 OR 1=1', ['4'], '999']) {
        const state = harness();
        const res = await state.invoke({ body: { ...validBody, id_categoria } });
        assert.equal(res.statusCode, 400);
        assert.ok(res.locals.errors.id_categoria);
        assert.equal(mutations(state).length, 0);
    }
});

test('product edit route: optional safe images are stored as parameters without fetching', async () => {
    for (const imagem of [undefined, '', '/img/queijo.jpg', '/img/queijo%20fresco.jpg', 'https://example.test/pao.jpg?size=600', 'http://example.test/pao.jpg']) {
        const state = harness();
        const res = await state.invoke({ body: { ...validBody, imagem } });
        assert.equal(res.statusCode, 302, imagem);
        assert.ok(update(state).values.includes(imagem || ''));
    }
});

test('product edit route: unsafe image URLs, credentials and malformed URL types cannot be saved', async () => {
    for (const imagem of ['javascript:alert(1)', 'data:image/svg+xml,<svg/>', '//example.test/a.jpg', '/\\example.test/a.jpg', '/%2fexample.test/a.jpg', '/%5cexample.test/a.jpg', '/img/a%00.jpg', 'https://example.test/a\n.jpg', 'https://user:password@example.test/a.jpg', 'https:example.test/a.jpg', '/bad%zz.jpg', '/img/' + 'a'.repeat(2048), ['a'], {}]) {
        const state = harness();
        const res = await state.invoke({ body: { ...validBody, imagem } });
        assert.equal(res.statusCode, 400, String(imagem));
        assert.ok(res.locals.errors.imagem);
        assert.equal(res.locals.values.imagem, typeof imagem === 'string' ? imagem.trim() : '');
        assert.equal(mutations(state).length, 0);
    }
});

test('product edit route: success makes one parameterized metadata update and keeps stock untouched', async () => {
    const state = harness();
    const res = await state.invoke({ id: '0017', body: { ...validBody, estoque: '9999999999', id_usuario: '100', id_produto: '99' } });
    assert.equal(res.statusCode, 302);
    assert.equal(res.location, '/produtos/listar?mensagem=' + encodeURIComponent('Produto alterado com sucesso!'));
    assert.equal(mutations(state).length, 1);
    const query = update(state);
    assert.match(query.sql, /RETURNING\s+(?:produtos\.)?id_produto/i);
    assert.doesNotMatch(query.sql, /\bestoque\s*=|movimentacoes|\bINSERT\b|\bDELETE\b/);
    for (const value of ['Queijo fresco', '5.50', '20.90', '/img/fresco.jpg', 4, 17]) assert.ok(query.values.includes(value), String(value));
    assert.equal(query.values.length, 6);
    assert.equal(query.values.includes('9999999999'), false);
    assert.equal(query.values.includes('100'), false);
    assert.doesNotMatch(query.sql, /Queijo|fresco|20\.90/);
});

test('product edit route: SQL-looking names are data, not query syntax', async () => {
    const nome_produto = "  Queijo'); DROP TABLE produtos; -- <script>x</script>  ";
    const state = harness();
    assert.equal((await state.invoke({ body: { ...validBody, nome_produto } })).statusCode, 302);
    assert.ok(update(state).values.includes(nome_produto.trim()));
    for (const query of state.calls) assert.doesNotMatch(query.sql, /DROP TABLE|script|Queijo/);
});

test('product edit route: a row removed between loading and saving returns 404 rather than success', async () => {
    const state = harness({ updated: [] });
    const res = await state.invoke();
    assert.equal(res.statusCode, 404);
    assert.equal(res.locals.notFound, true);
    assert.equal(res.location, undefined);
});

test('product edit route: category foreign-key race becomes an actionable field error', async () => {
    const state = harness({ failAt: 'update', failure: Object.assign(new Error('Private'), { code: '23503', constraint: 'produtos_id_categoria_fkey' }) });
    const res = await state.invoke();
    assert.equal(res.statusCode, 400);
    assert.ok(res.locals.errors.id_categoria);
    assert.deepEqual(res.locals.values, validBody);
    assert.equal(res.locals.submitted, true);
    assert.equal(res.location, undefined);
});

test('product edit route: update failure retains every field and original stock in a generic 503', async () => {
    const state = harness({ failAt: 'update' });
    const res = await state.invoke();
    assert.equal(res.statusCode, 503);
    assert.ok(res.locals.formError);
    assert.deepEqual(res.locals.values, validBody);
    assert.equal(res.locals.produto.estoque, '12.50');
    assert.equal(res.locals.submitted, true);
    assert.doesNotMatch(JSON.stringify(res.locals), /Private|Sensitive|TEST_DB_ERROR/);
    assert.doesNotMatch(JSON.stringify(state.errors), /Private|Sensitive/);
    assert.equal(res.location, undefined);
});

test('product edit route: null legacy values remain missing instead of fabricated zeros', async () => {
    const state = harness({ product: { ...original, estoque: null, estoque_minimo: null, valor: null, imagem: null, id_categoria: null, nome_categoria: null } });
    const res = await state.invoke({ method: 'GET' });
    assert.equal(res.statusCode, 200);
    assert.equal(res.locals.produto.estoque, null);
    assert.deepEqual(res.locals.values, { nome_produto: 'Queijo', estoque_minimo: '', valor: '', imagem: '', id_categoria: '' });
    assert.equal(mutations(state).length, 0);
});

test('product edit route: existing endpoints and router authentication remain available', () => {
    const state = harness();
    for (const route of ['GET /novo_produto', 'POST /cadastro', 'GET /listar', 'POST /pesquisar', 'GET /alterar/:id_produto', 'POST /alterar/:id_produto', 'POST /excluir/:id_produto']) assert.equal(typeof state.handlers.get(route), 'function');
    assert.match(fs.readFileSync(path.join(__dirname, '../app.js'), 'utf8'), /app\.use\('\/produtos', verificaUsuario, rota_produto\)/);
});
