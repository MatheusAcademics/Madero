const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../routes/categorias.js'), 'utf8');

// Queries are mocked, including all deletion scenarios. No actual record is written.
function harness({ summary = {}, total = 0, categories = [], results, failAt = -1, code } = {}) {
    const handlers = new Map();
    const calls = { queries: [], errors: [] };
    const rows = results || [
        [{ total: '0', with_products: '0', without_products: '0', ...summary }],
        [{ total: String(total) }], categories
    ];
    const router = {
        get(route, callback) { handlers.set('GET ' + route, callback); },
        post(route, callback) { handlers.set('POST ' + route, callback); }
    };
    vm.runInNewContext(source, {
        module: { exports: {} },
        console: { error: (...args) => calls.errors.push(args), log() { assert.fail('No data should be logged'); } },
        require(name) {
            if (name === 'express') return { Router: () => router };
            if (name === '../conexao') return {
                async query(sql, values) {
                    const index = calls.queries.length;
                    calls.queries.push({ sql, values: values ? Array.from(values) : [] });
                    if (index === failAt) throw Object.assign(new Error('Private diagnostic with user data'), { code });
                    return { rows: rows[index] || [] };
                }
            };
            throw new Error('Unexpected dependency: ' + name);
        }
    }, { filename: 'routes/categorias.js' });
    return {
        calls, handlers,
        async invoke(query = {}, { method = 'GET', route = '/listar', body, params = {} } = {}) {
            const response = {
                statusCode: 200,
                status(value) { this.statusCode = value; return this; },
                render(view, locals) { this.view = view; this.locals = JSON.parse(JSON.stringify(locals)); return this; },
                redirect(target) { this.statusCode = 302; this.location = target; return this; }
            };
            await handlers.get(method + ' ' + route)({ query, body, params }, response);
            return response;
        }
    };
}

test('category list: empty success renders the workspace and genuine zero category counts', async () => {
    const state = harness();
    const response = await state.invoke();
    assert.equal(response.statusCode, 200);
    assert.equal(response.view, 'categoria');
    assert.deepEqual(response.locals, {
        mainClass: 'main-categories', categorias: [],
        filters: { q: '', status: 'todas', ordem: 'nome' },
        pagination: { page: 1, pageSize: 20, total: 0, totalPages: 1 },
        summary: { total: 0, withProducts: 0, withoutProducts: 0 },
        mensagem: '', noticeType: 'success', categoriesError: null
    });
    assert.equal(state.calls.queries.length, 3);
});

test('category list: record names and product counts are preserved, including legacy unnamed categories', async () => {
    const categories = [
        { id_categoria: 1, nome: 'Pães & <script>example()</script>', total_produtos: '12' },
        { id_categoria: 2, nome: null, total_produtos: '0' }
    ];
    const state = harness({ total: 2, categories, summary: { total: '2', with_products: '1', without_products: '1' } });
    const response = await state.invoke();
    assert.deepEqual(response.locals.categorias, categories);
    assert.deepEqual(response.locals.summary, { total: 2, withProducts: 1, withoutProducts: 1 });
    assert.match(state.calls.queries[2].sql, /SELECT c\.id_categoria, c\.nome,/);
    assert.match(state.calls.queries[2].sql, /\(SELECT COUNT\(\*\) FROM produtos p WHERE p\.id_categoria = c\.id_categoria\) AS total_produtos/);
    assert.doesNotMatch(state.calls.queries[2].sql, /COALESCE|INNER JOIN/);
});

test('category list: search is parameterized on category name and ID without exposing query text', async () => {
    const q = "Bebidas'; DROP TABLE categorias; --";
    const state = harness({ total: 41 });
    const response = await state.invoke({ q: ' ' + q + ' ', status: 'com-produtos', ordem: 'produtos', pagina: '2' });
    assert.deepEqual(response.locals.filters, { q, status: 'com-produtos', ordem: 'produtos' });
    assert.deepEqual(response.locals.pagination, { page: 2, pageSize: 20, total: 41, totalPages: 3 });
    assert.deepEqual(state.calls.queries[1].values, ['%' + q + '%']);
    assert.deepEqual(state.calls.queries[2].values, ['%' + q + '%', 20, 20]);
    for (const index of [1, 2]) {
        assert.match(state.calls.queries[index].sql, /\(c\.nome ILIKE \$1 OR c\.id_categoria::text ILIKE \$1\)/);
        assert.match(state.calls.queries[index].sql, /AND EXISTS \(SELECT 1 FROM produtos p WHERE p\.id_categoria = c\.id_categoria\)/);
        assert.doesNotMatch(state.calls.queries[index].sql, /DROP TABLE|Bebidas/);
    }
    assert.match(state.calls.queries[2].sql, /LIMIT \$2 OFFSET \$3/);
});

