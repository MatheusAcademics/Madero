(() => {
  'use strict';
  const form = document.querySelector('[data-product-form]') || document.querySelector('[data-product-edit-form]');
  if (!form) return;
  const link = form.elements.namedItem('imagem');
  const picker = form.elements.namedItem('imagem_arquivo');
  const preview = document.querySelector('[data-product-preview]');
  const output = key => preview?.querySelector('[data-preview-' + key + ']');
  const inline = form.querySelector('[data-upload-preview]');
  const inlineImage = form.querySelector('[data-upload-preview-image]');
  const image = output('image') || inlineImage;
  const placeholder = output('image-placeholder');
  const feedback = form.querySelector('[data-upload-feedback]');
  const selection = form.querySelector('[data-upload-selection]');
  const filename = form.querySelector('[data-upload-filename]');
  if (!link || !image) return;
  let selected = null;
  let objectURL = '';
  let source = '';

  const message = text => {
    if (output('image-message')) output('image-message').textContent = text;
    if (feedback) feedback.textContent = text;
  };
  const hide = text => {
    image.hidden = true;
    if (placeholder) placeholder.hidden = false;
    if (inline) inline.hidden = true;
    message(text);
  };
  const clearError = field => {
    if (!field) return;
    field.removeAttribute('aria-invalid');
    const error = form.querySelector('[data-field-error="' + field.name + '"]');
    if (error) error.hidden = true;
    const ids = (field.getAttribute('aria-describedby') || '').split(/\s+/).filter(id => id !== field.name + '-error');
    field.setAttribute('aria-describedby', ids.join(' '));
  };
  const safeLink = value => {
    if (!value || value.length > 2048 || /[\s\\\u0000-\u001f\u007f]/.test(value)) return false;
    try {
      const decoded = decodeURIComponent(value);
      if (/[\\\u0000-\u001f\u007f]/.test(decoded)) return false;
      if (value.startsWith('/')) return !value.startsWith('//') && !decoded.startsWith('//');
      const url = new URL(value);
      return /^https?:\/\//i.test(value) && ['http:', 'https:'].includes(url.protocol)
        && Boolean(url.hostname) && !url.username && !url.password;
    } catch (_) { return false; }
  };
  const release = () => {
    if (objectURL) URL.revokeObjectURL(objectURL);
    objectURL = '';
    source = '';
    image.removeAttribute('src');
    if (inlineImage && inlineImage !== image) inlineImage.removeAttribute('src');
  };
  const update = () => {
    const value = selected ? objectURL : link.value.trim();
    if (value && value === source) return;
    source = '';
    image.removeAttribute('src');
    if (inlineImage && inlineImage !== image) inlineImage.removeAttribute('src');
    if (selected && !objectURL) return hide(picker.validationMessage || 'Arquivo selecionado. A imagem será conferida ao salvar.');
    hide(value ? 'Confira o endereço da imagem.' : 'Nenhuma imagem adicionada.');
    if (!value || (!selected && !safeLink(value))) return;
    source = value;
    hide('Carregando prévia…');
    image.src = value;
  };
  const selectFile = () => {
    const next = picker?.files?.[0] || null;
    if (next === selected && (!next || objectURL)) return;
    release();
    selected = next;
    if (picker) { picker.setCustomValidity(''); clearError(picker); }
    link.readOnly = Boolean(selected);
    if (selection) selection.hidden = !selected;
    if (filename) filename.textContent = selected ? selected.name : '';
    if (selected) {
      const notice = form.querySelector('[data-upload-notice]');
      if (notice) notice.hidden = true;
      link.setCustomValidity('');
      clearError(link);
      const error = selected.size > 5 * 1024 * 1024 ? 'A imagem deve ter no máximo 5 MB.'
        : !selected.size ? 'Este arquivo está vazio. Escolha outra imagem.'
          : !(['image/jpeg', 'image/png', 'image/webp'].includes(selected.type)
            || (!selected.type && /\.(jpe?g|png|webp)$/i.test(selected.name))) ? 'Escolha uma imagem JPG, PNG ou WebP.' : '';
      if (error) {
        picker.setCustomValidity(error);
        picker.setAttribute('aria-invalid', 'true');
        hide(error);
        return;
      }
      if (typeof URL.createObjectURL === 'function') objectURL = URL.createObjectURL(selected);
    }
    update();
  };
  image.addEventListener('load', () => {
    if (!source) return;
    if (selected && image.naturalWidth * image.naturalHeight > 25_000_000) {
      const error = 'Esta imagem é muito grande. Escolha uma imagem de até 25 megapixels.';
      picker.setCustomValidity(error);
      picker.setAttribute('aria-invalid', 'true');
      return hide(error);
    }
    image.hidden = false;
    if (placeholder) placeholder.hidden = true;
    if (inlineImage && inlineImage !== image) inlineImage.src = source;
    if (inline) inline.hidden = false;
    message(selected ? 'Prévia do arquivo selecionado. Salve para aplicar ao produto.' : 'Prévia da imagem informada.');
  });
  image.addEventListener('error', () => {
    if (!source) return;
    const error = selected ? 'Não foi possível abrir este arquivo. Escolha outra imagem JPG, PNG ou WebP.'
      : 'Este endereço não carregou uma imagem. Use o link direto da foto ou escolha um arquivo.';
    if (selected) { picker.setCustomValidity(error); picker.setAttribute('aria-invalid', 'true'); }
    hide(error);
    source = '';
  });
  picker?.addEventListener('change', selectFile);
  form.querySelector('[data-upload-clear]')?.addEventListener('click', () => {
    picker.value = '';
    selectFile();
    picker.focus();
  });
  link.addEventListener('change', update);
  window.addEventListener('pagehide', release);
  window.addEventListener('pageshow', () => { selectFile(); update(); });
  selectFile();
  update();
})();
