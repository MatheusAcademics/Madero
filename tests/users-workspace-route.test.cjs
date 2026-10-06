const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../routes/usuarios.js'), 'utf8');
const publicValues = { nome: 'Ana Silva', usuario: 'ana', email: 'ana@example.com', telefone: '', foto: '' };
const password = 'mock-password-only';
const createBody = { ...publicValues, senha: password, confirmar_senha: password };
const editBody = { ...publicValues, senha: '', confirmar_senha: '' };

// All queries and hashes are mocked. No real account or database write is used.
function harness({ results = [], errorAt = -1, code, constraint, hashError = false } = {}) {
  const handlers = new Map();
  const calls = { queries: [], hashes: [], logs: [] };
  const router = {
    get(route, handler) { handlers.set('GET ' + route, handler); },
    post(route, handler) { handlers.set('POST ' + route, handler); }
  };
  vm.runInNewContext(source, {
    module: { exports: {} }, Buffer,
    console: { log: (...args) => calls.logs.push(args), error: (...args) => calls.logs.push(args) },
    require(name) {
      if (name === 'express') return { Router: () => router };
      if (name === 'bcrypt') return {
        async hash(...args) {
          calls.hashes.push(args);
          if (hashError) throw new Error('Private password diagnostic');
          return 'mock-user-hash';
        }, compareSync() { return true; }
      };
      if (name === '../conexao') return {
        async query(sql, values = []) {
          const index = calls.queries.length;
          calls.queries.push({ sql, values: Array.from(values) });
          if (index === errorAt) throw Object.assign(new Error('Private account diagnostic'), { code, constraint });
          return { rows: results[index] || [], rowCount: (results[index] || []).length };
        }
      };
      throw new Error('Unexpected dependency: ' + name);
    }
  }, { filename: 'routes/usuarios.js' });
  return {
    calls, handlers,
    async invoke(method = 'GET', route = '/listar', options = {}) {
      const req = { query: {}, params: {}, session: { user: { id_usuario: 1, usuario: 'current' } }, ...options };
      const res = {
        statusCode: 200,
        status(code) { this.statusCode = code; return this; },
        render(view, locals) { this.view = view; this.locals = JSON.parse(JSON.stringify(locals)); return this; },
        redirect(location) { this.statusCode = 302; this.location = location; return this; }
      };
      const handler = handlers.get(method + ' ' + route);
      assert.equal(typeof handler, 'function');
      await handler(req, res);
      return res;
    }
  };
}

function assertNoSecrets(res, h) {
  const rendered = JSON.stringify(res.locals || {});
  assert.doesNotMatch(rendered, /mock-password-only|mock-user-hash|Private account diagnostic|Private password diagnostic/);
  if (res.locals?.values) assert.deepEqual(Object.keys(res.locals.values).sort(), ['email', 'foto', 'nome', 'telefone', 'usuario']);
  for (const query of h.calls.queries) {
    assert.doesNotMatch(query.sql, /SELECT\s+\*|RETURNING[^;]*\bsenha\b/i);
    if (/^SELECT/i.test(query.sql)) assert.doesNotMatch(query.sql, /\bsenha\b/i);
  }
  assert.doesNotMatch(JSON.stringify(h.calls.logs), /mock-password-only|mock-user-hash|Private account diagnostic|Private password diagnostic|ana@example/);
}

test('users workspace: every internal endpoint rejects missing or invalid session before SQL or hashing', async () => {
  const routes = [['GET', '/listar'], ['POST', '/pesquisar'], ['GET', '/novo'], ['POST', '/criar'],
    ['GET', '/alterar/:id_usuario'], ['POST', '/alterar/:id_usuario'], ['POST', '/excluir/:id_usuario']];
  for (const [method, route] of routes) for (const session of [undefined, null, {}, { user: {} },
    { user: { id_usuario: 0 } }, { user: { id_usuario: -1 } }, { user: { id_usuario: '1x' } },
    { user: { id_usuario: [] } }, { user: { id_usuario: 2147483648 } }]) {
    const h = harness();
    const res = await h.invoke(method, route, { session, params: { id_usuario: '2' }, body: createBody });
    assert.equal(res.location, '/usuarios/login', method + route);
    assert.equal(h.calls.queries.length, 0);
    assert.equal(h.calls.hashes.length, 0);
  }
});

