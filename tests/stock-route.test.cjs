const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../routes/movimentacoes.js'), 'utf8');

// Listing tests never open the database or invoke a mutation endpoint.
function harness({ categories = [], summary = {}, total = 0, products = [], failAt = -1 } = {}) {
    const handlers = new Map();
    const calls = { queries: [], errors: [] };
    const rows = [categories, [{ total: '0', below_minimum: '0', zero: '0', negative: '0', ...summary }], [{ total: String(total) }], products];
    let activeRoute = '';
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
                    return { rows: activeRoute === '/nova_movimentacao' ? (/FROM produtos/.test(sql) ? products : [{ id_usuario: 9, nome_usuario: 'Responsável' }]) : rows[index] || [] };
                }
            };
            throw new Error('Unexpected dependency: ' + name);
        }
    }, { filename: 'routes/movimentacoes.js' });
    return {
        calls, handlers,
        async invoke(query = {}, { method = 'GET', route = '/listar_estoque', body = {}, session = { user: { id_usuario: 9 } } } = {}) {
            activeRoute = route;
            const response = {
                statusCode: 200,
                status(code) { this.statusCode = code; return this; },
                render(view, locals) { this.view = view; this.locals = JSON.parse(JSON.stringify(locals)); return this; },
                redirect(target) { this.statusCode = 302; this.location = target; return this; },
                send(text) { this.text = text; return this; }
            };
            await handlers.get(method + ' ' + route)({ query, body, session }, response);
            return response;
        }
    };
}

test('stock list: empty database uses the isolated stock layout and honest totals', async () => {
    const state = harness();
    const response = await state.invoke();
    assert.equal(response.statusCode, 200);
    assert.equal(response.view, 'estoque');
    assert.deepEqual(response.locals, {
        mainClass: 'main-stock', produtos: [], categorias: [],
        filters: { q: '', categoria: '', status: 'todos', ordem: 'nome' },
        pagination: { page: 1, pageSize: 20, total: 0, totalPages: 1 },
        mensagem: '', stockError: '', geradoEm: response.locals.geradoEm,
        summary: { total: 0, belowMinimum: 0, zero: 0, negative: 0 }
    });
    assert.equal(state.calls.queries.length, 4);
    assert.ok(Number.isFinite(Date.parse(response.locals.geradoEm)));
});

test('stock list: rows, decimal and negative balances, images, and uncategorized products survive unchanged', async () => {
    const products = [
        { id_produto: 1, nome: 'Queijo', estoque: '2.50', estoque_minimo: '5.00', valor: '18.90', imagem: '/img/queijo.jpg', id_categoria: 4, nome_categoria: 'Ingredientes' },
        { id_produto: 2, nome: 'Caixa', estoque: '-1.25', estoque_minimo: '0', valor: '0', imagem: '', id_categoria: null, nome_categoria: null }
    ];
    const categories = [{ id_categoria: 4, nome: 'Ingredientes' }, { id_categoria: 9, nome: 'Categoria sem produtos' }];
    const state = harness({ products, categories, total: 2, summary: { total: '2', below_minimum: '2', zero: '0', negative: '1' } });
    const response = await state.invoke();
    assert.deepEqual(response.locals.produtos, products);
    assert.deepEqual(response.locals.categorias, categories);
    assert.deepEqual(response.locals.summary, { total: 2, belowMinimum: 2, zero: 0, negative: 1 });
    assert.match(state.calls.queries[3].sql, /LEFT JOIN categorias/);
    assert.match(state.calls.queries[3].sql, /produtos\.id_categoria/);
    assert.match(state.calls.queries[0].sql, /ORDER BY nome ASC, id_categoria ASC/);
});

