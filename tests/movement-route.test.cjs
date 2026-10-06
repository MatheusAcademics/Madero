const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../routes/movimentacoes.js'), 'utf8');
const validBody = {
    tipo_movimentacao: 'Entrada', data_movimentacao: '2026-09-29', quantidade: '2.50',
    descricao: 'Reposição da cozinha', id_produto: '4', id_usuario: '9'
};

// Database dependencies are completely mocked. These tests never connect to PostgreSQL.
function harness({
    products = [{ id_produto: 4, nome: 'Pão', estoque: '10.25', estoque_minimo: '5.00' }],
    users = [{ id_usuario: 9, nome_usuario: 'responsável' }],
    product = { id_produto: 4, estoque: '10.25' },
    user = { id_usuario: 9 },
    failAt = [],
    now = '2026-09-30T01:30:00.000Z'
} = {}) {
    const handlers = new Map();
    const calls = { poolQueries: [], clientQueries: [], connects: 0, releases: [], errors: [], events: [] };
    const failures = new Set(failAt);
    const failure = Object.assign(new Error('Private database diagnostic'), { code: 'TEST_DB_ERROR', detail: 'Sensitive values' });
    const check = stage => { if (failures.has(stage)) throw failure; };
    const client = {
        async query(sql, values) {
            const query = { sql: sql.trim(), values: values ? Array.from(values) : [] };
            calls.clientQueries.push(query);
            calls.events.push(query.sql);
            const stage = query.sql === 'BEGIN' ? 'begin' : query.sql === 'COMMIT' ? 'commit'
                : query.sql === 'ROLLBACK' ? 'rollback' : /FOR UPDATE/.test(sql) ? 'product'
                    : /SELECT id_usuario FROM usuarios/.test(sql) ? 'user'
                        : /INSERT INTO movimentacoes/.test(sql) ? 'insert' : /^UPDATE produtos/.test(sql) ? 'update' : '';
            assert.ok(stage, 'Unexpected client query: ' + sql);
            check(stage);
            return { rows: stage === 'product' ? (product ? [product] : []) : stage === 'user' ? (user ? [user] : []) : [], rowCount: 1 };
        },
        release(error) { calls.releases.push(Boolean(error)); calls.events.push('RELEASE'); }
    };
    class FixedDate extends Date {
        constructor(...args) { super(...(args.length ? args : [now])); }
    }
    vm.runInNewContext(source, {
        module: { exports: {} }, Date: FixedDate,
        console: { error: (...args) => calls.errors.push(args), log() {} },
        require(name) {
            if (name === 'express') return { Router: () => ({
                get(route, handler) { handlers.set('GET ' + route, handler); },
                post(route, handler) { handlers.set('POST ' + route, handler); }
            }) };
            if (name === '../conexao') return {
                async connect() { calls.connects++; calls.events.push('CONNECT'); check('connect'); return client; },
                async query(sql, values) {
                    calls.poolQueries.push({ sql, values: values ? Array.from(values) : [] });
                    calls.events.push('POOL ' + sql);
                    assert.match(sql, /^SELECT /);
                    if (/FROM produtos/.test(sql)) { check('loadProduct'); return { rows: products }; }
                    if (/FROM usuarios/.test(sql)) { check('loadUser'); return { rows: users }; }
                    throw new Error('Unexpected pool query');
                }
            };
            throw new Error('Unexpected dependency: ' + name);
        }
    }, { filename: 'routes/movimentacoes.js' });
    return {
        calls, handlers,
        async invoke(body = validBody, { method = 'POST', session = { user: { id_usuario: 2 } } } = {}) {
            const response = {
                statusCode: 200,
                status(code) { this.statusCode = code; return this; },
                render(view, locals) { this.view = view; this.locals = JSON.parse(JSON.stringify(locals)); return this; },
                redirect(target) { this.statusCode = 302; this.location = target; return this; },
                send(text) { this.text = text; return this; }
            };
            const route = method === 'GET' ? '/nova_movimentacao' : '/cadastro';
            await handlers.get(method + ' ' + route)({ body, session }, response);
            return response;
        }
    };
}

const statements = state => state.calls.clientQueries.map(call => call.sql);
const mutations = state => state.calls.clientQueries.filter(call => /^(INSERT|UPDATE|DELETE)\b/.test(call.sql));
const queryAt = (state, prefix) => state.calls.clientQueries.find(call => call.sql.startsWith(prefix));

