const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ejs = require('ejs');

const root = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const render = (file, data) => ejs.render(read(file), data, { filename: path.join(root, file) });
const attributes = (html, name) => [...html.matchAll(new RegExp(`\\s${name}="([^"]*)"`, 'g'))].map(match => match[1]);
const urls = html => attributes(html, 'href').filter(href => href.startsWith('/movimentacoes/listar'))
  .map(href => new URL(href.replaceAll('&amp;', '&'), 'http://localhost'));

function movement(overrides = {}) {
  return { id_movimentacao: 37, tipo_movimentacao: 'Entrada', data_movimentacao: '2026-10-02T00:15:00',
    quantidade: '2.50', descricao: 'Recebimento de ingredientes', id_produto: 7, id_usuario: 2,
    nome_produto: 'Queijo', nome_usuario: 'Ana', ...overrides };
}

function movements(overrides = {}) {
  const locals = {
    mainClass: 'main-movements', isLoggedIn: true, user: { usuario: 'Ana' },
    movimentacoes: [movement()], usuarios: [{ id_usuario: 2, nome_usuario: 'Ana' }],
    filters: { q: '', tipo: 'todos', usuario: '', de: '', ate: '', ordem: 'recentes' },
    pagination: { page: 1, pageSize: 20, total: 1, totalPages: 1 },
    summary: { total: 1, entries: 1, exits: 0, other: 0 },
    geradoEm: '2026-10-02T12:30:00.000Z', mensagem: '', listError: '', filterErrors: {}, ...overrides,
  };
  const body = render('views/movimentacao.ejs', locals);
  return { body, html: render('views/layouts/principal.ejs', { ...locals, body }) };
}

function emptyMovements(overrides = {}) {
  return movements({ movimentacoes: [], usuarios: [],
    pagination: { page: 1, pageSize: 20, total: 0, totalPages: 1 },
    summary: { total: 0, entries: 0, exits: 0, other: 0 }, ...overrides });
}

