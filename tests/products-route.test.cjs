const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../routes/produtos.js'), 'utf8');

// Listing tests never open the database or invoke a mutation endpoint.
function harness({ categories = [], summary = {}, total = 0, products = [], failAt = -1 } = {}) {
    const handlers = new Map();
    const calls = { queries: [], errors: [] };
    const rows = [categories, [{ total: '0', below_minimum: '0', non_positive: '0', ...summary }], [{ total: String(total) }], products];
    const router = {
        get(route, callback) { handlers.set('GET ' + route, callback); },
        post(route, callback) { handlers.set('POST ' + route, callback); }
    };
    vm.runInNewContext(source, {
        module: { exports: {} },
        console: { error: (...args) => calls.errors.push(args), log() {} },
        require(name) {
            if (name === 'express') return { Router: () => router };
            if (name === '../conexao') return {
                async query(sql, values) {
                    const index = calls.queries.length;
                    calls.queries.push({ sql, values: values ? Array.from(values) : [] });
                    if (index === failAt) throw new Error('Private database diagnostic');
                    return { rows: rows[index] || [] };
                }
            };
            throw new Error('Unexpected dependency: ' + name);
        }
    }, { filename: 'routes/produtos.js' });
    return {
        calls, handlers,
        async invoke(query = {}, { method = 'GET', route = '/listar', body = {} } = {}) {
            const response = {
                statusCode: 200,
                status(code) { this.statusCode = code; return this; },
                render(view, locals) { this.view = view; this.locals = JSON.parse(JSON.stringify(locals)); return this; },
                redirect(target) { this.statusCode = 302; this.location = target; return this; }
            };
            await handlers.get(method + ' ' + route)({ query, body }, response);
            return response;
        }
    };
}

test('products list: empty database uses the isolated product layout and honest totals', async () => {
    const state = harness();
    const response = await state.invoke();
    assert.equal(response.statusCode, 200);
    assert.equal(response.view, 'produto');
    assert.deepEqual(response.locals, {
        mainClass: 'main-products', produtos: [], categorias: [],
        filters: { q: '', categoria: '', status: 'todos', ordem: 'nome' },
        pagination: { page: 1, pageSize: 20, total: 0, totalPages: 1 },
        mensagem: '', noticeType: 'success', productsError: null,
        summary: { total: 0, belowMinimum: 0, nonPositive: 0 }
    });
    assert.equal(state.calls.queries.length, 4);
});

test('products list: rows, decimal and negative balances, images, and uncategorized products survive unchanged', async () => {
    const products = [
        { id_produto: 1, nome_produto: 'Queijo', estoque: '2.50', estoque_minimo: '5.00', valor: '18.90', imagem: '/img/queijo.jpg', id_categoria: 4, nome_categoria: 'Ingredientes' },
        { id_produto: 2, nome_produto: 'Caixa', estoque: '-1.25', estoque_minimo: '0', valor: '0', imagem: '', id_categoria: null, nome_categoria: null }
    ];
    const categories = [{ id_categoria: 4, nome: 'Ingredientes' }, { id_categoria: 9, nome: 'Categoria sem produtos' }];
    const state = harness({ products, categories, total: 2, summary: { total: '2', below_minimum: '2', non_positive: '1' } });
    const response = await state.invoke();
    assert.deepEqual(response.locals.produtos, products);
    assert.deepEqual(response.locals.categorias, categories);
    assert.deepEqual(response.locals.summary, { total: 2, belowMinimum: 2, nonPositive: 1 });
    assert.match(state.calls.queries[3].sql, /LEFT JOIN categorias/);
    assert.match(state.calls.queries[3].sql, /produtos\.id_categoria/);
    assert.match(state.calls.queries[0].sql, /ORDER BY nome ASC, id_categoria ASC/);
});

