(() => {
  'use strict';

  const body = document.body;
  const page = document.querySelector('[data-menu-page]');

  if (!page || !body.classList.contains('main-cardapio')) return;

  const root = document.documentElement;
  const reducedMotion = () => root.classList.contains('motion-reduced');
  const finePointer = window.matchMedia('(hover: hover) and (pointer: fine)');
  const mobileNavigation = window.matchMedia('(max-width: 900px)');
  const clamp = (value, minimum = 0, maximum = 1) => Math.min(Math.max(value, minimum), maximum);
  const wait = (duration) => new Promise((resolve) => window.setTimeout(resolve, duration));

  body.classList.add('menu-motion-active');

  /* Entrada editorial: sem loader, aguardando apenas a imagem principal decodificar. */
  const heroImage = document.querySelector('.menu-hero__media img');
  let pageReady = false;

  const markPageReady = () => {
    if (pageReady) return;
    pageReady = true;
    body.classList.add('menu-ready');
  };

  const decodeHero = async () => {
    if (!heroImage) return;
    if (typeof heroImage.decode === 'function') {
      try {
        await heroImage.decode();
      } catch (_) {
        /* A entrada continua mesmo quando o navegador não antecipa a decodificação. */
      }
      return;
    }
    if (heroImage.complete) return;
    await new Promise((resolve) => {
      heroImage.addEventListener('load', resolve, { once: true });
      heroImage.addEventListener('error', resolve, { once: true });
    });
  };

  if (reducedMotion()) {
    markPageReady();
  } else {
    Promise.all([
      wait(80),
      Promise.race([decodeHero(), wait(500)])
    ]).then(() => window.requestAnimationFrame(markPageReady));
    window.setTimeout(markPageReady, 1100);
  }

  window.addEventListener('pageshow', (event) => {
    if (event.persisted) markPageReady();
  });

  /* Menu responsivo com foco contido e fechamento por Escape. */
  const header = document.querySelector('[data-site-header]');
  const menuToggle = document.querySelector('.nav-toggle');
  const navigation = document.querySelector('#cardapio-navigation');
  const navBrand = document.querySelector('.nav-brand');
  let menuIsOpen = false;
  let focusTimer = 0;

  const setMenu = (open, returnFocus = false) => {
    if (!menuToggle || !navigation) return;

    window.clearTimeout(focusTimer);
    menuIsOpen = open;
    body.classList.toggle('menu-open', open);
    menuToggle.setAttribute('aria-expanded', String(open));
    menuToggle.setAttribute('aria-label', open ? 'Fechar menu' : 'Abrir menu');

    if (open) {
      header?.classList.remove('escondido');
      const firstLink = navigation.querySelector('a');
      focusTimer = window.setTimeout(() => firstLink?.focus(), reducedMotion() ? 0 : 360);
    } else if (returnFocus) {
      menuToggle.focus();
    }
  };

  menuToggle?.addEventListener('click', () => setMenu(!menuIsOpen));

  navigation?.addEventListener('click', (event) => {
    if (event.target.closest('a')) setMenu(false);
  });

  document.addEventListener('keydown', (event) => {
    if (!menuIsOpen || !menuToggle || !navigation) return;

    if (event.key === 'Escape') {
      event.preventDefault();
      setMenu(false, true);
      return;
    }

    if (event.key !== 'Tab') return;

    const focusable = [navBrand, menuToggle, ...navigation.querySelectorAll('a[href], button:not([disabled])')].filter(Boolean);
    const first = focusable[0];
    const last = focusable[focusable.length - 1];

    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  });

  const handleNavigationBreakpoint = (event) => {
    if (!event.matches && menuIsOpen) setMenu(false);
  };

  if (typeof mobileNavigation.addEventListener === 'function') {
    mobileNavigation.addEventListener('change', handleNavigationBreakpoint);
  } else {
    mobileNavigation.addListener(handleNavigationBreakpoint);
  }

  /* Revelações acontecem uma vez e permanecem estáveis após entrar na tela. */
  const revealElements = [...document.querySelectorAll('[data-menu-reveal]')];
  let editionRevealIndex = 0;
  revealElements.forEach((element) => {
    if (element.matches('[data-menu-edition]')) {
      element.style.setProperty('--menu-reveal-delay', `${editionRevealIndex * 70}ms`);
      editionRevealIndex += 1;
    }
  });

  const revealAll = () => revealElements.forEach((element) => element.classList.add('is-visible'));

  if (reducedMotion() || !('IntersectionObserver' in window)) {
    revealAll();
  } else {
    const revealObserver = new IntersectionObserver((entries, observer) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        entry.target.classList.add('is-visible');
        observer.unobserve(entry.target);
      });
    }, {
      threshold: 0.12,
      rootMargin: '0px 0px -7% 0px'
    });

    revealElements.forEach((element) => revealObserver.observe(element));
  }

  /* As três opções preservam os PDFs e controlam apenas o preview visual. */
  const editionContainer = document.querySelector('[data-menu-editions]');
  const editions = [...document.querySelectorAll('[data-menu-edition]')];
  const previewImages = [...document.querySelectorAll('[data-preview-image]')];
  const previewNumber = document.querySelector('[data-preview-number]');
  const previewName = document.querySelector('[data-preview-name]');
  const previewLabels = [
    { number: '01', name: 'Steakhouse' },
    { number: '02', name: 'Container' },
    { number: '03', name: 'Madero + Jerônimo' }
  ];
  let activeEdition = 0;
  let editionSyncPending = true;

  const activateEdition = (index) => {
    if (!Number.isInteger(index) || index < 0 || index >= editions.length) return;
    activeEdition = index;
    editionContainer?.classList.add('has-active');
    editions.forEach((edition, editionIndex) => edition.classList.toggle('is-active', editionIndex === index));
    previewImages.forEach((image, imageIndex) => image.classList.toggle('is-active', imageIndex === index));
    if (previewNumber) previewNumber.textContent = previewLabels[index].number;
    if (previewName) previewName.textContent = previewLabels[index].name;
  };

  editions.forEach((edition, index) => {
    edition.addEventListener('pointerenter', (event) => {
      if (finePointer.matches && event.pointerType === 'mouse') activateEdition(index);
    });
    edition.addEventListener('focusin', () => activateEdition(index));
  });

  activateEdition(activeEdition);

  /* No celular, a foto pode ocupar a tela antes do texto. A seleção acompanha
     a área de leitura, não a entrada da foto nem um lote parcial do observer. */
  const syncVisibleEdition = (viewportHeight) => {
    const mobile = mobileNavigation.matches;
    const readingTop = viewportHeight * (mobile ? 0.12 : 0.34);
    const readingBottom = viewportHeight * (mobile ? 0.9 : 0.66);
    const readingCenter = viewportHeight * (mobile ? 0.56 : 0.5);
    const candidates = editions.map((edition, index) => {
      const content = mobile ? edition.querySelector('.menu-edition__content') : edition;
      const bounds = (content || edition).getBoundingClientRect();
      const visible = Math.max(0, Math.min(bounds.bottom, readingBottom) - Math.max(bounds.top, readingTop));
      const required = Math.min(bounds.height, readingBottom - readingTop) * (mobile ? 0.55 : 0.1);
      return {
        index,
        eligible: bounds.height > 0 && visible > 0 && visible >= required,
        distance: Math.abs((bounds.top + bounds.bottom) / 2 - readingCenter)
      };
    }).filter((candidate) => candidate.eligible);

    if (!candidates.length) return;
    candidates.sort((first, second) => first.distance - second.distance);
    const nearest = candidates[0];
    const current = candidates.find((candidate) => candidate.index === activeEdition);
    // Pequena zona estável evita alternância na divisa entre dois cartões.
    if (current && current.distance <= nearest.distance + 24) return;
    if (nearest.index !== activeEdition) activateEdition(nearest.index);
  };

  /* Um único RAF atende cabeçalho, parallax e resposta sutil ao ponteiro. */
  const hero = document.querySelector('[data-menu-hero]');
  let previousScroll = window.scrollY;
  let frame = 0;
  let pointerTargetX = 0;
  let pointerTargetY = 0;
  let pointerX = 0;
  let pointerY = 0;

  const render = () => {
    frame = 0;
    const scrollTop = window.scrollY;
    const viewportHeight = Math.max(window.innerHeight, 1);
    const progress = clamp(scrollTop / viewportHeight);
    const scrollDelta = scrollTop - previousScroll;
    const navigationLocked = menuIsOpen || header?.contains(document.activeElement);

    if (editionSyncPending) {
      editionSyncPending = false;
      syncVisibleEdition(viewportHeight);
    }

    header?.classList.toggle('is-scrolled', scrollTop > 24);
    if (header && !navigationLocked) {
      if (scrollTop < 90 || scrollDelta < -3) {
        header.classList.remove('escondido');
      } else if (scrollDelta > 3) {
        header.classList.add('escondido');
      }
    }

    if (hero && !reducedMotion()) {
      const headingExit = clamp((progress - 0.05) / 0.82);
      const bottomExit = clamp((progress - 0.12) / 0.68);
      hero.style.setProperty('--menu-hero-shift', `${(progress * 56).toFixed(2)}px`);
      hero.style.setProperty('--menu-hero-scale', (1.07 + progress * 0.025).toFixed(4));
      hero.style.setProperty('--menu-heading-y', `${(-headingExit * 30).toFixed(2)}px`);
      hero.style.setProperty('--menu-heading-opacity', (1 - headingExit).toFixed(4));
      hero.style.setProperty('--menu-bottom-y', `${(-bottomExit * 16).toFixed(2)}px`);
      hero.style.setProperty('--menu-bottom-opacity', (1 - bottomExit).toFixed(4));

      pointerX += (pointerTargetX - pointerX) * 0.12;
      pointerY += (pointerTargetY - pointerY) * 0.12;
      hero.style.setProperty('--menu-pointer-x', `${pointerX.toFixed(2)}px`);
      hero.style.setProperty('--menu-pointer-y', `${pointerY.toFixed(2)}px`);

      if (Math.abs(pointerTargetX - pointerX) > 0.05 || Math.abs(pointerTargetY - pointerY) > 0.05) {
        scheduleFrame();
      }
    }

    previousScroll = Math.max(scrollTop, 0);
  };

  function scheduleFrame() {
    if (!frame) frame = window.requestAnimationFrame(render);
  }

  const scheduleViewportFrame = () => {
    editionSyncPending = true;
    scheduleFrame();
  };

  window.addEventListener('scroll', scheduleViewportFrame, { passive: true });
  window.addEventListener('resize', scheduleViewportFrame, { passive: true });
  window.addEventListener('pageshow', scheduleViewportFrame);
  if (typeof mobileNavigation.addEventListener === 'function') {
    mobileNavigation.addEventListener('change', scheduleViewportFrame);
  } else {
    mobileNavigation.addListener(scheduleViewportFrame);
  }
  document.fonts?.ready.then(scheduleViewportFrame);

  hero?.addEventListener('pointermove', (event) => {
    if (!finePointer.matches || reducedMotion()) return;
    const bounds = hero.getBoundingClientRect();
    pointerTargetX = ((event.clientX - bounds.left) / bounds.width - 0.5) * 10;
    pointerTargetY = ((event.clientY - bounds.top) / bounds.height - 0.5) * 7;
    scheduleFrame();
  }, { passive: true });

  hero?.addEventListener('pointerleave', () => {
    pointerTargetX = 0;
    pointerTargetY = 0;
    scheduleFrame();
  });

  scheduleFrame();

  if (window.__menuMotionFallback) {
    window.clearTimeout(window.__menuMotionFallback);
    window.__menuMotionFallback = 0;
  }
})();
