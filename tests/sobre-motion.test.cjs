const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../public/js/sobre.js'), 'utf8');

function node() {
  const listeners = new Map();
  const attributes = new Map();
  const classes = new Set();
  const styles = new Map();
  return {
    dataset: {},
    textContent: '',
    offsetTop: 0,
    addEventListener(name, callback) {
      listeners.set(name, [...(listeners.get(name) || []), callback]);
    },
    dispatch(name, event = {}) {
      for (const callback of listeners.get(name) || []) callback(event);
    },
    setAttribute: (name, value) => attributes.set(name, value),
    getAttribute: (name) => attributes.get(name),
    removeAttribute: (name) => attributes.delete(name),
    classList: {
      add: (name) => classes.add(name),
      remove: (name) => classes.delete(name),
      contains: (name) => classes.has(name),
      toggle(name, value) { if (value) classes.add(name); else classes.delete(name); },
    },
    style: {
      setProperty: (name, value) => styles.set(name, value),
      getPropertyValue: (name) => styles.get(name),
    },
  };
}

function setup({ mobile = true, reduced = false, systemReduced = false } = {}) {
  const window = Object.assign(node(), { innerWidth: mobile ? 390 : 1440, innerHeight: 800, scrollY: 0 });
  const document = node();
  const body = node();
  body.classList.add('main-sobre');
  const root = node();
  if (reduced) root.classList.add('motion-reduced');
  document.body = body;
  document.documentElement = root;
  const mobileQuery = Object.assign(node(), { matches: mobile });
  const reducedQuery = Object.assign(node(), { matches: systemReduced });
  window.matchMedia = (query) => query.includes('prefers-reduced') ? reducedQuery
    : query.includes('max-width') ? mobileQuery : { matches: false };
  window.setTimeout = () => 1;
  window.clearTimeout = () => {};
  let frameId = 0;
  const frames = new Map();
  window.requestAnimationFrame = (callback) => { frames.set(++frameId, callback); return frameId; };
  const flush = () => {
    const callbacks = [...frames.values()];
    frames.clear();
    callbacks.forEach((callback) => callback());
  };
  const rect = (top, height) => ({ top: top - window.scrollY, bottom: top + height - window.scrollY, height });
  const section = node();
  section.getBoundingClientRect = () => rect(900, 2700);
  const entries = [1999, 2005, 2014].map((year, index) => {
    const entry = node();
    const media = node();
    const time = Object.assign(node(), { textContent: String(year), offsetTop: 348 });
    const top = 1000 + index * 800;
    entry.getBoundingClientRect = () => rect(top, 800);
    media.getBoundingClientRect = () => rect(top + 48, 240);
    entry.querySelector = (selector) => selector === 'time' ? time : selector === '.about-era__mobile-media' ? media : null;
    return entry;
  });
  const images = entries.map(node);
  const links = entries.map((_, index) => Object.assign(node(), { dataset: { yearLink: String(index) } }));
  const currentYear = node();
  const selectorMap = {
    '[data-about-page]': node(),
    '[data-timeline-section]': section,
    '[data-current-year]': currentYear,
  };
  document.querySelector = (selector) => selectorMap[selector] || null;
  document.querySelectorAll = (selector) => ({
    '[data-timeline-entry]': entries,
    '[data-timeline-image]': images,
    '[data-year-link]': links,
  })[selector] || [];
  vm.runInNewContext(source, { document, window });
  flush();
  const scroll = (position) => { window.scrollY = position; window.dispatch('scroll'); flush(); };
  return { window, root, section, entries, images, links, currentYear, mobileQuery, reducedQuery, frames, flush, scroll };
}

test('timeline mobile: foto, ano e traço respondem ao scroll sem aguardar observer', () => {
  const { section, entries, scroll } = setup();
  assert.equal(section.classList.contains('has-mobile-motion'), true);
  scroll(300);
  const first = entries[0].style;
  const initialInset = Number.parseFloat(first.getPropertyValue('--about-era-image-inset'));
  const initialShift = Number.parseFloat(first.getPropertyValue('--about-era-image-shift'));
  const initialScale = Number.parseFloat(first.getPropertyValue('--about-era-image-scale'));
  assert.ok(initialInset > 0 && initialInset <= 8);
  assert.equal(first.getPropertyValue('--about-era-year-shift'), '18.00px');
  assert.ok(Number.parseFloat(first.getPropertyValue('--about-era-line-progress')) > 0);

  scroll(600);
  assert.ok(Number.parseFloat(first.getPropertyValue('--about-era-image-inset')) < initialInset);
  assert.ok(Number.parseFloat(first.getPropertyValue('--about-era-image-shift')) < initialShift);
  assert.ok(Number.parseFloat(first.getPropertyValue('--about-era-image-scale')) < initialScale);
  assert.ok(Number.parseFloat(first.getPropertyValue('--about-era-year-shift')) < 18);

  scroll(1000);
  assert.equal(first.getPropertyValue('--about-era-year-shift'), '0.00px');
  assert.equal(first.getPropertyValue('--about-era-line-progress'), '1.0000');
  scroll(300);
  assert.equal(Number.parseFloat(first.getPropertyValue('--about-era-image-shift')), initialShift);
});

