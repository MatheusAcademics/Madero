const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../routes/produtos.js'), 'utf8');
const validBody = {
    nome: 'Queijo', estoque: '2,50', estoque_minimo: '5', valor: '18,90',
    imagem: '/img/queijo.jpg', id_categoria: '4'
};

// Every database interaction is mocked. No records or PostgreSQL sequences are changed.
function harness({
    categories = [{ id_categoria: 4, nome: 'Ingredientes' }],
    category = { id_categoria: 4 }, user = { id_usuario: 9 }, failAt = [],
    failure = Object.assign(new Error('Private database diagnostic'), { code: 'TEST_DB_ERROR', detail: 'Sensitive values' })
} = {}) {
    const handlers = new Map();
    const calls = { pool: [], client: [], connects: 0, releases: [], errors: [], events: [] };
    const fails = new Set(failAt);
    const check = stage => { if (fails.has(stage)) throw failure; };
    const client = {
        async query(sql, values) {
            sql = sql.trim();
            calls.client.push({ sql, values: values ? Array.from(values) : [] });
            calls.events.push(sql);
            const stage = sql === 'BEGIN' ? 'begin' : sql === 'COMMIT' ? 'commit'
                : sql === 'ROLLBACK' ? 'rollback' : /^SELECT id_categoria/.test(sql) ? 'category'
                    : /^SELECT id_usuario/.test(sql) ? 'user' : /^INSERT INTO produtos/.test(sql) ? 'productInsert'
                        : /^INSERT INTO movimentacoes/.test(sql) ? 'movementInsert' : '';
            assert.ok(stage, 'Unexpected client query: ' + sql);
            check(stage);
            return { rows: stage === 'category' ? (category ? [category] : [])
                : stage === 'user' ? (user ? [user] : []) : stage === 'productInsert' ? [{ id_produto: 17 }] : [] };
        },
        release(error) { calls.releases.push(Boolean(error)); calls.events.push('RELEASE'); }
    };
    class FixedDate extends Date { constructor(...args) { super(...(args.length ? args : ['2026-10-02T12:30:00.000Z'])); } }
    vm.runInNewContext(source, {
        module: { exports: {} }, URL, Date: FixedDate,
        console: { error: (...args) => calls.errors.push(args), log() {} },
        require(name) {
            if (name === 'express') return { Router: () => ({
                get(route, handler) { handlers.set('GET ' + route, handler); },
                post(route, handler) { handlers.set('POST ' + route, handler); }
            }) };
            if (name === '../conexao') return {
                async connect() { calls.connects++; calls.events.push('CONNECT'); check('connect'); return client; },
                async query(sql, values) {
                    calls.pool.push({ sql, values: values ? Array.from(values) : [] });
                    calls.events.push('POOL');
                    assert.equal(sql, 'SELECT id_categoria, nome FROM categorias ORDER BY nome ASC, id_categoria ASC');
                    check('loadCategories');
                    return { rows: categories };
                }
            };
            throw new Error('Unexpected dependency: ' + name);
        }
    }, { filename: 'routes/produtos.js' });
    return {
        calls, handlers,
        async invoke(body = validBody, { method = 'POST', query = {}, session = { user: { id_usuario: 9 } } } = {}) {
            const res = {
                statusCode: 200,
                status(code) { this.statusCode = code; return this; },
                render(view, locals) { this.view = view; this.locals = JSON.parse(JSON.stringify(locals)); return this; },
                redirect(target) { this.statusCode = 302; this.location = target; return this; },
                send(text) { this.text = text; return this; }
            };
            await handlers.get(method + (method === 'GET' ? ' /novo_produto' : ' /cadastro'))({ body, query, session }, res);
            return res;
        }
    };
}

const sql = state => state.calls.client.map(call => call.sql);
const queryAt = (state, prefix) => state.calls.client.find(call => call.sql.startsWith(prefix));
const mutations = state => state.calls.client.filter(call => /^(INSERT|UPDATE|DELETE)\b/.test(call.sql));