test('movements list: workspace isolado com navegação atual, título e landmarks únicos', () => {
  const { html } = movements();
  assert.match(html, /<title>Movimentações — Madero<\/title>/i);
  assert.match(html, /<body class="main-dashboard main-movements">/);
  assert.match(html, /href="\/css\/dashboard\.css\?v=[^"]+"/);
  assert.match(html, /href="\/css\/movements-list\.css\?v=[^"]+"/);
  assert.match(html, /src="\/js\/dashboard\.js\?v=[^"]+"/);
  assert.match(html, /<meta name="robots" content="noindex, nofollow">/);
  assert.equal([...html.matchAll(/<main\b/g)].length, 1);
  assert.equal([...html.matchAll(/<h1\b/g)].length, 1);
  assert.match(html, /<h1\b[^>]*>Movimentações<\/h1>/i);
  assert.match(html, /href="\/movimentacoes\/listar"[^>]*aria-current="page"/);
  assert.doesNotMatch(html, /<header class="header-main"|href="\/css\/(?:style|login|landing|sobre|cardapio|public-footer)\.css/);
  assert.doesNotMatch(html, /src="\/js\/(?:stock|products|movement-form)\.js/);
});

test('movements list: assets de histórico não afetam outras áreas internas ou públicas', () => {
  for (const mainClass of ['main-dashboard', 'main-products', 'main-stock', 'main-category-form', 'main-movement-form', 'main-login', 'main-index', 'main-cardapio', 'main-sobre', '']) {
    const html = render('views/layouts/principal.ejs', {
      mainClass, authPage: 'login', isLoggedIn: true, user: { usuario: 'Ana' }, body: '<p>Conteúdo</p>',
    });
    assert.doesNotMatch(html, /(?:href|src)="\/(?:css|js)\/movements-list\./);
  }
});

test('movements list: IDs, fragmentos, labels e descrições acessíveis permanecem válidos em todos os estados', () => {
  for (const { html } of [movements(), emptyMovements(), movements({ movimentacoes: [], summary: null, listError: 'Falha de consulta' }),
    emptyMovements({ filterErrors: { de: 'Informe uma data válida.' }, filters: { q: '', tipo: 'todos', usuario: '', de: '2026-99-01', ate: '', ordem: 'recentes' } })]) {
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

test('movements list: consulta GET nativa inclui busca, tipo, responsável, datas e ordenação', () => {
  const { body } = movements();
  const forms = [...body.matchAll(/<form\b[^>]*>[\s\S]*?<\/form>/g)].map(match => match[0]);
  const form = forms.find(value => /name="q"/.test(value));
  assert.ok(form, 'Formulário de busca ausente');
  assert.match(form, /action="\/movimentacoes\/listar"/);
  assert.match(form, /method="get"/i);
  for (const name of ['q', 'tipo', 'usuario', 'de', 'ate', 'ordem']) assert.ok(form.includes(`name="${name}"`), name);
  assert.match(form, /<button\b[^>]*type="submit"/);
  assert.doesNotMatch(form, /\sdisabled(?:\s|[=>])|name="pagina"/);
  assert.match(form, /type="date"[^>]*name="de"|name="de"[^>]*type="date"/);
  assert.match(form, /type="date"[^>]*name="ate"|name="ate"[^>]*type="date"/);
  assert.match(body, /<table\b/);
  assert.match(body, /<caption\b/);
  assert.match(body, /<th\b[^>]*scope="col"/);
  assert.match(body, /<th\b[^>]*scope="row"/);
  assert.doesNotMatch(body, /<tr[^>]+hidden|data-stock-search\b|data-stock-search-control\b/);
});

test('movements list: histórico somente de consulta, com ação de registrar separada e sem edição ou exclusão', () => {
  const { body } = movements();
  assert.match(body, /href="\/movimentacoes\/nova_movimentacao(?:(?:\?[^"]*)?")/);
  assert.doesNotMatch(body, /<form\b[^>]*method="post"/i);
  assert.doesNotMatch(body, /(?:href|action)="\/movimentacoes\/(?:alterar|excluir|editar|deletar)\b/);
  assert.doesNotMatch(body, /contenteditable|<input[^>]*name="(?:estoque|estoque_minimo|quantidade)"/);
});

test('movements list: nomes, tipos, descrição, pesquisa, mensagens e erros são escapados', () => {
  const attack = '</script><script>alert("movements")</script><img src=x onerror="alert(1)">';
  const { body, html } = movements({
    movimentacoes: [movement({ nome_produto: attack, nome_usuario: attack, tipo_movimentacao: attack, descricao: attack })],
    usuarios: [{ id_usuario: 2, nome_usuario: attack }], user: { usuario: attack }, mensagem: attack,
    filters: { q: attack, tipo: 'todos', usuario: '2', de: '', ate: '', ordem: 'recentes' },
  });
  assert.ok(body.includes(ejs.escapeXML(attack)));
  assert.ok(body.includes(`value="${ejs.escapeXML(attack)}"`));
  assert.doesNotMatch(body, /<script\b|<img src=x|onerror="alert/);
  assert.doesNotMatch(html, /<script>alert\("movements"\)/);
  const { body: error } = movements({ movimentacoes: [], summary: null, listError: attack });
  assert.ok(error.includes(ejs.escapeXML(attack)));
  assert.doesNotMatch(error, /<script\b|<img src=x/);
  const { body: filters } = emptyMovements({ filterErrors: { de: attack } });
  assert.ok(filters.includes(ejs.escapeXML(attack)));
  assert.doesNotMatch(filters, /<script\b|<img src=x/);
});

test('movements list: quantidade mostra efeito real no saldo, incluindo registros legados negativos', () => {
  for (const [tipo_movimentacao, quantidade, tone, value] of [
    ['Entrada', '2.50', 'positive', '+2,5'], ['Saída', '2.50', 'negative', '−2,5'],
    ['Entrada', '-2.50', 'negative', '−2,5'], ['Saída', '-2.50', 'positive', '+2,5'],
    ['Entrada', 0, 'neutral', '0'], ['Saída', 0, 'neutral', '0'], ['Saída', -0, 'neutral', '0'],
    ['Entrada', '0.01', 'positive', '+0,01'], ['Saída', '0.01', 'negative', '−0,01'],
    ['Entrada', '9999999999.99', 'positive', '+9.999.999.999,99'],
    ['Saída', '9999999999.99', 'negative', '−9.999.999.999,99'],
  ]) {
    const { body } = movements({ movimentacoes: [movement({ tipo_movimentacao, quantidade })] });
    const table = body.match(/<table\b[\s\S]*?<\/table>/)[0];
    assert.match(table, new RegExp(`data-tone="${tone}">\\s*${value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*<\\/strong>`), `${tipo_movimentacao}/${quantidade}: ${tone}/${value}`);
    assert.ok(table.includes(ejs.escapeXML(tipo_movimentacao)));
    assert.doesNotMatch(table, /NaN|Infinity|undefined|\+−|−−|\+0<|−0</);
  }
});

test('movements list: tipo desconhecido e quantidade ausente ficam neutros, sem direção ou zero inventados', () => {
  for (const [tipo_movimentacao, quantidade, value] of [
    ['Ajuste', '2.50', '2,5'], ['Ajuste', '-2.50', '-2,5'], ['Ajuste', 0, '0'],
    [null, '2.50', '2,5'], ['', '2.50', '2,5'],
    ['Entrada', null, '—'], ['Saída', undefined, '—'], ['Entrada', '', '—'], ['Saída', 'inválida', '—'],
  ]) {
    const { body } = movements({ movimentacoes: [movement({ tipo_movimentacao, quantidade })] });
    const table = body.match(/<table\b[\s\S]*?<\/table>/)[0];
    assert.match(table, new RegExp(`data-tone="neutral">\\s*${value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*<\\/strong>`));
    assert.doesNotMatch(table, />null<|>undefined<|NaN|Infinity|\+2,5|−2,5/);
  }
});

test('movements list: timestamp sem timezone preserva o dia e a hora registrados sem conversão do navegador', () => {
  for (const [data_movimentacao, date, time] of [
    ['2026-10-02T00:15:00', '02/10/2026', '00:15'],
    ['2026-10-02T23:45:00', '02/10/2026', '23:45'],
    ['2024-02-29T12:05:30', '29/02/2024', '12:05'],
  ]) {
    const { body } = movements({ movimentacoes: [movement({ data_movimentacao })] });
    const table = body.match(/<table\b[\s\S]*?<\/table>/)[0];
    assert.ok(table.includes(date), `${data_movimentacao}: dia não preservado`);
    assert.ok(table.includes(time), `${data_movimentacao}: horário não preservado`);
    assert.doesNotMatch(table, /data-movement-date|data-dashboard-date|Invalid Date|NaN/);
  }
  for (const data_movimentacao of [null, undefined, '', 'inválida', '2026-02-30T12:00:00']) {
    const { body } = movements({ movimentacoes: [movement({ data_movimentacao })] });
    const table = body.match(/<table\b[\s\S]*?<\/table>/)[0];
    assert.doesNotMatch(table, /<time\b|1970|Invalid Date|NaN|02\/03\/2026/);
  }
});

test('movements list: descrição completa permanece acessível por details nativo, sem duplicar registros', () => {
  const descricao = 'Lote de recebimento. '.repeat(120) + 'FIM DA DESCRIÇÃO';
  const { body } = movements({ movimentacoes: [movement({ descricao })] });
  const table = body.match(/<table\b[\s\S]*?<\/table>/)[0];
  assert.ok(table.includes(ejs.escapeXML(descricao)));
  assert.match(table, /<details\b/);
  assert.match(table, /<summary\b/);
  assert.equal([...body.matchAll(/<table\b/g)].length, 1);
  assert.doesNotMatch(table, /data-toggle|onclick=|<dialog\b/);
});

test('movements list: paginação preserva busca, tipo, responsável, datas e ordem sem refazer filtros no cliente', () => {
  const filters = { q: 'Pão & queijo', tipo: 'saida', usuario: '2', de: '2026-09-01', ate: '2026-10-02', ordem: 'antigas' };
  const { body } = movements({ filters,
    pagination: { page: 5, pageSize: 20, total: 205, totalPages: 11 },
    summary: { total: 310, entries: 103, exits: 205, other: 2 },
  });
  const navigation = [...body.matchAll(/<nav\b[\s\S]*?<\/nav>/g)].map(match => match[0])
    .find(nav => /aria-label="P[aá]gina 5"/.test(nav));
  assert.ok(navigation, 'Paginação ausente');
  const links = urls(navigation);
  assert.ok(links.length >= 3);
  for (const link of links) {
    assert.equal(link.pathname, '/movimentacoes/listar');
    for (const [key, value] of Object.entries(filters)) assert.equal(link.searchParams.get(key), value, key);
    assert.ok(Number(link.searchParams.get('pagina') || 1) >= 1);
    assert.ok(Number(link.searchParams.get('pagina') || 1) <= 11);
  }
  assert.match(navigation, /aria-label="Página 5" aria-current="page"/);
  assert.match(body, /Mostrando <strong>81–81<\/strong> de <strong>205<\/strong>/);
  const form = [...body.matchAll(/<form\b[\s\S]*?<\/form>/g)].map(match => match[0]).find(value => /name="q"/.test(value));
  assert.doesNotMatch(form, /name="pagina"/);
  assert.match(form, /value="2" selected/);
  assert.match(form, /value="antigas" selected/);
  assert.match(form, /name="tipo" value="saida"/);
  assert.ok(form.includes(`value="${ejs.escapeXML(filters.q)}"`));
  assert.match(form, /value="2026-09-01"/);
  assert.match(form, /value="2026-10-02"/);
  assert.doesNotMatch(movements().body, /aria-label="Página 2"/);
});

test('movements list: campos de produto, responsável, tipo, data, id, quantidade e descrição não se perdem', () => {
  const { body } = movements({ movimentacoes: [movement({ nome_produto: 'Queijo especial', nome_usuario: 'Ana Souza', descricao: 'Referência lote 999', id_movimentacao: 777 })] });
  const table = body.match(/<table\b[\s\S]*?<\/table>/)[0];
  for (const value of ['Queijo especial', 'Ana Souza', 'Referência lote 999', '777', 'Entrada', '02/10/2026', '00:15', '+2,5']) {
    assert.ok(table.includes(value), `${value} não visível no histórico`);
  }
  const missing = movements({ movimentacoes: [movement({ nome_produto: null, nome_usuario: null, descricao: null, data_movimentacao: null, quantidade: null })] }).body;
  const missingTable = missing.match(/<table\b[\s\S]*?<\/table>/)[0];
  assert.doesNotMatch(missingTable, />null<|>undefined<|NaN|Infinity|1970/);
});

test('movements list: resumo global é distinto do resultado filtrado, sem tratar saída como erro', () => {
  const filters = { q: 'Queijo', tipo: 'saida', usuario: '2', de: '2026-09-01', ate: '2026-10-02', ordem: 'antigas' };
  const { body } = movements({ filters,
    summary: { total: 310, entries: 103, exits: 205, other: 2 },
    pagination: { page: 1, pageSize: 20, total: 12, totalPages: 1 },
  });
  const navigation = body.match(/<nav class="history-type-tabs"[\s\S]*?<\/nav>/)[0];
  const links = [...navigation.matchAll(/<a\b[^>]*>[\s\S]*?<\/a>/g)].map(match => match[0]);
  assert.equal(links.length, 4);
  for (const [index, label, count, type] of [[0, 'Todas', 310, null], [1, 'Entradas', 103, 'entrada'], [2, 'Saídas', 205, 'saida'], [3, 'Outros tipos', 2, 'outros']]) {
    assert.ok(links[index].includes(`${label}<span>${count}</span>`));
    const link = urls(links[index])[0];
    assert.equal(link.searchParams.get('tipo'), type);
    assert.equal(link.searchParams.get('pagina'), null);
    for (const key of ['q', 'usuario', 'de', 'ate', 'ordem']) assert.equal(link.searchParams.get(key), filters[key]);
  }
  assert.match(links[2], /aria-current="true"/);
  assert.equal(links.filter(link => /aria-current=/.test(link)).length, 1);
  assert.doesNotMatch(navigation, /data-tone="(?:negative|warning|positive)"/);
  assert.match(body, /Todo o histórico/);
  assert.match(body, /Resultado da consulta<span>12 registros<\/span>/);
  assert.doesNotMatch(movements().body, /Outros tipos/);
  const others = movements({ filters: { ...filters, tipo: 'outros' }, summary: { total: 3, entries: 2, exits: 1, other: 0 } }).body;
  assert.match(others, /Outros tipos<span>0<\/span>/);
});

test('movements list: vazios distinguem primeiro registro, filtro sem resultado e falha de consulta', () => {
  const first = emptyMovements().body;
  assert.match(first, /Nenhuma movimentação registrada/);
  assert.match(first, /href="\/movimentacoes\/nova_movimentacao"/);
  assert.doesNotMatch(first, /class="history-type-tabs"|<table\b|Nenhuma movimentação encontrada/);
  for (const summary of [{ total: 4, entries: 3, exits: 1, other: 0 }, { total: 0, entries: 0, exits: 0, other: 0 }]) {
    const filtered = emptyMovements({ summary,
      filters: { q: 'Inexistente', tipo: 'todos', usuario: '', de: '', ate: '', ordem: 'recentes' },
    }).body;
    assert.doesNotMatch(filtered, /Nenhuma movimentação registrada/);
    assert.match(filtered, /Nenhuma movimentação encontrada/);
    assert.match(filtered, /href="\/movimentacoes\/listar">Limpar filtros/);
    assert.match(filtered, /name="q" value="Inexistente"/);
    assert.doesNotMatch(filtered, /<table\b/);
  }
  for (const [summary, listError] of [[null, 'Falha de consulta'], [null, '']]) {
    const error = movements({ movimentacoes: [], summary, listError }).body;
    assert.match(error, /role="alert"/);
    assert.match(error, /Não conseguimos carregar as movimentações/);
    assert.match(error, /Tentar novamente/);
    assert.doesNotMatch(error, /Nenhuma movimentação registrada|Nenhuma movimentação encontrada|class="history-type-tabs"|<table\b/);
  }
});

test('movements list: período inválido permanece corrigível, associado aos campos e sem fingir resultado vazio', () => {
  const { body } = emptyMovements({
    filters: { q: 'Queijo', tipo: 'saida', usuario: '2', de: '2026-10-02', ate: '2026-09-01', ordem: 'antigas' },
    filterErrors: { de: 'Confira o início.', ate: 'O fim não pode ser anterior ao início.' },
  });
  assert.match(body, /<details class="history-advanced" open>/);
  assert.match(body, /id="history-from"[^>]*aria-invalid="true" aria-describedby="history-from-error"/);
  assert.match(body, /id="history-to"[^>]*aria-invalid="true" aria-describedby="history-to-error"/);
  assert.match(body, /id="history-from-error">Confira o início\./);
  assert.match(body, /id="history-to-error">O fim não pode ser anterior ao início\./);
  assert.match(body, /role="alert"/);
  assert.match(body, /A consulta ainda não foi realizada/);
  assert.match(body, /name="de" value="2026-10-02"/);
  assert.match(body, /name="ate" value="2026-09-01"/);
  assert.doesNotMatch(body, /Nenhuma movimentação registrada|Nenhuma movimentação encontrada|<table\b|Mostrando|Resultado da consulta<span>0 registros/);
});

test('movements list: filtros adicionais nativos abrem ao preservar período ou responsável, inclusive removido', () => {
  assert.match(movements().body, /<details class="history-advanced"\s*>/);
  for (const partial of [{ usuario: '2' }, { de: '2026-09-01' }, { ate: '2026-10-02' }]) {
    const { body } = movements({ filters: { q: '', tipo: 'todos', usuario: '', de: '', ate: '', ordem: 'recentes', ...partial } });
    assert.match(body, /<details class="history-advanced" open>/);
    assert.match(body, /Filtros ativos/);
  }
  const missingUser = movements({ filters: { q: '', tipo: 'todos', usuario: '999', de: '', ate: '', ordem: 'recentes' } }).body;
  assert.match(missingUser, /<option value="999" selected>Responsável indisponível<\/option>/);
  assert.match(missingUser, /O período inclui o dia inicial e o dia final/);
});

test('movements list: atualizar e tentar novamente mantêm a consulta e a página, sem alegar atualização automática', () => {
  const filters = { q: 'Pão & queijo', tipo: 'entrada', usuario: '2', de: '2026-09-01', ate: '2026-10-02', ordem: 'antigas' };
  const pagination = { page: 5, pageSize: 20, total: 205, totalPages: 11 };
  const { body } = movements({ filters, pagination });
  const refresh = body.match(/<a class="history-refresh"[^>]*>/)[0];
  const failed = movements({ filters, pagination, movimentacoes: [], summary: null, listError: 'Falha de consulta' }).body;
  const retry = failed.match(/<section class="dash-error"[\s\S]*?<\/section>/)[0];
  for (const link of [...urls(refresh), ...urls(retry)]) {
    for (const [key, value] of Object.entries(filters)) assert.equal(link.searchParams.get(key), value);
    assert.equal(link.searchParams.get('pagina'), '5');
  }
  assert.match(body, /Consultado em <time datetime="2026-10-02T12:30:00\.000Z" data-dashboard-date>/);
  assert.doesNotMatch(body, /em tempo real|atualização automática/i);
  for (const geradoEm of [null, '', 'inválida', undefined]) {
    const missing = movements({ geradoEm }).body;
    assert.doesNotMatch(missing, /data-dashboard-date|1970|Invalid Date|NaN/);
  }
});
