const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ejs = require('ejs');
const source = fs.readFileSync(path.join(__dirname, '../public/js/avatar.js'), 'utf8');
const photo = '/uploads/avatars/12345678-abcd-4321-abcd-123456789abc.webp';
function harness({ current = photo } = {}) {
  const element = extra => Object.assign({ listeners: {}, attributes: {}, dataset: {}, hidden: false, textContent: '',
    addEventListener(name, fn) { this.listeners[name] = fn; },
    setAttribute(name, value) { this.attributes[name] = String(value); },
    getAttribute(name) { return this.attributes[name] ?? null; },
    removeAttribute(name) { delete this.attributes[name]; }, focus() { this.focused = true; }
  }, extra);
  const picker = element({ files: [], setCustomValidity(value) { this.validity = value; } });
  Object.defineProperty(picker, 'value', { set(value) { if (!value) this.files = []; }, get() { return this.files[0]?.name || ''; } });
  const image = element({ naturalWidth: 100, naturalHeight: 100 });
  const feedback = element({});
  const cancel = element({ hidden: true });
  const remove = element({ checked: false });
  const name = element({ value: 'Ana Silva' });
  const initials = element({});
  const error = element({});
  const notice = element({});
  picker.form = { elements: { namedItem: key => key === 'nome' ? name : null } };
  const selectors = { '[name="foto_arquivo"]': picker, '[data-avatar-preview]': image, '[data-avatar-feedback]': feedback,
    '[data-avatar-cancel]': cancel, '[name="remover_foto"]': remove, '[data-avatar-initials]': initials,
    '[data-field-error="foto_arquivo"]': error, '[data-avatar-notice]': notice };
  const field = element({ dataset: { avatarCurrent: current }, querySelector: selector => selectors[selector] || null });
  const listed = element({ complete: true, naturalWidth: 0 });
  const window = element({});
  const blobs = [], revoked = [];
  class BlobURL extends URL {
    static createObjectURL(file) { const url = 'blob:avatar/' + (blobs.length + 1); blobs.push({ file, url }); return url; }
    static revokeObjectURL(url) { revoked.push(url); }
  }
  vm.runInNewContext(source, { URL: BlobURL, window,
    document: { querySelectorAll: selector => selector === '[data-avatar-image]' ? [listed] : selector === '[data-avatar-field]' ? [field] : [] } });
  return { picker, image, feedback, cancel, remove, name, initials, listed, error, window, blobs, revoked,
    choose(file) { picker.files = file ? [file] : []; picker.listeners.change(); },
    load() { image.listeners.load(); }
  };
}

test('avatar UI: safe initials/fallback and image preview work without any background request or HTML injection', () => {
  const h = harness();
  assert.equal(h.initials.textContent, 'A');
  assert.equal(h.listed.hidden, true);
  h.name.value = '<script>'; h.name.listeners.input(); assert.equal(h.initials.textContent, '<');
  h.choose({ name: 'foto.jpg', type: 'image/jpeg', size: 1000 });
  h.load();
  assert.equal(h.image.src, 'blob:avatar/1');
  assert.equal(h.image.hidden, false);
  assert.equal(h.cancel.hidden, false);
  assert.equal(h.picker.validity, '');
  assert.doesNotMatch(source, /innerHTML|fetch\(|localStorage|sessionStorage|\.submit\(/);
});

test('avatar UI: clear and remove are reversible and do not change any server data', () => {
  const h = harness();
  h.choose({ name: 'foto.png', type: 'image/png', size: 1000 });
  h.cancel.listeners.click();
  assert.equal(h.picker.files.length, 0);
  assert.equal(h.image.src, photo);
  assert.equal(h.picker.focused, true);
  assert.deepEqual(h.revoked, ['blob:avatar/1']);
  h.remove.checked = true; h.remove.listeners.change();
  assert.equal(h.image.hidden, true);
  assert.match(h.feedback.textContent, /ao salvar/);
  h.remove.checked = false; h.remove.listeners.change();
  assert.equal(h.image.src, photo);
  h.remove.checked = true;
  h.choose({ name: 'outra.webp', type: 'image/webp', size: 1000 });
  assert.equal(h.remove.checked, false);
});

test('avatar UI: invalid file size/type/pixels and corrupt images set native validation with visible feedback', () => {
  for (const file of [{ name: 'x.svg', type: 'image/svg+xml', size: 100 }, { name: 'x.jpg', type: 'image/jpeg', size: 0 },
    { name: 'x.png', type: 'image/png', size: 5 * 1024 * 1024 + 1 }]) {
    const h = harness(); h.choose(file);
    assert.ok(h.picker.validity);
    assert.equal(h.feedback.dataset.state, 'error');
    assert.equal(h.blobs.length, 0);
  }
  const h = harness(); h.choose({ name: 'x.jpg', type: 'image/jpeg', size: 1000 });
  h.image.naturalWidth = 6000; h.image.naturalHeight = 6000; h.load();
  assert.match(h.picker.validity, /megapixels/);
  h.choose({ name: 'ok.jpg', type: 'image/jpeg', size: 1000 });
  h.image.listeners.error(); assert.ok(h.picker.validity);
});

test('avatar UI: return from BFCache restores the chosen photo and releases old blob URLs', () => {
  const h = harness(); h.choose({ name: 'x.jpg', type: 'image/jpeg', size: 1000 });
  h.window.listeners.pagehide();
  assert.deepEqual(h.revoked, ['blob:avatar/1']);
  h.window.listeners.pageshow({ persisted: true });
  assert.equal(h.image.src, 'blob:avatar/2');
  assert.equal(h.picker.files[0].name, 'x.jpg');
});

test('avatar UI: optional public avatar belongs to the native multipart form, internal fields support removal', () => {
  const render = (file, locals) => ejs.render(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'), locals,
    { filename: path.join(__dirname, '..', file) });
  const publicHtml = render('views/novo_usuario.ejs', {});
  assert.match(publicHtml, /name="foto_arquivo" type="file"\s+form="login-form"/);
  assert.match(publicHtml, /<form[^>]+id="login-form"[^>]+enctype="multipart\/form-data"/);
  assert.match(publicHtml, /avatar-field--compact/);
  const markup = render('views/partials/user-avatar-field.ejs', { avatarPhoto: photo, avatarError: 'Arquivo inválido.', avatarName: 'Ana', avatarRemove: '1' });
  assert.match(markup, /name="remover_foto" value="1"[^>]*checked/);
  assert.match(markup, /aria-invalid="true"/);
  assert.match(markup, /id="foto_arquivo-error"/);
  for (const malicious of ['javascript:alert(1)', 'https://example.com/tracking.png', '/uploads/avatars/../../x']) {
    assert.doesNotMatch(render('views/partials/user-avatar.ejs', { name: '<script>', photo: malicious }), /<img|<script>/);
  }
});
