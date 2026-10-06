const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const readSource = () => fs.readFileSync(path.join(__dirname, '../public/js/categories.js'), 'utf8');

function harness({ present = true, supported = true, throws = false, fallbackResult = false, requestSupported = true, incomplete = false } = {}) {
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
    querySelector(selector) {
      return incomplete ? null : { '[data-delete-name]': name, '[data-delete-cancel]': cancel, '[data-delete-confirm]': confirm }[selector];
    },
  });
  const nativeRequest = function () {
    this.requests++;
    if (this.onsubmit({ submitter: origin }) !== false) this.sent++;
  };
  const form = {
    dataset: { categoryName: '<img src=x onerror=alert(1)>' },
    requests: 0, sent: 0, fallbackCalls: 0,
    onsubmit() { this.fallbackCalls++; return fallbackResult; },
    requestSubmit: requestSupported ? nativeRequest : undefined,
  };
  const page = {
    querySelector(selector) { return selector === '[data-category-delete-dialog]' ? dialog : null; },
    querySelectorAll(selector) { return selector === '[data-delete-category]' ? [form] : []; },
  };
  const window = events({ confirm: () => fallbackResult });
  vm.runInNewContext(readSource(), {
    document: { querySelector: selector => present && selector === '[data-categories]' ? page : null, activeElement: origin }, window,
  });
  return { form, dialog, name, cancel, confirm, origin, window, submit: () => nativeRequest.call(form) };
}

test('categories dialog: unrelated pages, unsupported features and incomplete markup retain native confirmation', () => {
  for (const options of [{ present: false }, { supported: false }, { requestSupported: false }, { incomplete: true }]) {
    const h = harness(options);
    h.submit();
    assert.equal(h.form.fallbackCalls, 1);
    assert.equal(h.form.sent, 0);
    assert.equal(h.dialog.open, false);
  }
});

test('categories dialog: opening is non-destructive, names use text, cancel restores focus', () => {
  const h = harness();
  h.submit();
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

test('categories dialog: Escape cancels and confirmation sends the original form exactly once', () => {
  const h = harness();
  h.submit();
  let prevented = false;
  h.dialog.fire('cancel', { preventDefault() { prevented = true; } });
  assert.equal(prevented, true);
  assert.equal(h.form.sent, 0);
  assert.equal(h.origin.focused, true);
  h.submit();
  h.confirm.fire('click');
  h.confirm.fire('click');
  assert.equal(h.form.sent, 1);
  assert.equal(h.confirm.disabled, true);
  assert.equal(h.dialog.open, false);
  h.submit();
  assert.equal(h.form.sent, 1);
});

test('categories dialog: BFCache restoration clears pending approval and enables a fresh choice', () => {
  const h = harness();
  h.submit();
  h.confirm.fire('click');
  h.window.fire('pageshow', { persisted: true });
  assert.equal(h.confirm.disabled, false);
  assert.equal(h.dialog.open, false);
  h.confirm.fire('click');
  assert.equal(h.form.sent, 1);
  h.submit();
  assert.equal(h.dialog.open, true);
  h.cancel.fire('click');
  assert.equal(h.form.sent, 1);
});

test('categories dialog: failed showModal falls back to native confirmation without silently deleting', () => {
  for (const fallbackResult of [false, true]) {
    const h = harness({ throws: true, fallbackResult });
    h.submit();
    assert.equal(h.form.fallbackCalls, 1);
    assert.equal(h.form.sent, fallbackResult ? 1 : 0);
  }
  assert.doesNotMatch(readSource(), /innerHTML|fetch\(|\.submit\(|requestAnimationFrame|setInterval/);
});