test('stock list: search and category are parameterized while global summary stays unfiltered', async () => {
    const q = "Queijo'; DROP TABLE produtos; --";
    const state = harness({ total: 47, summary: { total: '120', below_minimum: '9', zero: '1', negative: '2' } });
    const response = await state.invoke({ q, categoria: '004', status: 'repor', ordem: 'saldo', pagina: '2' });
    assert.deepEqual(response.locals.filters, { q, categoria: '4', status: 'repor', ordem: 'saldo' });
    assert.deepEqual(response.locals.pagination, { page: 2, pageSize: 20, total: 47, totalPages: 3 });
    assert.deepEqual(response.locals.summary, { total: 120, belowMinimum: 9, zero: 1, negative: 2 });
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

test('stock list: SQL wildcard characters in a search are treated as literal text', async () => {
    const state = harness();
    await state.invoke({ q: '  50%_\\  ' });
    assert.deepEqual(state.calls.queries[2].values, ['%50\\%\\_\\\\%']);
    assert.deepEqual(state.calls.queries[3].values, ['%50\\%\\_\\\\%', 20, 0]);
});

test('stock list: valid sort options have deterministic ordering and bound pagination', async () => {
    const sorts = {
        nome: 'produtos.nome ASC, produtos.id_produto ASC',
        saldo: 'produtos.estoque ASC NULLS LAST, produtos.nome ASC, produtos.id_produto ASC',
        'saldo-desc': 'produtos.estoque DESC NULLS LAST, produtos.nome ASC, produtos.id_produto ASC',
        reposicao: 'CASE WHEN produtos.estoque IS NULL OR produtos.estoque_minimo IS NULL THEN NULL ELSE GREATEST(produtos.estoque_minimo - produtos.estoque, 0) END DESC NULLS LAST, produtos.nome ASC, produtos.id_produto ASC'
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

test('stock list: strict replenishment, zero and negative balances have independent predicates', async () => {
    for (const [status, predicate] of [
        ['repor', 'produtos.estoque < produtos.estoque_minimo'],
        ['zerado', 'produtos.estoque = 0'],
        ['negativo', 'produtos.estoque < 0']
    ]) {
        const state = harness();
        const response = await state.invoke({ status });
        assert.equal(response.locals.filters.status, status);
        for (const index of [2, 3]) {
            assert.ok(state.calls.queries[index].sql.includes('WHERE ' + predicate));
            assert.doesNotMatch(state.calls.queries[index].sql, /estoque <=/);
        }
    }
    const state = harness();
    await state.invoke();
    assert.match(state.calls.queries[1].sql, /COUNT\(\*\) FILTER \(WHERE estoque < estoque_minimo\) AS below_minimum/);
    assert.match(state.calls.queries[1].sql, /COUNT\(\*\) FILTER \(WHERE estoque = 0\) AS zero/);
    assert.match(state.calls.queries[1].sql, /COUNT\(\*\) FILTER \(WHERE estoque < 0\) AS negative/);
});

test('stock list: out-of-range pages clamp to existing results without overflow', async () => {
    for (const [total, page, offset] of [[0, 1, 0], [20, 1, 0], [21, 2, 20], [60, 3, 40]]) {
        const state = harness({ total });
        const response = await state.invoke({ pagina: String(Number.MAX_SAFE_INTEGER) });
        assert.equal(response.locals.pagination.page, page);
        assert.equal(response.locals.pagination.totalPages, page);
        assert.deepEqual(state.calls.queries[3].values, [20, offset]);
    }
});

test('stock list: malformed arrays, objects and injected sort/status values fall back safely', async () => {
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

test('stock list: feedback and search are bounded strings with no HTML interpretation at the route', async () => {
    const state = harness();
    const response = await state.invoke({ q: ' x'.repeat(150), mensagem: '<script>evil()</script>' + 'a'.repeat(400) });
    assert.equal(response.locals.filters.q.length, 120);
    assert.equal(response.locals.mensagem.length, 300);
    assert.ok(response.locals.mensagem.startsWith('<script>evil()</script>'));
});

test('stock list: every read failure renders 503 unavailable instead of reporting an empty healthy inventory', async () => {
    for (const failAt of [0, 1, 2, 3]) {
        const state = harness({ failAt });
        const response = await state.invoke({ q: 'Queijo', mensagem: 'Success' });
        assert.equal(response.statusCode, 503);
        assert.equal(response.view, 'estoque');
        assert.equal(response.locals.mainClass, 'main-stock');
        assert.equal(response.locals.summary, null);
        assert.equal(response.locals.geradoEm, null);
        assert.deepEqual(response.locals.pagination, { page: 1, pageSize: 20, total: 0, totalPages: 1 });
        assert.equal(response.locals.filters.q, 'Queijo');
        assert.deepEqual(response.locals.produtos, []);
        assert.equal(response.locals.mensagem, '');
        assert.ok(response.locals.stockError);
        assert.doesNotMatch(response.locals.stockError, /Private database diagnostic/);
        assert.equal(state.calls.errors.length, 1);
    }
});

test('stock legacy search: redirect keeps existing POST compatibility without querying or mutating data', async () => {
    for (const [pesquisa, target] of [
        ['  Pão & queijo  ', '/movimentacoes/listar_estoque?q=' + encodeURIComponent('Pão & queijo')],
        ['', '/movimentacoes/listar_estoque'],
        [undefined, '/movimentacoes/listar_estoque'],
        [['a', 'b'], '/movimentacoes/listar_estoque'],
        ['x'.repeat(200), '/movimentacoes/listar_estoque?q=' + 'x'.repeat(120)]
    ]) {
        const state = harness();
        const response = await state.invoke({}, { method: 'POST', route: '/pesquisar_estoque', body: { pesquisa } });
        assert.equal(response.statusCode, 302);
        assert.equal(response.location, target);
        assert.equal(state.calls.queries.length, 0);
    }
});

test('stock list: all queries are read-only and existing mutation paths remain registered and session-protected', async () => {
    const state = harness();
    await state.invoke();
    for (const { sql } of state.calls.queries) {
        assert.match(sql.trim(), /^SELECT\b/);
        assert.doesNotMatch(sql, /\b(?:INSERT|UPDATE|DELETE|DROP|TRUNCATE)\b/i);
        assert.doesNotMatch(sql, /\b(?:senha|email|telefone|movimentacoes)\b/i);
        assert.doesNotMatch(sql, /SUM\(/);
    }
    for (const route of ['GET /listar', 'POST /cadastro', 'GET /nova_movimentacao', 'GET /listar_estoque', 'POST /pesquisar_estoque', 'POST /pesquisar']) {
        assert.equal(typeof state.handlers.get(route), 'function');
    }
    const app = fs.readFileSync(path.join(__dirname, '../app.js'), 'utf8');
    assert.match(app, /app\.use\('\/movimentacoes', verificaUsuario, rota_movimentacao\)/);
});

test('stock list: nullable quantities stay nullable and no history sum replaces the stored balance', async () => {
    const products = [
        { id_produto: 3, nome: 'Legado', estoque: null, estoque_minimo: null, imagem: null, id_categoria: null, nome_categoria: null },
        { id_produto: 4, nome: 'Água', estoque: '0.00', estoque_minimo: '0.00', imagem: '', id_categoria: 4, nome_categoria: 'Bebidas' }
    ];
    const state = harness({ products, total: 2 });
    const response = await state.invoke();
    assert.deepEqual(response.locals.produtos, products);
    assert.match(state.calls.queries[3].sql, /SELECT produtos\.id_produto, produtos\.nome, produtos\.estoque, produtos\.estoque_minimo/);
    assert.doesNotMatch(state.calls.queries[3].sql, /COALESCE|SUM\(|JOIN movimentacoes/);
});

test('stock action: movement form preselects an existing product only after checking the loaded list', async () => {
    for (const produto of ['4', '004', ' 4 ']) {
        const state = harness({ products: [{ id_produto: 4, nome: 'Pão', estoque: '2.50', estoque_minimo: '5.00' }] });
        const response = await state.invoke({ produto }, { route: '/nova_movimentacao' });
        assert.equal(response.statusCode, 200);
        assert.equal(response.locals.values.id_produto, '4');
        assert.equal(response.locals.values.id_usuario, '9');
        assert.equal(response.locals.values.tipo_movimentacao, 'Entrada');
        assert.equal(response.locals.submitted, false);
        assert.equal(state.calls.queries.length, 2);
        for (const query of state.calls.queries) assert.deepEqual(query.values, []);
    }
});

test('stock action: missing, deleted and malformed product identifiers never invent a selected product', async () => {
    for (const produto of [undefined, '', '5', '0', '-1', '1.5', '1e2', '2147483648', 'Infinity', '4 OR 1=1', ['4'], { id: 4 }]) {
        const state = harness({ products: [{ id_produto: 4, nome: 'Pão', estoque: '2.50' }] });
        const response = await state.invoke({ produto }, { route: '/nova_movimentacao' });
        assert.equal(response.statusCode, 200);
        assert.equal(response.locals.values.id_produto, '');
        assert.deepEqual(response.locals.errors, {});
    }
});

test('stock action: unavailable options never retain an unverified product selection', async () => {
    for (const failAt of [0, 1]) {
        const state = harness({ products: [{ id_produto: 4, nome: 'Pão', estoque: '2.50' }], failAt });
        const response = await state.invoke({ produto: '4' }, { route: '/nova_movimentacao' });
        assert.equal(response.statusCode, 503);
        assert.equal(response.locals.values.id_produto, '');
        assert.ok(response.locals.loadError);
        assert.deepEqual(response.locals.produtos, []);
    }
});

test('stock action: unauthenticated movement preselection does not query options', async () => {
    const state = harness();
    const response = await state.invoke({ produto: '4' }, { route: '/nova_movimentacao', session: {} });
    assert.equal(response.statusCode, 401);
    assert.equal(state.calls.queries.length, 0);
});
