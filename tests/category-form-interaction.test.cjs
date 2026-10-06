const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../public/js/category-form.js'), 'utf8');
function harness({ present = true, fieldError = false, saveError = false, value = '' } = {}) {
  const element = extra => Object.assign({
    attributes: {}, listeners: {},
    addEventListener(name, callback) { this.listeners[name] = callback; },
    setAttribute(name, value) { this.attributes[name] = value; },
    removeAttribute(name) { delete this.attributes[name]; },
    focus() { this.focused = true; },
  }, extra);
  const input = element({ value, validity: '', setCustomValidity(value) { this.validity = value; }, reportValidity() { this.reported = true; } });
  const button = element({ disabled: false });
  const label = element({ textContent: 'Cadastrar categoria' });
  const nameError = fieldError ? element({ hidden: false }) : null;
  const formError = saveError ? element({}) : null;
  const form = element({ querySelector(selector) {
    return { '[data-category-name]': input, '[data-category-submit]': button,
      '[data-category-submit-label]': label, '[data-category-name-error]': nameError,
      '[data-category-save-error]': formError }[selector];
  } });
  const window = element({});
  vm.runInNewContext(source, { document: { querySelector: () => present ? form : null }, window });
  return { input, button, label, nameError, formError, form, window,
    submit() {
      let prevented = false;
      form.listeners.submit?.({ preventDefault() { prevented = true; } });
      return { prevented };
    }
  };
}

test('category form interaction: não executa em outra página nem move foco na primeira visita', () => {
  const absent = harness({ present: false });
  assert.equal(absent.form.listeners.submit, undefined);
  assert.equal(harness().input.focused, undefined);
});

test('category form interaction: nome vazio, whitespace e longo não enviam nem bloqueiam o botão', () => {
  for (const value of ['', '   ', '\n\t', 'a'.repeat(101)]) {
    const h = harness({ value });
    assert.equal(h.submit().prevented, true);
    assert.ok(h.input.validity);
    assert.equal(h.input.reported, true);
    assert.equal(h.button.disabled, false);
  }
});

test('category form interaction: envio válido permanece nativo, anuncia salvamento e impede envio repetido', () => {
  const h = harness({ value: '  Ingredientes  ' });
  assert.equal(h.submit().prevented, false);
  assert.equal(h.button.disabled, true);
  assert.equal(h.form.attributes['aria-busy'], 'true');
  assert.equal(h.label.textContent, 'Salvando…');
  assert.equal(h.submit().prevented, true);
  assert.doesNotMatch(source, /fetch\(|innerHTML|\.submit\(|requestAnimationFrame|setInterval/);
});

test('category form interaction: edição recupera feedback do campo e o servidor mantém última palavra', () => {
  const h = harness({ fieldError: true, value: 'Ingredientes' });
  assert.equal(h.input.focused, true);
  h.input.listeners.input();
  assert.equal(h.nameError.hidden, true);
  assert.equal(h.input.validity, '');
  assert.equal(h.input.attributes['aria-describedby'], 'category-name-hint');
  assert.equal(h.input.attributes['aria-invalid'], undefined);
});

test('category form interaction: erro de banco recebe foco, e histórico desbloqueia envio sem apagar nome', () => {
  const h = harness({ saveError: true, value: 'Bebidas' });
  assert.equal(h.formError.focused, true);
  assert.equal(h.input.focused, undefined);
  h.submit();
  h.window.listeners.pageshow({ persisted: true });
  assert.equal(h.input.value, 'Bebidas');
  assert.equal(h.button.disabled, false);
  assert.equal(h.label.textContent, 'Cadastrar categoria');
  assert.equal(h.form.attributes['aria-busy'], undefined);
  assert.equal(h.submit().prevented, false);
});
