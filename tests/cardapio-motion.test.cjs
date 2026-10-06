const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const script = fs.readFileSync(path.join(root, 'public/js/cardapio.js'), 'utf8');

function element(initialClasses = []) {
  const classes = new Set(initialClasses);
  const listeners = new Map();
  const styles = new Map();
  return {
    textContent: '',
    addEventListener(name, callback) {
      listeners.set(name, [...(listeners.get(name) || []), callback]);
    },
    dispatch(name, event = {}) {
      for (const callback of listeners.get(name) || []) callback(event);
    },
    classList: {
      add: (name) => classes.add(name),
      remove: (name) => classes.delete(name),
      contains: (name) => classes.has(name),
      toggle(name, force) { if (force) classes.add(name); else classes.delete(name); },
    },
    style: { setProperty: (name, value) => styles.set(name, value) },
    contains: () => false,
    bounds: { top: 1200, bottom: 1400, height: 200 },
    getBoundingClientRect() { return this.bounds; },
  };
}

function setup({ mobile = true, reduced = false, observer = true } = {}) {
  const page = element();
  const body = element(['main-cardapio']);
  const html = element(reduced ? ['motion-reduced'] : []);
  const editions = Array.from({ length: 3 }, () => element());
  const contents = editions.map(() => element());
  const previews = editions.map(() => element());
  editions.forEach((edition, index) => {
    edition.querySelector = (selector) => selector === '.menu-edition__content' ? contents[index] : null;
    edition.matches = (selector) => selector === '[data-menu-edition]';
  });
  const nodes = {
    '[data-menu-page]': page,
    '[data-menu-editions]': element(),
    '[data-preview-number]': element(),
    '[data-preview-name]': element(),
  };
  const document = Object.assign(element(), {
    body, documentElement: html, activeElement: null,
    querySelector: (selector) => nodes[selector] || null,
    querySelectorAll: (selector) => ({
      '[data-menu-reveal]': editions,
      '[data-menu-edition]': editions,
      '[data-preview-image]': previews,
    })[selector] || [],
  });
  const mobileQuery = Object.assign(element(), { matches: mobile });
  const fineQuery = Object.assign(element(), { matches: !mobile });
  const frames = new Map();
  let frameId = 0;
  const window = Object.assign(element(), {
    scrollY: 0, innerHeight: 800,
    matchMedia: (query) => query.includes('max-width') ? mobileQuery : fineQuery,
    requestAnimationFrame: (callback) => { frames.set(++frameId, callback); return frameId; },
    setTimeout: () => 1,
    clearTimeout: () => {},
  });
  const observers = [];
  class Observer {
    constructor(callback, options) {
      this.callback = callback;
      this.options = options;
      this.observed = new Set();
      observers.push(this);
    }
    observe(node) { this.observed.add(node); }
    unobserve(node) { this.observed.delete(node); }
  }
  if (observer) window.IntersectionObserver = Observer;
  vm.runInNewContext(script, { document, window, IntersectionObserver: Observer });

  function bounds(node, top, bottom) { node.bounds = { top, bottom, height: bottom - top }; }
  function flush() {
    const pending = [...frames.values()];
    frames.clear();
    for (const callback of pending) callback();
  }
  function scroll() {
    window.scrollY += 20;
    window.dispatch('scroll');
    flush();
  }
  const active = () => editions.findIndex((edition) => edition.classList.contains('is-active'));
  return { editions, contents, previews, nodes, window, mobileQuery, fineQuery, frames, observers, bounds, flush, scroll, active };
}

test('cardápio mobile: foto seguinte visível não adianta a seleção antes do texto', () => {
  const ui = setup();
  ui.bounds(ui.editions[0], -150, 510);
  ui.bounds(ui.contents[0], 300, 450);
  ui.bounds(ui.editions[1], 530, 1190);
  ui.bounds(ui.contents[1], 950, 1140);
  ui.flush();
  assert.equal(ui.active(), 0);
  ui.bounds(ui.editions[1], 200, 860);
  ui.bounds(ui.contents[1], 720, 820); // A imagem entrou; o texto ainda não.
  ui.scroll();
  assert.equal(ui.active(), 0);
  ui.bounds(ui.contents[0], -180, -40);
  ui.bounds(ui.contents[1], 390, 570);
  ui.scroll();
  assert.equal(ui.active(), 1);
  assert.equal(ui.nodes['[data-preview-name]'].textContent, 'Container');
});