test('category list: SQL wildcards are escaped as literal characters', async () => {
    const state = harness();
    await state.invoke({ q: '  50%_\\  ' });
    assert.deepEqual(state.calls.queries[1].values, ['%50\\%\\_\\\\%']);
    assert.deepEqual(state.calls.queries[2].values, ['%50\\%\\_\\\\%', 20, 0]);
});

test('category list: category totals are global and not multiplied by linked products', async () => {
    const state = harness({ total: 1, summary: { total: '70', with_products: '50', without_products: '20' } });
    const response = await state.invoke({ q: 'A', status: 'sem-produtos' });
    assert.deepEqual(response.locals.summary, { total: 70, withProducts: 50, withoutProducts: 20 });
    assert.equal(response.locals.pagination.total, 1);
    const summary = state.calls.queries[0];
    assert.deepEqual(summary.values, []);
    assert.match(summary.sql, /COUNT\(\*\) AS total/);
    assert.match(summary.sql, /COUNT\(\*\) FILTER \(WHERE EXISTS/);
    assert.match(summary.sql, /COUNT\(\*\) FILTER \(WHERE NOT EXISTS/);
    assert.doesNotMatch(summary.sql, /JOIN|SUM\(|ILIKE|estoque|quantidade/);
    for (const { sql } of state.calls.queries) {
        assert.match(sql.trim(), /^SELECT\b/);
        assert.doesNotMatch(sql, /\b(?:INSERT|UPDATE|DELETE|DROP|TRUNCATE|senha|email|telefone)\b/i);
    }
});

test('category list: usage filters rely on actual product relationships, not stock quantities', async () => {
    for (const [status, fragment] of [
        ['com-produtos', 'WHERE EXISTS (SELECT 1 FROM produtos p WHERE p.id_categoria = c.id_categoria)'],
        ['sem-produtos', 'WHERE NOT EXISTS (SELECT 1 FROM produtos p WHERE p.id_categoria = c.id_categoria)']
    ]) {
        const state = harness();
        const response = await state.invoke({ status });
        assert.equal(response.locals.filters.status, status);
        for (const index of [1, 2]) {
            assert.ok(state.calls.queries[index].sql.includes(fragment));
            assert.doesNotMatch(state.calls.queries[index].sql, /estoque|quantidade/);
        }
    }
});

test('category list: every sort is allowlisted and deterministic', async () => {
    const orders = {
        nome: 'c.nome ASC NULLS LAST, c.id_categoria ASC',
        'nome-desc': 'c.nome DESC NULLS LAST, c.id_categoria DESC',
        produtos: 'total_produtos DESC, c.nome ASC NULLS LAST, c.id_categoria ASC',
        recentes: 'c.id_categoria DESC'
    };
    for (const [ordem, orderSql] of Object.entries(orders)) {
        const state = harness();
        const response = await state.invoke({ ordem });
        assert.equal(response.locals.filters.ordem, ordem);
        assert.ok(state.calls.queries[2].sql.includes('ORDER BY ' + orderSql));
    }
});

test('category list: malformed filters and pagination fall back safely', async () => {
    for (const query of [
        { q: ['one', 'two'], status: ['com-produtos'], ordem: {}, pagina: ['2'], mensagem: {}, aviso: {} },
        { status: '__proto__', ordem: 'constructor', pagina: '1.5', aviso: '__proto__' },
        { status: 'toString', ordem: 'toString', pagina: '0', aviso: 'constructor' },
        { status: 'todas; DROP TABLE categorias', ordem: 'nome; DROP TABLE categorias', pagina: '-1' },
        { pagina: 'Infinity' }, { pagina: '9007199254740992' }
    ]) {
        const state = harness();
        const response = await state.invoke(query);
        assert.deepEqual(response.locals.filters, { q: '', status: 'todas', ordem: 'nome' });
        assert.equal(response.locals.pagination.page, 1);
        assert.equal(response.locals.mensagem, '');
        assert.equal(response.locals.noticeType, 'success');
        assert.deepEqual(state.calls.queries[2].values, [20, 0]);
        assert.doesNotMatch(state.calls.queries[2].sql, /DROP TABLE|constructor|toString/);
    }
});

test('category list: searches and notices are bounded without inventing HTML', async () => {
    const state = harness();
    const response = await state.invoke({ q: 'x'.repeat(150), mensagem: '<script>example()</script>' + 'x'.repeat(400) });
    assert.equal(response.locals.filters.q.length, 120);
    assert.equal(response.locals.mensagem.length, 300);
    assert.ok(response.locals.mensagem.startsWith('<script>'));
});

test('category list: deletion notices are allowlisted errors and take priority over success messages', async () => {
    for (const aviso of ['em-uso', 'nao-encontrada', 'falha', 'id-invalido']) {
        const state = harness();
        const response = await state.invoke({ aviso, mensagem: 'Success should not appear' });
        assert.equal(response.locals.noticeType, 'error');
        assert.ok(response.locals.mensagem);
        assert.doesNotMatch(response.locals.mensagem, /Success should not appear/);
        assert.equal(response.locals.categoriesError, null);
    }
});

test('category list: pages clamp to filtered results before calculating offsets', async () => {
    for (const [total, page, offset] of [[0, 1, 0], [20, 1, 0], [21, 2, 20], [61, 4, 60]]) {
        const state = harness({ total });
        const response = await state.invoke({ pagina: String(Number.MAX_SAFE_INTEGER) });
        assert.deepEqual(response.locals.pagination, { page, pageSize: 20, total, totalPages: page });
        assert.deepEqual(state.calls.queries[2].values, [20, offset]);
    }
});

test('category list: unavailable reads return 503 instead of a successful empty category list', async () => {
    for (const failAt of [0, 1, 2]) {
        const state = harness({ failAt, code: 'ECONNREFUSED' });
        const response = await state.invoke({ q: 'Bebidas', pagina: '4', mensagem: 'Success' });
        assert.equal(response.statusCode, 503);
        assert.equal(response.view, 'categoria');
        assert.equal(response.locals.mainClass, 'main-categories');
        assert.equal(response.locals.filters.q, 'Bebidas');
        assert.equal(response.locals.pagination.page, 4);
        assert.equal(response.locals.summary, null);
        assert.deepEqual(response.locals.categorias, []);
        assert.equal(response.locals.mensagem, '');
        assert.equal(response.locals.noticeType, 'error');
        assert.ok(response.locals.categoriesError);
        assert.doesNotMatch(response.locals.categoriesError, /Private|ECONNREFUSED|user data/);
        assert.deepEqual(state.calls.errors, [['Erro ao listar categorias:', 'ECONNREFUSED']]);
    }
});

test('category legacy search: POST redirects to canonical GET search without reading or writing data', async () => {
    for (const [body, target] of [
        [{ pesquisa: ' Pães & queijos ' }, '/categorias/listar?q=' + encodeURIComponent('Pães & queijos')],
        [{ pesquisa: 'x'.repeat(200) }, '/categorias/listar?q=' + 'x'.repeat(120)],
        [undefined, '/categorias/listar'], [{}, '/categorias/listar'],
        [{ pesquisa: [] }, '/categorias/listar'], [{ pesquisa: ' ' }, '/categorias/listar']
    ]) {
        const state = harness();
        const response = await state.invoke({}, { method: 'POST', route: '/pesquisar', body });
        assert.equal(response.location, target);
        assert.equal(state.calls.queries.length, 0);
    }
});

test('category removal: invalid identifiers never reach a database statement', async () => {
    for (const id_categoria of ['', '0', '-1', '1.5', '2147483648', '1 OR 1=1', undefined, {}, ['1']]) {
        const state = harness();
        const response = await state.invoke({}, { method: 'POST', route: '/excluir/:id_categoria', params: { id_categoria } });
        assert.equal(response.location, '/categorias/listar?aviso=id-invalido');
        assert.equal(state.calls.queries.length, 0);
    }
});

test('category removal: unused categories are removed atomically with a NOT EXISTS guard and truthful success', async () => {
    const state = harness({ results: [[{ id_categoria: 12 }]] });
    const response = await state.invoke({}, { method: 'POST', route: '/excluir/:id_categoria', params: { id_categoria: '0012' } });
    assert.equal(response.location, '/categorias/listar?mensagem=' + encodeURIComponent('Categoria excluída com sucesso!'));
    assert.equal(state.calls.queries.length, 1);
    assert.deepEqual(state.calls.queries[0].values, [12]);
    assert.match(state.calls.queries[0].sql, /^DELETE FROM categorias c WHERE c\.id_categoria = \$1/);
    assert.match(state.calls.queries[0].sql, /AND NOT EXISTS \(SELECT 1 FROM produtos p WHERE p\.id_categoria = c\.id_categoria\)/);
    assert.match(state.calls.queries[0].sql, /RETURNING c\.id_categoria/);
    assert.doesNotMatch(state.calls.queries[0].sql, /CASCADE|UPDATE produtos|DELETE FROM produtos/);
});

test('category removal: no deleted row distinguishes an in-use category from a missing category', async () => {
    for (const [category_exists, aviso] of [[true, 'em-uso'], [false, 'nao-encontrada']]) {
        const state = harness({ results: [[], [{ category_exists }]] });
        const response = await state.invoke({}, { method: 'POST', route: '/excluir/:id_categoria', params: { id_categoria: '12' } });
        assert.equal(response.location, '/categorias/listar?aviso=' + aviso);
        assert.equal(state.calls.queries.length, 2);
        assert.deepEqual(state.calls.queries[1].values, [12]);
        assert.match(state.calls.queries[1].sql, /^SELECT EXISTS/);
        assert.equal(state.calls.errors.length, 0);
    }
});

test('category removal: concurrent foreign-key conflicts stay in-use and database failures stay generic', async () => {
    for (const [code, aviso] of [['23503', 'em-uso'], ['ECONNREFUSED', 'falha'], [undefined, 'falha']]) {
        const state = harness({ failAt: 0, code });
        const response = await state.invoke({}, { method: 'POST', route: '/excluir/:id_categoria', params: { id_categoria: '12' } });
        assert.equal(response.location, '/categorias/listar?aviso=' + aviso);
        assert.equal(state.calls.queries.length, 1);
        assert.doesNotMatch(JSON.stringify(state.calls.errors), /Private diagnostic|user data/);
        if (code === '23503') assert.equal(state.calls.errors.length, 0);
        else assert.deepEqual(state.calls.errors, [['Erro ao excluir categoria:', code || 'unknown']]);
    }
});

test('category removal: failure while checking a guarded category does not claim deletion succeeded', async () => {
    const state = harness({ results: [[]], failAt: 1 });
    const response = await state.invoke({}, { method: 'POST', route: '/excluir/:id_categoria', params: { id_categoria: '12' } });
    assert.equal(response.location, '/categorias/listar?aviso=falha');
});

test('category edit: existing update functionality is retained with correct encoded success wording and no debug logs', async () => {
    const state = harness({ results: [[{ id_categoria: 12 }]] });
    const response = await state.invoke({}, { method: 'POST', route: '/alterar/:id_categoria', params: { id_categoria: '12' }, body: { nome: 'Bebidas' } });
    assert.equal(response.location, '/categorias/listar?mensagem=' + encodeURIComponent('Categoria alterada com sucesso!'));
    assert.deepEqual(state.calls.queries, [{ sql: 'UPDATE categorias SET nome = $1 WHERE id_categoria = $2 RETURNING id_categoria', values: ['Bebidas', 12] }]);
    assert.equal(state.calls.errors.length, 0);
});

test('category list: existing endpoints remain session-protected', () => {
    const state = harness();
    for (const route of ['GET /cadastro', 'POST /cadastro', 'GET /listar', 'POST /pesquisar', 'GET /alterar/:id_categoria', 'POST /alterar/:id_categoria', 'POST /excluir/:id_categoria']) {
        assert.equal(typeof state.handlers.get(route), 'function', route);
    }
    const app = fs.readFileSync(path.join(__dirname, '../app.js'), 'utf8');
    assert.match(app, /app\.use\('\/categorias', verificaUsuario, rota_categoria\)/);
});