test('users workspace: public login and registration pages remain open and use original layouts', async () => {
  const h = harness();
  assert.equal((await h.invoke('GET', '/login', { session: undefined })).view, 'login');
  const res = await h.invoke('GET', '/novo_usuario', { session: undefined });
  assert.equal(res.view, 'novo_usuario');
  assert.equal(res.locals.authPage, 'register');
  assert.equal(h.calls.queries.length, 0);
});

test('users list: empty success uses genuine zero counts and shared contract', async () => {
  const h = harness({ results: [[{ total: '0' }], [{ total: '0' }], []] });
  const res = await h.invoke();
  assert.equal(res.view, 'usuario');
  assert.deepEqual(res.locals, {
    mainClass: 'main-users', usuarios: [], filters: { q: '', ordem: 'nome' }, currentUserId: '1',
    pagination: { page: 1, pageSize: 20, total: 0, totalPages: 1 }, summary: { total: 0 },
    mensagem: '', noticeType: 'success', usersError: null
  });
  assert.equal(h.calls.queries.length, 3);
  assertNoSecrets(res, h);
});

test('users list: explicit public fields and movement counts never expose hashes or duplicate users', async () => {
  const row = { id_usuario: 2, ...publicValues, total_movimentacoes: '8', senha: 'mock-user-hash', private: 'unused' };
  const h = harness({ results: [[{ total: '2' }], [{ total: '1' }], [row]] });
  const res = await h.invoke();
  assert.deepEqual(res.locals.usuarios, [{ id_usuario: 2, ...publicValues, total_movimentacoes: '8' }]);
  assert.match(h.calls.queries[2].sql, /SELECT u\.id_usuario, u\.nome, u\.usuario, u\.email, u\.telefone/);
  assert.match(h.calls.queries[2].sql, /SELECT COUNT\(\*\) FROM movimentacoes m WHERE m\.id_usuario = u\.id_usuario/);
  assert.doesNotMatch(h.calls.queries[2].sql, /JOIN|SUM\(/);
  assertNoSecrets(res, h);
});

test('users list: search is parameterized across name, login, email and ID with escaped literal wildcards', async () => {
  const h = harness({ results: [[{ total: '50' }], [{ total: '21' }], []] });
  const res = await h.invoke('GET', '/listar', { query: { q: '  50%_\\  ', ordem: 'usuario', pagina: '2' } });
  assert.deepEqual(res.locals.filters, { q: '50%_\\', ordem: 'usuario' });
  assert.deepEqual(res.locals.pagination, { page: 2, pageSize: 20, total: 21, totalPages: 2 });
  assert.deepEqual(res.locals.summary, { total: 50 });
  assert.deepEqual(h.calls.queries[0].values, []);
  assert.deepEqual(h.calls.queries[1].values, ['%50\\%\\_\\\\%']);
  assert.deepEqual(h.calls.queries[2].values, ['%50\\%\\_\\\\%', 20, 20]);
  assert.match(h.calls.queries[2].sql, /u\.nome ILIKE \$1 OR u\.usuario ILIKE \$1 OR u\.email ILIKE \$1 OR u\.id_usuario::text ILIKE \$1/);
  assert.match(h.calls.queries[2].sql, /ORDER BY u\.usuario ASC NULLS LAST, u\.id_usuario ASC/);
  assertNoSecrets(res, h);
});

test('users list: sort and page are allowlisted, bounded and stable', async () => {
  for (const query of [{ q: ['x'], ordem: 'DROP TABLE usuarios', pagina: '-2' }, { ordem: '__proto__', pagina: '1e3' }, { ordem: {}, pagina: '9007199254740992' }]) {
    const h = harness({ results: [[{ total: '23' }], [{ total: '23' }], []] });
    const res = await h.invoke('GET', '/listar', { query });
    assert.equal(res.locals.filters.ordem, 'nome');
    assert.equal(res.locals.pagination.page, 1);
    assert.doesNotMatch(h.calls.queries[2].sql, /DROP TABLE|__proto__/);
  }
  const h = harness({ results: [[{ total: '23' }], [{ total: '23' }], []] });
  const res = await h.invoke('GET', '/listar', { query: { q: 'x'.repeat(200), ordem: 'recentes', pagina: '99999' } });
  assert.equal(res.locals.filters.q.length, 120);
  assert.equal(res.locals.pagination.page, 2);
  assert.match(h.calls.queries[2].sql, /ORDER BY u\.id_usuario DESC/);
});

test('users list: notices are allowlisted and arbitrary message strings cannot claim success', async () => {
  for (const [aviso, expected] of [['criado', 'success'], ['propria-conta', 'error'], ['em-uso', 'error'], ['sessao', 'error']]) {
    const h = harness({ results: [[{ total: '0' }], [{ total: '0' }], []] });
    const res = await h.invoke('GET', '/listar', { query: { aviso } });
    assert.equal(res.locals.noticeType, expected);
    assert.ok(res.locals.mensagem);
  }
  const h = harness({ results: [[{ total: '0' }], [{ total: '0' }], []] });
  const res = await h.invoke('GET', '/listar', { query: { aviso: '__proto__', mensagem: 'Everything succeeded' } });
  assert.equal(res.locals.mensagem, '');
});

test('users list: database failure returns 503 without a misleading empty success or diagnostics', async () => {
  const h = harness({ errorAt: 0, code: '08006' });
  const res = await h.invoke('GET', '/listar', { query: { aviso: 'criado' } });
  assert.equal(res.statusCode, 503);
  assert.equal(res.locals.summary, null);
  assert.equal(res.locals.mensagem, '');
  assert.ok(res.locals.usersError);
  assertNoSecrets(res, h);
});

test('users search: legacy POST redirects into native GET without another query', async () => {
  const h = harness();
  const res = await h.invoke('POST', '/pesquisar', { body: { pesquisa: ' Ana & João ' } });
  assert.equal(res.location, '/usuarios/listar?q=' + encodeURIComponent('Ana & João'));
  assert.equal((await h.invoke('POST', '/pesquisar', { body: {} })).location, '/usuarios/listar');
  assert.equal(h.calls.queries.length, 0);
});

test('user forms: internal create contract stays separate from public signup', async () => {
  const h = harness();
  const res = await h.invoke('GET', '/novo');
  assert.equal(res.view, 'usuario_form');
  assert.deepEqual(res.locals, { mainClass: 'main-user-form', isEditing: false, recordId: '',
    values: { nome: '', usuario: '', email: '', telefone: '', foto: '' }, errors: {}, formError: '', loadError: '', notFound: false, submitted: false, uploadNotice: '' });
  assert.equal(h.calls.queries.length, 0);
});

test('user edit: loads only public fields and preserves nullable legacy contacts as blanks', async () => {
  const h = harness({ results: [[{ id_usuario: 2, nome: 'Ana', usuario: 'ana', email: null, telefone: null, senha: 'mock-user-hash' }]] });
  const res = await h.invoke('GET', '/alterar/:id_usuario', { params: { id_usuario: '0002' } });
  assert.equal(res.view, 'alterar_usuario');
  assert.equal(res.locals.recordId, '2');
  assert.equal(res.locals.isEditing, true);
  assert.deepEqual(res.locals.values, { nome: 'Ana', usuario: 'ana', email: '', telefone: '', foto: '' });
  assert.deepEqual(h.calls.queries[0].values, [2]);
  assertNoSecrets(res, h);
});

test('user edit: invalid IDs and missing accounts return actionable 404, failures return separate 503', async () => {
  for (const id of ['', '0', '-1', '1 OR 1=1', '2147483648', ['1']]) {
    const h = harness();
    const res = await h.invoke('GET', '/alterar/:id_usuario', { params: { id_usuario: id } });
    assert.equal(res.statusCode, 404);
    assert.equal(res.locals.notFound, true);
    assert.equal(h.calls.queries.length, 0);
  }
  const missing = await harness().invoke('GET', '/alterar/:id_usuario', { params: { id_usuario: '2' } });
  assert.equal(missing.statusCode, 404);
  const h = harness({ errorAt: 0, code: '08006' });
  const res = await h.invoke('GET', '/alterar/:id_usuario', { params: { id_usuario: '2' } });
  assert.equal(res.statusCode, 503);
  assert.ok(res.locals.loadError);
  assert.equal(res.locals.notFound, false);
  assertNoSecrets(res, h);
});

test('user create: validation retains only non-secret fields before hashing or SQL', async () => {
  const cases = [
    [undefined, 'nome'], [{}, 'nome'], [{ ...createBody, nome: ' ' }, 'nome'], [{ ...createBody, nome: 'a'.repeat(101) }, 'nome'],
    [{ ...createBody, usuario: [] }, 'usuario'], [{ ...createBody, usuario: 'x'.repeat(101) }, 'usuario'],
    [{ ...createBody, email: '' }, 'email'], [{ ...createBody, email: '.a@example.com' }, 'email'],
    [{ ...createBody, telefone: {} }, 'telefone'], [{ ...createBody, telefone: '123' }, 'telefone'],
    [{ ...createBody, senha: '' }, 'senha'], [{ ...createBody, senha: [] }, 'senha'],
    [{ ...createBody, confirmar_senha: 'mismatch' }, 'confirmar_senha'],
    [{ ...createBody, senha: 'é'.repeat(37), confirmar_senha: 'é'.repeat(37) }, 'senha']
  ];
  for (const [body, key] of cases) {
    const h = harness();
    const res = await h.invoke('POST', '/criar', { body });
    assert.equal(res.statusCode, 400, key);
    assert.ok(res.locals.errors[key], key);
    assert.equal(res.locals.submitted, true);
    assert.equal(h.calls.hashes.length, 0);
    assert.equal(h.calls.queries.length, 0);
    assertNoSecrets(res, h);
  }
});

test('user create: hashes once, parameterizes contacts, allows blank phone and retains current session', async () => {
  const session = { user: { id_usuario: 1, usuario: 'current' } };
  const h = harness({ results: [[{ id_usuario: 2, ...publicValues }]] });
  const res = await h.invoke('POST', '/criar', { session, body: { ...createBody, nome: ' Ana Silva ', email: ' ANA@EXAMPLE.COM ', telefone: '+55 (11) 99999-9999' } });
  assert.equal(res.location, '/usuarios/listar?aviso=criado');
  assert.deepEqual(h.calls.hashes, [[password, 10]]);
  assert.deepEqual(h.calls.queries[0].values, ['Ana Silva', 'ana', 'ana@example.com', '+5511999999999', 'mock-user-hash']);
  assert.match(h.calls.queries[0].sql, /^INSERT INTO usuarios/);
  assert.deepEqual(session.user, { id_usuario: 1, usuario: 'current' });
  assertNoSecrets(res, h);
  const blank = harness();
  await blank.invoke('POST', '/criar', { body: createBody });
  assert.equal(blank.calls.queries[0].values[3], null);
});

test('user writes: known unique conflicts target the correct field, unknown conflicts remain generic', async () => {
  for (const [constraint, field] of [['usuarios_email_unique', 'email'], ['usuarios_usuario_key', 'usuario'], ['usuarios_pkey', null]]) {
    for (const route of ['/criar', '/alterar/:id_usuario']) {
      const h = harness({ errorAt: 0, code: '23505', constraint });
      const res = await h.invoke('POST', route, { body: route === '/criar' ? createBody : editBody, params: { id_usuario: '2' } });
      assert.equal(res.statusCode, 409);
      if (field) assert.ok(res.locals.errors[field]);
      else assert.ok(res.locals.formError);
      assert.deepEqual(res.locals.values, publicValues);
      assertNoSecrets(res, h);
    }
  }
});

test('user create: hashing failure is generic, preserves the draft and performs no SQL', async () => {
  const h = harness({ hashError: true });
  const res = await h.invoke('POST', '/criar', { body: createBody });
  assert.equal(res.statusCode, 503);
  assert.ok(res.locals.formError);
  assert.equal(h.calls.queries.length, 0);
  assertNoSecrets(res, h);
});

test('user edit: blank or omitted passwords leave the stored hash untouched', async () => {
  for (const body of [editBody, publicValues]) {
    const session = { user: { id_usuario: 1, usuario: 'current' }, save() { assert.fail('Another user must not change my session'); } };
    const h = harness({ results: [[{ id_usuario: 2, ...publicValues }]] });
    const res = await h.invoke('POST', '/alterar/:id_usuario', { body, session, params: { id_usuario: '2' } });
    assert.equal(res.location, '/usuarios/listar?aviso=alterado');
    assert.equal(h.calls.hashes.length, 0);
    assert.doesNotMatch(h.calls.queries[0].sql, /\bsenha\b/);
    assert.deepEqual(h.calls.queries[0].values, ['Ana Silva', 'ana', 'ana@example.com', null, 2]);
    assert.deepEqual(session.user, { id_usuario: 1, usuario: 'current' });
    assertNoSecrets(res, h);
  }
});

test('user edit: password change requires matching confirmation and bcrypt hash is never rendered', async () => {
  const h = harness({ results: [[{ id_usuario: 2, ...publicValues }]] });
  const res = await h.invoke('POST', '/alterar/:id_usuario', { body: createBody, params: { id_usuario: '2' } });
  assert.equal(res.location, '/usuarios/listar?aviso=alterado');
  assert.deepEqual(h.calls.hashes, [[password, 10]]);
  assert.match(h.calls.queries[0].sql, /senha = \$5/);
  assert.match(h.calls.queries[0].sql, /WHERE id_usuario = \$6 RETURNING/);
  assert.deepEqual(h.calls.queries[0].values.slice(-2), ['mock-user-hash', 2]);
  assertNoSecrets(res, h);
  for (const body of [{ ...editBody, senha: password }, { ...editBody, confirmar_senha: password }, { ...editBody, senha: [] }]) {
    const invalid = harness();
    const failed = await invalid.invoke('POST', '/alterar/:id_usuario', { body, params: { id_usuario: '2' } });
    assert.equal(failed.statusCode, 400);
    assert.equal(invalid.calls.hashes.length, 0);
    assert.equal(invalid.calls.queries.length, 0);
    assertNoSecrets(failed, invalid);
  }
});

test('user edit: self rename refreshes and persists only the current session identity', async () => {
  let saves = 0;
  const session = { user: { id_usuario: 1, usuario: 'old' }, save(done) { saves++; done(); } };
  const h = harness({ results: [[{ id_usuario: 1, ...publicValues }]] });
  const res = await h.invoke('POST', '/alterar/:id_usuario', { body: editBody, session, params: { id_usuario: '01' } });
  assert.equal(res.location, '/usuarios/listar?aviso=alterado');
  assert.equal(session.user.usuario, 'ana');
  assert.equal(saves, 1);
  assertNoSecrets(res, h);
});

test('user edit: session persistence failure does not falsely claim the successful DB update was rolled back', async () => {
  const session = { user: { id_usuario: 1, usuario: 'old' }, save(done) { done(new Error('Private session diagnostic')); } };
  const h = harness({ results: [[{ id_usuario: 1, ...publicValues }]] });
  const res = await h.invoke('POST', '/alterar/:id_usuario', { body: editBody, session, params: { id_usuario: '1' } });
  assert.equal(res.location, '/usuarios/listar?aviso=sessao');
  assert.equal(h.calls.queries.length, 1);
  assert.doesNotMatch(JSON.stringify(h.calls.logs), /Private session/);
});

test('user edit: missing update returns 404 rather than success and retains non-secret draft', async () => {
  const h = harness();
  const res = await h.invoke('POST', '/alterar/:id_usuario', { body: editBody, params: { id_usuario: '2' } });
  assert.equal(res.statusCode, 404);
  assert.equal(res.locals.notFound, true);
  assert.equal(res.locals.submitted, true);
  assert.deepEqual(res.locals.values, publicValues);
  assertNoSecrets(res, h);
});

test('user edit: invalid profile or DB failure never discards non-secret draft', async () => {
  const invalid = harness();
  const failed = await invalid.invoke('POST', '/alterar/:id_usuario', { body: { ...editBody, email: '' }, params: { id_usuario: '2' } });
  assert.equal(failed.statusCode, 400);
  assert.ok(failed.locals.errors.email);
  assert.equal(invalid.calls.queries.length, 0);
  const h = harness({ errorAt: 0, code: '08006' });
  const res = await h.invoke('POST', '/alterar/:id_usuario', { body: createBody, params: { id_usuario: '2' } });
  assert.equal(res.statusCode, 503);
  assert.deepEqual(res.locals.values, publicValues);
  assertNoSecrets(res, h);
});

test('user delete: self deletion and malformed IDs are stopped before SQL', async () => {
  for (const [id, notice] of [['1', 'propria-conta'], ['0001', 'propria-conta'], ['0', 'nao-encontrado'], ['2 OR 1=1', 'nao-encontrado'], ['2147483648', 'nao-encontrado']]) {
    const h = harness();
    const res = await h.invoke('POST', '/excluir/:id_usuario', { params: { id_usuario: id } });
    assert.equal(res.location, '/usuarios/listar?aviso=' + notice);
    assert.equal(h.calls.queries.length, 0);
  }
});

test('user delete: atomic no-history condition, explicit returning and no cascade', async () => {
  const h = harness({ results: [[{ id_usuario: 2 }]] });
  const res = await h.invoke('POST', '/excluir/:id_usuario', { params: { id_usuario: '2' } });
  assert.equal(res.location, '/usuarios/listar?aviso=excluido');
  assert.equal(h.calls.queries.length, 1);
  assert.deepEqual(h.calls.queries[0].values, [2]);
  assert.match(h.calls.queries[0].sql, /DELETE FROM usuarios u WHERE u\.id_usuario = \$1/);
  assert.match(h.calls.queries[0].sql, /AND NOT EXISTS \(SELECT 1 FROM movimentacoes m WHERE m\.id_usuario = u\.id_usuario\)/);
  assert.doesNotMatch(h.calls.queries[0].sql, /CASCADE|DELETE FROM movimentacoes/);
});

test('user delete: zero affected rows distinguish protected history from missing record truthfully', async () => {
  for (const exists of [true, false]) {
    const h = harness({ results: [[], [{ user_exists: exists }]] });
    const res = await h.invoke('POST', '/excluir/:id_usuario', { params: { id_usuario: '2' } });
    assert.equal(res.location, '/usuarios/listar?aviso=' + (exists ? 'em-uso' : 'nao-encontrado'));
    assert.equal(h.calls.queries.length, 2);
    assert.match(h.calls.queries[1].sql, /^SELECT EXISTS/);
  }
});

test('user delete: foreign-key race remains protected and operational failures are generic', async () => {
  for (const [code, notice] of [['23503', 'em-uso'], ['08006', 'falha']]) {
    const h = harness({ errorAt: 0, code });
    const res = await h.invoke('POST', '/excluir/:id_usuario', { params: { id_usuario: '2' } });
    assert.equal(res.location, '/usuarios/listar?aviso=' + notice);
    assert.equal(h.calls.queries.length, 1);
    assertNoSecrets(res, h);
  }
});
