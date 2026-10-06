const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../public/js/user-form.js'), 'utf8');
const events = node => Object.assign(node, { attrs: {}, listeners: {}, addEventListener(type, fn) { (this.listeners[type] ||= []).push(fn); }, fire(type, event = {}) { this.listeners[type]?.forEach(fn => fn(event)); }, setAttribute(k, v) { this.attrs[k] = v; }, removeAttribute(k) { delete this.attrs[k]; }, focus() { this.focused = true; } });
function harness(editing = false) {
  const values = { nome: 'Ana', usuario: 'ana', email: 'ana@example.test', telefone: '', senha: editing ? '' : 'senha-teste', confirmar_senha: editing ? '' : 'senha-teste' };
  const fields = Object.fromEntries(Object.entries(values).map(([key, value]) => [key, events({ value, type: key.includes('senha') ? 'password' : 'text', validity: '', setCustomValidity(v) { this.validity = v; } })]));
  const button = { disabled: false }, label = { textContent: 'Salvar' }, errors = { nome: { hidden: false } }, summary = events({});
  const toggles = ['senha', 'confirmar_senha'].map(key => events({ hidden: true, dataset: { passwordTarget: key } }));
  const form = events({ dataset: { mode: editing ? 'edit' : 'create' }, elements: { namedItem: key => fields[key] }, nativeValid: true,
    querySelector(q) { return { '[data-user-submit]': button, '[data-user-submit-label]': label, '[data-user-error-summary]': summary, '[data-field-error="nome"]': errors.nome }[q] || null; },
    querySelectorAll: () => toggles, checkValidity() { return this.nativeValid && Object.values(fields).every(f => !f.validity); }, reportValidity() { this.reported = true; }
  });
  const window = events({});
  vm.runInNewContext(source, { document: { querySelector: () => form }, window, TextEncoder });
  const submit = () => { const event = { prevented: false, preventDefault() { this.prevented = true; } }; form.fire('submit', event); return event; };
  return { fields, button, label, form, window, toggles, summary, errors, submit };
}
test('user form JS: edit can retain password, create requires matching new credentials', () => {
  assert.equal(harness(true).submit().prevented, false);
  for (const editing of [true, false]) { const h = harness(editing); h.fields.senha.value = 'nova'; h.fields.confirmar_senha.value = ''; assert.equal(h.submit().prevented, true); assert.ok(h.fields.confirmar_senha.validity); assert.equal(h.button.disabled, false); }
});
test('user form JS: refuses overlong UTF-8 passwords, blank identity and malformed phone', () => {
  for (const [key, value] of [['senha', 'á'.repeat(37)], ['nome', '  '], ['usuario', 'x'.repeat(101)], ['telefone', '123']]) {
    const h = harness(); h.fields[key].value = value; assert.equal(h.submit().prevented, true); assert.ok(h.fields[key].validity);
  }
  const h = harness(); h.fields.senha.value = 'á'.repeat(36); h.fields.confirmar_senha.value = h.fields.senha.value; assert.equal(h.submit().prevented, false);
});
test('user form JS: password visibility is explicit and resets on BFCache without retaining secrets', () => {
  const h = harness(); assert.equal(h.toggles[0].hidden, false); h.toggles[0].fire('click'); assert.equal(h.fields.senha.type, 'text'); assert.equal(h.toggles[0].attrs['aria-pressed'], 'true');
  h.window.fire('pageshow', { persisted: true }); assert.equal(h.fields.senha.type, 'password'); assert.equal(h.fields.senha.value, ''); assert.equal(h.fields.confirmar_senha.value, ''); assert.equal(h.fields.nome.value, 'Ana');
});
test('user form JS: prevents duplicate submissions and restores controls on history navigation', () => {
  const h = harness(); assert.equal(h.submit().prevented, false); assert.equal(h.button.disabled, true); assert.equal(h.label.textContent, 'Salvando…'); assert.equal(h.submit().prevented, true);
  h.window.fire('pageshow', {}); assert.equal(h.button.disabled, false); assert.equal(h.label.textContent, 'Salvar'); assert.equal(h.form.attrs['aria-busy'], undefined);
});
test('user form JS: correction clears field feedback, respects native validity and never sends background data', () => {
  const h = harness(); h.fields.nome.fire('input'); assert.equal(h.errors.nome.hidden, true); assert.equal(h.fields.nome.attrs['aria-describedby'], 'nome-hint'); assert.equal(h.summary.focused, true);
  h.form.nativeValid = false; assert.equal(h.submit().prevented, true); assert.equal(h.form.reported, true);
  assert.doesNotMatch(source, /innerHTML|fetch\(|\.submit\(|localStorage|sessionStorage|console\./);
  assert.doesNotThrow(() => vm.runInNewContext(source, { document: { querySelector: () => null } }));
});
