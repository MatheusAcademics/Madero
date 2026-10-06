const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ejs = require('ejs');

const root = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const render = (file, data) => ejs.render(read(file), data, { filename: path.join(root, file) });
const attributes = (html, name) => [...html.matchAll(new RegExp(`\\s${name}="([^"]*)"`, 'g'))].map(match => match[1]);

function product(overrides = {}) {
  return { id_produto: 7, nome: 'Queijo', estoque: 2.5, estoque_minimo: 5,
    imagem: '/img/comida_madero.jpg', id_categoria: 2,
    nome_categoria: 'Ingredientes', ...overrides };
}

function stock(overrides = {}) {
  const locals = {
    mainClass: 'main-stock', isLoggedIn: true, user: { usuario: 'Ana' },
    produtos: [product()], categorias: [{ id_categoria: 2, nome: 'Ingredientes' }],
    filters: { q: '', categoria: '', status: 'todos', ordem: 'nome' },
    pagination: { page: 1, pageSize: 20, total: 1, totalPages: 1 },
    summary: { total: 1, belowMinimum: 1, zero: 0, negative: 0 },
    geradoEm: '2026-10-02T12:30:00.000Z', mensagem: '', stockError: '', ...overrides,
  };
  const body = render('views/estoque.ejs', locals);
  return { body, html: render('views/layouts/principal.ejs', { ...locals, body }) };
}

function emptyStock(overrides = {}) {
  return stock({ produtos: [], categorias: [],
    pagination: { page: 1, pageSize: 20, total: 0, totalPages: 1 },
    summary: { total: 0, belowMinimum: 0, zero: 0, negative: 0 }, ...overrides });
}

