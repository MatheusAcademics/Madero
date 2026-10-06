const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../public/js/product-image.js'), 'utf8') + '\n'
  + fs.readFileSync(path.join(__dirname, '../public/js/product-form.js'), 'utf8');
const editSource = fs.readFileSync(path.join(__dirname, '../public/js/product-image.js'), 'utf8') + '\n'
  + fs.readFileSync(path.join(__dirname, '../public/js/product-edit.js'), 'utf8');

function harness({ present = true, previewPresent = true, disabled = false, summary = false,
  errors = [], valid = true, categoryAvailable = true, categoryName = 'Ingredientes · ID 4', values = {}, withUpload = false, editPage = false } = {}) {
  const element = extra => Object.assign({
    attributes: {}, dataset: {}, listeners: {}, hidden: false, textContent: '',
    addEventListener(name, callback) {
      const previous = this.listeners[name];
      this.listeners[name] = previous ? event => { previous(event); callback(event); } : callback;
    },
    setAttribute(name, value) { this.attributes[name] = String(value); },
    getAttribute(name) { return this.attributes[name] ?? null; },
    hasAttribute(name) { return Object.hasOwn(this.attributes, name); },
    removeAttribute(name) { delete this.attributes[name]; },
    focus() { this.focused = true; },
  }, extra);
  const initial = { [editPage ? 'nome_produto' : 'nome']: 'Queijo', estoque: '12.50', estoque_minimo: '3.00', valor: '25.90', imagem: '', id_categoria: '4', ...values };
  const fields = Object.fromEntries(Object.entries(initial).map(([name, value]) => [name, element({
    name, value, validity: '',
    attributes: { 'aria-describedby': name + '-hint' + (errors.includes(name) ? ' ' + name + '-error' : ''),
      ...(errors.includes(name) ? { 'aria-invalid': 'true' } : {}) },
    setCustomValidity(message) { this.validity = message; },
  })]));
  if (withUpload) {
    const picker = element({ name: 'imagem_arquivo', files: [], validity: '', attributes: {
      'aria-describedby': 'imagem_arquivo-hint imagem-feedback' + (errors.includes('imagem_arquivo') ? ' imagem_arquivo-error' : '')
    }, setCustomValidity(message) { this.validity = message; this.validationMessage = message; } });
    Object.defineProperty(picker, 'value', { get() { return this.files[0]?.name || ''; }, set(value) { if (!value) this.files = []; } });
    fields.imagem_arquivo = picker;
  }
  const uploadNodes = Object.fromEntries(['selection', 'filename', 'clear', 'feedback', 'preview', 'preview-image'].map(name => [name, element({ hidden: true })]));
  const option = element({ textContent: categoryName, value: initial.id_categoria,
    attributes: categoryAvailable ? {} : { 'data-unavailable': '' } });
  fields.id_categoria.options = [option];
  fields.id_categoria.selectedOptions = [option];
  fields.id_categoria.selectedIndex = 0;
  const button = element({ disabled });
  const label = element({ textContent: 'Cadastrar produto' });
  const errorSummary = summary ? element({}) : null;
  const errorElements = Object.fromEntries(errors.map(name => [name, element({})]));
  const nodes = Object.fromEntries(['name', 'category', 'stock', 'minimum', 'price', 'status', 'image', 'image-placeholder', 'image-message'].map(name => [name, element({ hidden: name === 'image' })]));
  nodes.image.complete = false;
  nodes.image.naturalWidth = 0;
  const imageRequests = [];
  Object.defineProperty(nodes.image, 'src', { get() { return this.attributes.src || ''; }, set(value) { this.attributes.src = value; imageRequests.push(value); } });
  nodes.image.setAttribute = function(name, value) { this.attributes[name] = String(value); if (name === 'src') imageRequests.push(value); };
  const preview = element({ hidden: true, querySelector(selector) {
    return nodes[selector.match(/^\[data-preview-([\w-]+)\]$/)?.[1]] ?? null;
  } });
  const form = element({
    dataset: { currentStock: '12.50' },
    elements: { namedItem(name) { return fields[name] ?? null; } },
    querySelector(selector) {
      const standard = { '[data-product-submit]': button, '[data-product-submit-label]': label,
        '[data-product-error-summary]': errorSummary };
      const fieldName = selector.match(/^\[name="([\w_]+)"\]$/)?.[1];
      const errorName = selector.match(/^\[data-field-error="([\w_]+)"\]$/)?.[1];
      const uploadName = selector.match(/^\[data-upload-([\w-]+)\]$/)?.[1];
      return standard[selector] ?? fields[fieldName] ?? errorElements[errorName] ?? (withUpload ? uploadNodes[uploadName] : null) ?? null;
    },
    querySelectorAll() { return Object.values(fields); },
    checkValidity() { return valid && Object.values(fields).every(field => !field.validity); },
    reportValidity() { this.reported = true; },
  });
  const window = element({ location: { href: 'http://localhost:3000/produtos/novo_produto', origin: 'http://localhost:3000' } });
  const document = { baseURI: window.location.href, querySelector(selector) {
    if (selector === '[data-product-form]') return present && !editPage ? form : null;
    if (selector === '[data-product-edit-form]') return present && editPage ? form : null;
    if (selector === '[data-product-preview]') return previewPresent ? preview : null;
    return preview.querySelector(selector);
  } };
  const blobs = [], revoked = [];
  class TestURL extends URL {
    static createObjectURL(file) { const url = 'blob:test/' + (blobs.length + 1); blobs.push({ file, url }); return url; }
    static revokeObjectURL(url) { revoked.push(url); }
  }
  vm.runInNewContext(editPage ? editSource : source, { document, window, Intl, URL: TestURL });
  return { fields, button, label, form, preview, nodes, window, errorElements, errorSummary, imageRequests, uploadNodes, blobs, revoked,
    selectFile(file) { fields.imagem_arquivo.files = file ? [file] : []; fields.imagem_arquivo.listeners.change?.(); },
    submit() { let prevented = false; form.listeners.submit?.({ preventDefault() { prevented = true; } }); return prevented; },
    edit(name, value, event = 'input') { if (value !== undefined) fields[name].value = value; fields[name].listeners[event]?.(); },
    imageLoaded() { nodes.image.complete = true; nodes.image.naturalWidth = 100; nodes.image.listeners.load?.(); },
    imageFailed() { nodes.image.complete = true; nodes.image.naturalWidth = 0; nodes.image.listeners.error?.(); },
  };
}

