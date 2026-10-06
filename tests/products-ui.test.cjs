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
  return { id_produto: 7, nome_produto: 'Queijo', estoque: 2.5, estoque_minimo: 5,
    valor: 14.1, imagem: '/img/comida_madero.jpg', id_categoria: 2,
    nome_categoria: 'Ingredientes', ...overrides };
}

function products(overrides = {}) {
  const locals = {
    mainClass: 'main-products', isLoggedIn: true, user: { usuario: 'Ana' },
    produtos: [product()], categorias: [{ id_categoria: 2, nome: 'Ingredientes' }],
    filters: { q: '', categoria: '', status: 'todos', ordem: 'nome' },
    pagination: { page: 1, pageSize: 20, total: 1, totalPages: 1 },
    summary: { total: 1, belowMinimum: 1, nonPositive: 0 },
    mensagem: '', productsError: null, ...overrides,
  };
  const body = render('views/produto.ejs', locals);
  return { body, html: render('views/layouts/principal.ejs', { ...locals, body }) };
}

function emptyProducts(overrides = {}) {
  return products({ produtos: [], categorias: [],
    pagination: { page: 1, pageSize: 20, total: 0, totalPages: 1 },
    summary: { total: 0, belowMinimum: 0, nonPositive: 0 }, ...overrides });
}

test('products: failed deletion is an accessible warning rather than a success checkmark', () => {
  const { body } = products({ mensagem: 'Este produto possui movimentações.', noticeType: 'error' });
  const notice = body.match(/<p class="dash-notice products-notice"[\s\S]*?<\/p>/)?.[0];
  assert.ok(notice);
  assert.match(notice, /role="alert"/);
  assert.match(notice, /Este produto possui movimentações\./);
  const success = products({ mensagem: 'Produto excluído com sucesso!', noticeType: 'success' }).body;
  assert.match(success, /class="dash-notice products-notice" role="status"/);
});

