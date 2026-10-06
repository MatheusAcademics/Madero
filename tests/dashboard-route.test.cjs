const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../routes/painel.js'), 'utf8');

// Exercise the route without opening a connection or writing demonstration data.
function createHarness({ results = [[], [], [], [], []], error, failAt = 0 } = {}) {
    const calls = { queries: [], errors: [] };
    let handler;
    const router = { get(route, callback) {
        assert.equal(route, '/');
        handler = callback;
    } };
    const dependencies = {
        express: { Router: () => router },
        '../conexao': {
            async query(sql, values) {
                const index = calls.queries.length;
                calls.queries.push({ sql, values: values ? Array.from(values) : [] });
                if (error && index === failAt) throw error;
                return { rows: results[index] || [] };
            }
        }
    };
    vm.runInNewContext(source, {
        module: { exports: {} },
        console: { error: (...args) => calls.errors.push(args) },
        require(name) {
            assert.ok(Object.hasOwn(dependencies, name), `Unexpected dependency: ${name}`);
            return dependencies[name];
        }
    }, { filename: 'routes/painel.js' });

    return {
        calls,
        async invoke(query = {}) {
            const res = {
                statusCode: 200,
                status(code) {
                    this.statusCode = code;
                    return this;
                },
                render(view, locals) {
                    this.view = view;
                    this.locals = JSON.parse(JSON.stringify(locals));
                    return this;
                }
            };
            await handler({ query }, res);
            return res;
        }
    };
}

test('empty database renders a real zero-state with the dashboard layout', async () => {
    const harness = createHarness({ results: [[{
        total_produtos: '0', total_estoque: null, total_categorias: '0',
        total_movimentacoes: '0', valor_total_estoque: null, produtos_abaixo_minimo: '0'
    }]] });
    const res = await harness.invoke();
    assert.equal(res.statusCode, 200);
    assert.equal(res.view, 'painel');
    assert.equal(res.locals.mainClass, 'main-dashboard');
    assert.equal(res.locals.mensagem, '');
    assert.equal(res.locals.dashboardError, null);
    const { geradoEm, ...data } = res.locals.data;
    assert.ok(Number.isFinite(Date.parse(geradoEm)));
    assert.deepEqual(data, {
        totalProdutos: 0, totalEstoque: 0, totalCategorias: 0,
        totalMovimentacoes: 0, valorTotalEstoqueNumero: 0, valorTotalEstoque: '0,00',
        produtosAbaixoMinimo: 0, produtosAbaixoMinimoList: [],
        categorias: { labels: [], values: [] },
        produtos: { labels: [], values: [] }, produtosRanking: [], ultimasMovimentacoes: []
    });
});

test('populated dashboard distinguishes product count from stock and normalizes PostgreSQL numerics', async () => {
    const harness = createHarness({ results: [
        [{ total_produtos: '9', total_estoque: '120.50', total_categorias: '3',
            total_movimentacoes: '12', valor_total_estoque: '2510.25', produtos_abaixo_minimo: '1' }],
        [{ id_produto: 4, nome_produto: 'Queijo', estoque: '2.50', estoque_minimo: '5.00',
            valor: '18.90', imagem: 'queijo.jpg', nome_categoria: 'Ingredientes' }],
        [{ id_categoria: 1, nome: 'Ingredientes', valor_total: '2510.25' },
            { id_categoria: 2, nome: 'Embalagens', valor_total: '0' }],
        [{ id_produto: 6, nome: 'Pão', estoque: '100.00', nome_categoria: 'Ingredientes' }],
        [{ id_movimentacao: 2, tipo_movimentacao: 'Saída', data_movimentacao: '2026-09-18T14:30:00.000Z',
            quantidade: '1.50', descricao: 'Preparação', nome_produto: 'Queijo', nome_usuario: 'ana' }]
    ] });
    const { locals: { data } } = await harness.invoke();
    assert.equal(data.totalProdutos, 9);
    assert.equal(data.totalEstoque, 120.5);
    assert.equal(data.totalCategorias, 3);
    assert.equal(data.totalMovimentacoes, 12);
    assert.equal(data.produtosAbaixoMinimo, 1);
    assert.equal(data.valorTotalEstoqueNumero, 2510.25);
    assert.equal(data.valorTotalEstoque, '2510,25');
    assert.deepEqual(data.produtosAbaixoMinimoList[0], {
        id_produto: 4, nome_produto: 'Queijo', estoque: 2.5, estoque_minimo: 5,
        valor: 18.9, imagem: 'queijo.jpg', nome_categoria: 'Ingredientes'
    });
    assert.deepEqual(data.categorias, { labels: ['Ingredientes', 'Embalagens'], values: [2510.25, 0] });
    assert.deepEqual(data.produtos, { labels: ['Pão'], values: [100] });
    assert.deepEqual(data.produtosRanking, [{ id_produto: 6, nome: 'Pão', estoque: 100, nome_categoria: 'Ingredientes' }]);
    assert.deepEqual(data.ultimasMovimentacoes[0], {
        id_movimentacao: 2, tipo_movimentacao: 'Saída', data_movimentacao: '2026-09-18T14:30:00.000Z',
        quantidade: 1.5, descricao: 'Preparação', nome_produto: 'Queijo', nome_usuario: 'ana'
    });
});

