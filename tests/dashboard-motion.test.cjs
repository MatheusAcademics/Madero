const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const script = fs.readFileSync(path.join(__dirname, '../public/js/dashboard.js'), 'utf8');

function element({ dataset = {}, text = '', hidden = false, datetime = null } = {}) {
  const listeners = new Map();
  const classes = new Set();
  const styles = new Map();
  const attributes = new Map();
  return {
    dataset, textContent: text, hidden, value: '', open: true,
    listeners,
    styles,
    style: { setProperty: (key, value) => styles.set(key, value) },
    classList: {
      add: (name) => classes.add(name),
      contains: (name) => classes.has(name),
    },
    getAttribute: (name) => name === 'datetime' ? datetime : attributes.get(name) ?? null,
    setAttribute: (name, value) => attributes.set(name, value),
    addEventListener(name, callback) {
      listeners.set(name, [...(listeners.get(name) || []), callback]);
    },
    dispatch(name, event = {}) {
      let result;
      for (const callback of listeners.get(name) || []) result = callback(event);
      return result;
    },
  };
}

function setup({ desktop = false, systemReduced = false, savedMotion = null,
  hasAnimation = true, empty = false, storageBlocked = false, htmlReduced = false,
  imageBroken = false, hidden = false, legacyQuery = false, present = true,
  hasObserver = false } = {}) {
  const page = element();
  const navigation = element();
  const summary = Object.assign(element(), { focused: false, focus() { this.focused = true; } });
  navigation.querySelector = (selector) => selector === 'summary' ? summary : null;
  const search = element();
  const searchControl = element({ hidden: true });
  const filterEmpty = element({ hidden: true });
  const filterCount = element();
  const rows = empty ? [] : [
    element({ dataset: { search: 'Pão de Hambúrguer Padaria' } }),
    element({ dataset: { search: 'Queijo   Prato Laticínios' } }),
    element({ text: 'Carne bovina Açougue' }),
  ];
  const reveal = Array.from({ length: 8 }, () => element());
  const bars = Array.from({ length: 3 }, () => element());
  const logout = element();
  const thumb = element();
  const image = Object.assign(element(), {
    complete: imageBroken, naturalWidth: imageBroken ? 0 : 500,
    closest: (selector) => selector === '[data-product-thumb]' ? thumb : null,
  });
  const date = element({ datetime: '2026-09-18', text: 'Data original' });
  const snapshotDate = element({ datetime: '2026-09-18T01:34:00.000Z', text: 'Consulta original' });
  const movementDate = element({ datetime: '2026-09-18T15:34:00', text: 'Movimento original' });
  const invalidDate = element({ datetime: 'não é uma data', text: 'Sem data' });
  const missingDate = element({ text: 'Data indisponível' });
  const single = {
    '[data-stock-search]': search,
    '[data-stock-search-control]': searchControl,
    '[data-stock-filter-empty]': filterEmpty,
    '[data-stock-filter-count]': filterCount,
  };
  const multiple = {
    '[data-stock-row]': rows,
    '[data-product-image]': [image],
    '[data-dashboard-date]': [date, snapshotDate, invalidDate, missingDate],
    '[data-movement-date]': [movementDate],
    '[data-dashboard-reveal]': reveal,
    '[data-dashboard-bar]': bars,
  };
  page.querySelector = (selector) => single[selector] || null;
  page.querySelectorAll = (selector) => multiple[selector] || [];
  const html = element();
  if (htmlReduced) html.classList.add('motion-reduced');
  const document = Object.assign(element(), {
    hidden,
    documentElement: html,
    querySelector: (selector) => ({
      '[data-dashboard]': present ? page : null,
      '[data-dashboard-navigation]': navigation,
    })[selector] || null,
    querySelectorAll: (selector) => selector === '[data-dashboard-logout]' ? [logout] : [],
  });
  const desktopQuery = Object.assign(element(), { matches: desktop });
  const motionQuery = Object.assign(element(), { matches: systemReduced });
  if (legacyQuery) {
    for (const query of [desktopQuery, motionQuery]) {
      const addEventListener = query.addEventListener.bind(query);
      delete query.addEventListener;
      query.addListener = (callback) => addEventListener('change', callback);
    }
  }
  const animations = [];
  if (hasAnimation) {
    for (const node of [...reveal, ...bars]) {
      node.animate = (keyframes, options) => {
        const animation = {
          node, keyframes, options, cancelled: false,
          cancel() { this.cancelled = true; this.oncancel?.(); },
        };
        animations.push(animation);
        return animation;
      };
    }
  }
  let confirmed = true;
  const confirmations = [];
  const observers = [];
  const window = Object.assign(element(), {
    matchMedia: (query) => query.includes('min-width') ? desktopQuery : motionQuery,
    localStorage: { getItem: () => {
      if (storageBlocked) throw new Error('Armazenamento indisponível');
      return savedMotion;
    } },
    confirm(message) { confirmations.push(message); return confirmed; },
    requestAnimationFrame() { throw new Error('O dashboard não precisa de frames de animação'); },
    setInterval() { throw new Error('O dashboard não precisa de polling'); },
    fetch() { throw new Error('O dashboard não faz requisições no navegador'); },
  });
  if (hasObserver) {
    window.IntersectionObserver = class {
      constructor(callback, options) {
        this.callback = callback;
        this.options = options;
        this.targets = new Set();
        this.disconnected = false;
        observers.push(this);
      }
      observe(target) { this.targets.add(target); }
      unobserve(target) { this.targets.delete(target); }
      disconnect() { this.targets.clear(); this.disconnected = true; }
      emit(entries) { this.callback(entries); }
    };
  }
  vm.runInNewContext(script, { document, window, Intl, Date });
  return {
    page, navigation, summary, search, searchControl, filterEmpty, filterCount, rows, reveal, bars,
    logout, image, thumb, date, snapshotDate, movementDate, invalidDate, missingDate,
    document, window, desktopQuery, motionQuery, animations, confirmations, observers,
    setConfirmed: (value) => { confirmed = value; },
  };
}