test('product form: GET loads sorted category options and explicit empty defaults', async () => {
    const state = harness();
    const res = await state.invoke(undefined, { method: 'GET' });
    assert.equal(res.statusCode, 200);
    assert.equal(res.view, 'novo_produto');
    assert.equal(res.locals.mainClass, 'main-product-form');
    assert.deepEqual(res.locals.values, { nome: '', estoque: '0', estoque_minimo: '0', valor: '', imagem: '', id_categoria: '' });
    assert.deepEqual(res.locals.categorias, [{ id_categoria: 4, nome: 'Ingredientes' }]);
    assert.deepEqual(res.locals.errors, {});
    assert.equal(res.locals.formError, '');
    assert.equal(res.locals.loadError, '');
    assert.equal(res.locals.submitted, false);
    assert.equal(state.calls.pool.length, 1);
    assert.equal(state.calls.connects, 0);
});

test('product form: GET preselects only an existing normalized category ID', async () => {
    for (const [categoria, expected] of [['4', '4'], [' 004 ', '4'], ['5', ''], ['0', ''], ['-4', ''], ['4 OR 1=1', ''], ['2147483648', ''], [['4'], ''], [null, '']]) {
        const state = harness();
        const res = await state.invoke(undefined, { method: 'GET', query: { categoria } });
        assert.equal(res.locals.values.id_categoria, expected);
        assert.equal(state.calls.pool.length, 1);
    }
});

test('product form: no categories and unavailable categories are distinct states', async () => {
    const empty = await harness({ categories: [] }).invoke(undefined, { method: 'GET' });
    assert.equal(empty.statusCode, 200);
    assert.deepEqual(empty.locals.categorias, []);
    assert.equal(empty.locals.loadError, '');
    const unavailable = await harness({ failAt: ['loadCategories'] }).invoke(undefined, { method: 'GET' });
    assert.equal(unavailable.statusCode, 503);
    assert.deepEqual(unavailable.locals.categorias, []);
    assert.ok(unavailable.locals.loadError);
    assert.doesNotMatch(unavailable.locals.loadError, /Private|Sensitive|TEST_DB_ERROR/);
});

test('product form: invalid sessions fail before any query or product insertion', async () => {
    for (const session of [null, {}, { user: null }, { user: {} }, ...[0, -1, 1.5, '1e2', '2147483648', [9], {}].map(id_usuario => ({ user: { id_usuario } }))]) {
        for (const method of ['GET', 'POST']) {
            const state = harness();
            const res = await state.invoke(validBody, { method, session });
            assert.equal(res.statusCode, 401);
            assert.equal(state.calls.pool.length, 0);
            assert.equal(state.calls.connects, 0);
            assert.equal(state.calls.client.length, 0);
        }
    }
});

test('product form: missing and non-string fields yield correction errors without writes', async () => {
    for (const body of [null, {}, Object.fromEntries(Object.keys(validBody).map(key => [key, ['unexpected']])), Object.fromEntries(Object.keys(validBody).map(key => [key, {}]))]) {
        const state = harness();
        const res = await state.invoke(body);
        assert.equal(res.statusCode, 400);
        for (const field of ['nome', 'estoque', 'estoque_minimo', 'valor', 'id_categoria']) assert.ok(res.locals.errors[field]);
        assert.deepEqual(res.locals.values, Object.fromEntries(Object.keys(validBody).map(key => [key, ''])));
        assert.equal(res.locals.submitted, true);
        assert.equal(state.calls.connects, 0);
        assert.equal(mutations(state).length, 0);
    }
});