test('timeline mobile: ano acompanha o capítulo visível, inclusive capítulos longos', () => {
  const { scroll, links, currentYear } = setup();
  scroll(1400); // Próximo capítulo começa em y=400, ainda abaixo da linha de leitura.
  assert.equal(currentYear.textContent, '1999');
  assert.equal(links[0].getAttribute('aria-current'), 'true');
  scroll(1470); // Próximo capítulo chegou em y=330.
  assert.equal(currentYear.textContent, '2005');
  assert.equal(links[0].getAttribute('aria-current'), undefined);
  assert.equal(links[1].getAttribute('aria-current'), 'true');
});

test('timeline desktop preserva a seleção central e a fotografia correspondente', () => {
  const { section, entries, images, currentYear, scroll } = setup({ mobile: false });
  scroll(1800);
  assert.equal(section.classList.contains('has-mobile-motion'), false);
  assert.equal(currentYear.textContent, '2005');
  assert.equal(images[1].classList.contains('is-active'), true);
  assert.equal(entries[1].style.getPropertyValue('--about-era-image-shift'), undefined);
});

test('timeline respeita movimento reduzido do site e do sistema', () => {
  for (const options of [{ reduced: true }, { systemReduced: true }]) {
    const { section, entries, scroll } = setup(options);
    scroll(1200);
    assert.equal(section.classList.contains('has-mobile-motion'), false);
    assert.equal(entries[0].style.getPropertyValue('--about-era-image-shift'), undefined);
  }
  const { section, reducedQuery, frames, flush } = setup();
  reducedQuery.matches = true;
  reducedQuery.dispatch('change');
  assert.equal(frames.size, 1);
  flush();
  assert.equal(section.classList.contains('has-mobile-motion'), false);
});

test('timeline alterna desktop/mobile e volta do histórico sem loop de animação', () => {
  const { window, section, mobileQuery, frames, flush, scroll } = setup();
  scroll(1200);
  assert.equal(frames.size, 0);
  window.dispatch('scroll');
  window.dispatch('scroll');
  window.dispatch('resize');
  assert.equal(frames.size, 1);
  flush();
  assert.equal(frames.size, 0);
  mobileQuery.matches = false;
  window.dispatch('resize');
  flush();
  assert.equal(section.classList.contains('has-mobile-motion'), false);
  mobileQuery.matches = true;
  window.dispatch('pageshow', { persisted: true });
  flush();
  assert.equal(section.classList.contains('has-mobile-motion'), true);
  assert.equal(frames.size, 0);
});

test('timeline mantém textos visíveis, imagens com dimensões e navegação nativa', () => {
  const view = fs.readFileSync(path.join(__dirname, '../views/sobre.ejs'), 'utf8');
  const css = fs.readFileSync(path.join(__dirname, '../public/css/sobre.css'), 'utf8');
  const cards = [...view.matchAll(/<article class="about-era[\s\S]*?<\/article>/g)];
  assert.equal(cards.length, 9);
  for (const [card] of cards) {
    assert.doesNotMatch(card, /data-about-reveal|hidden|aria-hidden/);
    assert.match(card, /<img[^>]*width="\d+" height="\d+"/);
    assert.match(card, /<time datetime="\d{4}">\d{4}<\/time>/);
  }
  const motionRules = [...css.matchAll(/[^{}]*\.has-mobile-motion[^{}]*\{([^}]+)\}/g)];
  assert.ok(motionRules.length >= 8);
  for (const [, declarations] of motionRules) {
    assert.doesNotMatch(declarations, /opacity:\s*0|visibility:\s*hidden|display:\s*none/);
  }
  const { links, currentYear } = setup();
  links[2].dispatch('click');
  assert.equal(currentYear.textContent, '2014');
  assert.doesNotMatch(source, /touchmove|wheel/);
});