test('movement form: GET loads sorted names and real stock without exposing private user fields', async () => {
    const state = harness();
    const response = await state.invoke(undefined, { method: 'GET' });
    assert.equal(response.statusCode, 200);
    assert.equal(response.view, 'nova_movimentacao');
    assert.equal(response.locals.mainClass, 'main-movement-form');
    assert.deepEqual(response.locals.produtos, [{ id_produto: 4, nome: 'Pão', estoque: '10.25', estoque_minimo: '5.00' }]);
    assert.deepEqual(response.locals.usuarios, [{ id_usuario: 9, nome_usuario: 'responsável' }]);
    assert.equal(response.locals.usuarioID, 2);
    assert.deepEqual(response.locals.errors, {});
    assert.equal(response.locals.formError, '');
    assert.equal(response.locals.loadError, '');
    assert.equal(response.locals.submitted, false);
    assert.match(state.calls.poolQueries[0].sql, /ORDER BY nome ASC, id_produto ASC/);
    assert.match(state.calls.poolQueries[1].sql, /ORDER BY usuario ASC, id_usuario ASC/);
    for (const { sql } of state.calls.poolQueries) assert.doesNotMatch(sql, /\b(senha|email|telefone)\b/i);
    assert.equal(state.calls.connects, 0);
});

test('movement form: date uses the São Paulo day and current user is only a default selection', async () => {
    const state = harness({ now: '2026-09-30T01:30:00.000Z' });
    const response = await state.invoke(undefined, { method: 'GET' });
    assert.deepEqual(response.locals.values, {
        tipo_movimentacao: 'Entrada', data_movimentacao: '2026-09-29',
        quantidade: '', descricao: '', id_produto: '', id_usuario: '2'
    });
});

test('movement form: an empty catalog is distinguished from unavailable data', async () => {
    const empty = harness({ products: [], users: [] });
    const response = await empty.invoke(undefined, { method: 'GET' });
    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.locals.produtos, []);
    assert.deepEqual(response.locals.usuarios, []);
    assert.equal(response.locals.loadError, '');
    for (const fail of ['loadProduct', 'loadUser']) {
        const state = harness({ failAt: [fail] });
        const failed = await state.invoke(undefined, { method: 'GET' });
        assert.equal(failed.statusCode, 503);
        assert.deepEqual(failed.locals.produtos, []);
        assert.deepEqual(failed.locals.usuarios, []);
        assert.ok(failed.locals.loadError);
        assert.equal(failed.locals.submitted, false);
        assert.doesNotMatch(failed.locals.loadError, /Private|Sensitive|TEST_DB_ERROR/);
    }
});

test('movement form: unauthenticated GET and POST return before any database operation', async () => {
    for (const session of [undefined, null, {}, { user: null }, { user: {} }]) {
        for (const method of ['GET', 'POST']) {
            const state = harness();
            const response = await state.invoke(validBody, { method, session: session ?? null });
            assert.equal(response.statusCode, 401);
            assert.equal(state.calls.poolQueries.length, 0);
            assert.equal(state.calls.clientQueries.length, 0);
            assert.equal(state.calls.connects, 0);
        }
    }
});

test('movement form: missing and non-string payloads produce field errors instead of coercion or writes', async () => {
    for (const body of [null, {}, Object.fromEntries(Object.keys(validBody).map(key => [key, ['unexpected']])), Object.fromEntries(Object.keys(validBody).map(key => [key, {}]))]) {
        const state = harness();
        const response = await state.invoke(body);
        assert.equal(response.statusCode, 400);
        assert.deepEqual(Object.keys(response.locals.errors).sort(), ['data_movimentacao', 'id_produto', 'id_usuario', 'quantidade', 'tipo_movimentacao']);
        assert.deepEqual(response.locals.values, Object.fromEntries(Object.keys(validBody).map(key => [key, ''])));
        assert.equal(response.locals.submitted, true);
        assert.equal(state.calls.connects, 0);
        assert.equal(mutations(state).length, 0);
    }
});