test('product form: names are trimmed and capped without truncating the correction draft', async () => {
    for (const nome of ['', '   ', 'é'.repeat(101)]) {
        const state = harness();
        const res = await state.invoke({ ...validBody, nome });
        assert.equal(res.statusCode, 400);
        assert.ok(res.locals.errors.nome);
        assert.equal(res.locals.values.nome, nome.trim());
        assert.equal(state.calls.connects, 0);
    }
    const state = harness();
    assert.equal((await state.invoke({ ...validBody, nome: '  ' + 'é'.repeat(100) + '  ' })).statusCode, 302);
    assert.equal(queryAt(state, 'INSERT INTO produtos').values[0], 'é'.repeat(100));
});

test('product form: every numeric field rejects negatives, exponents, grouping, overflow and rounding', async () => {
    for (const field of ['estoque', 'estoque_minimo', 'valor']) {
        for (const value of ['', '-0', '-1', '+1', '1e2', 'NaN', 'Infinity', '.25', ',25', '1.', '1,', '0.001', '0,001', '10.000,00', '10,000.00', '10000000000', '9999999999.999', '2 OR 1=1', 2, null, ['2']]) {
            const state = harness();
            const res = await state.invoke({ ...validBody, [field]: value });
            assert.equal(res.statusCode, 400, field + ': ' + value);
            assert.ok(res.locals.errors[field]);
            assert.equal(state.calls.connects, 0);
            assert.equal(mutations(state).length, 0);
        }
    }
});

test('product form: comma and point decimals normalize exactly within NUMERIC(12,2) bounds', async () => {
    for (const [value, normalized] of [['0', '0'], ['0,00', '0.00'], ['0.01', '0.01'], ['1,2', '1.2'], ['001.50', '1.50'], ['9999999999,99', '9999999999.99']]) {
        const state = harness();
        const res = await state.invoke({ ...validBody, estoque: value, estoque_minimo: value, valor: value });
        assert.equal(res.statusCode, 302);
        assert.deepEqual(queryAt(state, 'INSERT INTO produtos').values.slice(1, 4), [normalized, normalized, normalized]);
        assert.equal(queryAt(state, 'INSERT INTO movimentacoes').values[2], normalized);
    }
});

test('product form: category IDs must be positive PostgreSQL integers before opening a transaction', async () => {
    for (const id_categoria of ['', '0', '-1', '1.5', '1e2', '2147483648', '4 OR 1=1', ['4']]) {
        const state = harness();
        const res = await state.invoke({ ...validBody, id_categoria });
        assert.equal(res.statusCode, 400);
        assert.ok(res.locals.errors.id_categoria);
        assert.equal(state.calls.connects, 0);
    }
    const state = harness();
    await state.invoke({ ...validBody, id_categoria: '004' });
    assert.deepEqual(queryAt(state, 'SELECT id_categoria').values, [4]);
});

