(() => {
  'use strict';
  document.querySelectorAll('[data-avatar-image]').forEach(image => {
    const failed = () => { image.hidden = true; };
    image.addEventListener('error', failed);
    if (image.complete && !image.naturalWidth) failed();
  });
  document.querySelectorAll('[data-avatar-field]').forEach(field => {
    const picker = field.querySelector('[name="foto_arquivo"]');
    const image = field.querySelector('[data-avatar-preview]');
    const feedback = field.querySelector('[data-avatar-feedback]');
    const cancel = field.querySelector('[data-avatar-cancel]');
    const remove = field.querySelector('[name="remover_foto"]');
    const form = picker?.form;
    if (!picker || !image || !form || !feedback || !cancel) return;
    const original = /^\/uploads\/avatars\/[a-f0-9-]{36}\.webp$/i.test(field.dataset.avatarCurrent || '') ? field.dataset.avatarCurrent : '';
    const name = form.elements.namedItem('nome');
    const initial = field.querySelector('[data-avatar-initials]');
    let selected = null;
    let objectURL = '';
    const message = (text, error = false) => {
      feedback.textContent = text;
      feedback.dataset.state = error ? 'error' : '';
      picker.setCustomValidity(error ? text : '');
      if (error) picker.setAttribute('aria-invalid', 'true');
      else picker.removeAttribute('aria-invalid');
    };
    const release = () => {
      if (objectURL) URL.revokeObjectURL(objectURL);
      objectURL = '';
      image.removeAttribute('src');
      image.hidden = true;
    };
    const updateInitial = () => {
      if (initial && name) initial.textContent = Array.from(name.value.trim())[0]?.toLocaleUpperCase('pt-BR') || 'U';
    };
    const select = () => {
      release();
      selected = picker.files?.[0] || null;
      cancel.hidden = !selected;
      message('');
      field.querySelector('[data-field-error="foto_arquivo"]')?.setAttribute('hidden', '');
      picker.setAttribute('aria-describedby', 'foto_arquivo-hint foto_arquivo-feedback');
      if (!selected) {
        if (original && !remove?.checked) image.src = original;
        if (remove?.checked) message('A foto será removida ao salvar.');
        return;
      }
      if (remove) remove.checked = false;
      field.querySelector('[data-avatar-notice]')?.setAttribute('hidden', '');
      const error = selected.size > 5 * 1024 * 1024 ? 'Escolha uma foto de até 5 MB.'
        : !selected.size ? 'O arquivo está vazio. Escolha outra foto.'
          : !(['image/jpeg', 'image/png', 'image/webp'].includes(selected.type) || (!selected.type && /\.(jpe?g|png|webp)$/i.test(selected.name))) ? 'Escolha uma foto JPG, PNG ou WebP.' : '';
      if (error) return message(error, true);
      if (typeof URL.createObjectURL === 'function') {
        try { objectURL = URL.createObjectURL(selected); image.src = objectURL; }
        catch (_) { /* O envio nativo continua disponível mesmo sem prévia. */ }
      }
      message('Foto selecionada. Salve o cadastro para aplicar.');
    };
    image.addEventListener('load', () => {
      if (selected && image.naturalWidth * image.naturalHeight > 25_000_000) { image.hidden = true; return message('Escolha uma foto de até 25 megapixels.', true); }
      image.hidden = false;
    });
    image.addEventListener('error', () => {
      image.hidden = true;
      if (selected && objectURL) message('Não foi possível abrir esta foto. Escolha outro arquivo JPG, PNG ou WebP.', true);
    });
    picker.addEventListener('change', select);
    cancel.addEventListener('click', () => { picker.value = ''; select(); picker.focus(); });
    remove?.addEventListener('change', () => { if (remove.checked) picker.value = ''; select(); });
    name?.addEventListener('input', updateInitial);
    window.addEventListener('pagehide', release);
    window.addEventListener('pageshow', event => { if (event.persisted) select(); });
    updateInitial();
    if (image.complete && image.getAttribute('src') && !image.naturalWidth) image.hidden = true;
  });
})();