test('dashboard: só executa na página correspondente', () => {
  const ui = setup({ present: false });
  assert.equal(ui.animations.length, 0);
  assert.equal(ui.searchControl.hidden, true);
  assert.equal(ui.navigation.open, true);
});

test('dashboard mobile: details nativo mantém o controle por teclado e não é overlay', () => {
  const ui = setup();
  assert.equal(ui.navigation.open, false);
  assert.equal(ui.navigation.listeners.size, 0, 'Não substitui clique/teclado nativos do summary');
  ui.document.dispatch('keydown', { key: 'Tab' });
  assert.equal(ui.summary.focused, false, 'Não prende foco no menu');
  ui.navigation.open = true; // Abertura nativa pelo usuário.
  ui.window.dispatch('resize');
  ui.desktopQuery.dispatch('change', { matches: false });
  assert.equal(ui.navigation.open, true, 'Resize na mesma faixa preserva a escolha do usuário');
  ui.desktopQuery.dispatch('change', { matches: true });
  assert.equal(ui.navigation.open, true);
  ui.desktopQuery.dispatch('change', { matches: false });
  assert.equal(ui.navigation.open, false);
});

test('dashboard desktop: navegação começa aberta e suporta media query legada', () => {
  const ui = setup({ desktop: true, legacyQuery: true });
  assert.equal(ui.navigation.open, true);
  ui.desktopQuery.dispatch('change', { matches: false });
  assert.equal(ui.navigation.open, false);
  ui.motionQuery.dispatch('change', { matches: true });
  assert.ok(ui.animations.every((animation) => animation.cancelled));
});