test('product form: images may be omitted, safe local paths or http(s) without server fetching', async () => {
    for (const imagem of [undefined, '', '/img/queijo.jpg', '/img/queijo%20fresco.jpg', 'https://example.test/pao.jpg?size=600', 'http://example.test/pao.jpg', 'HTTPS://example.test/pao.jpg']) {
        const state = harness();
        const res = await state.invoke({ ...validBody, imagem });
        assert.equal(res.statusCode, 302, imagem);
        assert.equal(queryAt(state, 'INSERT INTO produtos').values[4], imagem || '');
        assert.equal(state.calls.pool.length, 0);
    }
    assert.doesNotMatch(source.slice(0, source.indexOf("router.get('/listar'")), /\bfetch\(|https?\.get\(|axios/);
});

test('product form: unsafe images and malformed URL types are rejected and strings retained', async () => {
    for (const imagem of ['javascript:alert(1)', 'data:image/svg+xml,<svg/>', 'file:///image.jpg', '//example.test/a.jpg', '/\\example.test/a.jpg', '/%2fexample.test/a.jpg', '/%5cexample.test/a.jpg', '/img/a%00.jpg', 'https://example.test/a\n.jpg', 'https://example.test/a b.jpg', 'https://user:password@example.test/a.jpg', 'https:example.test/a.jpg', 'https://', '/bad%zz.jpg', '/img/' + 'a'.repeat(2048), ['a'], {}]) {
        const state = harness();
        const res = await state.invoke({ ...validBody, imagem });
        assert.equal(res.statusCode, 400, String(imagem));
        assert.ok(res.locals.errors.imagem);
        assert.equal(res.locals.values.imagem, typeof imagem === 'string' ? imagem.trim() : '');
        assert.equal(state.calls.connects, 0);
    }
});

test('product form: success registers product and its opening entry on exactly one transaction client', async () => {
    const state = harness();
    const res = await state.invoke(validBody);
    assert.equal(res.statusCode, 302);
    assert.equal(state.calls.connects, 1);
    assert.equal(state.calls.pool.length, 0);
    assert.deepEqual(sql(state).map(statement => statement.split(/\s+/).slice(0, 3).join(' ')), [
        'BEGIN', 'SELECT id_categoria FROM', 'SELECT id_usuario FROM', 'INSERT INTO produtos', 'INSERT INTO movimentacoes', 'COMMIT'
    ]);
    assert.match(queryAt(state, 'SELECT id_categoria').sql, /WHERE id_categoria = \$1 FOR KEY SHARE$/);
    assert.match(queryAt(state, 'SELECT id_usuario').sql, /WHERE id_usuario = \$1 FOR KEY SHARE$/);
    assert.deepEqual(queryAt(state, 'INSERT INTO produtos').values, ['Queijo', '2.50', '5', '18.90', '/img/queijo.jpg', 4]);
    const movement = queryAt(state, 'INSERT INTO movimentacoes').values;
    assert.equal(movement[0], 'Entrada');
    assert.equal(movement[1].toISOString(), '2026-10-02T12:30:00.000Z');
    assert.deepEqual(movement.slice(2), ['2.50', 'Entrada de produto novo', 17, 9]);
    assert.deepEqual(state.calls.releases, [false]);
    assert.equal(state.calls.events.at(-1), 'RELEASE');
    assert.equal(res.location, '/produtos/listar?mensagem=' + encodeURIComponent('Produto criado com sucesso e movimentação de entrada registrada!'));
});

test('product form: zero initial stock still records its initial entry and no unit is invented', async () => {
    const state = harness();
    const res = await state.invoke({ ...validBody, estoque: '0', estoque_minimo: '0', valor: '0' });
    assert.equal(res.statusCode, 302);
    assert.equal(queryAt(state, 'INSERT INTO produtos').values[1], '0');
    assert.equal(queryAt(state, 'INSERT INTO movimentacoes').values[2], '0');
    assert.equal(mutations(state).length, 2);
    for (const query of state.calls.client) assert.doesNotMatch(query.sql, /\bunidade\b/);
});

test('product form: authenticated user owns opening movement, never a submitted user field', async () => {
    const state = harness();
    await state.invoke({ ...validBody, id_usuario: '100' }, { session: { user: { id_usuario: '009' } } });
    assert.deepEqual(queryAt(state, 'SELECT id_usuario').values, [9]);
    assert.equal(queryAt(state, 'INSERT INTO movimentacoes').values[5], 9);
});

test('product form: deleted category and stale session abort before either insertion', async () => {
    for (const [config, status] of [[{ category: null }, 400], [{ user: null }, 401], [{ category: null, user: null }, 401]]) {
        const state = harness(config);
        const res = await state.invoke(validBody);
        assert.equal(res.statusCode, status);
        assert.deepEqual(res.locals.values, validBody);
        if (config.category === null) assert.ok(res.locals.errors.id_categoria);
        if (config.user === null) assert.ok(res.locals.formError);
        assert.equal(mutations(state).length, 0);
        assert.equal(sql(state).at(-1), 'ROLLBACK');
        assert.deepEqual(state.calls.releases, [false]);
        assert.ok(state.calls.events.indexOf('RELEASE') < state.calls.events.indexOf('POOL'));
    }
});

test('product form: SQL and HTML input remain parameters rather than query content', async () => {
    const nome = "  Queijo'); DROP TABLE produtos; -- <script>x</script>  ";
    const state = harness();
    const res = await state.invoke({ ...validBody, nome });
    assert.equal(res.statusCode, 302);
    assert.equal(queryAt(state, 'INSERT INTO produtos').values[0], nome.trim());
    for (const query of state.calls.client) assert.doesNotMatch(query.sql, /DROP TABLE|script|Queijo/);
});

test('product form: connection and transaction failures preserve draft, rollback and release safely', async () => {
    for (const stage of ['connect', 'begin', 'category', 'user', 'productInsert', 'movementInsert', 'commit']) {
        const state = harness({ failAt: [stage] });
        const res = await state.invoke(validBody);
        assert.equal(res.statusCode, 503, stage);
        assert.deepEqual(res.locals.values, validBody);
        assert.equal(res.locals.submitted, true);
        assert.ok(res.locals.formError);
        assert.doesNotMatch(JSON.stringify(res.locals), /Private|Sensitive|TEST_DB_ERROR/);
        assert.doesNotMatch(JSON.stringify(state.calls.errors), /Private|Sensitive/);
        if (stage === 'connect') assert.deepEqual(state.calls.releases, []);
        else assert.deepEqual(state.calls.releases, [true]);
        if (!['connect', 'begin'].includes(stage)) assert.equal(sql(state).at(-1), 'ROLLBACK');
        if (stage === 'movementInsert') assert.equal(sql(state).filter(q => q === 'COMMIT').length, 0);
    }
});

test('product form: rollback failure still releases damaged connection and returns a useful draft', async () => {
    const state = harness({ failAt: ['movementInsert', 'rollback'] });
    const res = await state.invoke(validBody);
    assert.equal(res.statusCode, 503);
    assert.deepEqual(res.locals.values, validBody);
    assert.deepEqual(state.calls.releases, [true]);
    assert.equal(state.calls.errors.length, 2);
    assert.equal(state.calls.events.at(-1), 'POOL');
});

test('product form: concurrent category constraint rejection becomes a correction error after rollback', async () => {
    const state = harness({ failAt: ['productInsert'], failure: Object.assign(new Error('Private'), { code: '23503', constraint: 'produtos_id_categoria_fkey' }) });
    const res = await state.invoke(validBody);
    assert.equal(res.statusCode, 400);
    assert.ok(res.locals.errors.id_categoria);
    assert.equal(res.locals.formError, '');
    assert.deepEqual(res.locals.values, validBody);
    assert.equal(sql(state).at(-1), 'ROLLBACK');
    assert.equal(queryAt(state, 'INSERT INTO movimentacoes'), undefined);
    assert.deepEqual(state.calls.releases, [true]);
});

test('product form: category reload failure preserves draft and field errors rather than fake empty success', async () => {
    const state = harness({ failAt: ['loadCategories'] });
    const res = await state.invoke({ ...validBody, nome: 'a'.repeat(101) });
    assert.equal(res.statusCode, 503);
    assert.deepEqual(res.locals.values, { ...validBody, nome: 'a'.repeat(101) });
    assert.ok(res.locals.errors.nome);
    assert.ok(res.locals.loadError);
    assert.deepEqual(res.locals.categorias, []);
    assert.equal(state.calls.connects, 0);
});

test('product form: existing product endpoints and session protection remain available', () => {
    const state = harness();
    for (const route of ['GET /novo_produto', 'POST /cadastro', 'GET /listar', 'POST /pesquisar', 'GET /alterar/:id_produto', 'POST /alterar/:id_produto', 'POST /excluir/:id_produto']) {
        assert.equal(typeof state.handlers.get(route), 'function', route);
    }
    const app = fs.readFileSync(path.join(__dirname, '../app.js'), 'utf8');
    assert.match(app, /app\.use\('\/produtos', verificaUsuario, rota_produto\)/);
});
