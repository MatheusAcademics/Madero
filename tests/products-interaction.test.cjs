const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../public/js/products.js'), 'utf8');

function harness({ present = true, supported = true, throws = false, fallbackResult = false } = {}) {
  const events = target => Object.assign(target, {
    listeners: {}, addEventListener(name, callback) { this.listeners[name] = callback; },
    fire(name, event = {}) { return this.listeners[name]?.(event); },
    focus() { this.focused = true; },
  });
  const name = { textContent: '' };
  const cancel = events({});
  const confirm = events({ disabled: false });
  const origin = events({});
  const dialog = events({
    open: false,
    showModal: supported ? function () { if (throws) throw new Error('Unavailable'); this.open = true; } : undefined,
    close() { this.open = false; },
    querySelector(selector) { return { '[data-delete-name]': name, '[data-delete-cancel]': cancel, '[data-delete-confirm]': confirm }[selector]; },
  });
  const form = {
    dataset: { productName: '<img src=x onerror=alert(1)>' },
    requests: 0, sent: 0, fallbackCalls: 0,
    onsubmit() { this.fallbackCalls++; return fallbackResult; },
    requestSubmit() { this.requests++; if (this.onsubmit({ submitter: origin }) !== false) this.sent++; },
  };
  const page = { querySelector: () => dialog, querySelectorAll: () => [form] };
  const window = events({ confirm: () => fallbackResult });
  vm.runInNewContext(source, {
    document: { querySelector: () => present ? page : null, activeElement: origin }, window,
  });
  return { form, dialog, name, cancel, confirm, origin, window };
}

test('products dialog: unavailable or unrelated pages retain native confirmation', () => {
  for (const options of [{ present: false }, { supported: false }]) {
    const { form, dialog } = harness(options);
    form.requestSubmit();
    assert.equal(form.fallbackCalls, 1);
    assert.equal(form.sent, 0);
    assert.equal(dialog.open, false);
  }
});

test('products dialog: open and cancel never submit, names are text, focus returns to the action', () => {
  const h = harness();
  h.form.requestSubmit();
  assert.equal(h.form.sent, 0);
  assert.equal(h.dialog.open, true);
  assert.equal(h.name.textContent, '<img src=x onerror=alert(1)>');
  assert.equal(h.cancel.focused, true);
  h.cancel.fire('click');
  assert.equal(h.dialog.open, false);
  assert.equal(h.origin.focused, true);
  h.confirm.fire('click');
  assert.equal(h.form.sent, 0);
});

test('products dialog: Escape cancels; confirming submits the original form only once', () => {
  const h = harness();
  h.form.requestSubmit();
  let prevented = false;
  h.dialog.fire('cancel', { preventDefault() { prevented = true; } });
  assert.equal(prevented, true);
  assert.equal(h.form.sent, 0);
  h.form.requestSubmit();
  h.confirm.fire('click');
  h.confirm.fire('click');
  assert.equal(h.form.sent, 1);
  assert.equal(h.confirm.disabled, true);
  assert.equal(h.dialog.open, false);
  h.form.requestSubmit();
  assert.equal(h.form.sent, 1);
});

test('products dialog: BFCache restoration resets confirmation and supports a new choice', () => {
  const h = harness();
  h.form.requestSubmit();
  h.confirm.fire('click');
  h.window.fire('pageshow', { persisted: true });
  assert.equal(h.confirm.disabled, false);
  assert.equal(h.dialog.open, false);
  h.confirm.fire('click');
  assert.equal(h.form.sent, 1);
  h.form.requestSubmit();
  assert.equal(h.dialog.open, true);
  h.cancel.fire('click');
  assert.equal(h.form.sent, 1);
});

test('products dialog: failed showModal uses native confirmation, never a silent delete', () => {
  for (const fallbackResult of [false, true]) {
    const h = harness({ throws: true, fallbackResult });
    h.form.requestSubmit();
    assert.equal(h.form.fallbackCalls, 1);
    assert.equal(h.form.sent, fallbackResult ? 1 : 0);
  }
  assert.doesNotMatch(source, /innerHTML|fetch\(|\.submit\(|requestAnimationFrame|setInterval/);
});
