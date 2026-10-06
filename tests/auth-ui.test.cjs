const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ejs = require('ejs');

const root = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const render = (file, data) => ejs.render(read(file), data, { filename: path.join(root, file) });

for (const register of [false, true]) {
  const name = register ? 'cadastro' : 'login';
  test(`${name}: layout isolado, navegação, holofote e POST nativo`, () => {
    const data = { mainClass: 'main-login', authPage: register ? 'register' : 'login', isLoggedIn: false };
    const body = render(register ? 'views/novo_usuario.ejs' : 'views/login.ejs', data);
    const html = render('views/layouts/principal.ejs', { ...data, body });
    assert.ok(html.includes(`<title>${register ? 'Criar conta' : 'Entrar'} — Madero</title>`));
    assert.match(html, /login\.css\?v=access-10/);
    assert.match(html, /login\.js\?v=access-8/);
    assert.doesNotMatch(html, /href="\/css\/style\.css"|<header class="header-main"|data-background-toggle/);
    assert.match(body, /data-login-spotlight/);
    assert.match(body, /class="login-submit__icon" aria-hidden="true"/);
    assert.match(body, new RegExp(`action="/usuarios/${register ? 'cadastro' : 'login'}" method="post"`));
    assert.match(body, new RegExp(`autocomplete="${register ? 'new-password' : 'current-password'}" required`));
    assert.match(body, /name="usuario"/);
    assert.match(body, /name="senha"/);
    assert.match(body, /type="button" aria-label="Mostrar senha"/);
    assert.ok(body.indexOf('class="login-access"') < body.indexOf('<form'));
    assert.match(body, new RegExp(`href="/usuarios/${register ? 'novo_usuario' : 'login'}" aria-current="page"`));
    if (register) assert.match(body, /name="nome"/);
    const ids = [...body.matchAll(/\sid="([^"]+)"/g)].map((match) => match[1]);
    assert.equal(ids.length, new Set(ids).size);
  });
}

test('cadastro: erro acessível, dados escapados e senhas nunca repopuladas', () => {
  const body = render('views/novo_usuario.ejs', {
    mensagem_erro: '<script>alert(1)</script>',
    nome_digitado: '"><script>nome</script>',
    usuario_digitado: '"><script>usuario</script>',
    email_digitado: '"><script>email</script>',
    telefone_digitado: '"><script>telefone</script>',
    senha: 'must-not-appear',
    confirmar_senha: 'confirmation-must-not-appear',
  });
  assert.match(body, /role="alert"/);
  assert.match(body, /&lt;script&gt;/);
  assert.doesNotMatch(body, /<script>|must-not-appear/);
  assert.doesNotMatch(body.match(/<input id="senha"[^>]+>/)[0], /value=/);
  assert.doesNotMatch(body.match(/<input id="confirmar_senha"[^>]+>/)[0], /value=/);
  assert.match(body.match(/<input id="email"[^>]+>/)[0], /value="&#34;&gt;&lt;script&gt;email&lt;\/script&gt;"/);
  assert.match(body.match(/<input id="telefone"[^>]+>/)[0], /value="&#34;&gt;&lt;script&gt;telefone&lt;\/script&gt;"/);
});

test('cadastro: seis campos e foto opcional, e-mail obrigatório, telefone opcional e confirmação acessível', () => {
  const body = render('views/novo_usuario.ejs', {});
  const inputs = [...body.matchAll(/<input\b[^>]+>/g)].map(match => match[0]);
  assert.equal(inputs.filter(input => !input.includes('type="file"')).length, 6);
  const photo = inputs.find(input => input.includes('name="foto_arquivo"'));
  assert.match(photo, /type="file"/);
  assert.match(photo, /form="login-form"/);
  assert.doesNotMatch(photo, /required/);
  assert.match(body, /enctype="multipart\/form-data"/);
  const email = inputs.find(input => input.includes('name="email"'));
  assert.match(email, /type="email"/);
  assert.match(email, /autocomplete="email"/);
  assert.match(email, /maxlength="254" required/);
  const phone = inputs.find(input => input.includes('name="telefone"'));
  assert.match(phone, /type="tel"/);
  assert.match(phone, /autocomplete="tel" inputmode="tel"/);
  assert.doesNotMatch(phone, /required/);
  const confirmation = inputs.find(input => input.includes('name="confirmar_senha"'));
  assert.match(confirmation, /type="password"/);
  assert.match(confirmation, /autocomplete="new-password" required/);
  assert.match(confirmation, /aria-describedby="register-password-match register-confirm-caps-lock"/);
  assert.match(body, /id="register-password-match" aria-live="polite" aria-atomic="true"/);
  assert.match(body, /aria-label="Mostrar confirmação de senha" aria-controls="confirmar_senha"/);
  assert.equal([...body.matchAll(/data-password-toggle hidden|data-password-name="confirmação de senha" hidden/g)].length, 2);
});

