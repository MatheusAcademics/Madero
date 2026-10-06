const test = require('node:test');
const assert = require('node:assert/strict');
const { seedDemo, marker, catalog, checkAssets } = require('../scripts/seed-demo.cjs');

function harness({ missingUser = false, failMovement = false } = {}) {
  const state = { categories: [{ id_categoria: 1, nome: 'Existente' }],
    products: [{ id_produto: 1, nome: 'Produto original', estoque: '9', imagem: '/img/original.jpg', id_categoria: 1 }], movements: [] };
  const calls = [];
  let snapshot, releases = 0;
  const client = { release() { releases++; }, async query(sql, args = []) {
    sql = sql.trim(); calls.push({ sql, args });
    if (sql === 'BEGIN') { snapshot = structuredClone(state); return { rows: [] }; }
    if (sql === 'ROLLBACK') { Object.assign(state, snapshot); return { rows: [] }; }
    if (/^(COMMIT|SET LOCAL|SELECT pg_advisory_xact_lock)/.test(sql)) return { rows: [] };
    if (/^SELECT id_usuario/.test(sql)) return { rows: missingUser ? [] : [{ id_usuario: args[0] }] };
    if (/^SELECT p.id_produto/.test(sql)) return { rows: state.products.filter(p => p.nome === args[0]
      || state.movements.some(m => m.id_produto === p.id_produto && m.descricao === args[1])).slice(0, 1) };
    if (/^SELECT c.id_categoria/.test(sql)) return { rows: state.categories.filter(c => c.nome === args[0]
      || state.products.some(p => p.id_categoria === c.id_categoria
        && state.movements.some(m => m.id_produto === p.id_produto && args[1].includes(m.descricao)))).slice(0, 1) };
    if (/^INSERT INTO categorias/.test(sql)) {
      const row = { id_categoria: state.categories.length + 1, nome: args[0] }; state.categories.push(row); return { rows: [row] };
    }
    if (/^INSERT INTO produtos/.test(sql)) {
      const row = { id_produto: state.products.length + 1, nome: args[0], estoque: args[1], estoque_minimo: args[2],
        valor: args[3], imagem: args[4], id_categoria: args[5] }; state.products.push(row); return { rows: [row] };
    }
    if (/^INSERT INTO movimentacoes/.test(sql)) {
      if (failMovement) throw new Error('Simulated insert failure');
      state.movements.push({ tipo: args[0], data: args[1], quantidade: args[2], descricao: args[3], id_produto: args[4], id_usuario: args[5] });
      return { rows: [] };
    }
    throw new Error('Unexpected SQL: ' + sql);
  } };
  const db = { connect: async () => client };
  return { state, calls, releases: () => releases, run: options => seedDemo(db, { userId: 9, date: '2026-10-06', verifyAssets: async () => {}, ...options }) };
}

test('demo: photographs exist locally and are genuine decodable raster images', async () => {
  await checkAssets();
  assert.equal(new Set(catalog.products.map(p => p.image)).size, 8);
  for (const p of catalog.products) {
    assert.match(p.source, /^https:\/\/master\.restaurantemadero\.com\.br\//);
    assert.match(p.name, /\[DEMO\]$/);
  }
});

test('demo: adds four categories, eight products and matching movements without changing existing rows', async () => {
  const h = harness();
  const original = structuredClone(h.state);
  const report = await h.run();
  assert.equal(report.categoriesCreated, 4);
  assert.equal(report.productsCreated, 8);
  assert.equal(report.movementsCreated, 16);
  assert.equal(report.productsSkipped, 0);
  assert.deepEqual(h.state.products[0], original.products[0]);
  assert.deepEqual(h.state.categories[0], original.categories[0]);
  assert.equal(h.releases(), 1);
  assert.equal(h.calls.at(-1).sql, 'COMMIT');
  assert.ok(h.calls.every(({ sql }) => !/^(UPDATE|DELETE|TRUNCATE|ALTER|DROP)/.test(sql)));
  for (const p of h.state.products.slice(1)) {
    const movements = h.state.movements.filter(m => m.id_produto === p.id_produto);
    assert.equal(movements.length, 2);
    assert.equal(movements.reduce((n, m) => n + Number(m.quantidade) * (m.tipo === 'Entrada' ? 1 : -1), 0), Number(p.estoque));
    assert.ok(movements.every(m => m.descricao.startsWith('[DEMO:') && m.id_usuario === 9 && m.data < '2026-10-06'));
  }
  assert.equal(h.state.products.slice(1).filter(p => Number(p.estoque) < Number(p.estoque_minimo)).length, 3);
  assert.equal(h.state.products.slice(1).filter(p => Number(p.estoque) === 0).length, 1);
});

test('demo: rerunning is a no-op even after a demonstration product/category is renamed or stock is changed', async () => {
  const h = harness();
  await h.run();
  h.state.products[1].nome = 'Nome editado';
  h.state.products[1].estoque = '1';
  h.state.categories[1].nome = 'Categoria editada';
  const edited = structuredClone(h.state);
  const report = await h.run();
  assert.equal(report.productsSkipped, 8);
  assert.equal(report.productsCreated, 0);
  assert.equal(report.movementsCreated, 0);
  assert.equal(report.categoriesCreated, 0);
  assert.deepEqual(h.state, edited);
});

test('demo: failed insert rolls back the entire seed and releases its connection', async () => {
  const h = harness({ failMovement: true });
  const original = structuredClone(h.state);
  await assert.rejects(h.run(), /Simulated/);
  assert.deepEqual(h.state, original);
  assert.equal(h.calls.at(-1).sql, 'ROLLBACK');
  assert.equal(h.releases(), 1);
});

test('demo: valid existing responsible user and all images are required before inserting', async () => {
  const missing = harness({ missingUser: true });
  await assert.rejects(missing.run(), /Usuário/);
  assert.ok(missing.calls.every(({ sql }) => !sql.startsWith('INSERT')));
  for (const userId of [undefined, 0, -1, '1 OR 1=1', '2147483648']) {
    const h = harness();
    await assert.rejects(h.run({ userId }), /--user/);
    assert.equal(h.calls.length, 0);
  }
  for (const date of ['', '2026-02-30', '0000-01-01', '6/10/2026']) {
    const h = harness(); await assert.rejects(h.run({ date }), /--date/); assert.equal(h.calls.length, 0);
  }
  const brokenImage = harness();
  await assert.rejects(brokenImage.run({ verifyAssets: async () => { throw new Error('Missing asset'); } }), /Missing asset/);
  assert.equal(brokenImage.calls.length, 0);
  assert.match(marker(catalog.products[0], 'entrada'), /^\[DEMO:v1:hamburguer:entrada\]/);
});