test('movement form: movement type is validated before opening a transaction', async () => {
    for (const tipo_movimentacao of ['', 'entrada', 'Saida', 'Ajuste', 'UPDATE produtos SET estoque=0']) {
        const state = harness();
        const response = await state.invoke({ ...validBody, tipo_movimentacao });
        assert.equal(response.statusCode, 400);
        assert.ok(response.locals.errors.tipo_movimentacao);
        assert.equal(response.locals.values.tipo_movimentacao, tipo_movimentacao);
        assert.equal(state.calls.connects, 0);
    }
});

test('movement form: quantities reject zero, negative, non-finite, scientific and precision/range overflow', async () => {
    for (const quantidade of ['', '0', '0.00', '-0', '-0.01', '-2.50', '0.001', '1.001', '1e2', 'NaN', 'Infinity', '+2', '2,50', '2.', '.25', '10000000000', '9999999999.999', '2147483648.111', 2, null, ['2']]) {
        const state = harness();
        const response = await state.invoke({ ...validBody, quantidade });
        assert.equal(response.statusCode, 400, String(quantidade));
        assert.ok(response.locals.errors.quantidade);
        assert.equal(state.calls.connects, 0);
        assert.equal(mutations(state).length, 0);
    }
});

test('movement form: valid positive whole and hundredth quantities are never rounded', async () => {
    for (const quantidade of ['0.01', '0.10', '1', '1.2', '2.50', '9999999999.99']) {
        const state = harness({ product: { id_produto: 4, estoque: '0.00' } });
        const response = await state.invoke({ ...validBody, quantidade });
        assert.equal(response.statusCode, 302, quantidade);
        assert.equal(queryAt(state, 'INSERT').values[2], quantidade);
        assert.equal(queryAt(state, 'UPDATE').values[0], quantidade);
        assert.deepEqual(state.calls.releases, [false]);
    }
});

test('movement form: dates require an actual calendar day without silently rolling over', async () => {
    for (const data_movimentacao of ['', '2026-02-29', '2026-04-31', '2026-13-01', '2026-00-10', '2026-01-00', '2026-1-2', '0000-01-01', '29/09/2026', '2026-09-29T10:00:00Z', '2026-09-29 OR 1=1']) {
        const state = harness();
        const response = await state.invoke({ ...validBody, data_movimentacao });
        assert.equal(response.statusCode, 400, data_movimentacao);
        assert.ok(response.locals.errors.data_movimentacao);
        assert.equal(state.calls.connects, 0);
    }
    for (const data_movimentacao of ['2024-02-29', '2026-09-29', '0001-01-01', '9999-12-31']) {
        const state = harness();
        const response = await state.invoke({ ...validBody, data_movimentacao });
        assert.equal(response.statusCode, 302, data_movimentacao);
        assert.equal(queryAt(state, 'INSERT').values[1], data_movimentacao);
    }
});

test('movement form: product and user identifiers must be positive PostgreSQL integers', async () => {
    for (const field of ['id_produto', 'id_usuario']) {
        for (const invalid of ['', '0', '-1', '1.5', '1e2', 'Infinity', '2147483648', '9007199254740992', '1 OR 1=1', ['1'], { id: 1 }]) {
            const state = harness();
            const response = await state.invoke({ ...validBody, [field]: invalid });
            assert.equal(response.statusCode, 400);
            assert.ok(response.locals.errors[field]);
            assert.equal(state.calls.connects, 0);
        }
    }
});

test('movement form: optional description supports 1000 characters but rejects longer text and preserves correction values', async () => {
    for (const descricao of ['', ' ', 'á'.repeat(1000)]) {
        const state = harness();
        const response = await state.invoke({ ...validBody, descricao });
        assert.equal(response.statusCode, 302);
        assert.equal(queryAt(state, 'INSERT').values[3], descricao.trim() || null);
    }
    const state = harness();
    const response = await state.invoke({ ...validBody, descricao: 'á'.repeat(1001) });
    assert.equal(response.statusCode, 400);
    assert.equal(response.locals.values.descricao.length, 1001);
    assert.ok(response.locals.errors.descricao);
    assert.equal(state.calls.connects, 0);
});