test('cadastro: grade compacta só no cadastro, uma coluna em telas pequenas e conteúdo sem corte', () => {
  const css = read('public/css/login.css');
  assert.match(css, /\.login-page--register \.login-panel\s*\{\s*width: min\(100%, 42\.5rem\)/);
  assert.match(css, /\.login-page--register \.login-form\s*\{\s*grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/);
  assert.match(css, /\.login-page--register \.login-submit\s*\{\s*grid-column: 1 \/ -1/);
  assert.match(css, /@media \(max-width: 639px\)\s*\{[\s\S]*?\.login-page--register \.login-form\s*\{ grid-template-columns: minmax\(0, 1fr\)/);
  for (const selector of ['login-page', 'login-center', 'login-panel']) {
    const rule = css.match(new RegExp(`\\.${selector} \\{([^}]+)\\}`))[1];
    assert.doesNotMatch(rule, /overflow:\s*hidden|(?:^|\n)\s*(?:height|max-height):/);
  }
});

test('login e cadastro usam fotografias distintas e antecipam apenas o próprio fundo', () => {
  const images = [];
  for (const register of [false, true]) {
    const data = { mainClass: 'main-login', authPage: register ? 'register' : 'login', isLoggedIn: false };
    const body = render(register ? 'views/novo_usuario.ejs' : 'views/login.ejs', data);
    const html = render('views/layouts/principal.ejs', { ...data, body });
    const background = body.match(/data-login-spotlight>\s*<img src="([^"]+)"/)[1];
    const preloads = [...html.matchAll(/<link rel="preload" as="image" href="([^"]+)"/g)].map(match => match[1]);
    assert.deepEqual(preloads, [background]);
    assert.ok(background.startsWith('/img/'));
    assert.ok(fs.existsSync(path.join(root, 'public', background)));
    images.push(background);
  }
  assert.equal(images[0], '/img/sobre/aeroporto-brasilia-salao.jpg');
  assert.equal(images[1], '/img/comida_madero.jpg');
  assert.notEqual(images[0], images[1]);
});

test('layout público não recebe estilo ou script da autenticação', () => {
  for (const mainClass of ['main-index', 'main-cardapio', 'main-sobre', '']) {
    const html = render('views/layouts/principal.ejs', { mainClass, isLoggedIn: false, body: '' });
    assert.match(html, /<header class="header-main"/);
    assert.doesNotMatch(html, /href="\/css\/login\.css|src="\/js\/login\.js/);
  }
});

// Simula eventos e RAF sem navegador, servidor, credenciais ou banco de dados.
function element() {
  const listeners = new Map();
  const attributes = new Map();
  const classes = new Set();
  const properties = new Map();
  return {
    dataset: {}, textContent: '', value: '', hidden: false, disabled: false, customValidity: '',
    addEventListener(name, callback) {
      listeners.set(name, [...(listeners.get(name) || []), callback]);
    },
    dispatch(name, data = {}) {
      const event = { prevented: false, preventDefault() { this.prevented = true; }, ...data };
      for (const callback of listeners.get(name) || []) callback(event);
      return event;
    },
    setAttribute(name, value) { attributes.set(name, value); },
    getAttribute(name) { return attributes.get(name); },
    removeAttribute(name) { attributes.delete(name); },
    setCustomValidity(message) { this.customValidity = message; },
    style: { setProperty: (name, value) => properties.set(name, value), removeProperty: (name) => properties.delete(name), getPropertyValue: (name) => properties.get(name) },
    classList: {
      add: (name) => classes.add(name), remove: (name) => classes.delete(name), contains: (name) => classes.has(name),
      toggle(name, force) { if (force) classes.add(name); else classes.delete(name); },
    },
    focus() { this.focused = true; },
  };
}

function setup(register = false) {
  const selectors = ['[data-login-spotlight]', '[data-login-form]', '#senha', '[data-password-toggle]', '[data-password-toggle-label]', '[data-caps-lock]', '[data-login-submit]', '[data-submit-label]', '[data-login-status]'];
  const nodes = Object.fromEntries(selectors.map((selector) => [selector, element()]));
  nodes['[data-password-toggle]'].hidden = true;
  nodes['[data-caps-lock]'].hidden = true;
  if (register) {
    for (const selector of ['#confirmar_senha', '#telefone', '[data-password-match]', '[data-confirm-toggle]', '[data-confirm-toggle-label]', '[data-confirm-caps-lock]']) nodes[selector] = element();
    nodes['[data-confirm-toggle]'].dataset.passwordName = 'confirmação de senha';
    nodes['[data-confirm-toggle]'].hidden = true;
    nodes['[data-confirm-caps-lock]'].hidden = true;
    nodes['#confirmar_senha'].type = 'password';
    nodes['#confirmar_senha'].value = 'senha de teste';
    nodes['#confirmar_senha'].setSelectionRange = () => {};
    nodes['#confirmar_senha'].closest = () => ({ querySelector: selector => ({
      '[data-password-toggle]': nodes['[data-confirm-toggle]'],
      '[data-password-toggle-label]': nodes['[data-confirm-toggle-label]'],
      '[data-caps-lock]': nodes['[data-confirm-caps-lock]'],
    })[selector] || null });
  }
  const page = element();
  page.querySelector = (selector) => nodes[selector] || null;
  const form = nodes['[data-login-form]'];
  form.checkValidity = () => !nodes['#confirmar_senha']?.customValidity && !nodes['#telefone']?.customValidity;
  form.reportValidity = () => { form.validityReported = true; };
  if (register) form.dataset = { submitPending: 'Criando conta…', submitStatus: 'Criando sua conta.' };
  const label = nodes['[data-submit-label]'];
  label.textContent = register ? 'Criar minha conta' : 'Entrar';
  const password = nodes['#senha'];
  password.type = 'password';
  password.value = 'senha de teste';
  password.setSelectionRange = () => {};
  password.closest = () => ({ querySelector: selector => nodes[selector] || null });
  const window = element();
  const document = element();
  document.hidden = false;
  document.querySelector = () => page;
  const fine = Object.assign(element(), { matches: true });
  const reduced = Object.assign(element(), { matches: false });
  window.matchMedia = (query) => query.includes('prefers-reduced-motion') ? reduced : fine;
  window.CSS = { supports: () => true };
  window.localStorage = { getItem: () => null, setItem: () => assert.fail('Não deve armazenar dados') };
  window.innerWidth = 1440;
  window.innerHeight = 900;
  let id = 0;
  const frames = new Map();
  window.requestAnimationFrame = (callback) => { frames.set(++id, callback); return id; };
  window.cancelAnimationFrame = (frame) => frames.delete(frame);
  const flush = () => { const callbacks = [...frames.values()]; frames.clear(); callbacks.forEach((callback) => callback()); };
  vm.runInNewContext(read('public/js/login.js'), { window, document });
  return { nodes, page, form, label, password, window, document, fine, reduced, frames, flush };
}

for (const register of [false, true]) {
  test(`${register ? 'cadastro' : 'login'}: mostrar senha, envio, prevenção de duplicação e retorno`, () => {
    const { nodes, form, label, password, window } = setup(register);
    const toggle = nodes['[data-password-toggle]'];
    assert.equal(toggle.hidden, false);
    toggle.dispatch('click');
    assert.equal(password.type, 'text');
    assert.equal(toggle.getAttribute('aria-pressed'), 'true');
    assert.equal(form.dispatch('submit').prevented, false);
    assert.equal(password.type, 'password');
    assert.equal(label.textContent, register ? 'Criando conta…' : 'Entrando…');
    assert.equal(nodes['[data-login-status]'].textContent, register ? 'Criando sua conta.' : 'Verificando seu acesso.');
    assert.equal(form.getAttribute('aria-busy'), 'true');
    assert.equal(nodes['[data-login-submit]'].disabled, true);
    assert.equal(form.dispatch('submit').prevented, true);
    window.dispatch('pageshow');
    assert.equal(nodes['[data-login-submit]'].disabled, false);
    assert.equal(form.getAttribute('aria-busy'), undefined);
    assert.equal(label.textContent, register ? 'Criar minha conta' : 'Entrar');
    assert.equal(nodes['[data-login-status]'].textContent, '');
  });
}

test('formulário inválido não entra no estado de envio', () => {
  const { form, nodes, label } = setup(true);
  form.checkValidity = () => false;
  assert.equal(form.dispatch('submit').prevented, true);
  assert.equal(form.validityReported, true);
  assert.equal(nodes['[data-login-submit]'].disabled, false);
  assert.equal(label.textContent, 'Criar minha conta');
});

test('cadastro: controles independentes e ambas as senhas ocultas ao sair ou enviar', () => {
  const { nodes, password, form, window, document } = setup(true);
  const confirmation = nodes['#confirmar_senha'];
  const toggle = nodes['[data-confirm-toggle]'];
  assert.equal(toggle.hidden, false);
  toggle.dispatch('click');
  assert.equal(confirmation.type, 'text');
  assert.equal(password.type, 'password');
  assert.equal(toggle.getAttribute('aria-label'), 'Ocultar confirmação de senha');
  nodes['[data-password-toggle]'].dispatch('click');
  assert.equal(password.type, 'text');
  document.hidden = true;
  document.dispatch('visibilitychange');
  assert.equal(password.type, 'password');
  assert.equal(confirmation.type, 'password');
  assert.equal(toggle.getAttribute('aria-label'), 'Mostrar confirmação de senha');
  toggle.dispatch('click');
  window.dispatch('pageshow');
  assert.equal(confirmation.type, 'password');
  toggle.dispatch('click');
  form.dispatch('submit');
  assert.equal(confirmation.type, 'password');
});

test('cadastro: confirmação divergente bloqueia POST sem travar o botão e permite correção', () => {
  const { nodes, form, label, password } = setup(true);
  const confirmation = nodes['#confirmar_senha'];
  const feedback = nodes['[data-password-match]'];
  confirmation.value = 'outra senha';
  confirmation.dispatch('input');
  assert.match(confirmation.customValidity, /igual/);
  assert.equal(confirmation.getAttribute('aria-invalid'), 'true');
  assert.equal(feedback.dataset.state, 'error');
  assert.equal(form.dispatch('submit').prevented, true);
  assert.equal(nodes['[data-login-submit]'].disabled, false);
  assert.equal(form.getAttribute('aria-busy'), undefined);
  assert.equal(label.textContent, 'Criar minha conta');
  confirmation.value = password.value;
  confirmation.dispatch('input');
  assert.equal(confirmation.customValidity, '');
  assert.equal(confirmation.getAttribute('aria-invalid'), undefined);
  assert.equal(feedback.dataset.state, 'success');
  assert.equal(form.dispatch('submit').prevented, false);
  assert.equal(nodes['[data-login-submit]'].disabled, true);
});

test('cadastro: Caps Lock é indicado no campo de senha correspondente', () => {
  const { nodes, password } = setup(true);
  const confirmation = nodes['#confirmar_senha'];
  confirmation.dispatch('keydown', { getModifierState: () => true });
  assert.equal(nodes['[data-confirm-caps-lock]'].hidden, false);
  assert.equal(nodes['[data-caps-lock]'].hidden, true);
  confirmation.dispatch('blur');
  assert.equal(nodes['[data-confirm-caps-lock]'].hidden, true);
  password.dispatch('keyup', { getModifierState: () => true });
  assert.equal(nodes['[data-caps-lock]'].hidden, false);
  assert.equal(nodes['[data-confirm-caps-lock]'].hidden, true);
  password.dispatch('keyup', { getModifierState: () => false });
  assert.equal(nodes['[data-caps-lock]'].hidden, true);
});

test('cadastro: alterar a senha original revalida confirmação e compara os espaços exatamente', () => {
  const { nodes, password } = setup(true);
  const confirmation = nodes['#confirmar_senha'];
  password.value += ' ';
  password.dispatch('input');
  assert.notEqual(confirmation.customValidity, '');
  confirmation.value = '';
  confirmation.dispatch('change');
  assert.equal(confirmation.customValidity, '');
  assert.equal(confirmation.getAttribute('aria-invalid'), undefined);
  assert.equal(nodes['[data-password-match]'].textContent, 'Repita a senha escolhida.');
});

test('cadastro: submit revalida valores modificados sem evento input', () => {
  const { nodes, form } = setup(true);
  nodes['#confirmar_senha'].value = 'alteração programática';
  assert.equal(form.dispatch('submit').prevented, true);
  assert.equal(nodes['[data-login-submit]'].disabled, false);
});

test('cadastro: telefone opcional aceita DDD/DDI e rejeita formato ou quantidade inválida', () => {
  const { nodes, form } = setup(true);
  const phone = nodes['#telefone'];
  for (const value of ['', '   ', '(11) 99999-9999', '+55 (11) 99999-9999', '11.9999.9999', '+123456789012345']) {
    phone.value = value;
    phone.dispatch('input');
    assert.equal(phone.customValidity, '', value);
  }
  for (const value of ['119999999', '+1234567890123456', '55+11999999999', '11abc999999999', '++5511999999999']) {
    phone.value = value;
    phone.dispatch('change');
    assert.notEqual(phone.customValidity, '', value);
    assert.equal(form.dispatch('submit').prevented, true);
    assert.equal(nodes['[data-login-submit]'].disabled, false);
  }
  phone.value = '';
  phone.dispatch('input');
  assert.equal(form.dispatch('submit').prevented, false);
});

test('holofote permanece reativo, sem loop contínuo e com fallback para toque', () => {
  const { page, nodes, frames, flush, reduced, fine, window, document } = setup(true);
  const light = nodes['[data-login-spotlight]'];
  assert.equal(page.classList.contains('spotlight-active'), false);
  page.dispatch('pointermove', { pointerType: 'mouse', clientX: 100, clientY: 200 });
  page.dispatch('pointermove', { pointerType: 'mouse', clientX: 220, clientY: 260 });
  assert.equal(frames.size, 1);
  flush();
  assert.equal(frames.size, 0);
  assert.equal(light.style.getPropertyValue('--spotlight-x'), '220px');
  assert.equal(light.style.getPropertyValue('--spotlight-y'), '260px');
  assert.equal(page.classList.contains('spotlight-active'), true);
  page.dispatch('pointerleave');
  assert.equal(page.classList.contains('spotlight-active'), false);
  reduced.matches = true;
  reduced.dispatch('change');
  assert.equal(page.classList.contains('spotlight-instant'), true);
  page.dispatch('pointermove', { pointerType: 'touch', clientX: 100, clientY: 200 });
  assert.equal(frames.size, 0);
  fine.matches = false;
  fine.dispatch('change');
  assert.equal(page.classList.contains('spotlight-static'), true);
  fine.matches = true;
  fine.dispatch('change');
  page.dispatch('pointermove', { pointerType: 'mouse', clientX: 100, clientY: 200 });
  window.dispatch('scroll');
  assert.equal(frames.size, 0);
  page.dispatch('pointermove', { pointerType: 'mouse', clientX: 100, clientY: 200 });
  document.hidden = true;
  document.dispatch('visibilitychange');
  assert.equal(frames.size, 0);
  assert.equal(page.classList.contains('spotlight-active'), false);
});