test('dashboard: busca normaliza acentos, caixa, espaços e categoria', () => {
  const ui = setup();
  assert.equal(ui.searchControl.hidden, false);
  assert.equal(ui.filterCount.textContent, '3 de 3 produtos');
  ui.search.value = '  PAO DE HAMBURGUER  ';
  ui.search.dispatch('input');
  assert.deepEqual(ui.rows.map((row) => row.hidden), [false, true, true]);
  assert.equal(ui.filterCount.textContent, '1 de 3 produtos');
  ui.search.value = 'laticinios';
  ui.search.dispatch('input');
  assert.deepEqual(ui.rows.map((row) => row.hidden), [true, false, true]);
  ui.search.value = 'AÇOUGUE';
  ui.search.dispatch('input');
  assert.deepEqual(ui.rows.map((row) => row.hidden), [true, true, false]);
  assert.equal(ui.filterEmpty.hidden, true);
});

test('dashboard: busca sem resultados é reversível e não esconde os controles', () => {
  const ui = setup();
  ui.search.value = 'não existe';
  ui.search.dispatch('input');
  assert.ok(ui.rows.every((row) => row.hidden));
  assert.equal(ui.filterEmpty.hidden, false);
  assert.equal(ui.filterCount.textContent, '0 de 3 produtos');
  assert.equal(ui.searchControl.hidden, false);
  ui.search.value = '';
  ui.search.dispatch('search');
  assert.ok(ui.rows.every((row) => !row.hidden));
  assert.equal(ui.filterEmpty.hidden, true);
});

test('dashboard: banco vazio não oferece uma busca sem conteúdo', () => {
  const ui = setup({ empty: true });
  assert.equal(ui.searchControl.hidden, true);
  assert.equal(ui.filterEmpty.hidden, true);
  assert.equal(ui.filterCount.textContent, '0 de 0 produtos');
});

test('dashboard: restaura o filtro em páginas recuperadas do histórico', () => {
  const ui = setup();
  ui.search.value = 'prato';
  ui.window.dispatch('pageshow', { persisted: true });
  assert.deepEqual(ui.rows.map((row) => row.hidden), [true, false, true]);
  assert.ok(ui.animations.every((animation) => animation.cancelled));
});

test('dashboard: entrada discreta de execução única, sem bloquear dados SSR nem alterar números', () => {
  const ui = setup();
  assert.equal(ui.animations.length, ui.reveal.length + ui.bars.length);
  for (const animation of ui.animations) {
    assert.equal(animation.options.duration, 240);
    assert.equal(animation.options.delay ?? 0, 0, 'Dados não esperam uma entrada em cascata');
    assert.equal(animation.options.fill, 'backwards', 'Não mantém styles de animação ao terminar');
    assert.ok(animation.keyframes.every((frame) => frame.opacity !== 0));
  }
  for (const animation of ui.animations.slice(ui.reveal.length)) {
    assert.equal(animation.keyframes[0].transform, 'scaleX(0.96)', 'Gráficos não começam vazios');
    assert.equal(animation.keyframes[1].transform, 'scaleX(1)');
  }
  for (const animation of ui.animations.slice(0, ui.reveal.length)) {
    assert.equal(animation.keyframes[0].transform, 'translateY(6px)');
  }
  ui.window.dispatch('pageshow', { persisted: false });
  assert.ok(ui.animations.every((animation) => !animation.cancelled), 'pageshow inicial não corta a entrada');
  ui.window.dispatch('scroll');
  ui.window.dispatch('resize');
  assert.equal(ui.animations.length, 11, 'Rolagem e resize não reanimam os cards');
});

test('dashboard: respeita movimento reduzido do sistema, site e documento', () => {
  for (const options of [{ systemReduced: true }, { savedMotion: 'reduced' }, { htmlReduced: true }, { hidden: true }]) {
    const ui = setup(options);
    assert.equal(ui.animations.length, 0);
    assert.equal(ui.searchControl.hidden, false, 'Preferência não desativa a busca');
    assert.ok(ui.rows.every((row) => !row.hidden));
  }
});

