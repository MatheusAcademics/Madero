(() => {
  'use strict';
  const form = document.querySelector('[data-category-form]');
  if (!form) return;
  const name = form.querySelector('[data-category-name]');
  const button = form.querySelector('[data-category-submit]');
  const label = form.querySelector('[data-category-submit-label]');
  const nameError = form.querySelector('[data-category-name-error]');
  const saveError = form.querySelector('[data-category-save-error]');
  if (!name || !button || !label) return;
  const originalLabel = label.textContent;
  let submitting = false;

  const validate = () => {
    const value = name.value.trim();
    name.setCustomValidity(!value ? 'Informe o nome da categoria.'
      : value.length > 100 ? 'Use no máximo 100 caracteres no nome da categoria.' : '');
    return Boolean(value && value.length <= 100);
  };
  name.addEventListener('input', () => {
    if (nameError) nameError.hidden = true;
    name.removeAttribute('aria-invalid');
    name.setAttribute('aria-describedby', 'category-name-hint');
    validate();
  });
  form.addEventListener('submit', (event) => {
    if (submitting) { event.preventDefault(); return; }
    if (!validate()) {
      event.preventDefault();
      name.reportValidity();
      return;
    }
    submitting = true;
    button.disabled = true;
    label.textContent = 'Salvando…';
    form.setAttribute('aria-busy', 'true');
  });
  window.addEventListener('pageshow', () => {
    submitting = false;
    button.disabled = false;
    label.textContent = originalLabel;
    form.removeAttribute('aria-busy');
    name.setCustomValidity('');
  });
  // Só desloca o foco quando o servidor retornou um erro, sem abrir o teclado na primeira visita.
  if (saveError) saveError.focus();
  else if (nameError) name.focus();
})();
