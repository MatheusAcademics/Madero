(() => {
  'use strict';
  const page = document.querySelector('[data-movement-page]');
  if (!page) return;
  const form = page.querySelector('[data-movement-form]');
  if (!form) return;
  const product = form.querySelector('[data-movement-product]');
  const quantity = form.querySelector('[data-movement-quantity]');
  const button = form.querySelector('[data-movement-submit]');
  const label = form.querySelector('[data-movement-submit-label]');
  const preview = page.querySelector('[data-movement-preview]');
  const placeholder = page.querySelector('[data-preview-placeholder]');
  const previewPanel = page.querySelector('[data-preview-panel]');
  const productLabel = page.querySelector('[data-preview-product]');
  const current = page.querySelector('[data-preview-current]');
  const change = page.querySelector('[data-preview-change]');
  const next = page.querySelector('[data-preview-next]');
  const message = page.querySelector('[data-preview-message]');
  if (!product || !quantity || !button || !label || !preview || !placeholder || !productLabel || !current || !change || !next || !message) return;

  const originalLabel = label.textContent;
  const initiallyDisabled = button.disabled;
  const maxCents = 999999999999;
  const format = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  let submitting = false;

  // Trabalha em centavos para evitar saldos como 0,30000000000000004.
  const decimalCents = value => {
    if (typeof value !== 'string' || !/^-?\d+(?:\.\d{1,2})?$/.test(value.trim())) return null;
    const cents = Math.round(Number(value) * 100);
    return Number.isSafeInteger(cents) && Math.abs(cents) <= maxCents ? cents : null;
  };
  const quantityCents = () => {
    const cents = decimalCents(quantity.value);
    return cents !== null && cents > 0 ? cents : null;
  };
  const validateQuantity = () => {
    const valid = quantityCents() !== null;
    quantity.setCustomValidity(valid ? '' : 'Informe uma quantidade maior que zero, com até 2 casas decimais e no máximo 9.999.999.999,99.');
    return valid;
  };
  const setNumber = (element, cents, tone, sign = '') => {
    element.textContent = cents === null ? '—' : sign + format.format(cents / 100);
    element.setAttribute('data-tone', tone);
  };
  const stockTone = (cents, minimum) => cents <= 0 ? 'negative'
    : minimum === null ? 'neutral' : cents < minimum ? 'warning' : 'positive';

  const updatePreview = () => {
    const option = product.selectedOptions[0];
    const stock = option && product.value ? decimalCents(option.dataset.stock) : null;
    preview.hidden = stock === null;
    placeholder.hidden = stock !== null;
    if (stock === null) {
      placeholder.textContent = product.value
        ? 'Saldo indisponível para este produto. Não é possível calcular a prévia.'
        : 'Selecione um produto para conferir o saldo e a estimativa após a movimentação.';
      productLabel.textContent = '';
      setNumber(current, null, 'neutral');
      setNumber(change, null, 'neutral');
      setNumber(next, null, 'neutral');
      message.textContent = '';
      return;
    }

    const minimum = decimalCents(option.dataset.minimum);
    productLabel.textContent = option.textContent;
    setNumber(current, stock, stockTone(stock, minimum));
    setNumber(change, null, 'neutral');
    setNumber(next, null, 'neutral');
    const type = form.querySelector('[data-movement-type]:checked');
    if (!type || !['Entrada', 'Saída'].includes(type.value)) {
      message.textContent = 'Escolha entrada ou saída para calcular o saldo previsto.';
      return;
    }
    const amount = quantityCents();
    if (amount === null) {
      message.textContent = 'Informe uma quantidade válida para calcular o saldo previsto.';
      return;
    }
    const incoming = type.value === 'Entrada';
    const projected = stock + (incoming ? amount : -amount);
    setNumber(change, amount, incoming ? 'positive' : 'negative', incoming ? '+' : '−');
    if (!Number.isSafeInteger(projected) || Math.abs(projected) > maxCents) {
      message.textContent = 'O saldo previsto excede o limite de valores do estoque. Confira a quantidade.';
      return;
    }
    setNumber(next, projected, stockTone(projected, minimum));
    message.textContent = projected < 0 ? 'O saldo previsto ficará negativo. Confira o saldo consultado e a quantidade antes de salvar.'
      : projected === 0 ? 'O produto ficará sem estoque após esta movimentação.'
        : minimum === null ? 'Estoque mínimo não informado. Não é possível avaliar a reposição.'
          : projected < minimum ? 'O saldo previsto ficará abaixo do estoque mínimo.'
            : 'O saldo previsto atende ao estoque mínimo cadastrado.';
  };

  const fields = Array.from(form.querySelectorAll('input[name], select[name], textarea[name]'));
  const clearFieldError = field => {
    const name = field.name;
    const error = form.querySelector('[data-field-error="' + name + '"]');
    if (error) error.hidden = true;
    // Os dois radios compartilham a mesma mensagem de erro.
    fields.filter(input => input.name === name).forEach(input => {
      input.removeAttribute('aria-invalid');
      const description = (input.getAttribute('aria-describedby') || '').split(/\s+/)
        .filter(id => id && id !== name + '-error').join(' ');
      if (description) input.setAttribute('aria-describedby', description);
      else input.removeAttribute('aria-describedby');
    });
  };
  fields.forEach(field => {
    const edited = () => {
      clearFieldError(field);
      if (field === quantity) validateQuantity();
      if (field === quantity || field === product || field.name === 'tipo_movimentacao') updatePreview();
    };
    field.addEventListener('input', edited);
    field.addEventListener('change', edited);
  });
  form.addEventListener('submit', event => {
    if (submitting || initiallyDisabled) { event.preventDefault(); return; }
    if (!validateQuantity() || !form.checkValidity()) {
      event.preventDefault();
      form.reportValidity();
      return;
    }
    submitting = true;
    button.disabled = true;
    label.textContent = 'Salvando…';
    form.setAttribute('aria-busy', 'true');
  });
  window.addEventListener('pageshow', () => {
    submitting = false;
    button.disabled = initiallyDisabled;
    label.textContent = originalLabel;
    form.removeAttribute('aria-busy');
    validateQuantity();
    updatePreview();
  });
  validateQuantity();
  updatePreview();
  if (previewPanel) previewPanel.hidden = false;
  const summary = form.querySelector('[data-movement-error-summary]');
  if (summary) summary.focus();
})();
