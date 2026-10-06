(() => {
  'use strict';
  const form = document.querySelector('[data-product-edit-form]');
  if (!form) return;
  const keys = ['nome_produto', 'id_categoria', 'estoque_minimo', 'valor', 'imagem'];
  const fields = Object.fromEntries(keys.map(key => [key, form.elements.namedItem(key)]));
  const button = form.querySelector('[data-product-submit]');
  const label = form.querySelector('[data-product-submit-label]');
  if (keys.some(key => !fields[key]) || !button || !label) return;
  const originallyDisabled = button.disabled;
  const originalLabel = label.textContent;
  const preview = document.querySelector('[data-product-preview]');
  const summary = form.querySelector('[data-product-error-summary]');
  let submitting = false;

  // Centésimos inteiros, sem arredondar valores que o banco não pode armazenar.
  const cents = value => {
    const text = value.trim();
    if (!/^\d+(?:[.,]\d{1,2})?$/.test(text)) return null;
    const [whole, decimal = ''] = text.replace(',', '.').split('.');
    const integer = whole.replace(/^0+(?=\d)/, '');
    if (integer.length > 10) return null;
    return Number(integer) * 100 + Number(decimal.padEnd(2, '0'));
  };
  const safeImage = value => {
    if (!value) return true;
    if (value.length > 2048 || /[\s\\\u0000-\u001f\u007f]/.test(value)) return false;
    let decoded;
    try { decoded = decodeURIComponent(value); } catch (_) { return false; }
    if (/[\\\u0000-\u001f\u007f]/.test(decoded)) return false;
    if (value.startsWith('/')) return !value.startsWith('//') && !decoded.startsWith('//');
    try {
      const url = new URL(value);
      return /^https?:\/\//i.test(value) && ['http:', 'https:'].includes(url.protocol)
        && Boolean(url.hostname) && !url.username && !url.password;
    } catch (_) { return false; }
  };
  const selectedCategory = () => fields.id_categoria.selectedOptions[0];
  const validCategory = () => Boolean(fields.id_categoria.value && selectedCategory() && !selectedCategory().hasAttribute('data-unavailable'));
  const validate = key => {
    const value = fields[key].value.trim();
    let message = '';
    if (key === 'nome_produto') message = !value ? 'Informe o nome do produto.' : value.length > 100 ? 'Use no máximo 100 caracteres no nome.' : '';
    else if (key === 'id_categoria') message = validCategory() ? '' : 'Selecione uma categoria disponível.';
    else if (key === 'imagem') message = form.elements.namedItem('imagem_arquivo')?.files?.length || safeImage(value) ? '' : 'Use um link http/https ou um caminho local iniciado por /, com até 2048 caracteres.';
    else if (cents(value) === null) message = 'Informe um valor de 0 a 9.999.999.999,99, com até 2 casas decimais.';
    fields[key].setCustomValidity(message);
    return !message;
  };
  const output = key => preview?.querySelector('[data-preview-' + key + ']');
  const setText = (key, value) => { const target = output(key); if (target) target.textContent = value; };
  const number = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 2 });
  const money = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
  const updatePreview = () => {
    if (!preview) return;
    setText('name', fields.nome_produto.value.trim() || 'Nome do produto');
    setText('category', validCategory() ? selectedCategory().textContent : 'Selecione uma categoria');
    const rawStock = form.dataset.currentStock || '';
    const stock = /^-?\d{1,10}(?:\.\d{1,2})?$/.test(rawStock)
      ? cents(rawStock.replace(/^-/, '')) * (rawStock.startsWith('-') ? -1 : 1) : null;
    const minimum = cents(fields.estoque_minimo.value);
    const price = cents(fields.valor.value);
    setText('stock', stock === null ? 'Saldo indisponível' : number.format(stock / 100));
    if (output('stock')) output('stock').dataset.tone = stock !== null && stock < 0 ? 'negative' : 'neutral';
    setText('minimum', minimum === null ? '—' : number.format(minimum / 100));
    setText('price', price === null ? '—' : money.format(price / 100));
    const status = output('status');
    if (!status) return;
    const state = stock === null
      ? ['neutral', 'Saldo atual indisponível. Esta edição não modifica o estoque.']
      : minimum === null ? ['neutral', 'Preencha o estoque mínimo para conferir a situação.']
      : stock < 0 ? ['negative', 'O saldo consultado está negativo. Confira as movimentações registradas.']
      : stock < minimum ? ['warning', 'O saldo consultado está abaixo do mínimo informado.']
      : stock === 0 ? ['neutral', 'Produto sem saldo. Use uma entrada para atualizar o estoque.']
      : ['positive', 'O saldo consultado atende ao mínimo informado.'];
    status.dataset.tone = state[0];
    status.textContent = state[1];
  };

  keys.forEach(key => {
    const field = fields[key];
    const changed = () => {
      const valid = validate(key);
      if (valid) {
        field.removeAttribute('aria-invalid');
        const error = form.querySelector('[data-field-error="' + key + '"]');
        if (error) error.hidden = true;
        const ids = (field.getAttribute('aria-describedby') || '').split(/\s+/).filter(id => id !== key + '-error');
        field.setAttribute('aria-describedby', ids.join(' '));
      }
      updatePreview();
    };
    field.addEventListener('input', changed);
    field.addEventListener('change', changed);
  });
  form.addEventListener('submit', event => {
    if (submitting || originallyDisabled) { event.preventDefault(); return; }
    const valid = keys.map(validate).every(Boolean);
    if (!valid || !form.checkValidity()) {
      event.preventDefault();
      form.reportValidity();
      return;
    }
    submitting = true;
    button.disabled = true;
    label.textContent = 'Salvando…';
    form.setAttribute('aria-busy', 'true');
  });
  const restore = () => {
    submitting = false;
    button.disabled = originallyDisabled;
    label.textContent = originalLabel;
    form.removeAttribute('aria-busy');
    keys.forEach(key => fields[key].setCustomValidity(''));
    updatePreview();
  };
  window.addEventListener('pageshow', restore);
  if (preview) preview.hidden = false;
  updatePreview();
  if (summary) summary.focus();
})();
