(() => {
  'use strict';

  const page = document.querySelector('[data-login-page]');
  if (!page) return;

  // Holofote: revela uma foto imóvel somente onde o mouse está.
  // Não reutiliza preferências do antigo fundo animado nem grava no navegador.
  const spotlight = page.querySelector('[data-login-spotlight]');
  if (spotlight) {
    const finePointer = window.matchMedia?.('(hover: hover) and (pointer: fine)');
    const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    const maskSupported = Boolean(window.CSS?.supports?.('mask-image', 'radial-gradient(#000, transparent)')
      || window.CSS?.supports?.('-webkit-mask-image', 'radial-gradient(#000, transparent)'));
    let enabled = false;
    let frame = 0;
    let x = 0;
    let y = 0;

    const hideSpotlight = () => {
      if (frame) window.cancelAnimationFrame(frame);
      frame = 0;
      page.classList.remove('spotlight-active');
    };
    const syncSpotlight = () => {
      hideSpotlight();
      let savedReduced = false;
      try { savedReduced = window.localStorage.getItem('madero-motion') === 'reduced'; } catch (_) {}
      enabled = Boolean(finePointer?.matches && maskSupported);
      spotlight.style.removeProperty('--spotlight-x');
      spotlight.style.removeProperty('--spotlight-y');
      page.classList.toggle('spotlight-static', !enabled);
      // Resposta direta ao cursor, sem inércia; redução de movimento elimina o fade.
      page.classList.toggle('spotlight-instant', Boolean(reducedMotion?.matches || savedReduced));
    };
    page.addEventListener('pointermove', (event) => {
      if (!enabled || document.hidden) return;
      if (event.pointerType && event.pointerType !== 'mouse') { hideSpotlight(); return; }
      if (!Number.isFinite(event.clientX) || !Number.isFinite(event.clientY)) return;
      x = Math.max(0, Math.min(window.innerWidth, event.clientX));
      y = Math.max(0, Math.min(window.innerHeight, event.clientY));
      if (frame) return;
      frame = window.requestAnimationFrame(() => {
        frame = 0;
        spotlight.style.setProperty('--spotlight-x', x + 'px');
        spotlight.style.setProperty('--spotlight-y', y + 'px');
        page.classList.add('spotlight-active');
      });
    });
    page.addEventListener('pointerleave', hideSpotlight);
    page.addEventListener('pointercancel', hideSpotlight);
    window.addEventListener('blur', hideSpotlight);
    window.addEventListener('resize', hideSpotlight);
    window.addEventListener('scroll', hideSpotlight, { passive: true });
    window.addEventListener('pageshow', syncSpotlight);
    document.addEventListener('visibilitychange', hideSpotlight);
    window.addEventListener('storage', (event) => {
      if (event.key === null || event.key === 'madero-motion') syncSpotlight();
    });
    for (const query of [finePointer, reducedMotion]) {
      if (query?.addEventListener) query.addEventListener('change', syncSpotlight);
      else query?.addListener?.(syncSpotlight);
    }
    syncSpotlight();
  }

  const form = page.querySelector('[data-login-form]');
  const password = page.querySelector('#senha');
  const confirmation = page.querySelector('#confirmar_senha');
  const matchFeedback = page.querySelector('[data-password-match]');
  const phone = page.querySelector('#telefone');
  const submit = page.querySelector('[data-login-submit]');
  const submitLabel = page.querySelector('[data-submit-label]');
  const status = page.querySelector('[data-login-status]');
  let submitting = false;
  if (!form || !password || !submit) return;
  const idleLabel = submitLabel?.textContent.trim() || 'Entrar';
  const pendingLabel = form.dataset.submitPending || 'Entrando…';
  const pendingStatus = form.dataset.submitStatus || 'Verificando seu acesso.';

  const passwordControls = [password, confirmation].filter(Boolean).map((input) => {
    const field = input.closest('.login-field');
    const toggle = field.querySelector('[data-password-toggle]');
    const toggleLabel = field.querySelector('[data-password-toggle-label]');
    const capsLock = field.querySelector('[data-caps-lock]');
    const fieldName = toggle?.dataset.passwordName || 'senha';

    const hide = () => {
      input.type = 'password';
      toggle?.setAttribute('aria-pressed', 'false');
      toggle?.setAttribute('aria-label', 'Mostrar ' + fieldName);
      if (toggleLabel) toggleLabel.textContent = 'Mostrar';
      if (capsLock) capsLock.hidden = true;
    };
    if (toggle) {
      toggle.hidden = false;
      toggle.addEventListener('click', () => {
        const reveal = input.type === 'password';
        const selectionStart = input.selectionStart;
        const selectionEnd = input.selectionEnd;
        input.type = reveal ? 'text' : 'password';
        toggle.setAttribute('aria-pressed', String(reveal));
        toggle.setAttribute('aria-label', (reveal ? 'Ocultar ' : 'Mostrar ') + fieldName);
        if (toggleLabel) toggleLabel.textContent = reveal ? 'Ocultar' : 'Mostrar';
        // Preserva a seleção e o foco no controle acionado.
        try { input.setSelectionRange(selectionStart, selectionEnd); } catch (_) {}
      });
    }
    const updateCapsLock = (event) => {
      if (capsLock && typeof event.getModifierState === 'function') {
        capsLock.hidden = !event.getModifierState('CapsLock');
      }
    };
    input.addEventListener('keydown', updateCapsLock);
    input.addEventListener('keyup', updateCapsLock);
    input.addEventListener('blur', () => { if (capsLock) capsLock.hidden = true; });
    return { hide };
  });
  const hidePasswords = () => passwordControls.forEach((control) => control.hide());

  const validateConfirmation = () => {
    if (!confirmation) return;
    const hasConfirmation = confirmation.value.length > 0;
    const mismatch = hasConfirmation && confirmation.value !== password.value;
    confirmation.setCustomValidity(mismatch ? 'A confirmação precisa ser igual à senha.' : '');
    if (mismatch) confirmation.setAttribute('aria-invalid', 'true');
    else confirmation.removeAttribute('aria-invalid');
    if (matchFeedback) {
      matchFeedback.dataset.state = mismatch ? 'error' : hasConfirmation ? 'success' : '';
      matchFeedback.textContent = mismatch ? 'As senhas ainda não coincidem.'
        : hasConfirmation ? 'As senhas coincidem.' : 'Repita a senha escolhida.';
    }
  };
  const validatePhone = () => {
    if (!phone) return;
    const value = phone.value.trim();
    const digits = value.replace(/\D/g, '');
    const valid = !value || (/^\+?[\d\s().-]+$/.test(value) && digits.length >= 10 && digits.length <= 15);
    phone.setCustomValidity(valid ? '' : 'Informe de 10 a 15 dígitos, incluindo o DDD. Use + somente no início.');
  };
  if (confirmation) {
    for (const input of [password, confirmation]) {
      input.addEventListener('input', validateConfirmation);
      input.addEventListener('change', validateConfirmation);
    }
    validateConfirmation();
  }
  if (phone) {
    phone.addEventListener('input', validatePhone);
    phone.addEventListener('change', validatePhone);
    validatePhone();
  }

  form.addEventListener('submit', (event) => {
    if (submitting) {
      event.preventDefault();
      return;
    }
    validateConfirmation();
    validatePhone();
    if (!form.checkValidity()) {
      event.preventDefault();
      form.reportValidity();
      return;
    }
    submitting = true;
    hidePasswords();
    submit.disabled = true;
    form.setAttribute('aria-busy', 'true');
    if (submitLabel) submitLabel.textContent = pendingLabel;
    if (status) status.textContent = pendingStatus;
    // Mantém o POST nativo e não armazena credenciais no navegador.
  });

  window.addEventListener('pageshow', () => {
    submitting = false;
    submit.disabled = false;
    form.removeAttribute('aria-busy');
    if (submitLabel) submitLabel.textContent = idleLabel;
    if (status) status.textContent = '';
    hidePasswords();
    validateConfirmation();
    validatePhone();
  });
  document.addEventListener('visibilitychange', () => { if (document.hidden) hidePasswords(); });
  const feedback = page.querySelector('[data-login-feedback]');
  if (feedback) feedback.focus();
})();
