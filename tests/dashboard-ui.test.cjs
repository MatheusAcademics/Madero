const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ejs = require('ejs');

const root = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const render = (file, data) => ejs.render(read(file), data, { filename: path.join(root, file) });

function emptyState(overrides = {}) {
  return {
    geradoEm: '2026-09-22T15:00:00.000Z',
    totalProdutos: 0, totalEstoque: 0, totalCategorias: 0, totalMovimentacoes: 0,
    valorTotalEstoqueNumero: 0, valorTotalEstoque: '0,00',
    produtosAbaixoMinimo: 0, produtosAbaixoMinimoList: [],
    categorias: { labels: [], values: [] },
    produtos: { labels: [], values: [] }, produtosRanking: [], ultimasMovimentacoes: [],
    ...overrides,
  };
}

function populatedState(overrides = {}) {
  return emptyState({
    totalProdutos: 2, totalEstoque: 12.5, totalCategorias: 2, totalMovimentacoes: 2,
    valorTotalEstoqueNumero: 135.25,
    produtosAbaixoMinimo: 1,
    produtosAbaixoMinimoList: [{ id_produto: 3, nome_produto: 'Queijo', nome_categoria: 'Ingredientes',
      estoque: 2.5, estoque_minimo: 5, valor: 14.1, imagem: '/img/comida_madero.jpg' }],
    categorias: { labels: ['Ingredientes', 'Embalagens'], values: [100, 35.25] },
    produtosRanking: [{ id_produto: 4, nome: 'Caixa', estoque: 10 }, { id_produto: 3, nome: 'Queijo', estoque: 2.5 }],
    ultimasMovimentacoes: [
      { id_movimentacao: 2, tipo_movimentacao: 'Saída', nome_produto: 'Queijo', nome_usuario: 'Ana',
        quantidade: 1.5, data_movimentacao: '2026-09-22T14:30:00.000Z', descricao: 'Preparação do almoço' },
      { id_movimentacao: 1, tipo_movimentacao: 'Entrada', nome_produto: 'Caixa', nome_usuario: 'Ana',
        quantidade: 10, data_movimentacao: '2026-09-22T13:00:00.000Z', descricao: '' },
    ],
    ...overrides,
  });
}

function dashboard(data = emptyState(), extra = {}) {
  const locals = { mainClass: 'main-dashboard', isLoggedIn: true, user: { usuario: 'Ana' },
    data, dashboardError: null, mensagem: '', ...extra };
  const body = render('views/painel.ejs', locals);
  return { body, html: render('views/layouts/principal.ejs', { ...locals, body }) };
}

function attributeValues(html, attribute) {
  return [...html.matchAll(new RegExp(`\\s${attribute}="([^"]*)"`, 'g'))].map(match => match[1]);
}