test('product form interaction: scoped progressive enhancement without background writes or focus stealing', () => {
  assert.equal(harness({ present: false }).form.listeners.submit, undefined);
  const h = harness();
  assert.equal(h.preview.hidden, false);
  for (const field of Object.values(h.fields)) assert.equal(field.focused, undefined);
  assert.doesNotMatch(source, /fetch\(|innerHTML|\.submit\(|requestAnimationFrame|setInterval|localStorage|sessionStorage/);
});

for (const editPage of [false, true]) {
  const operation = editPage ? 'edit' : 'create';
  test(`product file preview ${operation}: picked image is immediate, safely named and takes priority over a bad link`, () => {
    const h = harness({ withUpload: true, editPage, values: { imagem: 'javascript:bad()' }, errors: ['imagem', 'imagem_arquivo'] });
    h.selectFile({ name: '<b>foto.png</b>', type: 'image/png', size: 2000 });
    assert.equal(h.imageRequests.at(-1), 'blob:test/1');
    assert.equal(h.fields.imagem.readOnly, true);
    assert.equal(h.uploadNodes.filename.textContent, '<b>foto.png</b>');
    assert.equal(h.errorElements.imagem.hidden, true);
    assert.equal(h.errorElements.imagem_arquivo.hidden, true);
    assert.equal(h.fields.imagem_arquivo.attributes['aria-describedby'], 'imagem_arquivo-hint imagem-feedback');
    h.imageLoaded();
    assert.equal(h.uploadNodes.preview.hidden, false);
    assert.equal(h.uploadNodes['preview-image'].src, 'blob:test/1');
    assert.equal(h.submit(), false);
  });

  test(`product file preview ${operation}: cancel keeps the previous image link and releases the local preview`, () => {
    const h = harness({ withUpload: true, editPage, values: { imagem: '/img/original.jpg' } });
    h.selectFile({ name: 'foto.jpg', type: 'image/jpeg', size: 300 });
    h.uploadNodes.clear.listeners.click();
    assert.equal(h.fields.imagem_arquivo.files.length, 0);
    assert.equal(h.fields.imagem.readOnly, false);
    assert.equal(h.fields.imagem.value, '/img/original.jpg');
    assert.equal(h.imageRequests.at(-1), '/img/original.jpg');
    assert.deepEqual(h.revoked, ['blob:test/1']);
    assert.equal(h.uploadNodes.selection.hidden, true);
    assert.equal(h.fields.imagem_arquivo.focused, true);
  });

  test(`product file preview ${operation}: invalid type, size, empty and corrupt files cannot submit`, () => {
    for (const file of [{ name: 'x.png', type: 'image/png', size: 5 * 1024 * 1024 + 1 },
      { name: 'x.svg', type: 'image/svg+xml', size: 300 }, { name: 'x.png', type: 'image/png', size: 0 },
      { name: 'x.html', type: '', size: 300 }]) {
      const h = harness({ withUpload: true, editPage });
      h.selectFile(file);
      assert.ok(h.fields.imagem_arquivo.validity);
      assert.equal(h.submit(), true);
      assert.equal(h.imageRequests.length, 0);
      assert.equal(h.button.disabled, false);
      assert.ok(h.uploadNodes.feedback.textContent);
    }
    const h = harness({ withUpload: true, editPage });
    h.selectFile({ name: 'x.jpg', type: 'image/jpeg', size: 500 });
    h.imageFailed();
    assert.ok(h.fields.imagem_arquivo.validity);
    assert.equal(h.submit(), true);
    h.selectFile({ name: 'ok.webp', type: 'image/webp', size: 500 });
    h.imageLoaded();
    assert.equal(h.submit(), false);
  });

  test(`product file preview ${operation}: pixel limits block huge images and replacing/returning does not leak object URLs`, () => {
    const h = harness({ withUpload: true, editPage });
    h.selectFile({ name: 'x.png', type: 'image/png', size: 300 });
    h.nodes.image.naturalWidth = 5100;
    h.nodes.image.naturalHeight = 5000;
    h.nodes.image.listeners.load();
    assert.ok(h.fields.imagem_arquivo.validity);
    assert.equal(h.submit(), true);
    h.selectFile({ name: 'ok.png', type: '', size: 300 });
    h.nodes.image.naturalHeight = 30;
    h.imageLoaded();
    assert.deepEqual(h.revoked, ['blob:test/1']);
    h.window.listeners.pagehide();
    assert.deepEqual(h.revoked, ['blob:test/1', 'blob:test/2']);
    h.window.listeners.pageshow({ persisted: true });
    assert.equal(h.imageRequests.at(-1), 'blob:test/3');
    assert.equal(h.fields.imagem_arquivo.files[0].name, 'ok.png');
    assert.equal(h.submit(), false);
  });
}

test('product form interaction: preview uses literal text and accurate locale numeric values', () => {
  const h = harness({ values: { nome: '<img src=x onerror=alert(1)>', estoque: '0,10', estoque_minimo: '0.20', valor: '25,90' }, categoryName: '<script>bad</script>' });
  assert.equal(h.nodes.name.textContent, '<img src=x onerror=alert(1)>');
  assert.equal(h.nodes.category.textContent, '<script>bad</script>');
  assert.equal(h.nodes.stock.textContent, '0,1');
  assert.equal(h.nodes.minimum.textContent, '0,2');
  assert.match(h.nodes.price.textContent, /25,90/);
  assert.equal(h.nodes.status.dataset.tone, 'warning');
});

test('product form interaction: blank and invalid values never turn into zero or a healthy stock status', () => {
  for (const estoque of ['', ' ', '-1', 'NaN', 'Infinity', '1e3', '1.234', '1,234', '10000000000']) {
    const h = harness({ values: { estoque, estoque_minimo: '', valor: '' } });
    assert.equal(h.nodes.stock.textContent, '—', estoque);
    assert.equal(h.nodes.minimum.textContent, '—');
    assert.equal(h.nodes.price.textContent, '—');
    assert.equal(h.nodes.status.dataset.tone, 'neutral');
    assert.doesNotMatch(h.nodes.status.textContent, /atende|dentro do mínimo|em dia/);
  }
});

test('product form interaction: decimals support exact cents, maximum and leading zeros', () => {
  for (const estoque of ['0', '0.01', '0,01', '9999999999.99', '00001,20']) {
    const h = harness({ values: { estoque, estoque_minimo: '0', valor: '0' } });
    assert.notEqual(h.nodes.stock.textContent, '—', estoque);
    assert.equal(h.submit(), false, estoque);
  }
});

test('product form interaction: strict minimum and no-stock states do not invent replenishment at zero minimum', () => {
  const equal = harness({ values: { estoque: '3', estoque_minimo: '3' } });
  assert.notEqual(equal.nodes.status.dataset.tone, 'warning');
  const below = harness({ values: { estoque: '2.99', estoque_minimo: '3' } });
  assert.equal(below.nodes.status.dataset.tone, 'warning');
  assert.match(below.nodes.status.textContent, /abaixo/);
  const zero = harness({ values: { estoque: '0', estoque_minimo: '0' } });
  assert.equal(zero.nodes.stock.textContent, '0');
  assert.doesNotMatch(zero.nodes.status.textContent, /abaixo/);
});

test('product form interaction: invalid numeric drafts cannot submit and remain editable', () => {
  for (const name of ['estoque', 'estoque_minimo', 'valor']) for (const value of ['', '-1', '1e3', '1.001', '10000000000']) {
    const h = harness({ values: { [name]: value } });
    assert.equal(h.submit(), true, `${name}: ${value}`);
    assert.ok(h.fields[name].validity);
    assert.equal(h.fields[name].value, value);
    assert.equal(h.button.disabled, false);
    assert.equal(h.form.attributes['aria-busy'], undefined);
  }
});

test('product form interaction: name and category validation include stale category option', () => {
  for (const options of [{ values: { nome: '   ' } }, { values: { nome: 'a'.repeat(101) } }, { values: { id_categoria: '' } }, { categoryAvailable: false }]) {
    const h = harness(options);
    assert.equal(h.submit(), true);
    assert.equal(h.button.disabled, false);
  }
});

test('product form interaction: unsafe image sources are not requested and block submission', () => {
  for (const imagem of ['javascript:alert(1)', 'data:image/svg+xml,<svg/>', '//example.com/x.jpg', '/%2fexample.com/x.jpg', '/\\example.com/x.jpg', 'https://user:pass@example.com/x.jpg', 'https://example.com/\\evil', 'https://example.com/%0ax.jpg']) {
    const h = harness({ values: { imagem } });
    assert.equal(h.imageRequests.length, 0, imagem);
    assert.equal(h.nodes.image.hidden, true);
    assert.equal(h.submit(), true, imagem);
    assert.ok(h.fields.imagem.validity);
  }
});

test('product form interaction: image preview changes only after committed change and gracefully handles failure', () => {
  const h = harness();
  assert.equal(h.imageRequests.length, 0);
  h.edit('imagem', 'https://example.com/queijo.jpg');
  assert.equal(h.imageRequests.length, 0);
  h.edit('imagem', undefined, 'change');
  assert.equal(h.imageRequests.length, 1);
  h.imageLoaded();
  assert.equal(h.nodes.image.hidden, false);
  assert.equal(h.nodes['image-placeholder'].hidden, true);
  h.edit('imagem', '/img/other.jpg', 'change');
  assert.equal(h.imageRequests.length, 2);
  h.imageFailed();
  assert.equal(h.nodes.image.hidden, true);
  assert.equal(h.nodes['image-placeholder'].hidden, false);
  assert.match(h.nodes['image-message'].textContent, /não|indisponível/i);
  assert.equal(h.submit(), false, 'A broken optional image does not prevent the product being saved');
});

test('product form interaction: clearing an image restores the placeholder without fetching an empty URL', () => {
  const h = harness({ values: { imagem: '/img/queijo.jpg' } });
  h.imageLoaded();
  h.edit('imagem', '', 'change');
  assert.equal(h.imageRequests.length, 1);
  assert.equal(h.nodes.image.hidden, true);
  assert.equal(h.nodes['image-placeholder'].hidden, false);
  assert.equal(h.nodes.image.getAttribute('src'), null);
});

test('product form interaction: edits clear only corresponding server error and preserve other hints', () => {
  const h = harness({ errors: ['estoque', 'nome'], summary: true });
  assert.equal(h.errorSummary.focused, true);
  h.edit('estoque', '2,50');
  assert.equal(h.errorElements.estoque.hidden, true);
  assert.equal(h.fields.estoque.attributes['aria-invalid'], undefined);
  assert.equal(h.fields.estoque.attributes['aria-describedby'], 'estoque-hint');
  assert.equal(h.errorElements.nome.hidden, false);
  assert.equal(h.fields.nome.attributes['aria-invalid'], 'true');
  assert.equal(h.nodes.stock.textContent, '2,5');
});

test('product form interaction: native submission has duplicate protection and respects other native constraints', () => {
  const invalid = harness({ valid: false });
  assert.equal(invalid.submit(), true);
  assert.equal(invalid.form.reported, true);
  const h = harness();
  assert.equal(h.submit(), false);
  assert.equal(h.submit(), true);
  assert.equal(h.button.disabled, true);
  assert.equal(h.form.attributes['aria-busy'], 'true');
});

test('product form interaction: BFCache restores submission without losing draft or overriding server-disabled button', () => {
  const h = harness();
  h.submit();
  h.fields.estoque.value = '8.50';
  h.window.listeners.pageshow({ persisted: true });
  assert.equal(h.button.disabled, false);
  assert.equal(h.label.textContent, 'Cadastrar produto');
  assert.equal(h.form.attributes['aria-busy'], undefined);
  assert.equal(h.fields.estoque.value, '8.50');
  assert.equal(h.nodes.stock.textContent, '8,5');
  assert.equal(h.submit(), false);
  const disabled = harness({ disabled: true });
  disabled.window.listeners.pageshow({ persisted: true });
  assert.equal(disabled.button.disabled, true);
  assert.equal(disabled.submit(), true);
});