test('stock: workspace isolado com título, navegação atual e um único main e h1', () => {
  const { html } = stock();
  assert.match(html, /<title>Estoque atual — Madero<\/title>/i);
  assert.match(html, /<body class="main-dashboard main-stock">/);
  assert.match(html, /href="\/css\/dashboard\.css\?v=[^"]+"/);
  assert.match(html, /href="\/css\/stock\.css\?v=[^"]+"/);
  assert.match(html, /src="\/js\/dashboard\.js\?v=[^"]+"/);
  assert.match(html, /<meta name="robots" content="noindex, nofollow">/);
  assert.equal([...html.matchAll(/<main\b/g)].length, 1);
  assert.equal([...html.matchAll(/<h1\b/g)].length, 1);
  assert.match(html, /<h1\b[^>]*>Estoque atual<\/h1>/i);
  assert.match(html, /href="\/movimentacoes\/listar_estoque"[^>]*aria-current="page"/);
  assert.doesNotMatch(html, /<header class="header-main"|href="\/css\/(?:style|login|landing|sobre|cardapio|public-footer)\.css/);
  assert.doesNotMatch(html, /src="\/js\/(?:stock|products|movement-form)\.js/);
});

test('stock: CSS exclusivo não modifica dashboard, produtos, formulários, login nem páginas públicas', () => {
  for (const mainClass of ['main-dashboard', 'main-products', 'main-category-form', 'main-movement-form', 'main-login', 'main-index', 'main-cardapio', 'main-sobre', '']) {
    const html = render('views/layouts/principal.ejs', {
      mainClass, authPage: 'login', isLoggedIn: true, user: { usuario: 'Ana' }, body: '<p>Conteúdo</p>',
    });
    assert.doesNotMatch(html, /(?:href|src)="\/(?:css|js)\/stock\./);
  }
});

test('stock: ids únicos, fragmentos e rótulos acessíveis apontam para elementos existentes', () => {
  for (const { html } of [stock(), emptyStock(), stock({ produtos: [], summary: null, stockError: 'Falha de consulta' })]) {
    const ids = attributes(html, 'id');
    assert.equal(ids.length, new Set(ids).size);
    for (const href of attributes(html, 'href').filter(value => value.startsWith('#'))) {
      assert.ok(ids.includes(href.slice(1)), `Destino ausente: ${href}`);
    }
    for (const attr of ['for', 'aria-labelledby', 'aria-describedby']) {
      for (const targets of attributes(html, attr)) {
        for (const target of targets.split(/\s+/)) assert.ok(ids.includes(target), `Rótulo ausente: ${target}`);
      }
    }
  }
});

test('stock: consulta usa busca, filtros e ordenação GET nativos sem ocultar linhas no cliente', () => {
  const { body } = stock();
  const form = [...body.matchAll(/<form\b[^>]*>[\s\S]*?<\/form>/g)]
    .map(match => match[0]).find(value => /name="q"/.test(value));
  assert.ok(form, 'Formulário de busca ausente');
  assert.match(form, /action="\/movimentacoes\/listar_estoque"/);
  assert.match(form, /method="get"/i);
  for (const name of ['q', 'categoria', 'status', 'ordem']) assert.ok(form.includes(`name="${name}"`));
  assert.match(form, /<button\b[^>]*type="submit"/);
  assert.doesNotMatch(form, /\s(?:disabled|hidden)(?:\s|[=>])|name="pagina"|data-stock-search\b/);
  assert.match(body, /<table\b/);
  assert.match(body, /<caption\b/);
  assert.match(body, /<th\b[^>]*scope="col"/);
  assert.match(body, /<th\b[^>]*scope="row"/);
  assert.doesNotMatch(body, /<tr[^>]+hidden|data-stock-search\b|data-stock-search-control\b/);
});

test('stock: tela somente de consulta encaminha ajustes para uma movimentação real', () => {
  const { body } = stock();
  assert.match(body, /href="\/movimentacoes\/nova_movimentacao(?:"|\?)/);
  assert.match(body, /href="\/movimentacoes\/nova_movimentacao\?produto=7"/);
  assert.doesNotMatch(body, /<form\b[^>]*method="post"/i);
  assert.doesNotMatch(body, /href="\/produtos\/(?:alterar|excluir)\/|action="\/produtos\//);
  assert.doesNotMatch(body, /contenteditable|<input[^>]*name="(?:estoque|estoque_minimo|quantidade)"/);
});

test('stock: dados, categorias, pesquisa, usuário, mensagens e erros são escapados', () => {
  const attack = '</script><script>alert("stock")</script><img src=x onerror="alert(1)">';
  const { body, html } = stock({
    produtos: [product({ nome: attack, nome_categoria: attack })],
    categorias: [{ id_categoria: 2, nome: attack }], user: { usuario: attack }, mensagem: attack,
    filters: { q: attack, categoria: '2', status: 'todos', ordem: 'nome' },
  });
  assert.ok(body.includes(ejs.escapeXML(attack)));
  assert.ok(body.includes(`value="${ejs.escapeXML(attack)}"`));
  assert.doesNotMatch(body, /<script\b|<img src=x|onerror="alert/);
  assert.doesNotMatch(html, /<script>alert\("stock"\)/);
  const { body: error } = stock({ produtos: [], summary: null, stockError: attack });
  assert.ok(error.includes(ejs.escapeXML(attack)));
  assert.doesNotMatch(error, /<script\b|<img src=x/);
});

test('stock: imagens aceitam somente HTTP(S) e caminhos locais, com dimensões e fallback compartilhado', () => {
  for (const imagem of ['javascript:alert(1)', 'JaVaScRiPt:alert(1)', 'data:image/svg+xml,<svg onload=alert(1)>', '//example.test/image.png', 'file:///secret', '', null]) {
    const { body } = stock({ produtos: [product({ imagem })] });
    assert.doesNotMatch(body, /\sdata-product-image(?:>|\s)/);
    assert.match(body, /data-product-thumb/);
    assert.doesNotMatch(body, /<img[^>]*src="(?:javascript:|data:|\/\/|file:)/i);
  }
  for (const imagem of ['/img/comida_madero.jpg', 'https://example.test/product.jpg', 'http://example.test/product.jpg']) {
    const { body } = stock({ produtos: [product({ imagem })] });
    const image = [...body.matchAll(/<img\b[^>]*>/g)].map(match => match[0]).find(tag => tag.includes(`src="${imagem}"`));
    assert.ok(image);
    assert.match(image, /alt=""/);
    assert.match(image, /width="\d+" height="\d+"/);
    assert.match(image, /loading="lazy"/);
    assert.match(image, /referrerpolicy="no-referrer"/);
    assert.match(image, /data-product-image/);
  }
});

test('stock: saldos têm cor e rótulo sem confundir nulo, zero, negativo ou mínimo exato', () => {
  for (const [estoque, estoque_minimo, tone, label, value] of [
    [2.5, 5, 'warning', 'Abaixo do mínimo', '2,5'],
    [0.01, 1, 'warning', 'Abaixo do mínimo', '0,01'],
    [0, 0, 'negative', 'Sem estoque', '0'],
    [0, 5, 'negative', 'Sem estoque', '0'],
    [-2.5, 0, 'negative', 'Saldo negativo', '-2,5'],
    [5, 5, 'positive', 'Mínimo atendido', '5'],
    [10, 5, 'positive', 'Mínimo atendido', '10'],
    [null, 5, 'neutral', 'Saldo indisponível', '—'],
    [undefined, 5, 'neutral', 'Saldo indisponível', '—'],
    ['', 5, 'neutral', 'Saldo indisponível', '—'],
    ['inválido', 5, 'neutral', 'Saldo indisponível', '—'],
    [10, null, 'neutral', 'Mínimo não definido', '10'],
    [10, undefined, 'neutral', 'Mínimo não definido', '10'],
    ['9999999999.99', '0.00', 'positive', 'Mínimo atendido', '9.999.999.999,99'],
  ]) {
    const { body } = stock({ produtos: [product({ estoque, estoque_minimo })] });
    const cell = body.match(/<td[^>]*class="stock-balance-cell"[^>]*>([\s\S]*?)<\/td>/)[1];
    assert.ok(cell.includes(`data-tone="${tone}">${value}</strong>`), `${estoque}: ${tone} / ${value}`);
    assert.ok(cell.includes(label), label);
    if (estoque === estoque_minimo) assert.doesNotMatch(cell, /Abaixo do mínimo/);
    assert.doesNotMatch(body, /NaN|Infinity|undefined/);
  }
});

test('stock: falta para o mínimo usa precisão do esquema NUMERIC(12,2), não soma unidades e preserva desconhecidos', () => {
  for (const [estoque, estoque_minimo, value, tone] of [
    [2.5, 5, '2,5', 'warning'],
    ['0.10', '0.30', '0,2', 'warning'],
    ['0.01', '0.02', '0,01', 'warning'],
    [0, 5, '5', 'negative'],
    [-2.5, 0, '2,5', 'negative'],
    [0, 0, '0', 'neutral'],
    [5, 5, '0', 'neutral'],
    [10, 5, '0', 'neutral'],
    [null, 5, '—', 'neutral'],
    [10, null, '—', 'neutral'],
    [0, null, '—', 'neutral'],
    [-2, null, '—', 'neutral'],
    [null, null, '—', 'neutral'],
    ['-9999999999.99', '9999999999.99', '19.999.999.999,98', 'negative'],
  ]) {
    const { body } = stock({ produtos: [product({ estoque, estoque_minimo })] });
    const cell = body.match(/<td[^>]*class="stock-shortage-cell"[^>]*>([\s\S]*?)<\/td>/)[1];
    assert.ok(cell.includes(`data-tone="${tone}">${value}</strong>`), `${estoque}/${estoque_minimo}: ${value} ${tone}`);
    assert.doesNotMatch(body, /\d (?:kg|unidades)|Estoque total em unidades|0,199999|NaN|Infinity/);
  }
});

test('stock: resumo global distingue abaixo do mínimo, zerados e negativos sem alertas falsos nos contadores zero', () => {
  const { body } = stock({ summary: { total: 12, belowMinimum: 3, zero: 2, negative: 1 },
    filters: { q: 'Queijo', categoria: '2', status: 'zerado', ordem: 'reposicao' } });
  const nav = body.match(/<nav class="stock-status-tabs"[\s\S]*?<\/nav>/)[0];
  const links = [...nav.matchAll(/<a\b[^>]*>[\s\S]*?<\/a>/g)].map(match => match[0]);
  assert.equal(links.length, 4);
  for (const [index, label, count, tone, status] of [
    [0, 'Todos', 12, 'neutral', null],
    [1, 'Abaixo do mínimo', 3, 'warning', 'repor'],
    [2, 'Zerados', 2, 'negative', 'zerado'],
    [3, 'Negativos', 1, 'negative', 'negativo'],
  ]) {
    assert.ok(links[index].includes(`${label}<span data-tone="${tone}">${count}</span>`));
    const url = new URL(attributes(links[index], 'href')[0].replaceAll('&amp;', '&'), 'http://localhost');
    assert.equal(url.pathname, '/movimentacoes/listar_estoque');
    assert.equal(url.searchParams.get('q'), 'Queijo');
    assert.equal(url.searchParams.get('categoria'), '2');
    assert.equal(url.searchParams.get('ordem'), 'reposicao');
    assert.equal(url.searchParams.get('status'), status);
    assert.equal(url.searchParams.get('pagina'), null);
  }
  assert.match(links[2], /aria-current="true"/);
  assert.equal(links.filter(link => /aria-current=/.test(link)).length, 1);
  const healthy = stock({ summary: { total: 2, belowMinimum: 0, zero: 0, negative: 0 } }).body;
  const healthyNav = healthy.match(/<nav class="stock-status-tabs"[\s\S]*?<\/nav>/)[0];
  assert.doesNotMatch(healthyNav, /data-tone="(?:negative|warning|positive)"/);
  assert.match(body, /Em todo o estoque/);
});

test('stock: vazios distinguem primeiro produto, filtro sem resultado e consulta indisponível', () => {
  const first = emptyStock().body;
  assert.match(first, /Nenhum produto no estoque/);
  assert.match(first, /href="\/categorias\/cadastro"/);
  assert.doesNotMatch(first, /class="stock-status-tabs"|<table\b|Nenhum produto encontrado/);
  const ready = emptyStock({ categorias: [{ id_categoria: 2, nome: 'Ingredientes' }] }).body;
  assert.match(ready, /Nenhum produto no estoque/);
  assert.match(ready, /href="\/produtos\/novo_produto"/);
  const filtered = emptyStock({ summary: { total: 4, belowMinimum: 1, zero: 0, negative: 0 },
    filters: { q: 'Inexistente', categoria: '', status: 'todos', ordem: 'nome' } }).body;
  assert.doesNotMatch(filtered, /Nenhum produto no estoque/);
  assert.match(filtered, /Nenhum produto encontrado/);
  assert.match(filtered, /href="\/movimentacoes\/listar_estoque">Limpar filtros/);
  for (const [summary, stockError] of [[null, 'Falha de consulta'], [null, '']]) {
    const error = stock({ produtos: [], summary, stockError }).body;
    assert.match(error, /role="alert"/);
    assert.match(error, /Não conseguimos carregar o estoque/);
    assert.match(error, /Tentar novamente/);
    assert.doesNotMatch(error, /Nenhum produto no estoque|Nenhum produto encontrado|class="stock-status-tabs"|<table\b/);
  }
});

test('stock: paginação e atualização preservam filtros enquanto formulário e abas reiniciam a página', () => {
  const { body } = stock({
    filters: { q: 'Pão & queijo', categoria: '2', status: 'repor', ordem: 'saldo-desc' },
    pagination: { page: 5, pageSize: 20, total: 205, totalPages: 11 },
    summary: { total: 310, belowMinimum: 205, zero: 2, negative: 1 },
  });
  const navigation = body.match(/<nav class="stock-pagination"[\s\S]*?<\/nav>/)[0];
  const links = attributes(navigation, 'href').map(href => new URL(href.replaceAll('&amp;', '&'), 'http://localhost'));
  const refresh = body.match(/<a class="stock-refresh"[^>]*>/)[0];
  links.push(new URL(attributes(refresh, 'href')[0].replaceAll('&amp;', '&'), 'http://localhost'));
  for (const link of links) {
    assert.equal(link.pathname, '/movimentacoes/listar_estoque');
    assert.equal(link.searchParams.get('q'), 'Pão & queijo');
    assert.equal(link.searchParams.get('categoria'), '2');
    assert.equal(link.searchParams.get('status'), 'repor');
    assert.equal(link.searchParams.get('ordem'), 'saldo-desc');
    assert.ok(Number(link.searchParams.get('pagina') || 1) >= 1);
    assert.ok(Number(link.searchParams.get('pagina') || 1) <= 11);
  }
  assert.equal(links.at(-1).searchParams.get('pagina'), '5');
  assert.match(navigation, /aria-label="Página 5" aria-current="page"/);
  assert.match(body, /Mostrando <strong>81–81<\/strong> de <strong>205<\/strong>/);
  const form = body.match(/<form class="stock-filters"[\s\S]*?<\/form>/)[0];
  assert.doesNotMatch(form, /name="pagina"/);
  assert.match(form, /value="2" selected/);
  assert.match(form, /value="saldo-desc" selected/);
  assert.match(form, /name="status" value="repor"/);
  assert.doesNotMatch(stock().body, /class="stock-pagination"/);
});

test('stock: categoria ausente permanece identificada e nunca simula o filtro de todas', () => {
  const { body } = stock({ filters: { q: '', categoria: '999', status: 'todos', ordem: 'nome' } });
  assert.match(body, /<option value="999" selected>Categoria indisponível<\/option>/);
  const withoutCategory = stock({ produtos: [product({ id_categoria: null, nome_categoria: null })] }).body;
  assert.match(withoutCategory, /Sem categoria/);
  assert.doesNotMatch(withoutCategory, />null<|>undefined</);
});

test('stock: data da consulta é válida, não promete atualização automática e não inventa 1970 para datas ausentes', () => {
  const { body } = stock();
  assert.match(body, /Consultado em <time datetime="2026-10-02T12:30:00\.000Z" data-dashboard-date>/);
  assert.match(body, /Atualizar saldos/);
  assert.match(body, /Esta tela é somente de consulta/);
  assert.doesNotMatch(body, /em tempo real|atualização automática|Atualização automática/i);
  for (const geradoEm of [null, '', 'inválida', undefined]) {
    const { body: missing } = stock({ geradoEm });
    assert.doesNotMatch(missing, /<time\b|1970|Invalid Date|NaN/);
  }
});

test('stock: móvel reorganiza a mesma tabela com cabeçalhos preservados, foco e controles de toque', () => {
  const css = read('public/css/stock.css');
  const shared = read('public/css/dashboard.css');
  assert.match(css, /@media \(max-width: 959px\)/);
  assert.match(css, /@media \(max-width: 719px\)/);
  assert.match(css, /\.stock-table tbody \{ display: grid; grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/);
  assert.match(css, /\.stock-table tbody \{ grid-template-columns: minmax\(0, 1fr\)/);
  assert.match(css, /\.stock-table thead \{[^}]*clip-path: inset\(50%\)/);
  assert.doesNotMatch(css, /\.stock-table thead \{[^}]*display: none/);
  assert.match(css, /min-height: 44px/);
  assert.match(css, /\.main-stock select:focus-visible/);
  assert.match(css, /\.stock-search:focus-within/);
  assert.match(css, /\.stock-search input, \.stock-field select \{ font-size: 16px/);
  assert.match(shared, /prefers-reduced-motion/);
  assert.doesNotMatch(css, /@keyframes|animation:.*infinite|(?<!min-)height: 100(?:s|d)?vh/);
  const { body } = stock();
  assert.equal([...body.matchAll(/<table\b/g)].length, 1);
  assert.equal([...body.matchAll(/class="stock-product-cell"/g)].length, 1);
  assert.equal([...body.matchAll(/class="stock-row-action"/g)].length, 1);
  assert.match(body, /<table class="stock-table" role="table">/);
  assert.match(body, /scope="row" role="rowheader"/);
  assert.match(body, /class="stock-mobile-label" aria-hidden="true"/);
});
