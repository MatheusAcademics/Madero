const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../public/js/movement-form.js'), 'utf8');

function harness({ present = true, hasForm = true, selected = '1', stock = '10.00', minimum = '5.00',
  quantity = '2.00', type = 'Entrada', disabled = false, summary = false,
  errors = [], valid = true, productName = 'Produto · ID 1' } = {}) {
  const element = extra => Object.assign({
    attributes: {}, listeners: {}, hidden: false, textContent: '',
    addEventListener(name, callback) { this.listeners[name] = callback; },
    setAttribute(name, value) { this.attributes[name] = value; },
    getAttribute(name) { return this.attributes[name] ?? null; },
    removeAttribute(name) { delete this.attributes[name]; },
    focus() { this.focused = true; },
  }, extra);
  const input = (name, value) => element({ name, value, validity: '',
    attributes: { 'aria-describedby': name + '-hint' + (errors.includes(name) ? ' ' + name + '-error' : ''),
      ...(errors.includes(name) ? { 'aria-invalid': 'true' } : {}) },
    setCustomValidity(value) { this.validity = value; },
  });
  const fields = {
    entrada: input('tipo_movimentacao', 'Entrada'),
    saida: input('tipo_movimentacao', 'Saída'),
    product: input('id_produto', selected),
    quantity: input('quantidade', quantity),
    date: input('data_movimentacao', '2026-09-29'),
    user: input('id_usuario', '1'),
    description: input('descricao', ''),
  };
  fields.entrada.checked = type === 'Entrada';
  fields.saida.checked = type === 'Saída';
  fields.product.selectedOptions = [{ dataset: { stock, minimum }, textContent: productName }];
  const button = element({ disabled });
  const label = element({ textContent: 'Salvar movimentação' });
  const errorSummary = summary ? element({}) : null;
  const errorElements = Object.fromEntries(errors.map(name => [name, element({})]));
  const preview = element({ hidden: true });
  const previewPanel = element({ hidden: true });
  const placeholder = element({ textContent: 'Selecione um produto' });
  const productLabel = element({});
  const current = element({});
  const change = element({});
  const next = element({});
  const message = element({});
  const form = element({
    querySelector(selector) {
      const selectors = {
        '[data-movement-product]': fields.product, '[data-movement-quantity]': fields.quantity,
        '[data-movement-submit]': button, '[data-movement-submit-label]': label,
        '[data-movement-type]:checked': fields.entrada.checked ? fields.entrada : fields.saida.checked ? fields.saida : null,
        '[data-movement-error-summary]': errorSummary,
      };
      for (const [name, error] of Object.entries(errorElements)) selectors['[data-field-error="' + name + '"]'] = error;
      return selectors[selector] ?? null;
    },
    querySelectorAll() { return Object.values(fields); },
    checkValidity() { return valid && !fields.quantity.validity; },
    reportValidity() { this.reported = true; },
  });
  const page = element({ querySelector(selector) {
    return {
      '[data-movement-form]': hasForm ? form : null,
      '[data-movement-preview]': preview, '[data-preview-placeholder]': placeholder,
      '[data-preview-panel]': previewPanel, '[data-preview-product]': productLabel,
      '[data-preview-current]': current, '[data-preview-change]': change,
      '[data-preview-next]': next, '[data-preview-message]': message,
    }[selector] ?? null;
  } });
  const window = element({});
  vm.runInNewContext(source, { document: { querySelector: () => present ? page : null }, window, Intl });
  return { ...fields, button, label, preview, previewPanel, placeholder, productLabel,
    current, change, next, message, form, window, errorElements, errorSummary,
    submit() {
      let prevented = false;
      form.listeners.submit?.({ preventDefault() { prevented = true; } });
      return prevented;
    },
    edit(fieldName, value, event = 'input') {
      if (value !== undefined) fields[fieldName].value = value;
      fields[fieldName].listeners[event]?.();
    },
    selectType(value) {
      fields.entrada.checked = value === 'Entrada'; fields.saida.checked = value === 'Saída';
      fields.entrada.listeners.change?.();
    },
  };
}

