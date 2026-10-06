const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// Only mock SQL calls: never load the real connection or remove demonstration data.
function harness({ results = [], failAt = -1, code } = {}) {
    const handlers = new Map();
    const calls = { queries: [], errors: [] };
    const router = {
        get(route, callback) { handlers.set('GET ' + route, callback); },
        post(route, callback) { handlers.set('POST ' + route, callback); }
    };
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../routes/produtos.js'), 'utf8'), {
        module: { exports: {} },
        console: { error: (...args) => calls.errors.push(args), log() {} },
        require(name) {
            if (name === 'express') return { Router: () => router };
            if (name === '../conexao') return { async query(sql, values) {
                const index = calls.queries.length;
                calls.queries.push({ sql, values: Array.from(values || []) });
                if (index === failAt) throw Object.assign(new Error('Private database diagnostic'), { code });
                return { rows: results[index] || [] };
            } };
            throw new Error('Unexpected dependency: ' + name);
        }
    });
    return { calls, async remove(id_produto, session = { user: { id_usuario: 9 } }) {
        const response = { redirect(location) { this.location = location; return this; } };
        await handlers.get('POST /excluir/:id_produto')({ params: { id_produto }, session }, response);
        return response;
    } };
}

test('product removal: authentication is checked before querying or deleting', async () => {
    for (const session of [null, {}, { user: {} }, { user: { id_usuario: 0 } }, { user: { id_usuario: ['9'] } }]) {
        const h = harness();
        assert.equal((await h.remove('12', session)).location, '/usuarios/login');
        assert.equal(h.calls.queries.length, 0);
    }
});

test('product removal: invalid identifiers never reach a database statement', async () => {
    for (const id of ['', '0', '-1', '1.5', '2147483648', '1 OR 1=1', undefined, {}, ['1']]) {
        const h = harness();
        assert.equal((await h.remove(id)).location, '/produtos/listar?aviso=id-invalido');
        assert.equal(h.calls.queries.length, 0);
    }
});

test('product removal: product without history uses an atomic guard and reports only confirmed deletion', async () => {
    const h = harness({ results: [[{ id_produto: 12 }]] });
    const response = await h.remove('0012');
    assert.equal(response.location, '/produtos/listar?mensagem=' + encodeURIComponent('Produto excluído com sucesso!'));
    assert.equal(h.calls.queries.length, 1);
    assert.deepEqual(h.calls.queries[0].values, [12]);
    assert.match(h.calls.queries[0].sql, /^DELETE FROM produtos p WHERE p\.id_produto = \$1/);
    assert.match(h.calls.queries[0].sql, /AND NOT EXISTS \(SELECT 1 FROM movimentacoes m WHERE m\.id_produto = p\.id_produto\)/);
    assert.match(h.calls.queries[0].sql, /RETURNING p\.id_produto/);
    assert.doesNotMatch(h.calls.queries[0].sql, /CASCADE|UPDATE|DELETE FROM movimentacoes/);
});

test('product removal: no deleted row distinguishes historical products from missing products', async () => {
    for (const [product_exists, notice] of [[true, 'em-uso'], [false, 'nao-encontrado']]) {
        const h = harness({ results: [[], [{ product_exists }]] });
        assert.equal((await h.remove('12')).location, '/produtos/listar?aviso=' + notice);
        assert.equal(h.calls.queries.length, 2);
        assert.match(h.calls.queries[1].sql, /^SELECT EXISTS/);
        assert.deepEqual(h.calls.queries[1].values, [12]);
        assert.equal(h.calls.errors.length, 0);
    }
});

test('product removal: concurrent foreign-key conflict preserves history and stays in the list', async () => {
    const h = harness({ failAt: 0, code: '23503' });
    assert.equal((await h.remove('12')).location, '/produtos/listar?aviso=em-uso');
    assert.equal(h.calls.queries.length, 1);
    assert.equal(h.calls.errors.length, 0);
});

test('product removal: read/write failures do not claim success or expose diagnostics', async () => {
    for (const failAt of [0, 1]) {
        const h = harness({ results: [[]], failAt, code: 'ECONNREFUSED' });
        assert.equal((await h.remove('12')).location, '/produtos/listar?aviso=falha');
        assert.equal(h.calls.queries.length, failAt + 1);
        assert.deepEqual(h.calls.errors, [['Erro ao excluir produto:', 'ECONNREFUSED']]);
        assert.doesNotMatch(JSON.stringify(h.calls.errors), /Private database diagnostic/);
    }
});
