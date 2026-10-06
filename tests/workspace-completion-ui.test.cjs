const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ejs = require('ejs');
const root = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const render = (view, data) => ejs.render(read('views/' + view + '.ejs'), data, { filename: path.join(root, 'views/' + view + '.ejs') });
const base = { isLoggedIn: true, user: { id_usuario: 1, usuario: 'ana' } };
const usersData = {
  ...base, mainClass: 'main-users', currentUserId: '1',
  usuarios: [
    { id_usuario: 1, nome: 'Ana', usuario: 'ana', email: 'ana@example.test', telefone: null, total_movimentacoes: 0 },
    { id_usuario: 2, nome: 'Bruno', usuario: 'bruno', email: null, telefone: null, total_movimentacoes: 3 },
    { id_usuario: 3, nome: 'Carla', usuario: 'carla', email: null, telefone: null, total_movimentacoes: 0 },
  ], filters: { q: '', ordem: 'nome' }, summary: { total: 3 },
  pagination: { page: 1, pageSize: 20, total: 3, totalPages: 1 }, usersError: null, mensagem: '', noticeType: 'success'
};
const formData = { ...base, mainClass: 'main-user-form', isEditing: false, recordId: '', values: { nome: 'Ana', usuario: 'ana', email: 'ana@example.test', telefone: '' }, errors: {}, formError: '', loadError: '', notFound: false };
const categoryData = { ...base, mainClass: 'main-category-edit', isEditing: true, id_categoria: '3', nome: 'Bebidas', fieldError: '', formError: '', loadError: '', notFound: false };
const productData = { ...base, mainClass: 'main-product-edit', productId: '7', produto: { id_produto: 7, estoque: '-2.50' }, categorias: [{ id_categoria: 3, nome: 'Bebidas' }], values: { nome_produto: 'Suco', estoque_minimo: '3', valor: '5,50', imagem: '', id_categoria: '3' }, errors: {}, formError: '', loadError: '', submitted: false, notFound: false };
const full = (view, data) => render('layouts/principal', { ...data, body: render(view, data) });
const attr = (html, name) => [...html.matchAll(new RegExp('\\s' + name + '="([^"]*)"', 'g'))].map(m => m[1]);