test('products list: search and category are parameterized while global summary stays unfiltered', async () => {
    const q = "Queijo'; DROP TABLE produtos; --";
    const state = harness({ total: 47, summary: { total: '120', below_minimum: '9', non_positive: '2' } });
    const response = await state.invoke({ q, categoria: '004', status: 'repor', ordem: 'saldo', pagina: '2' });
    assert.deepEqual(response.locals.filters, { q, categoria: '4', status: 'repor', ordem: 'saldo' });
    assert.deepEqual(response.locals.pagination, { page: 2, pageSize: 20, total: 47, totalPages: 3 });
    assert.deepEqual(response.locals.summary, { total: 120, belowMinimum: 9, nonPositive: 2 });
    assert.deepEqual(state.calls.queries[2].values, ['%' + q + '%', 4]);
    assert.deepEqual(state.calls.queries[3].values, ['%' + q + '%', 4, 20, 20]);
    for (const index of [2, 3]) {
        assert.match(state.calls.queries[index].sql, /produtos\.nome ILIKE \$1 OR produtos\.id_produto::text ILIKE \$1/);
        assert.match(state.calls.queries[index].sql, /produtos\.id_categoria = \$2/);
        assert.match(state.calls.queries[index].sql, /produtos\.estoque < produtos\.estoque_minimo/);
        assert.doesNotMatch(state.calls.queries[index].sql, /DROP TABLE|Queijo/);
    }
    assert.deepEqual(state.calls.queries[1].values, []);
    assert.doesNotMatch(state.calls.queries[1].sql, /ILIKE|id_categoria =/);
});

test('products list: SQL wildcard characters in a search are treated as literal text', async () => {
    const state = harness();
    await state.invoke({ q: '  50%_\\  ' });
    assert.deepEqual(state.calls.queries[2].values, ['%50\\%\\_\\\\%']);
    assert.deepEqual(state.calls.queries[3].values, ['%50\\%\\_\\\\%', 20, 0]);
});

test('products list: valid sort options have deterministic ordering and bound pagination', async () => {
    const sorts = {
        nome: 'produtos.nome ASC, produtos.id_produto ASC',
        'nome-desc': 'produtos.nome DESC, produtos.id_produto ASC',
        saldo: 'produtos.estoque ASC NULLS LAST, produtos.nome ASC, produtos.id_produto ASC',
        valor: 'produtos.valor DESC NULLS LAST, produtos.nome ASC, produtos.id_produto ASC',
        recentes: 'produtos.id_produto DESC'
    };
    for (const [ordem, sql] of Object.entries(sorts)) {
        const state = harness({ total: 21 });
        const response = await state.invoke({ ordem, pagina: '2' });
        assert.equal(response.locals.filters.ordem, ordem);
        assert.ok(state.calls.queries[3].sql.includes('ORDER BY ' + sql));
        assert.match(state.calls.queries[3].sql, /LIMIT \$1 OFFSET \$2/);
        assert.deepEqual(state.calls.queries[3].values, [20, 20]);
    }
});

test('products list: replenishment is strict, but no-balance includes zero independently of the minimum', async () => {
    const state = harness();
    await state.invoke({ status: 'sem-saldo' });
    for (const index of [2, 3]) {
        assert.match(state.calls.queries[index].sql, /produtos\.estoque <= 0/);
        assert.doesNotMatch(state.calls.queries[index].sql, /produtos\.estoque < produtos\.estoque_minimo/);
    }
    assert.match(state.calls.queries[1].sql, /COUNT\(\*\) FILTER \(WHERE estoque < estoque_minimo\) AS below_minimum/);
    assert.match(state.calls.queries[1].sql, /COUNT\(\*\) FILTER \(WHERE estoque <= 0\) AS non_positive/);
    assert.doesNotMatch(state.calls.queries[1].sql, /estoque <= estoque_minimo/);
});

test('products list: out-of-range pages clamp to existing results without overflow', async () => {
    for (const [total, page, offset] of [[0, 1, 0], [20, 1, 0], [21, 2, 20], [60, 3, 40]]) {
        const state = harness({ total });
        const response = await state.invoke({ pagina: String(Number.MAX_SAFE_INTEGER) });
        assert.equal(response.locals.pagination.page, page);
        assert.equal(response.locals.pagination.totalPages, page);
        assert.deepEqual(state.calls.queries[3].values, [20, offset]);
    }
});

test('products list: malformed arrays, objects and injected sort/status values fall back safely', async () => {
    for (const query of [
        { q: ['a', 'b'], categoria: {}, status: ['repor'], ordem: {}, pagina: ['2'], mensagem: {} },
        { categoria: '1 OR 1=1', status: 'repor; DROP TABLE produtos', ordem: '__proto__', pagina: '-2' },
        { categoria: '2147483648', status: 'constructor', ordem: 'constructor', pagina: 'Infinity' },
        { categoria: '-1', status: 'toString', ordem: 'nome; DROP TABLE produtos', pagina: '1.5' },
        { categoria: '0', pagina: '9007199254740992' }
    ]) {
        const state = harness();
        const response = await state.invoke(query);
        assert.deepEqual(response.locals.filters, { q: '', categoria: '', status: 'todos', ordem: 'nome' });
        assert.equal(response.locals.pagination.page, 1);
        assert.equal(response.locals.mensagem, '');
        assert.deepEqual(state.calls.queries[3].values, [20, 0]);
        assert.match(state.calls.queries[3].sql, /ORDER BY produtos\.nome ASC, produtos\.id_produto ASC/);
        assert.doesNotMatch(state.calls.queries[3].sql, /DROP TABLE|OR 1=1/);
    }
});

