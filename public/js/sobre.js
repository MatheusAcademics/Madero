(() => {
  'use strict';

  const body = document.body;
  const page = document.querySelector('[data-about-page]');

  if (!page || !body.classList.contains('main-sobre')) return;

  const root = document.documentElement;
  const reducedMotion = () => root.classList.contains('motion-reduced');
  const finePointer = window.matchMedia('(hover: hover) and (pointer: fine)');
  const mobileNavigation = window.matchMedia('(max-width: 900px)');
  const clamp = (value, minimum = 0, maximum = 1) => Math.min(Math.max(value, minimum), maximum);
  const wait = (duration) => new Promise((resolve) => window.setTimeout(resolve, duration));

  body.classList.add('about-motion-active');

  /* Entrada sem novo loader: a fotografia abre a página quando estiver pronta. */
  const heroImage = document.querySelector('.about-hero__media img');
  let pageReady = false;

  const markPageReady = () => {
    if (pageReady) return;
    pageReady = true;
    body.classList.add('about-ready');
  };

  const decodeHero = async () => {
    if (!heroImage) return;
    if (typeof heroImage.decode === 'function') {
      try {
        await heroImage.decode();
      } catch (_) {
        /* A abertura continua se o navegador não antecipar a decodificação. */
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
      wait(90),
      Promise.race([decodeHero(), wait(650)])
    ]).then(() => window.requestAnimationFrame(markPageReady));
    window.setTimeout(markPageReady, 1200);
  }

  window.addEventListener('pageshow', (event) => {
    if (event.persisted) markPageReady();
  });

  /* Navegação responsiva com Escape e foco contido. */
  const header = document.querySelector('[data-site-header]');
  const menuToggle = document.querySelector('.nav-toggle');
  const navigation = document.querySelector('#sobre-navigation');
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

  /* Elementos editoriais aparecem uma única vez, sem oscilar ao rolar. */
  const revealElements = [...document.querySelectorAll('[data-about-reveal]')];
  document.querySelectorAll('.about-value').forEach((element, index) => {
    element.style.setProperty('--about-reveal-delay', `${index * 90}ms`);
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

  /* Linha do tempo: o capítulo no centro controla fotografia, ano e progresso. */
  const timelineSection = document.querySelector('[data-timeline-section]');
  const timelineEntries = [...document.querySelectorAll('[data-timeline-entry]')];
  const timelineImages = [...document.querySelectorAll('[data-timeline-image]')];
  const yearLinks = [...document.querySelectorAll('[data-year-link]')];
  const yearsInner = document.querySelector('.about-years__inner');
  const currentYear = document.querySelector('[data-current-year]');
  const timelineYears = timelineEntries.map((entry) => entry.querySelector('time')?.textContent?.trim() || '');
  const mobileTimelineParts = timelineEntries.map((entry) => ({
    media: entry.querySelector('.about-era__mobile-media'),
    year: entry.querySelector('time')
  }));
  const systemReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  let activeTimelineIndex = -1;

  const keepActiveYearVisible = (index) => {
    const link = yearLinks[index];
    if (!link || !yearsInner || yearsInner.scrollWidth <= yearsInner.clientWidth) return;
    const left = link.offsetLeft - (yearsInner.clientWidth - link.offsetWidth) / 2;
    yearsInner.scrollTo({
      left: Math.max(0, left),
      behavior: reducedMotion() ? 'auto' : 'smooth'
    });
  };

  const activateTimeline = (index) => {
    if (!Number.isInteger(index) || index < 0 || index >= timelineEntries.length || index === activeTimelineIndex) return;
    activeTimelineIndex = index;
    timelineEntries.forEach((entry, entryIndex) => entry.classList.toggle('is-active', entryIndex === index));
    timelineImages.forEach((image, imageIndex) => image.classList.toggle('is-active', imageIndex === index));
    yearLinks.forEach((link, linkIndex) => {
      link.classList.toggle('is-active', linkIndex === index);
      if (linkIndex === index) link.setAttribute('aria-current', 'true');
      else link.removeAttribute('aria-current');
    });
    if (currentYear) currentYear.textContent = timelineYears[index];
    keepActiveYearVisible(index);
  };

  activateTimeline(0);

  const hero = document.querySelector('[data-about-hero]');
  const founderMedia = document.querySelector('[data-founder-media]');
  const finale = document.querySelector('[data-about-finale]');
  let previousScroll = window.scrollY;
  let frame = 0;
  let pointerTargetX = 0;
  let pointerTargetY = 0;
  let pointerX = 0;
  let pointerY = 0;

  const updateTimelineFromViewport = (viewportHeight) => {
    if (!timelineSection || timelineEntries.length === 0) return;

    const isMobile = mobileNavigation.matches;
    const animateMobile = isMobile && !reducedMotion() && !systemReducedMotion.matches;
    timelineSection.classList.toggle('has-mobile-motion', animateMobile);

    const sectionBounds = timelineSection.getBoundingClientRect();
    const progressDistance = Math.max(sectionBounds.height - viewportHeight * 0.42, 1);
    const progress = clamp((viewportHeight * 0.34 - sectionBounds.top) / progressDistance);
    timelineSection.style.setProperty('--about-timeline-progress', progress.toFixed(4));

    if (sectionBounds.bottom < 0 || sectionBounds.top > viewportHeight) return;

    const focusLine = viewportHeight * (isMobile ? 0.42 : 0.5);
    let closestIndex = 0;
    let closestDistance = Number.POSITIVE_INFINITY;

    timelineEntries.forEach((entry, index) => {
      const bounds = entry.getBoundingClientRect();

      /* No celular a foto pertence ao próprio capítulo: o scroll move a imagem,
         o ano e o traço, mas nunca esconde o conteúdo enquanto a pessoa lê. */
      if (animateMobile && bounds.bottom >= 0 && bounds.top <= viewportHeight) {
        const { media, year } = mobileTimelineParts[index];
        const mediaBounds = media?.getBoundingClientRect();
        if (mediaBounds) {
          const travel = clamp((viewportHeight - mediaBounds.top) / (viewportHeight + mediaBounds.height));
          const opening = clamp((viewportHeight - mediaBounds.top) / (viewportHeight * 0.65));
          entry.style.setProperty('--about-era-image-shift', `${(3 - travel * 6).toFixed(3)}%`);
          entry.style.setProperty('--about-era-image-scale', (1.13 - travel * 0.06).toFixed(4));
          entry.style.setProperty('--about-era-image-inset', `${((1 - opening) * 8).toFixed(3)}%`);
        }
        const yearTop = bounds.top + (year?.offsetTop || 0);
        const yearEntrance = clamp((viewportHeight - yearTop) / (viewportHeight * 0.3));
        const lineEntrance = clamp((viewportHeight - bounds.top) / (viewportHeight * 0.55));
        entry.style.setProperty('--about-era-year-shift', `${((1 - yearEntrance) * 18).toFixed(2)}px`);
        entry.style.setProperty('--about-era-line-progress', lineEntrance.toFixed(4));
      }

      // Mantém o ano atual até o próximo capítulo realmente alcançar a leitura.
      if (isMobile) {
        if (bounds.top <= focusLine) closestIndex = index;
        return;
      }
      const center = bounds.top + bounds.height * 0.5;
      const distance = Math.abs(center - focusLine);
      if (distance < closestDistance) {
        closestDistance = distance;
        closestIndex = index;
      }
    });

    activateTimeline(closestIndex);
  };

  const render = () => {
    frame = 0;
    const scrollTop = window.scrollY;
    const viewportHeight = Math.max(window.innerHeight, 1);
    const scrollDelta = scrollTop - previousScroll;
    const navigationLocked = menuIsOpen || header?.contains(document.activeElement);

    header?.classList.toggle('is-scrolled', scrollTop > 24);
    if (header && !navigationLocked) {
      if (scrollTop < 90 || scrollDelta < -3) {
        header.classList.remove('escondido');
      } else if (scrollDelta > 3) {
        header.classList.add('escondido');
      }
    }

    updateTimelineFromViewport(viewportHeight);

    if (!reducedMotion()) {
      if (hero) {
        const heroProgress = clamp(scrollTop / viewportHeight);
        const headingExit = clamp((heroProgress - 0.04) / 0.76);
        hero.style.setProperty('--about-hero-shift', `${(heroProgress * 52).toFixed(2)}px`);
        hero.style.setProperty('--about-hero-scale', (1.055 + heroProgress * 0.025).toFixed(4));
        hero.style.setProperty('--about-heading-y', `${(-headingExit * 24).toFixed(2)}px`);
        hero.style.setProperty('--about-heading-opacity', (1 - headingExit).toFixed(4));

        pointerX += (pointerTargetX - pointerX) * 0.11;
        pointerY += (pointerTargetY - pointerY) * 0.11;
        hero.style.setProperty('--about-pointer-x', `${pointerX.toFixed(2)}px`);
        hero.style.setProperty('--about-pointer-y', `${pointerY.toFixed(2)}px`);

        if (Math.abs(pointerTargetX - pointerX) > 0.05 || Math.abs(pointerTargetY - pointerY) > 0.05) {
          scheduleFrame();
        }
      }

      if (founderMedia) {
        const bounds = founderMedia.getBoundingClientRect();
        const progress = clamp((viewportHeight - bounds.top) / (viewportHeight + bounds.height));
        founderMedia.style.setProperty('--about-founder-shift', `${(22 - progress * 44).toFixed(2)}px`);
      }

      if (finale) {
        const bounds = finale.getBoundingClientRect();
        const progress = clamp((viewportHeight - bounds.top) / (viewportHeight + bounds.height));
        finale.style.setProperty('--about-finale-shift', `${(30 - progress * 60).toFixed(2)}px`);
      }
    }

    previousScroll = Math.max(scrollTop, 0);
  };

  function scheduleFrame() {
    if (!frame) frame = window.requestAnimationFrame(render);
  }

  window.addEventListener('scroll', scheduleFrame, { passive: true });
  window.addEventListener('resize', scheduleFrame, { passive: true });
  window.addEventListener('pageshow', scheduleFrame);

  if (typeof systemReducedMotion.addEventListener === 'function') {
    systemReducedMotion.addEventListener('change', scheduleFrame);
  } else {
    systemReducedMotion.addListener(scheduleFrame);
  }

  hero?.addEventListener('pointermove', (event) => {
    if (!finePointer.matches || reducedMotion()) return;
    const bounds = hero.getBoundingClientRect();
    pointerTargetX = ((event.clientX - bounds.left) / bounds.width - 0.5) * 8;
    pointerTargetY = ((event.clientY - bounds.top) / bounds.height - 0.5) * 5;
    scheduleFrame();
  }, { passive: true });

  hero?.addEventListener('pointerleave', () => {
    pointerTargetX = 0;
    pointerTargetY = 0;
    scheduleFrame();
  });

  yearLinks.forEach((link) => {
    link.addEventListener('click', () => {
      const index = Number.parseInt(link.dataset.yearLink, 10);
      activateTimeline(index);
    });
  });

  scheduleFrame();

  if (window.__aboutMotionFallback) {
    window.clearTimeout(window.__aboutMotionFallback);
    window.__aboutMotionFallback = 0;
  }
})();
