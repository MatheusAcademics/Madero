const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../routes/movimentacoes.js'), 'utf8');

// No database connection is made; only the history listing/legacy search execute.
function harness({ users = [], summary = {}, total = 0, movements = [], failAt = -1 } = {}) {
    const handlers = new Map();
    const calls = { queries: [], errors: [] };
    const rows = [users, [{ total: '0', entries: '0', exits: '0', other: '0', ...summary }], [{ total: String(total) }], movements];
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
    }, { filename: 'routes/movimentacoes.js' });
    return {
        calls, handlers,
        async invoke(query = {}, { method = 'GET', route = '/listar', body = {} } = {}) {
            const response = {
                statusCode: 200,
                status(code) { this.statusCode = code; return this; },
                render(view, locals) { this.view = view; this.locals = JSON.parse(JSON.stringify(locals)); return this; },
                redirect(target) { this.statusCode = 302; this.location = target; return this; }
            };
            await handlers.get(method + ' ' + route)({ query, body, session: { user: { id_usuario: 9 } } }, response);
            return response;
        }
    };
}

test('movement history: empty success uses the history layout and truthful zero totals', async () => {
    const state = harness();
    const response = await state.invoke();
    assert.equal(response.statusCode, 200);
    assert.equal(response.view, 'movimentacao');
    assert.deepEqual(response.locals, {
        mainClass: 'main-movements', movimentacoes: [], usuarios: [],
        filters: { q: '', tipo: 'todos', usuario: '', de: '', ate: '', ordem: 'recentes' },
        filterErrors: {}, pagination: { page: 1, pageSize: 20, total: 0, totalPages: 1 },
        summary: { total: 0, entries: 0, exits: 0, other: 0 },
        mensagem: '', listError: '', geradoEm: response.locals.geradoEm
    });
    assert.equal(state.calls.queries.length, 4);
    assert.ok(Number.isFinite(Date.parse(response.locals.geradoEm)));
});

