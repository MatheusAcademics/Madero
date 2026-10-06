(() => {
  'use strict';

  const page = document.querySelector('[data-products]');
  const dialog = page?.querySelector('[data-product-delete-dialog]');
  if (!dialog || typeof dialog.showModal !== 'function') return;
  const name = dialog.querySelector('[data-delete-name]');
  const cancel = dialog.querySelector('[data-delete-cancel]');
  const confirm = dialog.querySelector('[data-delete-confirm]');
  if (!name || !cancel || !confirm) return;

  let pending = null;
  let origin = null;
  let approved = null;
  let submitting = false;
  const forms = [...page.querySelectorAll('[data-delete-product]')];

  const dismiss = () => {
    pending = null;
    approved = null;
    if (dialog.open) dialog.close();
    origin?.focus();
    origin = null;
  };

  forms.forEach((form) => {
    if (typeof form.requestSubmit !== 'function') return;
    const fallback = form.onsubmit;
    form.onsubmit = function (event) {
      if (approved === form) {
        approved = null;
        return true;
      }
      if (submitting) return false;
      try {
        pending = form;
        origin = event.submitter || document.activeElement;
        name.textContent = form.dataset.productName || 'este produto';
        dialog.showModal();
        cancel.focus();
        return false;
      } catch (_) {
        pending = null;
        return typeof fallback === 'function'
          ? fallback.call(form, event)
          : window.confirm('Excluir este produto? Esta ação não pode ser desfeita.');
      }
    };
  });

  cancel.addEventListener('click', dismiss);
  dialog.addEventListener('cancel', (event) => {
    event.preventDefault();
    dismiss();
  });
  confirm.addEventListener('click', () => {
    if (!pending || submitting) return;
    const target = pending;
    pending = null;
    approved = target;
    submitting = true;
    confirm.disabled = true;
    if (dialog.open) dialog.close();
    target.requestSubmit();
  });
  window.addEventListener('pageshow', () => {
    submitting = false;
    confirm.disabled = false;
    dismiss();
  });
})();