test('dashboard: mudança de preferência e ocultação cancelam animações sem reiniciá-las', () => {
  for (const trigger of ['storage', 'visibility', 'media', 'pagehide']) {
    const ui = setup();
    if (trigger === 'storage') ui.window.dispatch('storage', { key: 'madero-motion' });
    if (trigger === 'visibility') {
      ui.document.hidden = true;
      ui.document.dispatch('visibilitychange');
    }
    if (trigger === 'media') ui.motionQuery.dispatch('change', { matches: true });
    if (trigger === 'pagehide') ui.window.dispatch('pagehide');
    assert.ok(ui.animations.every((animation) => animation.cancelled));
    ui.document.hidden = false;
    ui.document.dispatch('visibilitychange');
    ui.motionQuery.dispatch('change', { matches: false });
    assert.equal(ui.animations.length, 11);
  }
});

test('dashboard: storage alheio não interrompe a entrada, limpar preferências interrompe', () => {
  const ui = setup();
  ui.window.dispatch('storage', { key: 'outra-chave' });
  assert.ok(ui.animations.every((animation) => !animation.cancelled));
  ui.window.dispatch('storage', { key: null });
  assert.ok(ui.animations.every((animation) => animation.cancelled));
});

test('dashboard: permanece utilizável sem WAAPI ou localStorage disponível', () => {
  const ui = setup({ hasAnimation: false, storageBlocked: true });
  assert.equal(ui.animations.length, 0);
  assert.equal(ui.searchControl.hidden, false);
  assert.equal(ui.filterCount.textContent, '3 de 3 produtos');
});

test('dashboard: falha de imagem mantém miniatura e conteúdo, inclusive erro já em cache', () => {
  for (const imageBroken of [false, true]) {
    const ui = setup({ imageBroken });
    if (!imageBroken) ui.image.dispatch('error');
    assert.equal(ui.image.hidden, true);
    assert.equal(ui.thumb.classList.contains('has-image-error'), true);
    assert.ok(ui.rows.every((row) => !row.hidden));
  }
});

test('dashboard: cancelar saída mantém a página; confirmar mantém a navegação original', () => {
  const ui = setup();
  let prevented = false;
  ui.setConfirmed(false);
  ui.logout.dispatch('click', { preventDefault() { prevented = true; } });
  assert.equal(prevented, true);
  assert.equal(ui.confirmations[0], 'Deseja sair da área interna do Madero?');
  prevented = false;
  ui.setConfirmed(true);
  ui.logout.dispatch('click', { preventDefault() { prevented = true; } });
  assert.equal(prevented, false, 'Não substitui href nem método da saída');
});

test('dashboard: datas em português preservam fallback inválido e data sem horário', () => {
  const ui = setup();
  assert.equal(ui.date.textContent, 'sexta-feira, 18 de setembro de 2026');
  assert.match(ui.movementDate.textContent, /18\/09.*15:34/);
  assert.equal(ui.invalidDate.textContent, 'Sem data');
  assert.equal(ui.missingDate.textContent, 'Data indisponível');
});

test('dashboard: consulta com timestamp exibe data e horário no fuso local', () => {
  const ui = setup();
  const snapshot = new Date(ui.snapshotDate.getAttribute('datetime'));
  const expected = new Intl.DateTimeFormat('pt-BR', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  }).format(snapshot);
  assert.equal(ui.snapshotDate.textContent, expected);
  assert.match(ui.snapshotDate.textContent, /\d{2}:\d{2}/);
  assert.doesNotMatch(ui.date.textContent, /\d{2}:\d{2}/, 'Data sem horário continua sem hora artificial');
});

test('dashboard mobile: Escape recolhe menu aberto e retorna foco ao summary', () => {
  const ui = setup();
  ui.navigation.open = true;
  ui.document.dispatch('keydown', { key: 'Escape' });
  assert.equal(ui.navigation.open, false);
  assert.equal(ui.summary.focused, true);
  const desktop = setup({ desktop: true });
  desktop.document.dispatch('keydown', { key: 'Escape' });
  assert.equal(desktop.navigation.open, true);
  assert.equal(desktop.summary.focused, false);
});