test('dashboard: layout completo isolado, navegação atual e um único landmark principal', () => {
  const { html } = dashboard(populatedState());
  assert.match(html, /<title>Visão geral — Madero<\/title>/);
  assert.match(html, /<body class="main-dashboard">/);
  assert.match(html, /href="\/css\/dashboard\.css\?v=[^"]+"/);
  assert.match(html, /src="\/js\/dashboard\.js\?v=[^"]+"/);
  assert.match(html, /<meta name="robots" content="noindex, nofollow">/);
  assert.equal([...html.matchAll(/<main\b/g)].length, 1);
  assert.equal([...html.matchAll(/<h1\b/g)].length, 1);
  assert.match(html, /href="\/painel" aria-current="page"/);
  assert.match(html, /href="#dashboard-content"/);
  assert.match(html, /id="dashboard-content" tabindex="-1"/);
  assert.doesNotMatch(html, /href="\/css\/(?:style|login|landing|sobre|cardapio|public-footer)\.css/);
  assert.doesNotMatch(html, /src="\/js\/(?:login|landing|sobre|cardapio)\.js|<header class="header-main"/);
});

test('dashboard: assets não contaminam login, páginas públicas nem demais páginas internas', () => {
  for (const mainClass of ['main-login', 'main-index', 'main-cardapio', 'main-sobre', '']) {
    const html = render('views/layouts/principal.ejs', {
      mainClass, authPage: 'login', isLoggedIn: false, body: '<p>Conteúdo</p>',
    });
    assert.doesNotMatch(html, /(?:href|src)="\/(?:css|js)\/dashboard\./);
    assert.equal([...html.matchAll(/<main\b/g)].length, 1);
  }
  const html = render('views/layouts/principal.ejs', {
    mainClass: '', isLoggedIn: true, user: { usuario: 'Ana' }, body: '<p>Armazém</p>',
  });
  assert.match(html, /href="\/css\/style\.css"/);
  assert.match(html, /<header class="header-main"/);
  assert.doesNotMatch(html, /(?:href|src)="\/(?:css|js)\/dashboard\./);
});

test('dashboard: estado inicial honesto e primeiro passo contextual', () => {
  const { body } = dashboard();
  assert.match(body, /Nenhum produto cadastrado/);
  assert.match(body, /href="\/categorias\/cadastro">Criar categoria/);
  assert.match(body, /Crie uma categoria e cadastre seu primeiro produto para acompanhar a reposição/);
  assert.equal([...body.matchAll(/Nenhum produto cadastrado\./g)].length, 1);
  assert.doesNotMatch(body, /dash-onboarding|Reposição disponível após o cadastro/);
  assert.match(body, /Nenhum valor por categoria/);
  assert.match(body, /Nenhum saldo para comparar/);
  assert.match(body, /Nenhuma movimentação registrada/);
  assert.doesNotMatch(body, /Nenhum produto abaixo do mínimo|Nenhum produto está abaixo/);
  assert.doesNotMatch(body, /NaN|Infinity|undefined/);
  const { body: categoriesReady } = dashboard(emptyState({ totalCategorias: 1 }));
  assert.match(categoriesReady, /Suas categorias já estão prontas/);
  assert.match(categoriesReady, /href="\/produtos\/novo_produto">Cadastrar produto/);
  const { body: healthyStock } = dashboard(emptyState({ totalProdutos: 2 }));
  assert.match(healthyStock, /Nenhum produto abaixo do mínimo/);
  assert.doesNotMatch(healthyStock, /class="dash-onboarding"/);
});

test('dashboard: dados indisponíveis mostram erro acessível, não estoque vazio', () => {
  for (const state of [null, emptyState()]) {
    const { body } = dashboard(state, { dashboardError: 'Não foi possível carregar. Atualize a página.' });
    assert.match(body, /role="alert"/);
    assert.match(body, /Não conseguimos carregar os dados/);
    assert.match(body, /href="\/painel"[\s\S]*?Tentar novamente/);
    assert.doesNotMatch(body, /class="dash-metrics"|class="dash-onboarding"|Nenhum produto abaixo do mínimo|Nenhuma movimentação registrada/);
  }
  assert.match(dashboard(null).body, /Tente atualizar a página em instantes/);
});

test('dashboard: ids são únicos e todos os links de fragmento têm destino nos três estados', () => {
  for (const state of [null, emptyState(), populatedState()]) {
    const { html } = dashboard(state);
    const ids = attributeValues(html, 'id');
    assert.equal(ids.length, new Set(ids).size);
    for (const href of attributeValues(html, 'href').filter(value => value.startsWith('#'))) {
      assert.ok(ids.includes(href.slice(1)), `Destino ausente: ${href}`);
    }
    for (const targets of attributeValues(html, 'aria-labelledby')) {
      for (const target of targets.split(/\s+/)) assert.ok(ids.includes(target), `Rótulo ausente: ${target}`);
    }
  }
});

test('dashboard: todos os links de ação apontam para GETs existentes, sem destinos fictícios', () => {
  const mountedRoutes = [
    ['/painel', 'routes/painel.js'], ['/produtos', 'routes/produtos.js'],
    ['/categorias', 'routes/categorias.js'], ['/movimentacoes', 'routes/movimentacoes.js'],
    ['/usuarios', 'routes/usuarios.js'],
  ];
  const endpoints = mountedRoutes.flatMap(([mount, file]) =>
    [...read(file).matchAll(/router\.get\(['"]([^'"]+)['"]/g)]
      .map(match => mount + (match[1] === '/' ? '' : match[1])));
  assert.match(read('app.js'), /app\.get\('\/logout'/);
  endpoints.push('/logout');
  const patterns = endpoints.map(endpoint => new RegExp(`^${endpoint.replace(/:[\w]+/g, '[^/]+')}$`));
  const bodies = [dashboard(emptyState()).body, dashboard(populatedState()).body, dashboard(null).body];
  for (const body of bodies) {
    for (const href of attributeValues(body, 'href')) {
      assert.notEqual(href, '#');
      if (href.startsWith('#')) continue;
      assert.ok(patterns.some(pattern => pattern.test(href)), `Não existe GET para ${href}`);
    }
  }
});

test('dashboard: usuário, aviso, produtos, categorias e descrição são escapados, inclusive fechamento de script', () => {
  const attack = '</script><script>alert("dashboard")</script><img src=x onerror="alert(1)">';
  const state = populatedState();
  state.produtosAbaixoMinimoList[0].nome_produto = attack;
  state.produtosAbaixoMinimoList[0].nome_categoria = attack;
  state.categorias.labels[0] = attack;
  state.produtosRanking[0].nome = attack;
  state.ultimasMovimentacoes[0].nome_produto = attack;
  state.ultimasMovimentacoes[0].nome_usuario = attack;
  state.ultimasMovimentacoes[0].descricao = attack;
  const { body, html } = dashboard(state, { user: { usuario: attack }, mensagem: attack });
  assert.ok(body.includes(ejs.escapeXML(attack)));
  assert.doesNotMatch(body, /<script\b|<img src=x|onerror="alert/);
  assert.doesNotMatch(html, /<script>alert\("dashboard"\)/);
  const scripts = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)].map(match => match[1]);
  assert.ok(scripts.every(script => !script.includes('dashboard")') && !script.includes(attack)));
  const error = dashboard(null, { dashboardError: attack }).body;
  assert.ok(error.includes(ejs.escapeXML(attack)));
  assert.doesNotMatch(error, /<script\b|<img src=x/);
});

test('dashboard: thumbnails rejeitam protocolos executáveis e preservam fallback sem imagem', () => {
  for (const image of ['javascript:alert(1)', 'JaVaScRiPt:alert(1)', 'data:image/svg+xml,<svg onload=alert(1)>', '//example.test/image.png', 'file:///secret', '', null]) {
    const state = populatedState();
    state.produtosAbaixoMinimoList[0].imagem = image;
    const { body } = dashboard(state);
    assert.doesNotMatch(body, /\sdata-product-image(?:>|\s)/);
    assert.match(body, /data-product-thumb><svg/);
  }
  for (const image of ['/img/comida_madero.jpg', 'https://example.test/product.jpg', 'http://example.test/product.jpg']) {
    const state = populatedState();
    state.produtosAbaixoMinimoList[0].imagem = image;
    const { body } = dashboard(state);
    assert.ok(body.includes(`src="${image}"`));
    assert.match(body, /alt="" width="40" height="40" loading="lazy" referrerpolicy="no-referrer" data-product-image/);
  }
});

test('dashboard: gráficos são renderizados no servidor com legenda e valores acessíveis, sem Chart CDN', () => {
  const { body, html } = dashboard(populatedState());
  assert.match(body, /class="dash-donut" style="--donut-background: conic-gradient\(/);
  assert.match(body, /class="dash-category-legend" aria-label="Valor em estoque por categoria"/);
  assert.match(body, /class="dash-bar" style="width: 100\.000%"/);
  assert.match(body, /class="dash-bar" style="width: 25\.000%"/);
  assert.match(body, /Ingredientes/);
  assert.match(body, /135,25/);
  assert.doesNotMatch(html, /<canvas|chart\.js|new Chart|cdn\.jsdelivr|JSON\.parse\(/i);
  const scripts = attributeValues(html, 'src').filter(src => src.endsWith('.js') || src.includes('.js?'));
  assert.equal(scripts.length, 2);
  assert.ok(scripts.some(src => /^\/js\/dashboard\.js\?v=[^\s]+$/.test(src)));
  assert.ok(scripts.some(src => /^\/js\/avatar\.js\?v=[^\s]+$/.test(src)));
});

test('dashboard: busca progressiva e tabela permanecem legíveis antes do JavaScript', () => {
  const { body } = dashboard(populatedState());
  assert.match(body, /class="dash-search" hidden data-stock-search-control/);
  assert.match(body, /class="dash-filter-empty" hidden data-stock-filter-empty/);
  assert.match(body, /role="status" aria-live="polite" data-stock-filter-count/);
  assert.match(body, /role="region" aria-label="Produtos abaixo do estoque mínimo" tabindex="0"/);
  assert.match(body, /<caption class="dash-sr-only">/);
  assert.match(body, /<th scope="row">/);
  assert.match(body, /<th scope="col">Saldo atual/);
  assert.match(body, /data-stock-row data-search="Queijo Ingredientes 3"/);
  assert.match(body, /<span class="dash-deficit" data-tone="warning">2,5<\/span>/);
  assert.doesNotMatch(body, /<tr[^>]+hidden/);
});

test('dashboard: valores negativos não geram barras negativas e datas ausentes não inventam 1970', () => {
  const state = populatedState({ categorias: { labels: ['Negativo', 'Positivo'], values: [-10, 20] } });
  state.produtosRanking[0].estoque = -5;
  state.ultimasMovimentacoes = [null, undefined, '', 'not-a-date'].map((date, index) => ({
    ...state.ultimasMovimentacoes[0], data_movimentacao: date, quantidade: index ? 1.5 : -1.5,
  }));
  const { body } = dashboard(state);
  assert.match(body, /Saldos negativos permanecem identificados na legenda/);
  assert.match(body, /width: 0\.000%/);
  assert.doesNotMatch(body, /width: -|NaN|Infinity|1970|Invalid Date/);
  assert.equal([...body.matchAll(/Data indisponível/g)].length, 4);
  assert.doesNotMatch(body, /data-movement-date/);
  assert.match(body, /<strong data-tone="positive">\+1,5<\/strong>/);
  assert.match(body, /<strong data-tone="negative">−1,5<\/strong>/);
});

test('dashboard: CSS mantém menu móvel, gráficos em coluna, hidden e movimento reduzido', () => {
  const css = read('public/css/dashboard.css');
  assert.match(css, /body\.main-dashboard\s*\{/);
  assert.match(css, /\.main-dashboard \[hidden\]\s*\{\s*display:\s*none\s*!important/);
  assert.match(css, /@media \(max-width: 1099px\)\s*\{[\s\S]*?\.dash-navigation > summary\s*\{[^}]*display:\s*flex/);
  assert.match(css, /@media \(max-width: 719px\)\s*\{[\s\S]*?\.dash-charts-grid\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\)/);
  assert.match(css, /\.dash-table-scroll\s*\{[^}]*overflow-x:\s*auto/);
  assert.match(css, /:focus-visible\s*\{[^}]*outline:/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)\s*\{[\s\S]*?animation:\s*none\s*!important;\s*transition:\s*none\s*!important/);
  assert.doesNotMatch(css, /\[data-dashboard-reveal\][^{]*\{[^}]*opacity:\s*0/);
});

test('dashboard: ícones são SVGs decorativos locais, com fallback para nome desconhecido', () => {
  const html = render('views/partials/dashboard-icon.ejs', { name: '</svg><script>alert(1)</script>' });
  assert.match(html, /<svg class="dash-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">/);
  assert.match(html, /<path /);
  assert.doesNotMatch(html, /<script|<use|https?:/);
});

test('dashboard: navegação e ações usam nomes de tarefas, com reposição e histórico antes das análises', () => {
  const { body } = dashboard(populatedState());
  assert.match(body, /<h1 id="dashboard-title">Visão geral<\/h1>/);
  const navigation = body.match(/<nav class="dash-navigation__content"[^>]*>([\s\S]*?)<\/nav>/)[1];
  const navLinks = [...navigation.matchAll(/<a\b[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g)]
    .map(([, href, content]) => [content.replace(/<[^>]*>/g, '').trim(), href]);
  assert.deepEqual(navLinks, [
    ['Visão geral', '/painel'], ['Produtos', '/produtos/listar'],
    ['Saldos de estoque', '/movimentacoes/listar_estoque'], ['Movimentações', '/movimentacoes/listar'],
    ['Categorias', '/categorias/listar'], ['Usuários', '/usuarios/listar'],
  ]);
  const actions = body.match(/<nav class="dash-actions" aria-label="Ações do estoque">([\s\S]*?)<\/nav>/)[1];
  const actionLinks = [...actions.matchAll(/<a\b[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g)]
    .map(([, href, content]) => [content.replace(/<[^>]*>/g, '').trim(), href]);
  assert.deepEqual(actionLinks, [
    ['Registrar entrada ou saída', '/movimentacoes/nova_movimentacao'],
    ['Novo produto', '/produtos/novo_produto'], ['Consultar estoque', '/movimentacoes/listar_estoque'],
  ]);
  assert.match(read('views/nova_movimentacao.ejs'), /href="\/movimentacoes\/listar"[^>]*>Cancelar<\/a>/);
  const reposicao = body.indexOf('id="reposicao"');
  const atividade = body.indexOf('class="dash-panel dash-activity"');
  const analise = body.indexOf('id="analise"');
  assert.ok(reposicao > 0 && reposicao < atividade && atividade < analise);
  assert.match(body, /href="\/produtos\/alterar\/3" aria-label="Editar produto Queijo">Editar produto<\/a>/);
  assert.doesNotMatch(body, /dash-console|dash-stage|dash-dock|data-scene-|data-dashboard-scene|data-dashboard-stage|Por trás de uma|O ritmo da operação|AMPLIAR O ARMAZÉM|OLHAR MAIS DE PERTO/);
  const css = read('public/css/dashboard.css');
  assert.doesNotMatch(css, /body\.main-dashboard\s*\{[^}]*overflow:\s*hidden|zoom\s*:|scroll-snap-type/);
});

test('dashboard: quatro indicadores reais destacam primeiro o alerta, sem inventar períodos ou unidades', () => {
  const state = populatedState({ totalProdutos: 13, totalEstoque: 42.75, totalCategorias: 3,
    totalMovimentacoes: 8, valorTotalEstoqueNumero: 257.5, produtosAbaixoMinimo: 2 });
  const { body } = dashboard(state);
  const metrics = [...body.matchAll(/<article class="dash-metric(?: [^"]*)?">([\s\S]*?)<\/article>/g)].map(match => match[1]);
  assert.equal(metrics.length, 4);
  assert.deepEqual(metrics.map(metric => metric.match(/<h3>([^<]+)<\/h3>/)[1]), [
    'Produtos abaixo do mínimo', 'Produtos cadastrados', 'Valor em estoque', 'Movimentações',
  ]);
  assert.match(body, /<article class="dash-metric dash-metric--attention">/);
  assert.match(metrics[0], /class="dash-metric-value" data-tone="warning">2<\/p>/);
  assert.match(metrics[0], /href="#reposicao"/);
  assert.match(metrics[1], /class="dash-metric-value">13<\/p>/);
  assert.match(metrics[1], /Saldo total: 42,75 · 3 categorias/);
  assert.ok(metrics[2].includes(new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(257.5)));
  assert.match(metrics[3], /class="dash-metric-value">8<\/p>/);
  assert.match(metrics[3], /Total de entradas e saídas registradas/);
  assert.doesNotMatch(metrics.join(''), /hoje|este mês|unidades|\bkg\b|data-dashboard-reveal|\shidden(?:\s|[=>])/i);
  assert.match(body, /Consultado em <time datetime="2026-09-22T15:00:00\.000Z" data-dashboard-date>[^<]*12:00<\/time>/);
  assert.match(body, /href="\/painel" class="dash-refresh">[\s\S]*?Atualizar dados<\/a>/);
});

test('dashboard: foto de marca é única, local, decorativa e visível sem seletores de cenas', () => {
  const { body, html } = dashboard();
  const photo = body.match(/<div class="dash-intro-photo" aria-hidden="true">([\s\S]*?)<\/div>/)[1];
  const images = [...photo.matchAll(/<img\b[^>]*>/g)].map(match => match[0]);
  assert.equal(images.length, 1);
  assert.equal([...body.matchAll(/<img\b/g)].length, 1);
  const src = images[0].match(/src="([^"]+)"/)[1];
  assert.ok(src.startsWith('/img/'));
  assert.ok(fs.existsSync(path.join(root, 'public', src)));
  assert.match(images[0], /alt=""/);
  assert.match(images[0], /width="\d+" height="\d+"/);
  assert.match(images[0], /fetchpriority="high"/);
  assert.doesNotMatch(images[0], /\bhidden\b/);
  assert.doesNotMatch(body, /Escolher imagem do ambiente|data-scene-choice|data-scene-controls/);
  assert.match(html, /rel="preload" as="image" href="\/img\/comida_madero\.jpg"/);
});

test('dashboard: distribuição vazia ou não positiva não desenha um anel fictício e mantém os valores', () => {
  const empty = dashboard().body;
  assert.doesNotMatch(empty, /class="dash-donut"|conic-gradient\(/);
  assert.match(empty, /Nenhum valor por categoria/);
  for (const values of [[0, 0], [-10, 0]]) {
    const { body } = dashboard(populatedState({ categorias: { labels: ['Ingredientes', 'Embalagens'], values } }));
    assert.doesNotMatch(body, /class="dash-donut"|conic-gradient\(|NaN|Infinity/);
    assert.match(body, /class="dash-category-legend" aria-label="Valor em estoque por categoria"/);
    assert.match(body, /class="dash-category-name">Ingredientes<\/span>/);
    assert.match(body, /class="dash-category-name">Embalagens<\/span>/);
    for (const value of values) {
      assert.ok(body.includes('<strong>' + new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value) + '</strong>'));
    }
  }
});

test('dashboard: indicador de reposição distingue ausência de dados, saldo suficiente, atenção e falta de estoque', () => {
  const stockItem = populatedState().produtosAbaixoMinimoList[0];
  const cases = [
    { state: emptyState(), tone: 'neutral', count: '0', description: /Ainda sem produtos cadastrados/ },
    { state: emptyState({ totalProdutos: 2 }), tone: 'positive', count: '0', description: /Nenhum alerta de reposição/ },
    { state: populatedState(), tone: 'warning', count: '1', description: /Precisam de reposição/ },
    { state: populatedState({ produtosAbaixoMinimoList: [{ ...stockItem, estoque: 0 }] }),
      tone: 'negative', count: '1', description: /1 com saldo zerado ou negativo/ },
    { state: populatedState({ produtosAbaixoMinimoList: [{ ...stockItem, estoque: -2 }] }),
      tone: 'negative', count: '1', description: /1 com saldo zerado ou negativo/ },
    { state: populatedState({ totalProdutos: 3, produtosAbaixoMinimo: 3, produtosAbaixoMinimoList: [
      stockItem, { ...stockItem, id_produto: 4, estoque: 0 }, { ...stockItem, id_produto: 5, estoque: -2 },
    ] }), tone: 'negative', count: '3', description: /2 com saldo zerado ou negativo/ },
  ];

  for (const { state, tone, count, description } of cases) {
    const { body } = dashboard(state);
    const metric = body.match(/<article class="dash-metric(?: [^"]*)?">([\s\S]*?)<\/article>/)[1];
    assert.ok(metric.includes(`<p class="dash-metric-value" data-tone="${tone}">${count}</p>`));
    assert.match(metric, description);
    if (count === '0') {
      assert.doesNotMatch(body, /class="dash-count-badge"/);
    } else {
      assert.ok(body.includes(`<span class="dash-count-badge" data-tone="${tone}">${count}</span>`));
    }
  }

  const healthy = dashboard(emptyState({ totalProdutos: 1, totalEstoque: 0 })).body;
  assert.match(healthy, /Nenhum produto abaixo do mínimo/);
  assert.match(healthy, /Os saldos atendem aos mínimos cadastrados/);
  assert.doesNotMatch(healthy, /Todos (?:os produtos )?têm estoque|Estoque positivo/);
  const unavailable = dashboard(null, { dashboardError: 'Falha de consulta' }).body;
  assert.doesNotMatch(unavailable, /data-tone="positive"|Nenhum alerta de reposição|Nenhum produto abaixo do mínimo/);
});

test('dashboard: cores de saldo e déficit têm rótulos explícitos e preservam valores fracionários, zero e negativos', () => {
  const stockItem = populatedState().produtosAbaixoMinimoList[0];
  const cases = [
    { estoque: 2.5, minimo: 5, saldo: '2,5', deficit: '2,5', tone: 'warning', label: 'Abaixo do mínimo' },
    { estoque: 0.01, minimo: 0.02, saldo: '0,01', deficit: '0,01', tone: 'warning', label: 'Abaixo do mínimo' },
    { estoque: 0, minimo: 5, saldo: '0', deficit: '5', tone: 'negative', label: 'Sem estoque' },
    { estoque: -2, minimo: 0, saldo: '-2', deficit: '2', tone: 'negative', label: 'Saldo negativo' },
  ];
  for (const { estoque, minimo, saldo, deficit, tone, label } of cases) {
    const { body } = dashboard(populatedState({ produtosAbaixoMinimoList: [{ ...stockItem, estoque, estoque_minimo: minimo }] }));
    assert.ok(body.includes(`<td class="dash-table-stock"><strong data-tone="${tone}">${saldo}</strong><span class="dash-stock-label">${label}</span></td>`));
    assert.ok(body.includes(`<span class="dash-deficit" data-tone="${tone}">${deficit}</span>`));
    assert.match(body, /<th scope="col">Saldo atual<\/th><th scope="col">Mínimo<\/th><th scope="col">Faltam<\/th>/);
    assert.doesNotMatch(body, /NaN|Infinity|undefined/);
  }
});

test('dashboard: movimentos recebem a cor do efeito real no saldo, mantêm o tipo e mostram zero sem sinal', () => {
  const original = populatedState().ultimasMovimentacoes[0];
  const cases = [
    { type: 'Entrada', quantity: 1.5, tone: 'positive', value: '+1,5' },
    { type: 'Saída', quantity: 1.5, tone: 'negative', value: '−1,5' },
    { type: 'Entrada', quantity: -1.5, tone: 'negative', value: '−1,5' },
    { type: 'Saída', quantity: -1.5, tone: 'positive', value: '+1,5' },
    { type: 'Entrada', quantity: 0, tone: 'neutral', value: '0' },
    { type: 'Saída', quantity: 0, tone: 'neutral', value: '0' },
    { type: 'Entrada', quantity: -0, tone: 'neutral', value: '0' },
  ];
  for (const { type, quantity, tone, value } of cases) {
    const { body } = dashboard(populatedState({ ultimasMovimentacoes: [{ ...original, tipo_movimentacao: type, quantidade: quantity }] }));
    const activity = body.match(/<ol class="dash-activity-list">([\s\S]*?)<\/ol>/)[1];
    assert.ok(activity.includes(`<div class="dash-movement-meta"><strong data-tone="${tone}">${value}</strong>`));
    assert.ok(activity.includes(`<span>${type} · por Ana</span>`));
    assert.doesNotMatch(activity, /(?:\+|−|-)(?:0)<\/strong>/);
  }
});

test('dashboard: tipo de movimento desconhecido mantém a quantidade registrada sem inventar entrada ou saída', () => {
  const original = populatedState().ultimasMovimentacoes[0];
  for (const quantity of [2.5, -2.5, 0]) {
    const { body } = dashboard(populatedState({ ultimasMovimentacoes: [{ ...original, tipo_movimentacao: 'Ajuste', quantidade: quantity }] }));
    const activity = body.match(/<ol class="dash-activity-list">([\s\S]*?)<\/ol>/)[1];
    const formatted = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 2 }).format(quantity);
    assert.ok(activity.includes(`<div class="dash-movement-meta"><strong data-tone="neutral">${formatted}</strong>`));
    assert.match(activity, /<span>Ajuste · por Ana<\/span>/);
    assert.doesNotMatch(activity, /data-tone="(?:positive|negative)"|>\+|>−/);
    const icon = render('views/partials/dashboard-icon.ejs', { name: 'transfer' });
    assert.ok(activity.includes(icon));
  }
});

test('dashboard: números de contexto não sugerem que mais produtos, valor ou movimentos significam melhora', () => {
  const { body } = dashboard(populatedState());
  const metrics = [...body.matchAll(/<article class="dash-metric(?: [^"]*)?">([\s\S]*?)<\/article>/g)].map(match => match[1]);
  assert.equal(metrics.length, 4);
  assert.match(metrics[0], /data-tone="warning"/);
  for (const metric of metrics.slice(1)) assert.doesNotMatch(metric, /data-tone|is-positive|is-negative/);
});

test('dashboard: estado vazio tem apenas dois painéis operacionais e um primeiro passo contextual', () => {
  const { body } = dashboard();
  assert.match(body, /class="dash-operations dash-operations--empty"/);
  assert.doesNotMatch(body, /dash-onboarding|dash-stock-clear|class="dash-count-badge"/);
  const replenishment = body.match(/<section class="dash-panel dash-replenishment"[^>]*>([\s\S]*?)<\/section>/)[1];
  const activity = body.match(/<section class="dash-panel dash-activity"[^>]*>([\s\S]*?)<\/section>/)[1];
  assert.equal([...replenishment.matchAll(/<a\b/g)].length, 1);
  assert.match(replenishment, /href="\/categorias\/cadastro">Criar categoria/);
  assert.doesNotMatch(replenishment, /dash-empty-icon|dash-search/);
  assert.doesNotMatch(activity, /<a\b|dash-empty-icon/);
  assert.match(activity, /O histórico aparecerá aqui após o primeiro registro de entrada ou saída/);

  const categoriesReady = dashboard(emptyState({ totalCategorias: 1 })).body;
  assert.match(categoriesReady, /href="\/produtos\/novo_produto">Cadastrar produto/);
  const productsReady = dashboard(emptyState({ totalProdutos: 1 })).body;
  const readyActivity = productsReady.match(/<section class="dash-panel dash-activity"[^>]*>([\s\S]*?)<\/section>/)[1];
  assert.match(readyActivity, /href="\/movimentacoes\/nova_movimentacao">Registrar entrada ou saída/);
  assert.doesNotMatch(readyActivity, />Ver todas/);

  for (const state of [populatedState(), populatedState({ produtosAbaixoMinimoList: [], produtosAbaixoMinimo: 0 }), populatedState({ ultimasMovimentacoes: [] })]) {
    assert.doesNotMatch(dashboard(state).body, /class="dash-operations dash-operations--empty"/);
  }
});

test('dashboard: estilos de situação afetam apenas números e painéis vazios voltam a uma coluna no celular', () => {
  const css = read('public/css/dashboard.css');
  for (const [tone, token] of [['positive', 'positive'], ['negative', 'negative'], ['warning', 'gold'], ['neutral', 'muted']]) {
    assert.ok(css.includes(`.main-dashboard [data-tone="${tone}"] { color: var(--dash-${token}); }`));
  }
  assert.doesNotMatch(css, /\.dash-metric--attention\s+\.dash-metric-value\s*\{[^}]*color:/);
  assert.match(css, /\.dash-operations--empty\s*\{[^}]*grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\)/);
  assert.match(css, /@media \(max-width: 719px\)\s*\{[\s\S]*?\.dash-operations--empty\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\)/);
  const { body } = dashboard(populatedState());
  for (const match of body.matchAll(/<(\w+)\b[^>]*data-tone="[^"]+"[^>]*>/g)) {
    assert.ok(['p', 'strong', 'span'].includes(match[1]), `Cor aplicada a bloco inteiro: ${match[0]}`);
    assert.doesNotMatch(match[0], /dash-panel|dash-metric-detail|dash-movement-main/);
  }
});