test('movement form interaction: escopo isolado, prévia progressiva e sem foco na primeira visita', () => {
  assert.equal(harness({ present: false }).form.listeners.submit, undefined);
  assert.equal(harness({ hasForm: false }).form.listeners.submit, undefined);
  const h = harness();
  assert.equal(h.previewPanel.hidden, false);
  for (const field of [h.product, h.quantity, h.user, h.date, h.entrada]) assert.equal(field.focused, undefined);
  assert.doesNotMatch(source, /fetch\(|innerHTML|\.submit\(|requestAnimationFrame|setInterval|setTimeout|localStorage|sessionStorage/);
});

test('movement form interaction: entradas e saídas usam sinais explícitos e cores no efeito do saldo', () => {
  const h = harness();
  assert.equal(h.current.textContent, '10,00');
  assert.equal(h.change.textContent, '+2,00');
  assert.equal(h.change.attributes['data-tone'], 'positive');
  assert.equal(h.next.textContent, '12,00');
  assert.equal(h.next.attributes['data-tone'], 'positive');
  assert.match(h.message.textContent, /atende ao estoque mínimo/);
  h.selectType('Saída');
  assert.equal(h.change.textContent, '−2,00');
  assert.equal(h.change.attributes['data-tone'], 'negative');
  assert.equal(h.next.textContent, '8,00');
  assert.equal(h.next.attributes['data-tone'], 'positive');
});

test('movement form interaction: mínimo estrito, zero e negativo têm rótulos coerentes sem proibir saldo negativo', () => {
  const rows = [
    { quantity: '5', value: '5,00', tone: 'positive', label: /atende ao estoque mínimo/ },
    { quantity: '5.01', value: '4,99', tone: 'warning', label: /abaixo do estoque mínimo/ },
    { quantity: '10', value: '0,00', tone: 'negative', label: /sem estoque/ },
    { quantity: '12', value: '-2,00', tone: 'negative', label: /saldo previsto ficará negativo/ },
  ];
  for (const row of rows) {
    const h = harness({ type: 'Saída', quantity: row.quantity });
    assert.equal(h.next.textContent, row.value);
    assert.equal(h.next.attributes['data-tone'], row.tone);
    assert.match(h.message.textContent, row.label);
    assert.equal(h.submit(), false);
  }
  const zeroMinimum = harness({ stock: '1', minimum: '0', type: 'Saída', quantity: '1' });
  assert.equal(zeroMinimum.next.attributes['data-tone'], 'negative');
  assert.match(zeroMinimum.message.textContent, /sem estoque/);
  assert.doesNotMatch(zeroMinimum.message.textContent, /abaixo do estoque mínimo/);
});

test('movement form interaction: saldo inicial negativo permanece verdadeiro inclusive em entradas', () => {
  const h = harness({ stock: '-5', minimum: '0', quantity: '2' });
  assert.equal(h.current.textContent, '-5,00');
  assert.equal(h.current.attributes['data-tone'], 'negative');
  assert.equal(h.next.textContent, '-3,00');
  assert.equal(h.change.textContent, '+2,00');
  assert.match(h.message.textContent, /negativo/);
  assert.doesNotMatch(h.message.textContent, /Esta saída/);
});

test('movement form interaction: saldo ausente ou inválido nunca é convertido em zero', () => {
  for (const stock of [undefined, null, '', ' ', 'NaN', 'Infinity', 'abc', '1e2', '1.234', '99999999999']) {
    const h = harness({ stock });
    // undefined ativa o padrão do harness; representa atributo ausente explicitamente abaixo.
    if (stock === undefined) {
      delete h.product.selectedOptions[0].dataset.stock;
      h.edit('product');
    }
    assert.equal(h.preview.hidden, true, String(stock));
    assert.equal(h.placeholder.hidden, false);
    assert.match(h.placeholder.textContent, /Saldo indisponível/);
    assert.equal(h.current.textContent, '—');
    assert.equal(h.next.textContent, '—');
  }
  const noProduct = harness({ selected: '' });
  assert.equal(noProduct.preview.hidden, true);
  assert.match(noProduct.placeholder.textContent, /^Selecione um produto/);
});

test('movement form interaction: mínimo desconhecido não recebe avaliação positiva inventada', () => {
  const h = harness({ minimum: '' });
  assert.equal(h.current.attributes['data-tone'], 'neutral');
  assert.equal(h.next.attributes['data-tone'], 'neutral');
  assert.match(h.message.textContent, /Estoque mínimo não informado/);
  const zero = harness({ stock: '2', minimum: '', quantity: '2', type: 'Saída' });
  assert.equal(zero.next.attributes['data-tone'], 'negative');
  assert.match(zero.message.textContent, /sem estoque/);
});

test('movement form interaction: sem tipo válido não inventa direção ou saldo projetado', () => {
  for (const type of ['', 'Ajuste', 'entrada']) {
    const h = harness({ type });
    assert.equal(h.preview.hidden, false);
    assert.equal(h.current.textContent, '10,00');
    assert.equal(h.change.textContent, '—');
    assert.equal(h.next.textContent, '—');
    assert.match(h.message.textContent, /Escolha entrada ou saída/);
  }
});

test('movement form interaction: quantidade inválida não salva e não fabrica prévia', () => {
  for (const quantity of ['', ' ', '0', '-0', '-1', '0.001', '1.999', '1,5', '1e3', '+2', 'Infinity', 'abc', '10000000000']) {
    const h = harness({ quantity });
    assert.equal(h.next.textContent, '—', quantity);
    assert.equal(h.change.textContent, '—');
    assert.ok(h.quantity.validity);
    assert.equal(h.submit(), true);
    assert.equal(h.form.reported, true);
    assert.equal(h.button.disabled, false);
    assert.equal(h.form.attributes['aria-busy'], undefined);
  }
});

test('movement form interaction: centésimos e limites têm cálculo exato sem projeção fora da coluna numeric', () => {
  const fractional = harness({ stock: '0.10', minimum: '0', quantity: '0.20' });
  assert.equal(fractional.next.textContent, '0,30');
  fractional.selectType('Saída');
  assert.equal(fractional.next.textContent, '-0,10');
  const max = harness({ stock: '0', quantity: '9999999999.99' });
  assert.equal(max.quantity.validity, '');
  assert.equal(max.next.textContent, '9.999.999.999,99');
  for (const options of [
    { stock: '9999999999.99', quantity: '0.01' },
    { stock: '-9999999999.99', quantity: '0.01', type: 'Saída' },
  ]) {
    const h = harness(options);
    assert.equal(h.next.textContent, '—');
    assert.equal(h.next.attributes['data-tone'], 'neutral');
    assert.match(h.message.textContent, /excede o limite/);
  }
});

test('movement form interaction: dados de produto são texto e trocar produto apaga a estimativa antiga', () => {
  const h = harness({ productName: '<img src=x onerror=alert(1)> · ID 1' });
  assert.equal(h.productLabel.textContent, '<img src=x onerror=alert(1)> · ID 1');
  h.product.selectedOptions[0] = { dataset: { stock: '3.25', minimum: '5' }, textContent: 'Outro produto' };
  h.edit('product', '2', 'change');
  assert.equal(h.productLabel.textContent, 'Outro produto');
  assert.equal(h.current.textContent, '3,25');
  assert.equal(h.current.attributes['data-tone'], 'warning');
  assert.equal(h.next.textContent, '5,25');
  h.edit('product', '', 'change');
  assert.equal(h.preview.hidden, true);
  assert.equal(h.productLabel.textContent, '');
  assert.equal(h.next.textContent, '—');
});

test('movement form interaction: envio nativo, checagem dos demais campos e bloqueio apenas durante salvamento', () => {
  const invalid = harness({ valid: false });
  assert.equal(invalid.submit(), true);
  assert.equal(invalid.form.reported, true);
  assert.equal(invalid.button.disabled, false);
  const h = harness();
  assert.equal(h.submit(), false);
  assert.equal(h.submit(), true);
  assert.equal(h.button.disabled, true);
  assert.equal(h.label.textContent, 'Salvando…');
  assert.equal(h.form.attributes['aria-busy'], 'true');
});

test('movement form interaction: somente o erro do campo editado some e radios limpam o erro compartilhado', () => {
  const h = harness({ errors: ['quantidade', 'id_produto', 'tipo_movimentacao'], summary: true });
  assert.equal(h.errorSummary.focused, true);
  assert.equal(h.quantity.focused, undefined);
  h.edit('quantity', '3.50');
  assert.equal(h.errorElements.quantidade.hidden, true);
  assert.equal(h.quantity.attributes['aria-describedby'], 'quantidade-hint');
  assert.equal(h.quantity.attributes['aria-invalid'], undefined);
  assert.equal(h.errorElements.id_produto.hidden, false);
  assert.equal(h.product.attributes['aria-invalid'], 'true');
  assert.equal(h.next.textContent, '13,50');
  h.selectType('Saída');
  for (const field of [h.entrada, h.saida]) {
    assert.equal(field.attributes['aria-invalid'], undefined);
    assert.equal(field.attributes['aria-describedby'], 'tipo_movimentacao-hint');
  }
  assert.equal(h.errorElements.tipo_movimentacao.hidden, true);
});

test('movement form interaction: BFCache reabilita envio e recalcula sem apagar valores nem desativação do servidor', () => {
  const h = harness();
  h.submit();
  h.quantity.value = '4.50';
  h.window.listeners.pageshow({ persisted: true });
  assert.equal(h.button.disabled, false);
  assert.equal(h.label.textContent, 'Salvar movimentação');
  assert.equal(h.form.attributes['aria-busy'], undefined);
  assert.equal(h.quantity.value, '4.50');
  assert.equal(h.next.textContent, '14,50');
  assert.equal(h.submit(), false);
  const unavailable = harness({ disabled: true });
  unavailable.window.listeners.pageshow({ persisted: true });
  assert.equal(unavailable.button.disabled, true);
  assert.equal(unavailable.submit(), true);
  assert.equal(unavailable.label.textContent, 'Salvar movimentação');
});