test('cardápio mobile: seleção acompanha scroll rápido nos dois sentidos sem esperar observer', () => {
  const ui = setup();
  ui.bounds(ui.contents[2], 350, 520);
  ui.flush();
  assert.equal(ui.active(), 2);
  assert.equal(ui.observers.length, 1, 'Somente revelações usam observer, não seleção parcial');
  ui.bounds(ui.contents[2], 1500, 1680);
  ui.bounds(ui.contents[0], 320, 500);
  ui.scroll();
  assert.equal(ui.active(), 0);
  assert.ok(ui.previews[0].classList.contains('is-active'));
});

test('cardápio mobile: toque não simula hover, mas foco de teclado continua funcionando', () => {
  const ui = setup();
  ui.flush();
  ui.editions[2].dispatch('pointerenter', { pointerType: 'touch' });
  assert.equal(ui.active(), 0);
  ui.editions[1].dispatch('focusin');
  assert.equal(ui.active(), 1);
});

test('cardápio: usa todas as regiões e mantém a escolha estável na divisa', () => {
  const ui = setup();
  ui.bounds(ui.contents[0], 370, 450);
  ui.bounds(ui.contents[1], 450, 510);
  ui.flush();
  assert.equal(ui.active(), 0, 'Diferença de poucos pixels não provoca piscar');
  ui.bounds(ui.contents[1], 420, 480);
  ui.scroll();
  assert.equal(ui.active(), 1);
  ui.bounds(ui.contents[0], -500, -400);
  ui.bounds(ui.contents[1], -300, -200);
  ui.scroll();
  assert.equal(ui.active(), 1, 'Entre textos, mantém a seleção anterior');
});

test('cardápio desktop: hover real, foco, fotos e atualização após resize preservados', () => {
  const ui = setup({ mobile: false });
  ui.bounds(ui.editions[0], 310, 500);
  ui.flush();
  ui.editions[2].dispatch('pointerenter', { pointerType: 'mouse' });
  assert.equal(ui.active(), 2);
  assert.ok(ui.previews[2].classList.contains('is-active'));
  ui.editions[1].dispatch('pointerenter', { pointerType: 'touch' });
  assert.equal(ui.active(), 2);
  ui.window.dispatch('resize');
  ui.flush();
  assert.equal(ui.active(), 0);
});

test('cardápio: seleção funciona com movimento reduzido ou sem IntersectionObserver', () => {
  for (const options of [{ reduced: true }, { observer: false }]) {
    const ui = setup(options);
    ui.bounds(ui.contents[1], 330, 500);
    ui.flush();
    assert.equal(ui.active(), 1);
    assert.ok(ui.editions.every((edition) => edition.classList.contains('is-visible')));
  }
});

test('cardápio: eventos de scroll compartilham um único RAF', () => {
  const ui = setup();
  ui.flush();
  for (let i = 0; i < 12; i++) ui.window.dispatch('scroll');
  assert.equal(ui.frames.size, 1);
  ui.flush();
  assert.equal(ui.frames.size, 0);
});

test('cardápio mobile: texto sempre visível, sem stagger e cor/fundo simultâneos', () => {
  const css = fs.readFileSync(path.join(root, 'public/css/cardapio.css'), 'utf8');
  const start = css.indexOf('@media (max-width: 900px)');
  const mobile = css.slice(start, css.indexOf('@media (max-width: 640px)', start));
  assert.match(mobile, /\[data-menu-reveal\]\s*\{[^}]*opacity:\s*1;[^}]*transition-delay:\s*0ms;/);
  assert.match(mobile, /\.menu-edition\[data-menu-reveal\]\s*\{[^}]*opacity:\s*1;[^}]*transform:\s*none;[^}]*transition:\s*none;/);
  assert.match(mobile, /\.menu-edition::before\s*\{[^}]*transition:\s*none;/);
  assert.match(mobile, /\.menu-edition:not\(\.is-active\)\s*\{\s*opacity:\s*1;/);
});

test('cardápio: os três links PDF e a abertura segura continuam nativos', () => {
  const template = fs.readFileSync(path.join(root, 'views/cardapio.ejs'), 'utf8');
  const links = [...template.matchAll(/<a class="menu-edition[^>]+>/g)].map((match) => match[0]);
  assert.equal(links.length, 3);
  for (const link of links) {
    assert.match(link, /href="\/pdf\/[^"\s]+\.pdf"/);
    assert.match(link, /target="_blank" rel="noopener"/);
  }
});
