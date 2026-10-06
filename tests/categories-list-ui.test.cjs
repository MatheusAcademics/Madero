const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ejs = require('ejs');

const root = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const render = (file, data) => ejs.render(read(file), data, { filename: path.join(root, file) });
const attributes = (html, name) => [...html.matchAll(new RegExp(`\\s${name}="([^"]*)"`, 'g'))].map(match => match[1]);
const urls = html => attributes(html, 'href').filter(href => href.startsWith('/categorias/listar'))
  .map(href => new URL(href.replaceAll('&amp;', '&'), 'http://localhost'));
const forms = html => [...html.matchAll(/<form\b[^>]*>[\s\S]*?<\/form>/g)].map(match => match[0]);
const table = html => html.match(/<table\b[\s\S]*?<\/table>/)?.[0] || '';

function category(overrides = {}) {
  return { id_categoria: 7, nome: 'Ingredientes', total_produtos: 3, ...overrides };
}

function categories(overrides = {}) {
  const locals = {
    mainClass: 'main-categories', isLoggedIn: true, user: { usuario: 'Ana' },
    categorias: [category()],
    filters: { q: '', status: 'todas', ordem: 'nome' },
    pagination: { page: 1, pageSize: 20, total: 1, totalPages: 1 },
    summary: { total: 1, withProducts: 1, withoutProducts: 0 },
    mensagem: '', noticeType: 'success', categoriesError: null, ...overrides,
  };
  const body = render('views/categoria.ejs', locals);
  return { body, html: render('views/layouts/principal.ejs', { ...locals, body }) };
}

function emptyCategories(overrides = {}) {
  return categories({ categorias: [],
    pagination: { page: 1, pageSize: 20, total: 0, totalPages: 1 },
    summary: { total: 0, withProducts: 0, withoutProducts: 0 }, ...overrides });
}