test('movement history: raw records and orphan references survive without invented products, users or quantities', async () => {
    const movements = [
        { id_movimentacao: 1, tipo_movimentacao: 'Entrada', data_movimentacao: '2026-10-02T00:00:00', quantidade: '2.50', descricao: '<script>example()</script>', id_produto: 4, id_usuario: 9, nome_produto: 'Pão', nome_usuario: 'Equipe' },
        { id_movimentacao: 2, tipo_movimentacao: 'Saída', data_movimentacao: null, quantidade: '-1.25', descricao: '', id_produto: 99, id_usuario: 999, nome_produto: null, nome_usuario: null },
        { id_movimentacao: 3, tipo_movimentacao: 'Ajuste', data_movimentacao: '2024-02-29T23:59:59', quantidade: null, descricao: null, id_produto: null, id_usuario: null, nome_produto: null, nome_usuario: null }
    ];
    const users = [{ id_usuario: 9, nome_usuario: 'Equipe' }];
    const state = harness({ movements, users, total: 3, summary: { total: '3', entries: '1', exits: '1', other: '1' } });
    const response = await state.invoke();
    assert.deepEqual(response.locals.movimentacoes, movements);
    assert.deepEqual(response.locals.usuarios, users);
    assert.deepEqual(response.locals.summary, { total: 3, entries: 1, exits: 1, other: 1 });
    for (const index of [2, 3]) {
        assert.match(state.calls.queries[index].sql, /LEFT JOIN produtos p ON m\.id_produto = p\.id_produto/);
        assert.match(state.calls.queries[index].sql, /LEFT JOIN usuarios u ON m\.id_usuario = u\.id_usuario/);
    }
    assert.match(state.calls.queries[3].sql, /m\.quantidade, m\.descricao, m\.id_produto, m\.id_usuario/);
    assert.doesNotMatch(state.calls.queries[3].sql, /COALESCE|ABS\(/);
});

test('movement history: every filter is parameterized and global record summary stays unfiltered', async () => {
    const q = "Pão'; DROP TABLE movimentacoes; --";
    const state = harness({ total: 47, summary: { total: '200', entries: '120', exits: '78', other: '2' } });
    const response = await state.invoke({ q, tipo: 'saida', usuario: '009', de: '2026-09-01', ate: '2026-10-02', ordem: 'antigas', pagina: '2' });
    assert.deepEqual(response.locals.filters, { q, tipo: 'saida', usuario: '9', de: '2026-09-01', ate: '2026-10-02', ordem: 'antigas' });
    assert.deepEqual(response.locals.pagination, { page: 2, pageSize: 20, total: 47, totalPages: 3 });
    assert.deepEqual(response.locals.summary, { total: 200, entries: 120, exits: 78, other: 2 });
    assert.deepEqual(state.calls.queries[2].values, ['%' + q + '%', 'Saída', 9, '2026-09-01', '2026-10-02']);
    assert.deepEqual(state.calls.queries[3].values, ['%' + q + '%', 'Saída', 9, '2026-09-01', '2026-10-02', 20, 20]);
    for (const index of [2, 3]) {
        assert.match(state.calls.queries[index].sql, /p\.nome ILIKE \$1 OR m\.descricao ILIKE \$1 OR m\.id_movimentacao::text ILIKE \$1/);
        assert.match(state.calls.queries[index].sql, /m\.tipo_movimentacao = \$2/);
        assert.match(state.calls.queries[index].sql, /m\.id_usuario = \$3/);
        assert.match(state.calls.queries[index].sql, /m\.data_movimentacao >= \$4::date/);
        assert.match(state.calls.queries[index].sql, /m\.data_movimentacao < \(\$5::date \+ interval '1 day'\)/);
        assert.doesNotMatch(state.calls.queries[index].sql, /DROP TABLE|2026-09-01|2026-10-02/);
    }
    assert.match(state.calls.queries[3].sql, /LIMIT \$6 OFFSET \$7/);
    assert.deepEqual(state.calls.queries[1].values, []);
    assert.doesNotMatch(state.calls.queries[1].sql, /ILIKE|id_usuario =|data_movimentacao/);
});

test('movement history: SQL wildcard characters remain literal search text', async () => {
    const state = harness();
    await state.invoke({ q: '  50%_\\  ' });
    assert.deepEqual(state.calls.queries[2].values, ['%50\\%\\_\\\\%']);
    assert.deepEqual(state.calls.queries[3].values, ['%50\\%\\_\\\\%', 20, 0]);
});

test('movement history: types do not classify unknown or null legacy records as exits', async () => {
    for (const [tipo, value] of [['entrada', 'Entrada'], ['saida', 'Saída']]) {
        const state = harness();
        await state.invoke({ tipo });
        assert.deepEqual(state.calls.queries[2].values, [value]);
        assert.match(state.calls.queries[2].sql, /WHERE m\.tipo_movimentacao = \$1/);
    }
    const state = harness();
    const response = await state.invoke({ tipo: 'outros' });
    assert.equal(response.locals.filters.tipo, 'outros');
    for (const index of [2, 3]) {
        assert.match(state.calls.queries[index].sql, /WHERE \(m\.tipo_movimentacao IS NULL OR m\.tipo_movimentacao NOT IN \('Entrada', 'Saída'\)\)/);
    }
    assert.match(state.calls.queries[1].sql, /COUNT\(\*\) FILTER \(WHERE tipo_movimentacao = 'Entrada'\) AS entries/);
    assert.match(state.calls.queries[1].sql, /COUNT\(\*\) FILTER \(WHERE tipo_movimentacao = 'Saída'\) AS exits/);
    assert.match(state.calls.queries[1].sql, /COUNT\(\*\) FILTER \(WHERE tipo_movimentacao IS NULL OR tipo_movimentacao NOT IN \('Entrada', 'Saída'\)\) AS other/);
});

test('movement history: valid ranges include all of the final day without timezone conversion', async () => {
    for (const query of [
        { de: '2024-02-29', ate: '2024-02-29' },
        { de: '2000-02-29', ate: '2026-10-02' },
        { de: '0001-01-01', ate: '9999-12-31' },
        { de: '2026-10-02' }, { ate: '2026-10-02' }
    ]) {
        const state = harness();
        const response = await state.invoke(query);
        assert.equal(response.statusCode, 200);
        assert.deepEqual(response.locals.filterErrors, {});
        const params = [query.de, query.ate].filter(Boolean);
        assert.deepEqual(state.calls.queries[2].values, params);
        if (query.de) assert.match(state.calls.queries[2].sql, /m\.data_movimentacao >= \$1::date/);
        if (query.ate) assert.match(state.calls.queries[2].sql, /m\.data_movimentacao < \(\$\d::date \+ interval '1 day'\)/);
        assert.doesNotMatch(state.calls.queries[2].sql, /BETWEEN|::timestamptz|AT TIME ZONE|<=/);
    }
});

test('movement history: impossible and malformed dates return field errors before count/list queries', async () => {
    for (const invalid of ['2026-02-29', '2024-02-30', '1900-02-29', '2026-04-31', '2026-13-01', '0000-01-01', '2026-1-2', '02/10/2026', '2026-10-02T00:00:00Z', "2026-10-02'; DROP TABLE users", ['2026-10-02'], { date: '2026-10-02' }, null]) {
        for (const field of ['de', 'ate']) {
            const state = harness({ summary: { total: '8', entries: '5', exits: '3' } });
            const response = await state.invoke({ [field]: invalid, q: 'Pão', pagina: '4' });
            assert.equal(response.statusCode, 400, JSON.stringify({ field, invalid }));
            assert.equal(response.view, 'movimentacao');
            assert.ok(response.locals.filterErrors[field]);
            assert.equal(response.locals.filters[field], typeof invalid === 'string' ? invalid.slice(0, 40) : '');
            assert.equal(response.locals.filters.q, 'Pão');
            assert.equal(response.locals.summary.total, 8);
            assert.equal(response.locals.pagination.page, 1);
            assert.deepEqual(response.locals.movimentacoes, []);
            assert.equal(response.locals.listError, '');
            assert.equal(state.calls.queries.length, 2);
            assert.doesNotMatch(state.calls.queries[1].sql, /data_movimentacao/);
        }
    }
});

test('movement history: reversed dates retain both values and explain the range error', async () => {
    const state = harness();
    const response = await state.invoke({ de: '2026-10-02', ate: '2026-10-01' });
    assert.equal(response.statusCode, 400);
    assert.equal(response.locals.filters.de, '2026-10-02');
    assert.equal(response.locals.filters.ate, '2026-10-01');
    assert.match(response.locals.filterErrors.ate, /posterior/);
    assert.equal(response.locals.filterErrors.de, undefined);
    assert.equal(state.calls.queries.length, 2);
});

test('movement history: timestamp without timezone is returned literally, not shifted to a previous day', async () => {
    const state = harness({ total: 1, movements: [{ id_movimentacao: 1, data_movimentacao: '2026-10-02T00:00:00' }] });
    const response = await state.invoke();
    assert.match(state.calls.queries[3].sql, /TO_CHAR\(m\.data_movimentacao, 'YYYY-MM-DD"T"HH24:MI:SS'\) AS data_movimentacao/);
    assert.doesNotMatch(state.calls.queries[3].sql, /AT TIME ZONE|::timestamptz/);
    assert.equal(response.locals.movimentacoes[0].data_movimentacao, '2026-10-02T00:00:00');
});

test('movement history: sort order is allowlisted and deterministic even when dates match or are missing', async () => {
    for (const [ordem, direction] of [['recentes', 'DESC'], ['antigas', 'ASC']]) {
        const state = harness({ total: 21 });
        const response = await state.invoke({ ordem, pagina: '2' });
        assert.equal(response.locals.filters.ordem, ordem);
        assert.ok(state.calls.queries[3].sql.includes(`ORDER BY m.data_movimentacao ${direction} NULLS LAST, m.id_movimentacao ${direction}`));
        assert.match(state.calls.queries[3].sql, /LIMIT \$1 OFFSET \$2/);
        assert.deepEqual(state.calls.queries[3].values, [20, 20]);
    }
});

test('movement history: out-of-range pages clamp before calculating an offset', async () => {
    for (const [total, page, offset] of [[0, 1, 0], [20, 1, 0], [21, 2, 20], [60, 3, 40]]) {
        const state = harness({ total });
        const response = await state.invoke({ pagina: String(Number.MAX_SAFE_INTEGER) });
        assert.deepEqual(response.locals.pagination, { page, pageSize: 20, total, totalPages: page });
        assert.deepEqual(state.calls.queries[3].values, [20, offset]);
    }
});

test('movement history: malformed IDs, array filters and injected sort/type values use safe defaults', async () => {
    for (const query of [
        { q: ['a', 'b'], usuario: {}, tipo: ['entrada'], ordem: {}, pagina: ['2'], mensagem: {} },
        { usuario: '1 OR 1=1', tipo: 'entrada; DROP TABLE usuarios', ordem: '__proto__', pagina: '-2' },
        { usuario: '2147483648', tipo: 'constructor', ordem: 'constructor', pagina: 'Infinity' },
        { usuario: '-1', tipo: 'toString', ordem: 'antigas; DROP TABLE usuarios', pagina: '1.5' },
        { usuario: '0', pagina: '9007199254740992' }
    ]) {
        const state = harness();
        const response = await state.invoke(query);
        assert.equal(response.statusCode, 200);
        assert.deepEqual(response.locals.filters, { q: '', tipo: 'todos', usuario: '', de: '', ate: '', ordem: 'recentes' });
        assert.equal(response.locals.pagination.page, 1);
        assert.equal(response.locals.mensagem, '');
        assert.deepEqual(state.calls.queries[3].values, [20, 0]);
        assert.match(state.calls.queries[3].sql, /ORDER BY m\.data_movimentacao DESC NULLS LAST, m\.id_movimentacao DESC/);
        assert.doesNotMatch(state.calls.queries[3].sql, /DROP TABLE|OR 1=1/);
    }
});

test('movement history: search and feedback strings are bounded without route-side HTML rendering', async () => {
    const state = harness();
    const response = await state.invoke({ q: ' x'.repeat(150), mensagem: '<script>example()</script>' + 'a'.repeat(400) });
    assert.equal(response.locals.filters.q.length, 120);
    assert.equal(response.locals.mensagem.length, 300);
    assert.ok(response.locals.mensagem.startsWith('<script>example()</script>'));
});

test('movement history: each read failure renders 503 unavailable instead of an empty successful history', async () => {
    for (const failAt of [0, 1, 2, 3]) {
        const state = harness({ failAt });
        const response = await state.invoke({ q: 'Pão', mensagem: 'Success' });
        assert.equal(response.statusCode, 503);
        assert.equal(response.view, 'movimentacao');
        assert.equal(response.locals.mainClass, 'main-movements');
        assert.equal(response.locals.summary, null);
        assert.equal(response.locals.geradoEm, null);
        assert.deepEqual(response.locals.pagination, { page: 1, pageSize: 20, total: 0, totalPages: 1 });
        assert.equal(response.locals.filters.q, 'Pão');
        assert.deepEqual(response.locals.movimentacoes, []);
        assert.deepEqual(response.locals.usuarios, []);
        assert.equal(response.locals.mensagem, '');
        assert.ok(response.locals.listError);
        assert.doesNotMatch(response.locals.listError, /Private database diagnostic/);
        assert.equal(state.calls.errors.length, 1);
        assert.doesNotMatch(JSON.stringify(state.calls.errors), /Private database diagnostic/);
    }
});

test('movement legacy search: POST redirects to the canonical GET search without SQL', async () => {
    for (const [pesquisa, target] of [
        ['  Pão & queijo  ', '/movimentacoes/listar?q=' + encodeURIComponent('Pão & queijo')],
        ['', '/movimentacoes/listar'], [undefined, '/movimentacoes/listar'],
        [['a', 'b'], '/movimentacoes/listar'], [{ q: 'text' }, '/movimentacoes/listar'],
        ['x'.repeat(200), '/movimentacoes/listar?q=' + 'x'.repeat(120)]
    ]) {
        const state = harness();
        const response = await state.invoke({}, { method: 'POST', route: '/pesquisar', body: { pesquisa } });
        assert.equal(response.statusCode, 302);
        assert.equal(response.location, target);
        assert.equal(state.calls.queries.length, 0);
    }
});

test('movement history: listing reads only record counts, exposes no credentials and does not sum unrelated quantities', async () => {
    const state = harness();
    await state.invoke();
    for (const { sql } of state.calls.queries) {
        assert.match(sql.trim(), /^SELECT\b/);
        assert.doesNotMatch(sql, /\b(?:INSERT|UPDATE|DELETE|DROP|TRUNCATE|senha|email|telefone)\b/i);
        assert.doesNotMatch(sql, /SUM\(/);
    }
    assert.equal(state.calls.queries[0].sql, 'SELECT id_usuario, usuario AS nome_usuario FROM usuarios ORDER BY usuario ASC, id_usuario ASC');
    for (const route of ['GET /listar', 'POST /cadastro', 'GET /nova_movimentacao', 'GET /listar_estoque', 'POST /pesquisar_estoque', 'POST /pesquisar']) {
        assert.equal(typeof state.handlers.get(route), 'function');
    }
});

test('movement history: authentication middleware guards the entire router before queries can execute', () => {
    const app = fs.readFileSync(path.join(__dirname, '../app.js'), 'utf8');
    assert.match(app, /app\.use\('\/movimentacoes', verificaUsuario, rota_movimentacao\)/);
    const guard = require('../middleware/auth');
    for (const session of [undefined, {}, { user: null }]) {
        let next = false;
        let redirected = '';
        guard({ session }, { redirect(value) { redirected = value; } }, () => { next = true; });
        assert.equal(next, false);
        assert.ok(redirected.startsWith('/usuarios/login?mensagem='));
    }
    let next = false;
    guard({ session: { user: { id_usuario: 9 } } }, { redirect() { assert.fail('An authenticated reader must not redirect'); } }, () => { next = true; });
    assert.equal(next, true);
});