test('movement form: entry writes registration and increase in the same transaction after locking the product', async () => {
    const state = harness();
    const response = await state.invoke(validBody);
    assert.equal(response.statusCode, 302);
    assert.equal(state.calls.connects, 1);
    assert.equal(state.calls.poolQueries.length, 0);
    assert.equal(statements(state)[0], 'BEGIN');
    assert.match(statements(state)[1], /WHERE id_produto = \$1 FOR UPDATE$/);
    assert.deepEqual(state.calls.clientQueries[1].values, [4]);
    assert.match(statements(state)[2], /^SELECT id_usuario FROM usuarios WHERE id_usuario = \$1$/);
    assert.deepEqual(queryAt(state, 'INSERT').values, ['Entrada', '2026-09-29', '2.50', 'Reposição da cozinha', 4, 9]);
    assert.equal(queryAt(state, 'UPDATE').sql, 'UPDATE produtos SET estoque = estoque + $1 WHERE id_produto = $2');
    assert.deepEqual(queryAt(state, 'UPDATE').values, ['2.50', 4]);
    assert.equal(statements(state).at(-1), 'COMMIT');
    assert.equal(state.calls.events.at(-1), 'RELEASE');
    assert.deepEqual(state.calls.releases, [false]);
    assert.equal(response.location, '/movimentacoes/listar?mensagem=' + encodeURIComponent('Movimentação cadastrada com sucesso!'));
});

test('movement form: an outgoing movement subtracts once and may still create a negative balance', async () => {
    const state = harness({ product: { id_produto: 4, estoque: '1.00' } });
    const response = await state.invoke({ ...validBody, tipo_movimentacao: 'Saída', quantidade: '2.50' });
    assert.equal(response.statusCode, 302);
    assert.equal(queryAt(state, 'INSERT').values[0], 'Saída');
    assert.equal(queryAt(state, 'UPDATE').sql, 'UPDATE produtos SET estoque = estoque - $1 WHERE id_produto = $2');
    assert.deepEqual(queryAt(state, 'UPDATE').values, ['2.50', 4]);
    assert.equal(mutations(state).length, 2);
});

test('movement form: selected responsible user is preserved rather than silently replaced by logged-in user', async () => {
    const state = harness();
    await state.invoke({ ...validBody, id_usuario: '009', id_produto: '004' }, { session: { user: { id_usuario: 2 } } });
    assert.deepEqual(state.calls.clientQueries[2].values, [9]);
    assert.equal(queryAt(state, 'INSERT').values[5], 9);
    assert.equal(queryAt(state, 'INSERT').values[4], 4);
});

test('movement form: missing selected records cause rollback and field errors before either mutation', async () => {
    for (const config of [{ product: null }, { user: null }, { product: null, user: null }]) {
        const state = harness(config);
        const response = await state.invoke(validBody);
        assert.equal(response.statusCode, 400);
        assert.deepEqual(response.locals.values, validBody);
        assert.equal(response.locals.submitted, true);
        if (config.product === null) assert.ok(response.locals.errors.id_produto);
        if (config.user === null) assert.ok(response.locals.errors.id_usuario);
        assert.equal(statements(state).at(-1), 'ROLLBACK');
        assert.equal(mutations(state).length, 0);
        assert.deepEqual(state.calls.releases, [false]);
        assert.equal(state.calls.poolQueries.length, 2);
        assert.ok(state.calls.events.indexOf('RELEASE') < state.calls.events.findIndex(event => event.startsWith('POOL ')));
    }
});

test('movement form: projected balance range is checked precisely before inserting an entry or exit', async () => {
    for (const [estoque, tipo_movimentacao] of [['9999999999.99', 'Entrada'], ['-9999999999.99', 'Saída']]) {
        const state = harness({ product: { id_produto: 4, estoque } });
        const response = await state.invoke({ ...validBody, tipo_movimentacao, quantidade: '0.01' });
        assert.equal(response.statusCode, 400);
        assert.match(response.locals.errors.quantidade, /limite de saldo/);
        assert.equal(mutations(state).length, 0);
        assert.equal(statements(state).at(-1), 'ROLLBACK');
    }
    for (const [estoque, tipo_movimentacao] of [['9999999999.98', 'Entrada'], ['-9999999999.98', 'Saída'], ['9999999999.99', 'Saída'], ['-9999999999.99', 'Entrada']]) {
        const state = harness({ product: { id_produto: 4, estoque } });
        const response = await state.invoke({ ...validBody, tipo_movimentacao, quantidade: '0.01' });
        assert.equal(response.statusCode, 302);
    }
});