test('products: layout isolado com título, navegação atual e um único main e h1', () => {
  const { html } = products();
  assert.match(html, /<title>Produtos — Madero<\/title>/);
  assert.match(html, /<body class="[^"]*main-products[^"]*">/);
  assert.match(html, /href="\/css\/dashboard\.css\?v=[^"]+"/);
  assert.match(html, /href="\/css\/products\.css\?v=[^"]+"/);
  assert.match(html, /src="\/js\/products\.js\?v=[^"]+"/);
  assert.match(html, /<meta name="robots" content="noindex, nofollow">/);
  assert.equal([...html.matchAll(/<main\b/g)].length, 1);
  assert.equal([...html.matchAll(/<h1\b/g)].length, 1);
  assert.match(html, /<h1\b[^>]*>Produtos<\/h1>/);
  assert.match(html, /href="\/produtos\/listar"[^>]*aria-current="page"/);
  assert.doesNotMatch(html, /<header class="header-main"|href="\/css\/(?:style|login|landing|sobre|cardapio|public-footer)\.css/);
});

test('products: assets próprios não são carregados nas outras experiências', () => {
  for (const mainClass of ['main-dashboard', 'main-login', 'main-index', 'main-cardapio', 'main-sobre', '']) {
    const html = render('views/layouts/principal.ejs', {
      mainClass, authPage: 'login', isLoggedIn: true, user: { usuario: 'Ana' }, body: '<p>Conteúdo</p>',
    });
    assert.doesNotMatch(html, /(?:href|src)="\/(?:css|js)\/products\./);
  }
});

test('products: ids únicos e fragmentos e rótulos apontam para elementos existentes', () => {
  for (const { html } of [products(), emptyProducts(), products({ produtos: [], summary: null, productsError: 'Falha de consulta' })]) {
    const ids = attributes(html, 'id');
    assert.equal(ids.length, new Set(ids).size);
    for (const href of attributes(html, 'href').filter(value => value.startsWith('#'))) {
      assert.ok(ids.includes(href.slice(1)), `Destino ausente: ${href}`);
    }
    for (const target of attributes(html, 'for')) assert.ok(ids.includes(target), `Campo ausente: ${target}`);
    for (const targets of attributes(html, 'aria-labelledby')) {
      for (const target of targets.split(/\s+/)) assert.ok(ids.includes(target), `Rótulo ausente: ${target}`);
    }
  }
});

test('products: buscar, filtrar e ordenar usam formulário GET nativo sem esconder conteúdo', () => {
  const { body } = products();
  const form = [...body.matchAll(/<form\b[^>]*>[\s\S]*?<\/form>/g)]
    .map(match => match[0]).find(value => /name="q"/.test(value));
  assert.ok(form, 'Formulário de busca ausente');
  assert.match(form, /action="\/produtos\/listar"/);
  assert.match(form, /method="get"/i);
  for (const name of ['q', 'categoria', 'status', 'ordem']) assert.ok(form.includes(`name="${name}"`));
  assert.match(form, /<button\b[^>]*type="submit"/);
  assert.doesNotMatch(form, /\s(?:disabled|hidden)(?:\s|[=>])/);
  assert.match(body, /<table\b/);
  assert.match(body, /<caption\b/);
  assert.match(body, /<th\b[^>]*scope="col"/);
  assert.match(body, /<th\b[^>]*scope="row"/);
  assert.doesNotMatch(body, /<tr[^>]+hidden/);
});

test('products: edição e exclusão preservam rotas absolutas e confirmação não usa interpolação de dados', () => {
  const { body } = products();
  assert.match(body, /href="\/produtos\/novo_produto"/);
  assert.match(body, /href="\/produtos\/alterar\/7"/);
  const form = [...body.matchAll(/<form\b[^>]*>[\s\S]*?<\/form>/g)]
    .map(match => match[0]).find(value => /action="\/produtos\/excluir\/7"/.test(value));
  assert.ok(form, 'Formulário de exclusão ausente');
  assert.match(form, /method="post"/i);
  assert.match(form, /onsubmit="return confirm\('[^']+'\);?"/);
  assert.match(form, /<button\b[^>]*type="submit"/);
  assert.doesNotMatch(body, /href="\/produtos\/excluir\//);
});

test('products: nomes, categorias, busca, usuário e mensagens são escapados no HTML', () => {
  const attack = '</script><script>alert("products")</script><img src=x onerror="alert(1)">';
  const { body, html } = products({
    produtos: [product({ nome_produto: attack, nome_categoria: attack })],
    categorias: [{ id_categoria: 2, nome: attack }], user: { usuario: attack }, mensagem: attack,
    filters: { q: attack, categoria: '2', status: 'todos', ordem: 'nome' },
  });
  assert.ok(body.includes(ejs.escapeXML(attack)));
  assert.ok(body.includes(`value="${ejs.escapeXML(attack)}"`));
  assert.doesNotMatch(body, /<script\b|<img src=x|onerror="alert/);
  assert.doesNotMatch(html, /<script>alert\("products"\)/);
  for (const match of body.matchAll(/onsubmit="([^"]+)"/g)) {
    assert.doesNotMatch(match[1], /products|&lt;|&gt;/);
  }
  const { body: error } = products({ produtos: [], summary: null, productsError: attack });
  assert.ok(error.includes(ejs.escapeXML(attack)));
  assert.doesNotMatch(error, /<script\b|<img src=x/);
});

test('products: imagens aceitam apenas HTTP(S) e caminhos locais, com dimensões e fallback', () => {
  for (const imagem of ['javascript:alert(1)', 'JaVaScRiPt:alert(1)', 'data:image/svg+xml,<svg onload=alert(1)>', '//example.test/image.png', 'file:///secret', '', null]) {
    const { body } = products({ produtos: [product({ imagem })] });
    assert.doesNotMatch(body, /\sdata-product-image(?:>|\s)/);
    assert.match(body, /data-product-thumb/);
    assert.doesNotMatch(body, /<img[^>]*src="(?:javascript:|data:|\/\/|file:)/i);
  }
  for (const imagem of ['/img/comida_madero.jpg', 'https://example.test/product.jpg', 'http://example.test/product.jpg']) {
    const { body } = products({ produtos: [product({ imagem })] });
    const image = [...body.matchAll(/<img\b[^>]*>/g)].map(match => match[0]).find(tag => tag.includes(`src="${imagem}"`));
    assert.ok(image);
    assert.match(image, /alt=""/);
    assert.match(image, /width="\d+" height="\d+"/);
    assert.match(image, /loading="lazy"/);
    assert.match(image, /referrerpolicy="no-referrer"/);
    assert.match(image, /data-product-image/);
  }
});

test('products: valores em reais preservam zero, negativos e casas decimais', () => {
  for (const valor of [0, 14.1, -2.5, '1234.56']) {
    const { body } = products({ produtos: [product({ valor })] });
    const formatted = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(valor));
    assert.ok(body.includes(formatted), `Valor ausente: ${formatted}`);
    assert.doesNotMatch(body, /NaN|Infinity|undefined/);
  }
});

test('products: estados vazios distinguem primeiro cadastro, filtros sem resultados e consulta indisponível', () => {
  const first = emptyProducts().body;
  assert.match(first, /Nenhum produto cadastrado/);
  assert.match(first, /href="\/categorias\/cadastro"/);
  const ready = emptyProducts({ categorias: [{ id_categoria: 2, nome: 'Ingredientes' }] }).body;
  assert.match(ready, /Nenhum produto cadastrado/);
  assert.match(ready, /href="\/produtos\/novo_produto"/);
  const filtered = emptyProducts({ summary: { total: 4, belowMinimum: 1, nonPositive: 0 },
    filters: { q: 'Inexistente', categoria: '', status: 'todos', ordem: 'nome' } }).body;
  assert.doesNotMatch(filtered, /Nenhum produto cadastrado/);
  assert.match(filtered, /Nenhum (?:produto encontrado|resultado)/);
  assert.match(filtered, /href="\/produtos\/listar"/);
  const error = products({ produtos: [], summary: null, productsError: 'Falha de consulta' }).body;
  assert.match(error, /role="alert"/);
  assert.match(error, /Falha de consulta/);
  assert.match(error, /Tentar novamente/);
  assert.doesNotMatch(error, /Nenhum produto cadastrado|Nenhum produto encontrado|Nenhum resultado/);
});

test('products: saldos usam cor e rótulo sem arredondar frações para um falso zero', () => {
  for (const [estoque, estoque_minimo, tone, label, value] of [
    [2.5, 5, 'warning', 'Abaixo do mínimo', '2,5'],
    [0.001, 1, 'warning', 'Abaixo do mínimo', '0,001'],
    [0, 0, 'negative', 'Sem estoque', '0'],
    [-2.5, 0, 'negative', 'Saldo negativo', '-2,5'],
    [5, 5, 'positive', 'Mínimo atendido', '5'],
    [null, 5, 'neutral', 'Saldo indisponível', '—'],
    [10, null, 'neutral', 'Mínimo não definido', '10'],
  ]) {
    const { body } = products({ produtos: [product({ estoque, estoque_minimo })] });
    const cell = body.match(/<td[^>]*class="products-stock-cell"[^>]*>([\s\S]*?)<\/td>/)[1];
    assert.ok(cell.includes(`data-tone="${tone}">${value}</strong>`));
    assert.ok(cell.includes(label));
    if (estoque === 0 && estoque_minimo === 0) assert.ok(!cell.includes('Abaixo do mínimo'));
  }
});

test('products: paginação preserva filtros, status e ordem sem repetir a página atual nos filtros', () => {
  const { body } = products({
    filters: { q: 'Pão & queijo', categoria: '2', status: 'repor', ordem: 'saldo' },
    pagination: { page: 5, pageSize: 20, total: 205, totalPages: 11 },
    summary: { total: 310, belowMinimum: 205, nonPositive: 2 },
  });
  const navigation = body.match(/<nav class="products-pagination"[\s\S]*?<\/nav>/)[0];
  const links = attributes(navigation, 'href').map(href => new URL(href.replaceAll('&amp;', '&'), 'http://localhost'));
  for (const link of links) {
    assert.equal(link.searchParams.get('q'), 'Pão & queijo');
    assert.equal(link.searchParams.get('categoria'), '2');
    assert.equal(link.searchParams.get('status'), 'repor');
    assert.equal(link.searchParams.get('ordem'), 'saldo');
    assert.ok(Number(link.searchParams.get('pagina') || 1) <= 11);
  }
  assert.match(navigation, /aria-label="Página 5" aria-current="page"/);
  assert.match(body, /Mostrando <strong>81–81<\/strong> de <strong>205<\/strong>/);
  assert.match(body, /Em todo o cadastro/);
  const form = body.match(/<form class="products-filters"[\s\S]*?<\/form>/)[0];
  assert.doesNotMatch(form, /name="pagina"/);
  assert.match(form, /value="2" selected/);
  assert.match(form, /value="saldo" selected/);
});

test('products: categoria removida continua identificada no filtro e não simula todas as categorias', () => {
  const { body } = products({ filters: { q: '', categoria: '999', status: 'todos', ordem: 'nome' } });
  assert.match(body, /<option value="999" selected>Categoria indisponível<\/option>/);
});

test('products: CSS móvel reorganiza a mesma tabela sem conteúdo duplicado e mantém foco e áreas de toque', () => {
  const css = read('public/css/products.css');
  const shared = read('public/css/dashboard.css');
  assert.match(css, /@media \(max-width: 959px\)/);
  assert.match(css, /@media \(max-width: 719px\)/);
  assert.match(css, /\.products-table tbody \{ display: grid; grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/);
  assert.match(css, /\.products-table tbody \{ grid-template-columns: minmax\(0, 1fr\)/);
  assert.match(css, /min-height: 44px/);
  assert.match(css, /\.main-products select:focus-visible/);
  assert.match(shared, /prefers-reduced-motion/);
  assert.doesNotMatch(css, /@keyframes|animation:.*infinite|height: 100vh/);
  const { body } = products();
  assert.equal([...body.matchAll(/data-delete-product\b/g)].length, 1);
  assert.equal([...body.matchAll(/class="products-name"/g)].length, 1);
  assert.match(body, /<table class="products-table" role="table">/);
});
