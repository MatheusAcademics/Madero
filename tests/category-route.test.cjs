const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../routes/categorias.js'), 'utf8');

// All database calls are captured by this mock. No connection or real insert is made.
function harness({ failure } = {}) {
    const handlers = new Map();
    const calls = { queries: [], errors: [] };
    const router = {
        get(route, handler) { handlers.set('GET ' + route, handler); },
        post(route, handler) { handlers.set('POST ' + route, handler); }
    };
    vm.runInNewContext(source, {
        module: { exports: {} },
        console: { error: (...args) => calls.errors.push(args), log() {} },
        require(name) {
            if (name === 'express') return { Router: () => router };
            if (name === '../conexao') return {
                async query(sql, values) {
                    calls.queries.push({ sql, values: values ? Array.from(values) : [] });
                    if (failure) throw failure;
                    return { rows: [], rowCount: 1 };
                }
            };
            throw new Error('Unexpected dependency: ' + name);
        }
    }, { filename: 'routes/categorias.js' });

    return {
        calls, handlers,
        async invoke(body, method = 'POST') {
            const response = {
                statusCode: 200,
                status(code) { this.statusCode = code; return this; },
                render(view, locals) { this.view = view; this.locals = JSON.parse(JSON.stringify(locals)); return this; },
                redirect(target) { this.statusCode = 302; this.location = target; return this; }
            };
            await handlers.get(method + ' /cadastro')({ body }, response);
            return response;
        }
    };
}

test('category registration: GET opens an empty workspace form without querying the database', async () => {
    const state = harness();
    const response = await state.invoke(undefined, 'GET');
    assert.equal(response.statusCode, 200);
    assert.equal(response.view, 'nova_categoria');
    assert.deepEqual(response.locals, {
        mainClass: 'main-category-form', nome: '', fieldError: '', formError: ''
    });
    assert.equal(state.calls.queries.length, 0);
});

test('category registration: empty and whitespace-only names are rejected without an insert', async () => {
    for (const nome of ['', ' ', '\t\n\r ', '\u00a0']) {
        const state = harness();
        const response = await state.invoke({ nome });
        assert.equal(response.statusCode, 400);
        assert.equal(response.view, 'nova_categoria');
        assert.equal(response.locals.mainClass, 'main-category-form');
        assert.equal(response.locals.nome, '');
        assert.equal(response.locals.fieldError, 'Informe o nome da categoria.');
        assert.equal(response.locals.formError, '');
        assert.equal(response.location, undefined);
        assert.equal(state.calls.queries.length, 0);
    }
});

test('category registration: absent and non-string inputs are rejected instead of being coerced', async () => {
    for (const body of [undefined, null, {}, { nome: null }, { nome: 12 }, { nome: true }, { nome: ['A', 'B'] }, { nome: { value: 'A' } }]) {
        const state = harness();
        const response = await state.invoke(body);
        assert.equal(response.statusCode, 400);
        assert.equal(response.locals.nome, '');
        assert.ok(response.locals.fieldError);
        assert.equal(state.calls.queries.length, 0);
    }
});

test('category registration: valid names are trimmed with spelling and internal spaces preserved', async () => {
    const state = harness();
    const response = await state.invoke({ nome: '  Pães  & refeições  ' });
    assert.equal(response.statusCode, 302);
    assert.deepEqual(state.calls.queries, [{
        sql: 'INSERT INTO categorias (nome) VALUES ($1)', values: ['Pães  & refeições']
    }]);
    assert.equal(state.calls.errors.length, 0);
});

test('category registration: the 100-character application limit is accepted after trimming', async () => {
    for (const nome of ['A', 'Á'.repeat(100), '  ' + 'A'.repeat(100) + '  ']) {
        const state = harness();
        const response = await state.invoke({ nome });
        assert.equal(response.statusCode, 302);
        assert.deepEqual(state.calls.queries[0].values, [nome.trim()]);
        assert.equal(state.calls.queries.length, 1);
    }
});

test('category registration: oversized names remain available for correction without querying the database', async () => {
    const nome = 'A'.repeat(101);
    const state = harness();
    const response = await state.invoke({ nome: ' ' + nome + ' ' });
    assert.equal(response.statusCode, 400);
    assert.equal(response.locals.nome, nome);
    assert.match(response.locals.fieldError, /100 caracteres/);
    assert.equal(response.locals.formError, '');
    assert.equal(state.calls.queries.length, 0);
});

test('category registration: SQL and HTML-shaped names remain parameter values, never query text', async () => {
    for (const nome of ["Ingredientes'); DROP TABLE categorias; --", '<script>alert("nome")</script>']) {
        const state = harness();
        const response = await state.invoke({ nome });
        assert.equal(response.statusCode, 302);
        assert.equal(state.calls.queries[0].sql, 'INSERT INTO categorias (nome) VALUES ($1)');
        assert.deepEqual(state.calls.queries[0].values, [nome]);
        assert.doesNotMatch(state.calls.queries[0].sql, /DROP|script/);
    }
});

test('category registration: success keeps the category listing redirect with an encoded feedback message', async () => {
    const state = harness();
    const response = await state.invoke({ nome: 'Bebidas' });
    assert.equal(response.statusCode, 302);
    assert.equal(response.location, '/categorias/listar?mensagem=' + encodeURIComponent('Categoria cadastrada com sucesso!'));
    assert.equal(response.view, undefined);
    assert.equal(state.calls.queries.length, 1);
});

test('category registration: database failures preserve the name with generic feedback, including unknown uniqueness violations', async () => {
    for (const code of [undefined, 'ECONNREFUSED', '23505']) {
        const failure = Object.assign(new Error('Private SQL diagnostic containing Bebidas'), { code, detail: 'Sensitive database detail' });
        const state = harness({ failure });
        const response = await state.invoke({ nome: '  Bebidas  ' });
        assert.equal(response.statusCode, 503);
        assert.equal(response.view, 'nova_categoria');
        assert.equal(response.locals.mainClass, 'main-category-form');
        assert.equal(response.locals.nome, 'Bebidas');
        assert.equal(response.locals.fieldError, '');
        assert.ok(response.locals.formError);
        assert.doesNotMatch(response.locals.formError, /Private|SQL|Sensitive|23505|ECONNREFUSED|duplic|existente/i);
        assert.equal(response.location, undefined);
        assert.equal(state.calls.queries.length, 1);
        assert.deepEqual(state.calls.errors, [['Erro ao cadastrar categoria:', code || 'unknown']]);
        assert.doesNotMatch(JSON.stringify(state.calls.errors), /Bebidas|Private|Sensitive/);
    }
});

test('category registration: existing category endpoints and session protection are retained', () => {
    const state = harness();
    for (const route of ['GET /cadastro', 'POST /cadastro', 'GET /listar', 'POST /pesquisar', 'GET /alterar/:id_categoria', 'POST /alterar/:id_categoria', 'POST /excluir/:id_categoria']) {
        assert.equal(typeof state.handlers.get(route), 'function', route);
    }
    const app = fs.readFileSync(path.join(__dirname, '../app.js'), 'utf8');
    assert.match(app, /app\.use\('\/categorias', verificaUsuario, rota_categoria\)/);
});
