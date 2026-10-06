const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../routes/categorias.js'), 'utf8');
function harness({ rows = [{ id_categoria: 3, nome: 'Bebidas' }], failure = false } = {}) {
  const routes = new Map(), queries = [], logs = [];
  const router = { get: (p, f) => routes.set('GET ' + p, f), post: (p, f) => routes.set('POST ' + p, f) };
  vm.runInNewContext(source, { module: { exports: {} }, console: { error: (...args) => logs.push(args) }, require: name => name === 'express' ? { Router: () => router } : { query: async (sql, values) => { queries.push({ sql, values: Array.from(values) }); if (failure) throw Object.assign(new Error('private-data'), { code: 'TEST' }); return { rows }; } } });
  return { queries, logs, async invoke(method = 'GET', body = {}, id = '3') {
    const res = { statusCode: 200, status(v) { this.statusCode = v; return this; }, render(view, locals) { this.view = view; this.locals = JSON.parse(JSON.stringify(locals)); return this; }, redirect(v) { this.location = v; return this; } };
    await routes.get(method + ' /alterar/:id_categoria')({ params: { id_categoria: id }, body }, res); return res;
  } };
}
test('category edit: GET loads the chosen name and shared edit workspace without mutations', async () => {
  const h = harness(), res = await h.invoke();
  assert.equal(res.locals.mainClass, 'main-category-edit'); assert.equal(res.locals.nome, 'Bebidas'); assert.equal(res.locals.id_categoria, '3');
  assert.equal(res.locals.isEditing, true); assert.equal(h.queries.length, 1); assert.match(h.queries[0].sql, /^SELECT /);
});
test('category edit: malformed IDs perform no queries and missing records are not successful forms', async () => {
  for (const id of ['-1', '0', 'abc', '2147483648']) for (const method of ['GET', 'POST']) { const h = harness(), res = await h.invoke(method, { nome: 'Bebidas' }, id); assert.equal(res.statusCode, 404); assert.equal(h.queries.length, 0); }
  for (const method of ['GET', 'POST']) { const res = await harness({ rows: [] }).invoke(method, { nome: 'Bebidas' }); assert.equal(res.statusCode, 404); assert.equal(res.locals.notFound, true); assert.equal(res.location, undefined); }
});
test('category edit: invalid names retain draft without any update', async () => {
  for (const nome of ['', '  ', 'x'.repeat(101), null, ['A']]) {
    const h = harness(), res = await h.invoke('POST', { nome });
    assert.equal(res.statusCode, 400); assert.ok(res.locals.fieldError); assert.equal(res.locals.submitted, true); assert.equal(h.queries.length, 0);
    assert.equal(res.locals.nome, typeof nome === 'string' ? nome.trim() : '');
  }
});
test('category edit: updates only the name, parameterizes text and reports actual success', async () => {
  const h = harness(), value = "Bebidas'); --", res = await h.invoke('POST', { nome: '  ' + value + '  ', estoque: 100 });
  assert.equal(h.queries.length, 1); assert.deepEqual(h.queries[0].values, [value, 3]);
  assert.equal(h.queries[0].sql, 'UPDATE categorias SET nome = $1 WHERE id_categoria = $2 RETURNING id_categoria');
  assert.ok(res.location.includes(encodeURIComponent('Categoria alterada com sucesso!')));
});
test('category edit: load/save failures are styled, generic and preserve the name on POST', async () => {
  for (const method of ['GET', 'POST']) {
    const h = harness({ failure: true }), res = await h.invoke(method, { nome: 'Rascunho' });
    assert.equal(res.statusCode, 503); assert.equal(res.view, 'alterar_categoria'); assert.doesNotMatch(JSON.stringify(res.locals), /private-data/);
    if (method === 'POST') { assert.equal(res.locals.nome, 'Rascunho'); assert.ok(res.locals.formError); } else assert.ok(res.locals.loadError);
    assert.doesNotMatch(JSON.stringify(h.logs), /private-data|Rascunho/);
  }
});
