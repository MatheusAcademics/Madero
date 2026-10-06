(() => {
  'use strict';
  const form = document.querySelector('[data-user-form]');
  if (!form) return;
  const keys = ['nome', 'usuario', 'email', 'telefone', 'senha', 'confirmar_senha'];
  const fields = Object.fromEntries(keys.map(key => [key, form.elements.namedItem(key)]));
  const button = form.querySelector('[data-user-submit]');
  const label = form.querySelector('[data-user-submit-label]');
  if (keys.some(key => !fields[key]) || !button || !label) return;
  const editing = form.dataset.mode === 'edit';
  const originalLabel = label.textContent;
  let submitting = false;
  const validate = key => {
    const value = fields[key].value;
    let message = '';
    if (key === 'nome' || key === 'usuario') message = !value.trim() ? 'Preencha este campo.' : value.trim().length > 100 ? 'Use no máximo 100 caracteres.' : '';
    if (key === 'telefone' && value.trim() && (!/^\+?[\d\s().-]+$/.test(value.trim()) || !/^\d{10,15}$/.test(value.replace(/\D/g, '')))) message = 'Informe um telefone com 10 a 15 dígitos ou deixe em branco.';
    const changingPassword = !editing || Boolean(fields.senha.value || fields.confirmar_senha.value);
    if (key === 'senha' && changingPassword) {
      if (!value) message = 'Informe a senha.';
      else if (typeof TextEncoder === 'function' && new TextEncoder().encode(value).length > 72) message = 'A senha é longa demais. Use até 72 bytes em UTF-8.';
    }
    if (key === 'confirmar_senha' && changingPassword && (!value || value !== fields.senha.value)) message = 'A confirmação precisa ser igual à senha.';
    fields[key].setCustomValidity(message);
    return !message;
  };
  keys.forEach(key => fields[key].addEventListener('input', () => {
    validate(key);
    if (key === 'senha' || key === 'confirmar_senha') { validate('senha'); validate('confirmar_senha'); }
    const error = form.querySelector('[data-field-error="' + key + '"]');
    if (error) error.hidden = true;
    fields[key].removeAttribute('aria-invalid');
    fields[key].setAttribute('aria-describedby', key + '-hint');
  }));
  const toggles = [...form.querySelectorAll('[data-password-target]')];
  const setPasswordVisibility = (toggle, visible) => {
    const key = toggle.dataset.passwordTarget;
    fields[key].type = visible ? 'text' : 'password';
    toggle.textContent = visible ? 'Ocultar' : 'Mostrar';
    toggle.setAttribute('aria-pressed', String(visible));
    toggle.setAttribute('aria-label', (visible ? 'Ocultar ' : 'Mostrar ') + (key === 'senha' ? 'senha' : 'confirmação da senha'));
  };
  toggles.forEach(toggle => { toggle.hidden = false; toggle.addEventListener('click', () => {
    if (fields[toggle.dataset.passwordTarget]) setPasswordVisibility(toggle, fields[toggle.dataset.passwordTarget].type === 'password');
  }); });
  form.addEventListener('submit', event => {
    if (submitting) { event.preventDefault(); return; }
    const valid = keys.map(validate).every(Boolean);
    if (!valid || !form.checkValidity()) { event.preventDefault(); form.reportValidity(); return; }
    submitting = true;
    button.disabled = true;
    label.textContent = 'Salvando…';
    form.setAttribute('aria-busy', 'true');
  });
  window.addEventListener('pageshow', event => {
    submitting = false;
    button.disabled = false;
    label.textContent = originalLabel;
    form.removeAttribute('aria-busy');
    if (event.persisted) { fields.senha.value = ''; fields.confirmar_senha.value = ''; }
    toggles.forEach(toggle => setPasswordVisibility(toggle, false));
    keys.forEach(key => fields[key].setCustomValidity(''));
  });
  form.querySelector('[data-user-error-summary]')?.focus();
})();