test('products list: feedback and search are bounded strings with no HTML interpretation at the route', async () => {
    const state = harness();
    const response = await state.invoke({ q: ' x'.repeat(150), mensagem: '<script>evil()</script>' + 'a'.repeat(400) });
    assert.equal(response.locals.filters.q.length, 120);
    assert.equal(response.locals.mensagem.length, 300);
    assert.ok(response.locals.mensagem.startsWith('<script>evil()</script>'));
});

test('products list: deletion feedback is allowlisted and takes priority over success', async () => {
    for (const aviso of ['em-uso', 'nao-encontrado', 'id-invalido', 'falha']) {
        const state = harness();
        const response = await state.invoke({ aviso, mensagem: 'Success should not appear' });
        assert.equal(response.locals.noticeType, 'error');
        assert.ok(response.locals.mensagem);
        assert.doesNotMatch(response.locals.mensagem, /Success should not appear/);
        assert.equal(response.locals.productsError, null);
    }
    for (const aviso of ['__proto__', 'constructor', '<script>alert(1)</script>', ['em-uso'], {}]) {
        const state = harness();
        const response = await state.invoke({ aviso });
        assert.equal(response.locals.noticeType, 'success');
        assert.equal(response.locals.mensagem, '');
    }
});

test('products list: every read failure renders 503 unavailable instead of reporting an empty healthy inventory', async () => {
    for (const failAt of [0, 1, 2, 3]) {
        const state = harness({ failAt });
        const response = await state.invoke({ q: 'Queijo', mensagem: 'Success' });
        assert.equal(response.statusCode, 503);
        assert.equal(response.view, 'produto');
        assert.equal(response.locals.mainClass, 'main-products');
        assert.equal(response.locals.summary, null);
        assert.equal(response.locals.filters.q, 'Queijo');
        assert.deepEqual(response.locals.produtos, []);
        assert.equal(response.locals.mensagem, '');
        assert.ok(response.locals.productsError);
        assert.doesNotMatch(response.locals.productsError, /Private database diagnostic/);
        assert.equal(state.calls.errors.length, 1);
    }
});

test('products legacy search: redirect keeps existing POST compatibility without querying or mutating data', async () => {
    for (const [pesquisa, target] of [
        ['  Pão & queijo  ', '/produtos/listar?q=' + encodeURIComponent('Pão & queijo')],
        ['', '/produtos/listar'],
        [undefined, '/produtos/listar'],
        [['a', 'b'], '/produtos/listar'],
        ['x'.repeat(200), '/produtos/listar?q=' + 'x'.repeat(120)]
    ]) {
        const state = harness();
        const response = await state.invoke({}, { method: 'POST', route: '/pesquisar', body: { pesquisa } });
        assert.equal(response.statusCode, 302);
        assert.equal(response.location, target);
        assert.equal(state.calls.queries.length, 0);
    }
});

test('products list: all queries are read-only and existing mutation paths remain registered and session-protected', async () => {
    const state = harness();
    await state.invoke();
    for (const { sql } of state.calls.queries) {
        assert.match(sql.trim(), /^SELECT\b/);
        assert.doesNotMatch(sql, /\b(?:INSERT|UPDATE|DELETE|DROP|TRUNCATE)\b/i);
        assert.doesNotMatch(sql, /\b(?:senha|email|telefone)\b/i);
    }
    for (const route of ['GET /novo_produto', 'POST /cadastro', 'GET /alterar/:id_produto', 'POST /alterar/:id_produto', 'POST /excluir/:id_produto']) {
        assert.equal(typeof state.handlers.get(route), 'function');
    }
    const app = fs.readFileSync(path.join(__dirname, '../app.js'), 'utf8');
    assert.match(app, /app\.use\('\/produtos', verificaUsuario, rota_produto\)/);
});