test('categories list: isolated workspace with title, current navigation and unique landmarks', () => {
  const { html } = categories();
  assert.match(html, /<title>Categorias — Madero<\/title>/);
  assert.match(html, /<body class="main-dashboard main-categories">/);
  assert.match(html, /href="\/css\/dashboard\.css\?v=[^"]+"/);
  assert.match(html, /href="\/css\/categories\.css\?v=[^"]+"/);
  assert.match(html, /src="\/js\/categories\.js\?v=[^"]+"/);
  assert.match(html, /<meta name="robots" content="noindex, nofollow">/);
  assert.equal([...html.matchAll(/<main\b/g)].length, 1);
  assert.equal([...html.matchAll(/<h1\b/g)].length, 1);
  assert.match(html, /<h1\b[^>]*>Categorias<\/h1>/);
  assert.match(html, /href="\/categorias\/listar"[^>]*aria-current="page"/);
  assert.doesNotMatch(html, /<header class="header-main"|href="\/css\/(?:style|login|landing|sobre|cardapio|public-footer)\.css/);
});

test('categories list: own assets do not load on other internal or public pages', () => {
  for (const mainClass of ['main-dashboard', 'main-products', 'main-stock', 'main-movements', 'main-category-form', 'main-movement-form', 'main-login', 'main-index', 'main-cardapio', 'main-sobre', '']) {
    const html = render('views/layouts/principal.ejs', {
      mainClass, authPage: 'login', isLoggedIn: true, user: { usuario: 'Ana' }, body: '<p>Content</p>',
    });
    assert.doesNotMatch(html, /(?:href|src)="\/(?:css|js)\/categories\./);
  }
});

test('categories list: IDs, fragment links, labels and accessible references are valid in every state', () => {
  for (const { html } of [categories(), categories({ categorias: [category({ total_produtos: 0 })] }), emptyCategories(),
    categories({ categorias: [], summary: null, categoriesError: 'Falha de consulta' })]) {
    const ids = attributes(html, 'id');
    assert.equal(ids.length, new Set(ids).size);
    for (const href of attributes(html, 'href').filter(value => value.startsWith('#'))) {
      assert.ok(ids.includes(href.slice(1)), `Missing destination: ${href}`);
    }
    for (const attribute of ['for', 'aria-labelledby', 'aria-describedby']) {
      for (const targets of attributes(html, attribute)) {
        for (const target of targets.split(/\s+/)) assert.ok(ids.includes(target), `Missing accessible reference: ${target}`);
      }
    }
  }
});

test('categories list: search, occupancy and order use a native GET form without client-only filtering', () => {
  const { body } = categories();
  const form = forms(body).find(value => /name="q"/.test(value));
  assert.ok(form, 'Missing search form');
  assert.match(form, /action="\/categorias\/listar"/);
  assert.match(form, /method="get"/i);
  for (const name of ['q', 'status', 'ordem']) assert.ok(form.includes(`name="${name}"`), name);
  assert.match(form, /<button\b[^>]*type="submit"/);
  assert.doesNotMatch(form, /\sdisabled(?:\s|[=>])|name="pagina"/);
  assert.doesNotMatch(body, /data-stock-search\b|data-stock-search-control\b|<tr[^>]+hidden/);
  assert.match(body, /<table\b/);
  assert.match(body, /<caption\b/);
  assert.match(body, /<th\b[^>]*scope="col"/);
  assert.match(body, /<th\b[^>]*scope="row"/);
});

test('categories list: each category keeps its ID, name, edit route and product-filter link', () => {
  const { body } = categories();
  const listing = table(body);
  assert.ok(listing.includes('Ingredientes'));
  assert.match(listing, /href="\/categorias\/alterar\/7"/);
  assert.match(listing, /href="\/produtos\/listar\?categoria=7"/);
  assert.match(listing, /(?:#|ID\s*)7/);
  assert.match(body, /href="\/categorias\/cadastro"/);
  assert.doesNotMatch(listing, /(?:kg|litros?|R\$)\b|Saldo negativo|Abaixo do mínimo|Estoque mínimo/);
});

test('categories list: categories with products explain why deletion is unavailable', () => {
  const { body } = categories();
  assert.doesNotMatch(body, /action="\/categorias\/excluir\/7"|href="\/categorias\/excluir\/7"/);
  assert.match(table(body), /produtos|produto/);
  assert.match(table(body), /(?:vinculad|exclu|remov|transfir|mova)/i);
  assert.match(table(body), /href="\/categorias\/alterar\/7"/);
  assert.match(table(body), /href="\/produtos\/listar\?categoria=7"/);
});

test('categories list: empty category deletion is a POST with native confirmation and accessible dialog', () => {
  const { body } = categories({ categorias: [category({ total_produtos: 0 })] });
  const form = forms(body).find(value => /action="\/categorias\/excluir\/7"/.test(value));
  assert.ok(form, 'Missing delete form for empty category');
  assert.match(form, /method="post"/i);
  assert.match(form, /onsubmit="return confirm\('[^']+'\);?"/);
  assert.match(form, /<button\b[^>]*type="submit"/);
  assert.match(form, /data-delete-category/);
  assert.match(form, /data-category-name="Ingredientes"/);
  assert.doesNotMatch(body, /href="\/categorias\/excluir\//);
  assert.match(body, /<dialog\b[^>]*aria-labelledby="[^"]+"/);
  for (const hook of ['data-category-delete-dialog', 'data-delete-name', 'data-delete-cancel', 'data-delete-confirm']) assert.ok(body.includes(hook));
});

test('categories list: unknown counts never claim an empty category or expose destructive controls', () => {
  for (const total_produtos of [null, undefined, '', 'invalid', -1]) {
    const { body } = categories({ categorias: [category({ total_produtos })] });
    assert.doesNotMatch(body, /action="\/categorias\/excluir\/7"/);
    assert.doesNotMatch(table(body), /NaN|Infinity|>null<|>undefined</);
  }
});

test('categories list: category, search, username, message and errors are escaped in HTML', () => {
  const attack = '</script><script>alert("categories")</script><img src=x onerror="alert(1)">';
  const { body, html } = categories({
    categorias: [category({ nome: attack, total_produtos: 0 })], user: { usuario: attack }, mensagem: attack,
    filters: { q: attack, status: 'todas', ordem: 'nome' },
  });
  assert.ok(body.includes(ejs.escapeXML(attack)));
  assert.ok(body.includes(`value="${ejs.escapeXML(attack)}"`));
  assert.ok(body.includes(`data-category-name="${ejs.escapeXML(attack)}"`));
  assert.doesNotMatch(body, /<script\b|<img src=x|onerror="alert/);
  assert.doesNotMatch(html, /<script>alert\("categories"\)/);
  for (const match of body.matchAll(/onsubmit="([^"]+)"/g)) assert.doesNotMatch(match[1], /categories|&lt;|&gt;/);
  const { body: error } = categories({ categorias: [], summary: null, categoriesError: attack });
  assert.ok(error.includes(ejs.escapeXML(attack)));
  assert.doesNotMatch(error, /<script\b|<img src=x/);
});

test('categories list: pagination preserves literal search, occupancy and order but filtering resets page', () => {
  const filters = { q: 'Pão & queijo', status: 'sem-produtos', ordem: 'nome-desc' };
  const { body } = categories({ filters,
    pagination: { page: 5, pageSize: 20, total: 205, totalPages: 11 },
    summary: { total: 310, withProducts: 105, withoutProducts: 205 },
  });
  const navigation = [...body.matchAll(/<nav\b[\s\S]*?<\/nav>/g)].map(match => match[0])
    .find(nav => /aria-label="Página 5"/.test(nav));
  assert.ok(navigation, 'Missing pagination');
  const links = urls(navigation);
  assert.ok(links.length >= 3);
  for (const link of links) {
    assert.equal(link.pathname, '/categorias/listar');
    for (const [key, value] of Object.entries(filters)) assert.equal(link.searchParams.get(key), value, key);
    assert.ok(Number(link.searchParams.get('pagina') || 1) >= 1);
    assert.ok(Number(link.searchParams.get('pagina') || 1) <= 11);
  }
  assert.match(navigation, /aria-label="Página 5" aria-current="page"/);
  assert.match(body, /Mostrando <strong>81–81<\/strong> de <strong>205<\/strong>/);
  const form = forms(body).find(value => /name="q"/.test(value));
  assert.doesNotMatch(form, /name="pagina"/);
  assert.ok(form.includes(`value="${ejs.escapeXML(filters.q)}"`));
  assert.match(form, /value="nome-desc" selected/);
  assert.doesNotMatch(categories().body, /aria-label="Página 2"/);
});

test('categories list: first-use, no filtered results and query failures remain distinct', () => {
  const first = emptyCategories().body;
  assert.match(first, /Comece organizando seus produtos/);
  assert.match(first, /href="\/categorias\/cadastro"/);
  assert.doesNotMatch(first, /<table\b|Nenhuma categoria encontrada/);
  for (const summary of [{ total: 4, withProducts: 3, withoutProducts: 1 }, { total: 0, withProducts: 0, withoutProducts: 0 }]) {
    const filtered = emptyCategories({ summary,
      filters: { q: 'Inexistente', status: 'todas', ordem: 'nome' },
    }).body;
    assert.doesNotMatch(filtered, /Comece organizando seus produtos/);
    assert.match(filtered, /Nenhuma categoria encontrada|Nenhum resultado/);
    assert.match(filtered, /href="\/categorias\/listar"/);
    assert.match(filtered, /name="q"[^>]*value="Inexistente"/);
    assert.doesNotMatch(filtered, /<table\b/);
  }
  for (const categoriesError of ['Falha de consulta', null]) {
    const error = categories({ categorias: [], summary: null, categoriesError }).body;
    assert.match(error, /role="alert"/);
    assert.match(error, /Tentar novamente/);
    assert.doesNotMatch(error, /Comece organizando seus produtos|Nenhuma categoria encontrada|Nenhum resultado|<table\b/);
  }
});

test('categories list: feedback distinguishes success from rejected actions without creating fake inventory alerts', () => {
  const success = categories({ mensagem: 'Categoria cadastrada.', noticeType: 'success' }).body;
  assert.match(success, /role="status"/);
  assert.match(success, /Categoria cadastrada\./);
  const rejected = categories({ mensagem: 'Categoria possui produtos.', noticeType: 'error' }).body;
  assert.match(rejected, /role="alert"/);
  assert.match(rejected, /Categoria possui produtos\./);
  assert.doesNotMatch(table(categories().body), /data-tone="(?:negative|warning|positive)"/);
});

test('categories list: global neutral counters stay distinct from filtered results and tab links preserve search', () => {
  const filters = { q: 'Pão & queijo', status: 'sem-produtos', ordem: 'nome-desc' };
  const { body } = categories({ filters,
    summary: { total: 1310, withProducts: 105, withoutProducts: 1205 },
    pagination: { page: 1, pageSize: 20, total: 12, totalPages: 1 },
  });
  const navigation = body.match(/<nav class="categories-tabs"[\s\S]*?<\/nav>/)[0];
  const links = [...navigation.matchAll(/<a\b[^>]*>[\s\S]*?<\/a>/g)].map(match => match[0]);
  assert.equal(links.length, 3);
  for (const [index, label, count, status] of [[0, 'Todas', '1.310', null], [1, 'Com produtos', '105', 'com-produtos'], [2, 'Sem produtos', '1.205', 'sem-produtos']]) {
    assert.ok(links[index].includes(`${label}<span>${count}</span>`));
    const link = urls(links[index])[0];
    assert.equal(link.searchParams.get('status'), status);
    assert.equal(link.searchParams.get('pagina'), null);
    assert.equal(link.searchParams.get('q'), filters.q);
    assert.equal(link.searchParams.get('ordem'), filters.ordem);
  }
  assert.match(links[2], /aria-current="true"/);
  assert.equal(links.filter(link => /aria-current=/.test(link)).length, 1);
  assert.doesNotMatch(navigation, /data-tone="(?:negative|warning|positive)"/);
  assert.match(body, /Em todo o cadastro/);
  assert.match(body, /Resultado da busca<span>12 categorias<\/span>/);
  const form = forms(body).find(value => /name="q"/.test(value));
  assert.match(form, /name="status" value="sem-produtos"/);
});

test('categories list: retry preserves the failed query, order and page', () => {
  const filters = { q: 'Pão & queijo', status: 'sem-produtos', ordem: 'nome-desc' };
  const { body } = categories({ filters, categorias: [], summary: null, categoriesError: 'Falha de consulta',
    pagination: { page: 5, pageSize: 20, total: 205, totalPages: 11 },
  });
  const retry = body.match(/<section class="dash-error"[\s\S]*?<\/section>/)[0];
  const links = urls(retry);
  assert.equal(links.length, 1);
  for (const [key, value] of Object.entries(filters)) assert.equal(links[0].searchParams.get(key), value);
  assert.equal(links[0].searchParams.get('pagina'), '5');
});

test('categories list: mobile uses the same records, preserves table semantics and provides visible focus and touch targets', () => {
  const css = read('public/css/categories.css');
  const shared = read('public/css/dashboard.css');
  assert.match(css, /@media \(max-width: 719px\)/);
  assert.match(css, /@media \(max-width: 379px\)/);
  assert.match(css, /\.categories-table tbody tr \{ display: grid; grid-template-columns: minmax\(0, 1fr\)/);
  assert.match(css, /\.categories-table thead \{[^}]*clip-path: inset\(50%\)/);
  assert.match(css, /min-height: 44px/);
  assert.match(css, /\.categories-field select:focus-visible/);
  assert.match(css, /\.categories-search:focus-within/);
  assert.match(css, /\.categories-search input, \.categories-field select \{ font-size: 16px/);
  assert.match(css, /prefers-reduced-motion/);
  assert.match(shared, /prefers-reduced-motion/);
  assert.doesNotMatch(css, /@keyframes|animation:.*infinite|height: 100vh/);
  const { body } = categories({ categorias: [category({ total_produtos: 0 }), category({ id_categoria: 8, nome: 'Bebidas', total_produtos: 2 })] });
  assert.equal([...body.matchAll(/data-delete-category\b/g)].length, 1);
  assert.equal([...body.matchAll(/class="categories-name"/g)].length, 2);
  assert.equal([...body.matchAll(/<table\b/g)].length, 1);
  assert.match(body, /<table class="categories-table" role="table">/);
  assert.match(body, /<tbody role="rowgroup">/);
  assert.match(body, /<th scope="row" role="rowheader"/);
});
