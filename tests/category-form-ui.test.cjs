const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ejs = require('ejs');
const root = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const render = (file, data) => ejs.render(read(file), data, { filename: path.join(root, file) });
const attributes = (html, name) => [...html.matchAll(new RegExp(`\\s${name}="([^"]*)"`, 'g'))].map(match => match[1]);
function category(overrides = {}) {
  const locals = { mainClass: 'main-category-form', isLoggedIn: true, user: { usuario: 'Ana' },
    nome: '', fieldError: '', formError: '', ...overrides };
  const body = render('views/nova_categoria.ejs', locals);
  return { body, html: render('views/layouts/principal.ejs', { ...locals, body }) };
}

test('category form: workspace compartilhado, navegação atual e um único main/h1', () => {
  const { html } = category();
  assert.match(html, /<title>Nova categoria — Madero<\/title>/);
  assert.match(html, /<body class="main-dashboard main-category-form">/);
  assert.match(html, /href="\/css\/dashboard\.css\?v=/);
  assert.match(html, /href="\/css\/category-form\.css\?v=/);
  assert.match(html, /src="\/js\/category-form\.js\?v=/);
  assert.match(html, /href="\/categorias\/listar" aria-current="page"/);
  assert.match(html, /<meta name="robots" content="noindex, nofollow">/);
  assert.equal([...html.matchAll(/<main\b/g)].length, 1);
  assert.equal([...html.matchAll(/<h1\b/g)].length, 1);
  assert.doesNotMatch(html, /<header class="header-main"|href="\/css\/(?:style|login|products|landing|sobre|cardapio)\.css/);
});

test('category form: assets exclusivos não alteram dashboard, listagem, autenticação nem páginas públicas', () => {
  for (const mainClass of ['main-dashboard', 'main-products', 'main-login', 'main-index', 'main-cardapio', 'main-sobre', '']) {
    const html = render('views/layouts/principal.ejs', { mainClass, authPage: 'login',
      isLoggedIn: true, user: { usuario: 'Ana' }, body: '<p>Conteúdo</p>' });
    assert.doesNotMatch(html, /(?:href|src)="\/(?:css|js)\/category-form\./);
  }
});

test('category form: POST e cancelamento nativos; campo único obrigatório e limites explícitos', () => {
  const { body } = category({ nome: 'Ingredientes' });
  assert.match(body, /<form[^>]*action="\/categorias\/cadastro" method="post"/);
  assert.match(body, /<label for="category-name">Nome da categoria<\/label>/);
  assert.match(body, /<input[^>]*id="category-name" name="nome" value="Ingredientes"[^>]*maxlength="100" required/);
  assert.equal([...body.matchAll(/<input\b/g)].length, 1);
  assert.match(body, /href="\/categorias\/listar">Cancelar<\/a>/);
  assert.match(body, /type="submit"[^>]*data-category-submit/);
  assert.doesNotMatch(body, /\snovalidate|onsubmit=|type="hidden"|\sdisabled(?:\s|>)/);
  assert.match(body, /Algumas ideias para o seu estoque/);
});

test('category form: fragmentos, labels e mensagens acessíveis têm destinos válidos e ids únicos', () => {
  for (const extra of [{}, { fieldError: 'Informe o nome.' }, { formError: 'Falha ao salvar.' }]) {
    const { html } = category(extra);
    const ids = attributes(html, 'id');
    assert.equal(ids.length, new Set(ids).size);
    for (const target of attributes(html, 'href').filter(value => value.startsWith('#'))) {
      assert.ok(ids.includes(target.slice(1)), target);
    }
    for (const attr of ['for', 'aria-labelledby', 'aria-describedby']) {
      for (const value of attributes(html, attr)) {
        for (const id of value.split(/\s+/)) assert.ok(ids.includes(id), id);
      }
    }
  }
  assert.match(category({ fieldError: 'Nome inválido.' }).body, /aria-invalid="true"/);
  assert.doesNotMatch(category().body, /aria-invalid="true"/);
});

test('category form: nome e erros são preservados e escapados sem vazamento ou execução de HTML', () => {
  const attack = '\"><script>alert(1)</script><img src=x onerror=alert(1)>';
  const { body, html } = category({ nome: attack, fieldError: attack, formError: attack, user: { usuario: attack } });
  assert.ok(body.includes(`value="${ejs.escapeXML(attack)}"`));
  assert.match(body, /role="alert"/);
  assert.match(body, /data-category-save-error/);
  assert.match(body, /data-category-name-error/);
  assert.doesNotMatch(body, /<script>|<img src=x|value=""><script>/);
  assert.doesNotMatch(html, /<script>alert\(1\)<\/script>/);
  assert.match(body, /type="submit"/);
});

test('category form: CSS responsivo, foco visível, sem altura travada ou animação obrigatória', () => {
  const css = read('public/css/category-form.css');
  const shared = read('public/css/dashboard.css');
  assert.match(css, /grid-template-columns: minmax\(0, 1fr\) minmax\(230px, 300px\)/);
  assert.match(css, /@media \(max-width: 959px\)/);
  assert.match(css, /@media \(max-width: 719px\)/);
  assert.match(css, /\.category-layout \{ grid-template-columns: minmax\(0, 1fr\)/);
  assert.match(css, /font-size: 16px/);
  assert.match(css, /input:focus-visible/);
  assert.match(css, /min-height: 48px/);
  assert.doesNotMatch(css, /(?<!min-)height: 100(?:s|d)?vh|@keyframes|animation:.*infinite/);
  assert.match(shared, /prefers-reduced-motion: reduce/);
});
