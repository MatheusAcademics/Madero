const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ejs = require('ejs');
const root = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const render = (file, locals) => ejs.render(read(file), locals, { filename: path.join(root, file) });
const attrs = (html, name) => [...html.matchAll(new RegExp(`\\s${name}="([^"]*)"`, 'g'))].map(match => match[1]);
const values = { tipo_movimentacao: 'Entrada', data_movimentacao: '2026-09-29', quantidade: '2.50', descricao: 'Recebimento', id_produto: '4', id_usuario: '1' };
function page(extra = {}) {
  const locals = { mainClass: 'main-movement-form', isLoggedIn: true, user: { usuario: 'Ana' }, usuarioID: 1,
    produtos: [{ id_produto: 4, nome: 'Queijo', estoque: '5.50', estoque_minimo: '3.00' }],
    usuarios: [{ id_usuario: 1, nome_usuario: 'Ana' }], values, errors: {}, formError: '', loadError: '', submitted: false, ...extra };
  const body = render('views/nova_movimentacao.ejs', locals);
  return { body, html: render('views/layouts/principal.ejs', { ...locals, body }) };
}

test('movement UI: shared workspace, single main/h1 and active movements navigation', () => {
  const { html } = page();
  assert.match(html, /<title>Nova movimentação — Madero<\/title>/);
  assert.match(html, /<body class="main-dashboard main-movement-form">/);
  assert.equal([...html.matchAll(/<main\b/g)].length, 1);
  assert.equal([...html.matchAll(/<h1\b/g)].length, 1);
  assert.match(html, /href="\/movimentacoes\/listar" aria-current="page"/);
  assert.match(html, /\/css\/movement-form.css\?v=/);
  assert.match(html, /\/js\/movement-form.js\?v=/);
  assert.doesNotMatch(html, /header-main|href="\/css\/(?:style|products|category-form|login)\.css/);
  for (const mainClass of ['main-dashboard', 'main-products', 'main-category-form', 'main-login', 'main-index', '']) {
    const other = render('views/layouts/principal.ejs', { mainClass, authPage: 'login', isLoggedIn: true, user: { usuario: 'Ana' }, body: '' });
    assert.doesNotMatch(other, /(?:href|src)="\/(?:css|js)\/movement-form\./);
  }
});

test('movement UI: native POST, required choices, optional description and preserved inputs', () => {
  const { body } = page();
  assert.match(body, /action="\/movimentacoes\/cadastro" method="post"/);
  assert.match(body, /name="tipo_movimentacao" value="Entrada" required checked/);
  assert.match(body, /name="tipo_movimentacao" value="Saída" required/);
  assert.match(body, /value="4" data-stock="5.50" data-minimum="3.00" selected/);
  assert.match(body, /value="1" selected>Ana/);
  assert.match(body, /name="quantidade"[^>]*min="0.01" max="9999999999.99" step="0.01" required[^>]*value="2.50"/);
  assert.match(body, /type="date" required value="2026-09-29"/);
  const textarea = body.match(/<textarea[^>]*>[\s\S]*?<\/textarea>/)[0];
  assert.match(textarea, /maxlength="1000"/);
  assert.match(textarea, />Recebimento<\/textarea>/);
  assert.doesNotMatch(textarea, /\srequired/);
  assert.match(body, /href="\/movimentacoes\/listar">Cancelar/);
  assert.doesNotMatch(body, /novalidate|type="hidden"|onsubmit=/);
  assert.match(body, /hidden data-preview-panel/);
});

test('movement UI: labels, hints, errors and skip links target unique elements', () => {
  for (const extra of [{}, { submitted: true, errors: Object.fromEntries(Object.keys(values).map(key => [key, 'Corrija o campo.'])) }, { loadError: 'Falha.' }, { produtos: [] }]) {
    const { html } = page(extra);
    const ids = attrs(html, 'id');
    assert.equal(ids.length, new Set(ids).size);
    for (const attribute of ['for', 'aria-describedby', 'aria-labelledby']) {
      for (const value of attrs(html, attribute)) for (const id of value.split(/\s+/)) assert.ok(ids.includes(id), id);
    }
    for (const href of attrs(html, 'href').filter(value => value.startsWith('#'))) assert.ok(ids.includes(href.slice(1)), href);
  }
});

test('movement UI: query errors never masquerade as empty inventory, failed POST keeps draft', () => {
  const empty = page({ produtos: [] }).body;
  assert.match(empty, /Cadastre um produto primeiro/);
  assert.doesNotMatch(empty, /data-movement-form/);
  const failed = page({ produtos: [], usuarios: [], loadError: 'Opções indisponíveis.' }).body;
  assert.match(failed, /role="alert"/);
  assert.doesNotMatch(failed, /Cadastre um produto primeiro|data-movement-form/);
  const retry = page({ produtos: [], usuarios: [], loadError: 'Opções indisponíveis.', formError: 'Não foi salvo.', submitted: true }).body;
  assert.match(retry, /data-movement-form/);
  assert.match(retry, /data-movement-submit disabled/);
  assert.match(retry, /value="2.50"/);
  assert.match(retry, />Recebimento<\/textarea>/);
  assert.match(retry, /Produto indisponível/);
  assert.match(retry, /Usuário indisponível/);
});

test('movement UI: names, descriptions, errors and stock data attributes are escaped', () => {
  const attack = '\"><script>alert(1)</script><img src=x onerror=alert(1)>';
  const { body } = page({ submitted: true, values: { ...values, descricao: attack }, errors: { descricao: attack }, formError: attack,
    produtos: [{ id_produto: 4, nome: attack, estoque: attack, estoque_minimo: null }], usuarios: [{ id_usuario: 1, nome_usuario: attack }] });
  assert.ok(body.includes(ejs.escapeXML(attack)));
  assert.ok(body.includes(`data-stock="${ejs.escapeXML(attack)}"`));
  assert.doesNotMatch(body, /<script>|<img src=x/);
  assert.match(body, /aria-invalid="true"/);
  assert.match(body, /data-movement-error-summary/);
});

test('movement UI: responsive form and preview retain readable controls, reduced motion inherited', () => {
  const css = read('public/css/movement-form.css');
  assert.match(css, /@media \(max-width: 719px\)/);
  assert.match(css, /\.movement-fields \{ grid-template-columns: minmax\(0, 1fr\)/);
  assert.match(css, /font-size: 16px/);
  assert.match(css, /:focus-visible/);
  assert.match(css, /min-height: 48px/);
  assert.doesNotMatch(css, /@keyframes|animation:.*infinite/);
  assert.match(read('public/css/dashboard.css'), /prefers-reduced-motion: reduce/);
});