test('remaining workspace: users and all edit pages have shared navigation, scoped assets and single landmarks', () => {
  for (const [view, data, title, nav, script] of [
    ['usuario', usersData, 'Usuários', 'usuarios', 'users'],
    ['usuario_form', formData, 'Novo usuário', 'usuarios', 'user-form'],
    ['alterar_usuario', { ...formData, isEditing: true, recordId: '1' }, 'Editar usuário', 'usuarios', 'user-form'],
    ['alterar_categoria', categoryData, 'Editar categoria', 'categorias', 'category-form'],
    ['alterar_produto', productData, 'Editar produto', 'produtos', 'product-edit'],
  ]) {
    const html = full(view, data);
    assert.ok(html.includes('<title>' + title + ' — Madero</title>'));
    assert.equal([...html.matchAll(/<main\b/g)].length, 1);
    assert.equal([...html.matchAll(/<h1\b/g)].length, 1);
    assert.match(html, /<body class="main-dashboard /);
    assert.ok(html.includes('href="/' + nav + '/listar" aria-current="page"'));
    assert.ok(html.includes('/js/' + script + '.js?v='));
    assert.doesNotMatch(html, /href="\/css\/style.css|<header class="header-main"/);
  }
});

test('remaining workspace: labels, skip links and error descriptions point to unique elements in every branch', () => {
  const scenarios = [
    ['usuario', usersData], ['usuario', { ...usersData, summary: null, usersError: 'Falha' }],
    ['usuario_form', formData], ['alterar_usuario', { ...formData, isEditing: true, recordId: '1', errors: { nome: 'Nome', senha: 'Senha', confirmar_senha: 'Confirme' } }],
    ['alterar_usuario', { ...formData, notFound: true }], ['usuario_form', { ...formData, loadError: 'Falha' }],
    ['alterar_categoria', categoryData], ['alterar_categoria', { ...categoryData, fieldError: 'Nome' }], ['alterar_categoria', { ...categoryData, notFound: true }],
    ['alterar_produto', productData], ['alterar_produto', { ...productData, errors: { nome_produto: 'Nome', imagem: 'Imagem' } }],
    ['alterar_produto', { ...productData, produto: null, notFound: true }],
    ['alterar_produto', { ...productData, produto: null, categorias: [], submitted: true, loadError: 'Falha' }],
  ];
  for (const [view, data] of scenarios) {
    const html = full(view, data), ids = attr(html, 'id');
    assert.equal(ids.length, new Set(ids).size, view);
    for (const key of ['for', 'aria-labelledby', 'aria-describedby', 'aria-controls']) for (const names of attr(html, key)) for (const id of names.split(/\s+/)) assert.ok(ids.includes(id), view + ': ' + id);
    for (const href of attr(html, 'href').filter(v => v.startsWith('#'))) assert.ok(ids.includes(href.slice(1)), href);
  }
});

test('users UI: only unused other accounts can be deleted, self and histories are clearly protected', () => {
  const html = render('usuario', usersData);
  assert.match(html, /action="\/usuarios\/excluir\/3" method="post"/);
  assert.doesNotMatch(html, /action="\/usuarios\/excluir\/[12]"/);
  assert.match(html, /Sua conta/); assert.match(html, /Com histórico/);
  assert.match(html, /href="\/usuarios\/novo"/);
  const unknown = render('usuario', { ...usersData, usuarios: [{ ...usersData.usuarios[2], total_movimentacoes: null }] });
  assert.doesNotMatch(unknown, /data-delete-user\s/);
  assert.match(unknown, /Exclusão indisponível/);
});

test('users UI: native search/pagination keep filters, and empty results never impersonate query failure', () => {
  const html = render('usuario', { ...usersData, filters: { q: 'Ana & Silva', ordem: 'recentes' }, pagination: { page: 3, pageSize: 20, total: 80, totalPages: 4 } });
  assert.match(html, /action="\/usuarios\/listar" method="get"/);
  const links = attr(html, 'href').filter(v => v.includes('pagina='));
  for (const link of links) { const url = new URL(link.replaceAll('&amp;', '&'), 'http://localhost'); assert.equal(url.searchParams.get('q'), 'Ana & Silva'); assert.equal(url.searchParams.get('ordem'), 'recentes'); }
  assert.match(render('usuario', { ...usersData, usuarios: [], filters: { q: 'Nada', ordem: 'nome' } }), /Nenhum usuário encontrado/);
  const failure = render('usuario', { ...usersData, summary: null, usersError: 'Falha' });
  assert.match(failure, /role="alert"/); assert.doesNotMatch(failure, /Nenhum usuário encontrado|Nenhum usuário cadastrado/);
});

test('user forms: password is never returned and is optional only while editing', () => {
  for (const editing of [true, false]) {
    const html = render('usuario_form', { ...formData, isEditing: editing, recordId: '1', values: { ...formData.values, senha: 'SECRET_SENTINEL', confirmar_senha: 'SECRET_SENTINEL' } });
    assert.doesNotMatch(html, /SECRET_SENTINEL/);
    assert.ok(html.includes('action="/usuarios/' + (editing ? 'alterar/1' : 'criar') + '" method="post"'));
    const passwords = [...html.matchAll(/<input[^>]*type="password"[^>]*>/g)].map(v => v[0]);
    assert.equal(passwords.length, 2);
    passwords.forEach(input => { assert.doesNotMatch(input, /\svalue=/); assert.equal(/\srequired\b/.test(input), !editing); });
    assert.match(html, /name="email" type="email"/);
    if (editing) assert.match(html, /manter a senha atual/);
  }
});

test('remaining forms: hostile names, contact fields, errors and previews remain escaped', () => {
  const attack = '<script>alert("x")</script>';
  for (const html of [
    render('usuario', { ...usersData, usuarios: [{ ...usersData.usuarios[2], nome: attack, usuario: attack, email: attack, telefone: attack }], mensagem: attack }),
    render('usuario_form', { ...formData, values: { nome: attack, usuario: attack, email: attack, telefone: attack }, errors: { nome: attack }, formError: attack }),
    render('alterar_categoria', { ...categoryData, nome: attack, formError: attack }),
    render('alterar_produto', { ...productData, values: { ...productData.values, nome_produto: attack, imagem: attack }, errors: { imagem: attack } }),
  ]) { assert.doesNotMatch(html, /<script>/); assert.ok(html.includes(ejs.escapeXML(attack))); }
});

test('product edit UI: negative or unknown stock remains read-only and image preview is safely deferred', () => {
  const html = render('alterar_produto', productData);
  assert.match(html, /data-current-stock="-2.50"/);
  assert.match(html, /-2,5/);
  assert.doesNotMatch(html, /<input[^>]*name="estoque"/);
  assert.match(html, /href="\/movimentacoes\/nova_movimentacao\?produto=7"/);
  for (const img of [...html.matchAll(/<img\b[^>]*>/g)].map(v => v[0])) assert.doesNotMatch(img, /\ssrc=/);
  assert.match(render('alterar_produto', { ...productData, produto: { estoque: null } }), /Saldo indisponível/);
  const failed = render('alterar_produto', { ...productData, produto: null, categorias: [], loadError: 'Falha', submitted: true });
  assert.match(failed, /value="Suco"/); assert.match(failed, /data-product-submit disabled/);
});

test('category edit UI: shares the category form, only changes name and preserves draft on failure', () => {
  const html = render('alterar_categoria', { ...categoryData, formError: 'Falha ao salvar' });
  assert.match(html, /action="\/categorias\/alterar\/3" method="post"/);
  assert.match(html, /name="nome" value="Bebidas"/);
  assert.match(html, /Salvar alterações/);
  assert.equal([...html.matchAll(/<input\b/g)].length, 1);
  assert.doesNotMatch(render('alterar_categoria', { ...categoryData, notFound: true }), /<form\b/);
});

test('remaining UI: mobile keeps real content, touch targets, visible focus and reduced-motion support', () => {
  const users = read('public/css/users.css'), forms = read('public/css/product-form.css'), shared = read('public/css/dashboard.css');
  assert.match(users, /@media \(max-width: 959px\)/);
  assert.match(users, /clip-path: inset\(50%\)/);
  assert.match(users, /min-height: 44px/);
  assert.match(forms, /grid-template-columns: minmax\(0, 1fr\)/);
  assert.match(shared, /prefers-reduced-motion/);
  assert.match(read('public/css/user-form.css'), /min-height: 44px/);
});