test('zero and negative values remain honest instead of being clamped for charts', async () => {
    const harness = createHarness({ results: [
        [{ total_produtos: '2', total_estoque: '-2.75', total_categorias: '2',
            total_movimentacoes: '0', valor_total_estoque: '-10.50', produtos_abaixo_minimo: '1' }],
        [{ id_produto: 2, estoque: '-2.75', estoque_minimo: '0', valor: '3' }],
        [{ nome: 'Ingredientes', valor_total: '-10.50' }, { nome: 'Ingredientes', valor_total: '0' }],
        [{ nome: 'Pão', estoque: '0' }, { nome: 'Queijo', estoque: '-2.75' }], []
    ] });
    const { locals: { data } } = await harness.invoke();
    assert.equal(data.totalEstoque, -2.75);
    assert.equal(data.valorTotalEstoqueNumero, -10.5);
    assert.equal(data.valorTotalEstoque, '-10,50');
    assert.equal(data.produtosAbaixoMinimoList[0].estoque, -2.75);
    assert.equal(data.produtosAbaixoMinimoList[0].estoque_minimo, 0);
    assert.deepEqual(data.produtos.values, [0, -2.75]);
    assert.deepEqual(data.categorias, { labels: ['Ingredientes', 'Ingredientes'], values: [-10.5, 0] });
});

test('queries only read dashboard data, parameterize limits, and have deterministic ordering', async () => {
    const harness = createHarness();
    await harness.invoke({ mensagem: "'; DROP TABLE produtos; --" });
    assert.equal(harness.calls.queries.length, 5);
    for (const { sql } of harness.calls.queries) {
        assert.match(sql.trim(), /^SELECT\b/);
        assert.doesNotMatch(sql, /\b(?:INSERT|UPDATE|DELETE|DROP|TRUNCATE)\b/i);
        assert.doesNotMatch(sql, /\b(?:senha|email|telefone)\b/i);
    }
    assert.match(harness.calls.queries[0].sql, /COUNT\(\*\) AS total_produtos/);
    assert.match(harness.calls.queries[0].sql, /SUM\(estoque\)/);
    assert.match(harness.calls.queries[1].sql, /ORDER BY \(p\.estoque_minimo - p\.estoque\) DESC,\s*p\.estoque ASC, p\.id_produto ASC/);
    assert.match(harness.calls.queries[2].sql, /GROUP BY c\.id_categoria, c\.nome/);
    assert.match(harness.calls.queries[3].sql, /ORDER BY p\.estoque DESC, p\.nome ASC, p\.id_produto ASC/);
    assert.match(harness.calls.queries[4].sql, /ORDER BY m\.data_movimentacao DESC, m\.id_movimentacao DESC/);
    assert.deepEqual(harness.calls.queries.map(call => call.values), [[], [], [], [5], [5]]);
    assert.match(harness.calls.queries[3].sql, /LIMIT \$1/);
    assert.match(harness.calls.queries[4].sql, /LIMIT \$1/);
});

test('message accepts only a bounded, trimmed string and is never interpolated in SQL', async () => {
    for (const [mensagem, expected] of [
        ['  Tudo certo.  ', 'Tudo certo.'],
        ['x'.repeat(400), 'x'.repeat(240)],
        [['unexpected', 'array'], ''],
        [{ unexpected: 'object' }, ''],
        [null, ''], [123, '']
    ]) {
        const harness = createHarness();
        const res = await harness.invoke({ mensagem });
        assert.equal(res.locals.mensagem, expected);
        assert.deepEqual(harness.calls.queries.map(call => call.values), [[], [], [], [5], [5]]);
    }
});

test('database failures render an unavailable state, never a misleading empty stock', async () => {
    const error = Object.assign(new Error('Sensitive connection and query details'), { code: '3D000' });
    for (const failAt of [0, 4]) {
        const harness = createHarness({ error, failAt });
        const res = await harness.invoke();
        assert.equal(res.statusCode, 503);
        assert.equal(res.view, 'painel');
        assert.equal(res.locals.mainClass, 'main-dashboard');
        assert.equal(res.locals.data, null);
        assert.match(res.locals.dashboardError, /Não foi possível carregar/);
        assert.match(res.locals.dashboardError, /Atualize/);
        assert.equal(JSON.stringify(res.locals).includes(error.message), false);
        assert.equal(JSON.stringify(harness.calls.errors).includes(error.message), false);
        assert.equal(harness.calls.errors[0][1], '3D000');
    }
});
