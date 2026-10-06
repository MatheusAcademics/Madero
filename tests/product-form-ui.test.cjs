const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ejs = require('ejs');

const root = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const render = (file, locals) => ejs.render(read(file), locals, { filename: path.join(root, file) });
const attrs = (html, name) => [...html.matchAll(new RegExp(`\\s${name}="([^"]*)"`, 'g'))].map(match => match[1]);
const field = (html, name) => [...html.matchAll(/<(?:input|select|textarea)\b[^>]*>/g)].map(match => match[0]).find(tag => tag.includes(`name="${name}"`));
const values = { nome: 'Queijo muçarela', estoque: '12.50', estoque_minimo: '3.00', valor: '25.90', imagem: '/img/queijo.jpg', id_categoria: '4' };

function page(extra = {}) {
  const locals = { mainClass: 'main-product-form', isLoggedIn: true, user: { usuario: 'Ana' },
    categorias: [{ id_categoria: 4, nome: 'Ingredientes' }, { id_categoria: 9, nome: 'Bebidas' }],
    values, errors: {}, formError: '', loadError: '', submitted: false, ...extra };
  const body = render('views/novo_produto.ejs', locals);
  return { body, html: render('views/layouts/principal.ejs', { ...locals, body }) };
}

test('product form UI: shared workspace, one main/h1 and active product navigation', () => {
  const { html } = page();
  assert.match(html, /<title>Novo produto — Madero<\/title>/);
  assert.match(html, /<body class="main-dashboard main-product-form">/);
  assert.equal([...html.matchAll(/<main\b/g)].length, 1);
  assert.equal([...html.matchAll(/<h1\b/g)].length, 1);
  assert.match(html, /href="\/produtos\/listar" aria-current="page"/);
  assert.match(html, /<meta name="robots" content="noindex, nofollow">/);
  assert.match(html, /\/css\/dashboard\.css\?v=/);
  assert.match(html, /\/css\/product-form\.css\?v=/);
  assert.match(html, /\/js\/product-form\.js\?v=/);
  assert.ok(html.indexOf('/js/product-image.js?') < html.indexOf('/js/product-form.js?'));
  assert.doesNotMatch(html, /header-main|href="\/css\/(?:style|login|products|category-form)\.css/);
});

test('product form UI: new assets do not affect public, auth or other stock pages', () => {
  for (const mainClass of ['main-dashboard', 'main-products', 'main-categories', 'main-category-form', 'main-movement-form', 'main-stock', 'main-movements', 'main-login', 'main-index', 'main-cardapio', 'main-sobre', '']) {
    const html = render('views/layouts/principal.ejs', { mainClass, authPage: 'login', isLoggedIn: true, user: { usuario: 'Ana' }, body: '' });
    assert.doesNotMatch(html, /(?:href|src)="\/(?:css|js)\/product-form\./, mainClass);
  }
});

test('product form UI: native POST preserves all field names, draft and cancel destination', () => {
  const { body } = page();
  assert.match(body, /<form[^>]*action="\/produtos\/cadastro"[^>]*method="post"/);
  assert.match(body, /data-product-form/);
  for (const [name, value] of Object.entries(values)) {
    assert.ok(field(body, name), name);
    assert.equal([...body.matchAll(new RegExp(`name="${name}"`, 'g'))].length, 1, name);
    if (name !== 'id_categoria') assert.ok(field(body, name).includes(`value="${ejs.escapeXML(value)}"`), name);
  }
  assert.match(body, /<option[^>]*value="4"[^>]*selected/);
  assert.match(body, /href="\/produtos\/listar">Cancelar/);
  assert.match(body, /type="submit"[^>]*data-product-submit/);
  assert.doesNotMatch(body, /\snovalidate|onsubmit=|type="hidden"/);
  assert.match(body, /enctype="multipart\/form-data"/);
  assert.match(body, /name="imagem_arquivo" type="file"/);
});

test('product form UI: decimal fields accept comma or dot, require a value and preserve zero', () => {
  const { body } = page({ values: { ...values, estoque: '0', estoque_minimo: '0', valor: '0' } });
  const name = field(body, 'nome');
  assert.match(name, /maxlength="100"/);
  assert.match(name, /\srequired(?:\s|>)/);
  assert.match(field(body, 'id_categoria'), /\srequired(?:\s|>)/);
  for (const name of ['estoque', 'estoque_minimo', 'valor']) {
    const input = field(body, name);
    assert.match(input, /type="text"/);
    assert.match(input, /inputmode="decimal"/);
    assert.match(input, /maxlength="24"/);
    const pattern = attrs(input, 'pattern')[0];
    assert.ok(pattern, 'Browser validates decimal format without JavaScript');
    const valid = new RegExp(`^(?:${pattern})$`, 'u');
    for (const amount of ['0', '25', '0,01', '0.01', '9999999999.99']) assert.ok(valid.test(amount), amount);
    for (const amount of ['-1', '1.001', '1,001', '1e3', 'Infinity', 'abc', '']) assert.ok(!valid.test(amount), amount);
    assert.match(input, /\srequired(?:\s|>)/);
    assert.match(input, /value="0"/);
  }
});

test('product form UI: malformed and empty numeric drafts stay editable instead of becoming zero', () => {
  const malformed = { ...values, estoque: '-1', estoque_minimo: '0,001', valor: '' };
  const { body } = page({ submitted: true, values: malformed, errors: { estoque: 'Valor inválido.', estoque_minimo: 'Até duas casas decimais.', valor: 'Informe o valor.' } });
  for (const name of ['estoque', 'estoque_minimo', 'valor']) {
    assert.ok(field(body, name).includes(`value="${malformed[name]}"`), name);
    assert.match(field(body, name), /aria-invalid="true"/);
  }
});

test('product form UI: image is optional and accepts local paths without requiring an absolute URL', () => {
  const { body } = page();
  const image = field(body, 'imagem');
  assert.match(image, /maxlength="2048"/);
  assert.doesNotMatch(image, /\srequired(?:\s|>)|type="url"/);
  assert.match(image, /value="\/img\/queijo\.jpg"/);
  assert.match(body, /href="\/categorias\/cadastro"/);
});

test('product image UI: native file selection, inline preview and reselection errors are accessible', () => {
  const { body } = page({ errors: { imagem_arquivo: 'Escolha uma foto válida.' },
    uploadNotice: 'Selecione o arquivo novamente.', submitted: true });
  const picker = field(body, 'imagem_arquivo');
  assert.match(picker, /type="file"/);
  assert.match(picker, /accept="image\/jpeg,image\/png,image\/webp/);
  assert.match(picker, /aria-invalid="true"/);
  assert.doesNotMatch(picker, /\s(?:required|multiple|capture)(?:\s|=|>)/);
  assert.match(body, /href="#imagem_arquivo"/);
  assert.match(body, /data-upload-preview hidden/);
  assert.match(body, /data-upload-feedback role="status" aria-live="polite"/);
  assert.match(body, /data-upload-notice role="status">Selecione o arquivo novamente/);
  const ids = attrs(body, 'id');
  for (const id of attrs(picker, 'aria-describedby')[0].split(/\s+/)) assert.equal(ids.filter(value => value === id).length, 1);
});

test('product form UI: labels, field errors and skip links point to unique existing elements', () => {
  for (const extra of [{}, { submitted: true, errors: Object.fromEntries(Object.keys(values).map(key => [key, 'Corrija este campo.'])) },
    { categorias: [], loadError: 'Falha ao carregar.' }, { categorias: [] },
    { categorias: [], submitted: true, loadError: 'Falha ao carregar.', formError: 'Não foi salvo.' }]) {
    const { html } = page(extra);
    const ids = attrs(html, 'id');
    assert.equal(ids.length, new Set(ids).size);
    for (const attribute of ['for', 'aria-describedby', 'aria-labelledby', 'aria-controls']) {
      for (const value of attrs(html, attribute)) for (const id of value.split(/\s+/)) assert.ok(ids.includes(id), `${attribute}: ${id}`);
    }
    for (const href of attrs(html, 'href').filter(value => value.startsWith('#'))) assert.ok(ids.includes(href.slice(1)), href);
  }
});

test('product form UI: all submitted field errors are associated and linked from summary', () => {
  const { body } = page({ submitted: true, errors: Object.fromEntries(Object.keys(values).map(key => [key, 'Confira o valor.'])) });
  assert.match(body, /role="alert"/);
  assert.match(body, /data-product-error-summary/);
  for (const name of Object.keys(values)) {
    const input = field(body, name);
    assert.match(input, /aria-invalid="true"/, name);
    const id = attrs(input, 'id')[0];
    assert.ok(body.includes(`href="#${id}"`), name);
    assert.ok(attrs(input, 'aria-describedby')[0], name);
  }
  assert.doesNotMatch(page().body, /aria-invalid="true"/);
});

test('product form UI: empty categories and load failure are separate actionable states', () => {
  const empty = page({ categorias: [] }).body;
  assert.match(empty, /href="\/categorias\/cadastro"/);
  assert.doesNotMatch(empty, /data-product-form|data-product-submit/);
  const failed = page({ categorias: [], loadError: 'Categorias indisponíveis.' }).body;
  assert.match(failed, /role="alert"/);
  assert.match(failed, /Categorias indisponíveis\./);
  assert.match(failed, /href="\/produtos\/novo_produto"/);
  assert.doesNotMatch(failed, /data-product-form|data-product-submit/);
});

test('product form UI: failed POST retains editable draft even when category loading fails', () => {
  const { body } = page({ submitted: true, categorias: [], loadError: 'Categorias indisponíveis.', formError: 'O produto não foi salvo.' });
  assert.match(body, /data-product-form/);
  assert.match(body, /<button[^>]*data-product-submit[^>]*disabled/);
  for (const [name, value] of Object.entries(values)) {
    assert.ok(field(body, name), name);
    assert.doesNotMatch(field(body, name), /\sdisabled(?:\s|>)/, name);
    if (name !== 'id_categoria') assert.ok(field(body, name).includes(`value="${ejs.escapeXML(value)}"`), name);
  }
  assert.match(body, /<option[^>]*value="4"[^>]*selected/);
  assert.match(body, /Categoria indisponível/);
});

test('product form UI: category selection is not silently changed if a failed draft references a missing category', () => {
  const { body } = page({ submitted: true, values: { ...values, id_categoria: '777' }, errors: { id_categoria: 'Selecione uma categoria disponível.' } });
  assert.match(body, /<option[^>]*value="777"[^>]*selected/);
  assert.equal([...body.matchAll(/<option\b[^>]*\sselected(?:\s|>)/g)].length, 1);
  assert.match(field(body, 'id_categoria'), /aria-invalid="true"/);
});

test('product form UI: draft, category, username and error HTML is always escaped', () => {
  const attack = '\"><script>alert(1)</script><img src=x onerror=alert(1)>';
  const { body, html } = page({ submitted: true, user: { usuario: attack },
    values: Object.fromEntries(Object.keys(values).map(name => [name, attack])),
    categorias: [{ id_categoria: attack, nome: attack }],
    errors: Object.fromEntries(Object.keys(values).map(name => [name, attack])), formError: attack });
  assert.ok(body.includes(ejs.escapeXML(attack)));
  for (const name of Object.keys(values).filter(name => name !== 'id_categoria')) assert.ok(field(body, name).includes(`value="${ejs.escapeXML(attack)}"`), name);
  assert.doesNotMatch(html, /<script>alert\(1\)<\/script>|<img src=x|value=""><script>/);
});

test('product form UI: uninitialized preview is hidden and image URLs cannot run through SSR', () => {
  for (const imagem of ['', '/img/queijo.jpg', 'https://example.com/image.jpg', 'javascript:alert(1)', 'data:image/svg+xml,<svg onload=alert(1)>', '//example.com/image.jpg']) {
    const { body } = page({ values: { ...values, imagem } });
    assert.match(body, /<[^>]*\bhidden\b[^>]*data-product-preview|<[^>]*data-product-preview[^>]*\bhidden\b/);
    assert.doesNotMatch(body, /<img\b[^>]*\ssrc\s*=/, imagem);
    assert.ok(field(body, 'imagem').includes(`value="${ejs.escapeXML(imagem)}"`));
  }
});

test('product form UI: responsive layout retains visible controls and respects reduced motion', () => {
  const css = read('public/css/product-form.css');
  assert.match(css, /@media \(max-width: 959px\)/);
  assert.match(css, /@media \(max-width: 719px\)/);
  assert.match(css, /\.product-create-layout \{ grid-template-columns: minmax\(0, 1fr\)/);
  assert.match(css, /\.product-create-fields \{ grid-template-columns: minmax\(0, 1fr\)/);
  assert.match(css, /\.product-create-aside \{ position: static/);
  assert.match(css, /font-size: 16px/);
  assert.match(css, /:focus-visible/);
  assert.match(css, /min-height: 48px/);
  assert.match(css, /prefers-reduced-motion: reduce/);
  assert.doesNotMatch(css, /(?<!min-)height: 100(?:s|d)?vh|@keyframes|animation:.*infinite/);
});