test('dashboard: observador anima seção apenas ao entrar no viewport, uma única vez', () => {
  const ui = setup({ hasObserver: true });
  assert.equal(ui.observers.length, 1);
  const observer = ui.observers[0];
  assert.equal(observer.targets.size, 11);
  assert.equal(ui.animations.length, 0);
  assert.ok(ui.reveal.every((node) => !node.hidden && node.styles.size === 0), 'SSR nunca fica oculto aguardando observer');
  observer.emit([{ target: ui.reveal[0], isIntersecting: false }]);
  assert.equal(ui.animations.length, 0);
  observer.emit([{ target: ui.reveal[0], isIntersecting: true }]);
  assert.equal(ui.animations.length, 1);
  assert.equal(observer.targets.has(ui.reveal[0]), false);
  observer.emit([{ target: ui.reveal[0], isIntersecting: true }]);
  assert.equal(ui.animations.length, 1, 'Reentrada não repete animação');
  observer.emit([...observer.targets].map((target) => ({ target, isIntersecting: true })));
  assert.equal(ui.animations.length, 11);
  assert.equal(observer.disconnected, true);
});

test('dashboard: cancelar motion desconecta observer e ignora callbacks já enfileirados', () => {
  for (const trigger of ['pagehide', 'storage', 'visibility', 'media', 'bfcache']) {
    const ui = setup({ hasObserver: true });
    const observer = ui.observers[0];
    observer.emit([{ target: ui.reveal[0], isIntersecting: true }]);
    if (trigger === 'pagehide') ui.window.dispatch('pagehide');
    if (trigger === 'storage') ui.window.dispatch('storage', { key: 'madero-motion' });
    if (trigger === 'media') ui.motionQuery.dispatch('change', { matches: true });
    if (trigger === 'bfcache') ui.window.dispatch('pageshow', { persisted: true });
    if (trigger === 'visibility') {
      ui.document.hidden = true;
      ui.document.dispatch('visibilitychange');
      ui.document.hidden = false;
    }
    observer.emit([{ target: ui.reveal[1], isIntersecting: true }]);
    assert.equal(observer.disconnected, true);
    assert.equal(ui.animations.length, 1);
    assert.equal(ui.animations[0].cancelled, true);
  }
});

test('dashboard: rolagem e movimento do mouse não movem interface nem agendam frames', () => {
  const ui = setup({ hasObserver: true });
  for (const node of [ui.window, ui.document, ui.page]) {
    for (const event of ['scroll', 'pointermove', 'mousemove', 'resize']) {
      assert.equal(node.listeners.has(event), false);
      node.dispatch(event, { clientX: 10, clientY: 20, pointerType: 'mouse' });
    }
  }
  assert.equal(ui.animations.length, 0);
  assert.ok(ui.reveal.every((node) => node.styles.size === 0));
  assert.doesNotMatch(script, /data-dashboard-scene|data-dashboard-stage|data-scene-/);
  assert.doesNotMatch(script, /requestAnimationFrame|setInterval|setTimeout/);
});

test('dashboard: observador permanece opcional em movimento reduzido e sem WAAPI', () => {
  for (const options of [{ systemReduced: true }, { savedMotion: 'reduced' }, { htmlReduced: true }]) {
    const ui = setup({ hasObserver: true, ...options });
    assert.equal(ui.observers.length, 0);
    assert.equal(ui.animations.length, 0);
    assert.equal(ui.searchControl.hidden, false);
  }
  const ui = setup({ hasObserver: true, hasAnimation: false });
  const observer = ui.observers[0];
  observer.emit([...observer.targets].map((target) => ({ target, isIntersecting: true })));
  assert.equal(ui.animations.length, 0);
  assert.equal(observer.disconnected, true);
  assert.ok(ui.reveal.every((node) => !node.hidden && node.styles.size === 0));
});