test('movement form: missing or invalid stored stock is not presented as zero or silently overwritten', async () => {
    for (const estoque of [null, undefined, 'NaN', 'Infinity', '1.001']) {
        const state = harness({ product: { id_produto: 4, estoque } });
        const response = await state.invoke(validBody);
        assert.equal(response.statusCode, 503);
        assert.ok(response.locals.formError);
        assert.equal(mutations(state).length, 0);
        assert.equal(statements(state).at(-1), 'ROLLBACK');
        assert.deepEqual(state.calls.releases, [true]);
    }
});

test('movement form: text is trimmed while internal content stays parameterized, never executable SQL', async () => {
    const descricao = "  Conferência'); DROP TABLE produtos; -- <script>bad()</script>  ";
    const state = harness();
    const response = await state.invoke({ ...validBody, quantidade: ' 2.50 ', descricao });
    assert.equal(response.statusCode, 302);
    assert.equal(queryAt(state, 'INSERT').values[3], descricao.trim());
    assert.equal(queryAt(state, 'INSERT').values[2], '2.50');
    for (const { sql } of state.calls.clientQueries) assert.doesNotMatch(sql, /DROP TABLE|script|Conferência/);
});

test('movement form: database transaction failures preserve values, roll back, release client and return generic feedback', async () => {
    for (const fail of ['connect', 'begin', 'product', 'user', 'insert', 'update', 'commit']) {
        const state = harness({ failAt: [fail] });
        const response = await state.invoke(validBody);
        assert.equal(response.statusCode, 503, fail);
        assert.equal(response.view, 'nova_movimentacao');
        assert.equal(response.locals.submitted, true);
        assert.deepEqual(response.locals.values, validBody);
        assert.ok(response.locals.formError);
        assert.equal(response.location, undefined);
        assert.doesNotMatch(response.locals.formError, /Private|Sensitive|TEST_DB_ERROR/);
        assert.doesNotMatch(JSON.stringify(state.calls.errors), /Private|Sensitive|Reposição/);
        if (!['connect', 'begin'].includes(fail)) assert.equal(statements(state).at(-1), 'ROLLBACK');
        assert.deepEqual(state.calls.releases, fail === 'connect' ? [] : [true]);
        if (['connect', 'begin', 'product', 'user'].includes(fail)) assert.equal(mutations(state).length, 0);
        if (fail === 'insert') assert.equal(mutations(state).length, 1);
        if (fail === 'update') assert.doesNotMatch(statements(state).join('\n'), /^COMMIT$/m);
    }
});

test('movement form: rollback failure discards the failed client and never reports success', async () => {
    const state = harness({ failAt: ['update', 'rollback'] });
    const response = await state.invoke(validBody);
    assert.equal(response.statusCode, 503);
    assert.ok(response.locals.formError);
    assert.equal(response.location, undefined);
    assert.deepEqual(state.calls.releases, [true]);
    assert.equal(state.calls.errors.length, 2);
    assert.equal(statements(state).at(-1), 'ROLLBACK');
});

test('movement form: failed option reload preserves submitted text but signals unavailability, not an empty catalog', async () => {
    const state = harness({ failAt: ['update', 'loadProduct'] });
    const response = await state.invoke(validBody);
    assert.equal(response.statusCode, 503);
    assert.deepEqual(response.locals.values, validBody);
    assert.ok(response.locals.formError);
    assert.ok(response.locals.loadError);
    assert.equal(response.locals.submitted, true);
    assert.deepEqual(response.locals.produtos, []);
    assert.deepEqual(response.locals.usuarios, []);
    assert.equal(response.location, undefined);
});

test('movement form: old list/search routes remain registered and all movement routes remain session-protected', () => {
    const state = harness();
    for (const route of ['GET /listar', 'GET /listar_estoque', 'POST /pesquisar_estoque', 'POST /pesquisar', 'GET /nova_movimentacao', 'POST /cadastro']) {
        assert.equal(typeof state.handlers.get(route), 'function', route);
    }
    const app = fs.readFileSync(path.join(__dirname, '../app.js'), 'utf8');
    assert.match(app, /app\.use\('\/movimentacoes', verificaUsuario, rota_movimentacao\)/);
});
