(() => {
  'use strict';

  const body = document.body;
  const landing = document.querySelector('[data-landing]');

  if (!landing || !body.classList.contains('main-index')) return;

  body.classList.add('motion-active');

  const root = document.documentElement;
  const reducedMotion = {
    get matches() {
      return root.classList.contains('motion-reduced');
    }
  };
  const finePointer = window.matchMedia('(hover: hover) and (pointer: fine)');
  const mobileNavigation = window.matchMedia('(max-width: 900px)');
  const pinnedStages = window.matchMedia('(min-width: 1100px) and (min-height: 760px)');
  const clamp = (value, minimum = 0, maximum = 1) => Math.min(Math.max(value, minimum), maximum);
  const wait = (duration) => new Promise((resolve) => window.setTimeout(resolve, duration));

  /* Movimento fica ativo por padrão; o visitante pode alterá-lo junto às ações da hero. */
  const motionToggle = document.querySelector('[data-motion-toggle]');

  const syncMotionToggle = () => {
    if (!motionToggle) return;
    const isPaused = reducedMotion.matches;
    const label = isPaused ? 'Ativar animações' : 'Desativar animações';
    motionToggle.setAttribute('aria-checked', String(!isPaused));
    motionToggle.setAttribute('aria-label', label);
    motionToggle.setAttribute('title', label);
  };

  const saveMotionPreference = (value) => {
    try {
      window.localStorage.setItem('madero-motion', value);
    } catch (_) {
      /* A preferência continua válida durante a visita atual. */
    }
  };

  syncMotionToggle();

  motionToggle?.addEventListener('click', () => {
    if (reducedMotion.matches) {
      root.classList.remove('motion-reduced');
      saveMotionPreference('full');
      window.location.reload();
      return;
    }

    root.classList.add('motion-reduced');
    saveMotionPreference('reduced');
    syncMotionToggle();
    document.dispatchEvent(new CustomEvent('madero:motionchange'));
  });

  /* Abertura: aguarda a imagem principal, conclui a barra e só então abre os painéis. */
  const loaderCount = document.querySelector('[data-loader-count]');
  const heroImage = document.querySelector('.hero-media img');
  let loaderReleased = false;
  let counterFrame = 0;

  const releaseLoader = () => {
    if (loaderReleased) return;
    loaderReleased = true;
    window.cancelAnimationFrame(counterFrame);
    if (loaderCount) loaderCount.textContent = '100';
    body.classList.add('is-loaded');
    window.setTimeout(() => body.classList.add('motion-ready'), reducedMotion.matches ? 0 : 1750);
  };

  const animateLoaderCount = () => {
    if (!loaderCount || reducedMotion.matches) return;
    const startedAt = performance.now();
    const duration = 1120;

    const update = (now) => {
      const progress = clamp((now - startedAt) / duration);
      const eased = 1 - Math.pow(1 - progress, 3);
      loaderCount.textContent = String(Math.min(99, Math.floor(eased * 100))).padStart(2, '0');
      if (progress < 1 && !loaderReleased) counterFrame = window.requestAnimationFrame(update);
    };

    counterFrame = window.requestAnimationFrame(update);
  };

  const heroReady = async () => {
    if (!heroImage) return;
    if (typeof heroImage.decode === 'function') {
      try {
        await heroImage.decode();
      } catch (_) {
        /* A sequência continua mesmo sem decodificação antecipada. */
      }
    } else if (!heroImage.complete) {
      await new Promise((resolve) => {
        heroImage.addEventListener('load', resolve, { once: true });
        heroImage.addEventListener('error', resolve, { once: true });
      });
    }
  };

  if (reducedMotion.matches) {
    releaseLoader();
  } else {
    animateLoaderCount();
    Promise.all([
      wait(1200),
      Promise.race([heroReady(), wait(700)])
    ]).then(releaseLoader);
    window.setTimeout(releaseLoader, 2600);
  }

  window.addEventListener('pageshow', (event) => {
    if (event.persisted) {
      body.classList.add('is-loaded', 'motion-ready');
      releaseLoader();
    }
  });

  /* Menu mobile: foco contido, Escape, resize e restauração do foco. */
  const menuToggle = document.querySelector('.nav-toggle');
  const navigation = document.querySelector('#landing-navigation');
  const navBrand = document.querySelector('.nav-brand');
  let menuIsOpen = false;
  let menuFocusTimer = 0;

  const setMenu = (open, returnFocus = false) => {
    if (!menuToggle || !navigation) return;

    window.clearTimeout(menuFocusTimer);
    menuIsOpen = open;
    body.classList.toggle('menu-open', open);
    menuToggle.setAttribute('aria-expanded', String(open));
    menuToggle.setAttribute('aria-label', open ? 'Fechar menu' : 'Abrir menu');

    if (open) {
      document.querySelector('[data-site-header]')?.classList.remove('escondido');
      const firstLink = navigation.querySelector('a');
      menuFocusTimer = window.setTimeout(() => {
        if (menuIsOpen) firstLink?.focus();
      }, reducedMotion.matches ? 0 : 380);
    } else if (returnFocus) {
      menuToggle.focus();
    }
  };

  menuToggle?.addEventListener('click', () => setMenu(!menuIsOpen, false));

  navigation?.addEventListener('click', (event) => {
    if (event.target.closest('a')) setMenu(false, false);
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
    if (!event.matches && menuIsOpen) setMenu(false, false);
  };

  if (typeof mobileNavigation.addEventListener === 'function') {
    mobileNavigation.addEventListener('change', handleNavigationBreakpoint);
  } else {
    mobileNavigation.addListener(handleNavigationBreakpoint);
  }

  /* Reveals editoriais: sequência calculada dentro de cada seção, não globalmente. */
  const revealElements = [...document.querySelectorAll('[data-reveal]')];
  const revealGroups = new Map();
  const counterFrames = new Map();

  revealElements.forEach((element) => {
    const group = element.closest('section, footer') || landing;
    const groupIndex = revealGroups.get(group) || 0;
    element.style.setProperty('--reveal-delay', `${Math.min(groupIndex * 65, 260)}ms`);
    revealGroups.set(group, groupIndex + 1);
  });

  const finishCounter = (counter) => {
    const target = Number(counter.dataset.counter);
    const padding = Number(counter.dataset.counterPad || 0);
    counter.textContent = String(target).padStart(padding, '0');
  };

  const animateCounters = (container) => {
    container.querySelectorAll('[data-counter]:not([data-counted])').forEach((counter) => {
      counter.dataset.counted = 'true';
      const target = Number(counter.dataset.counter);
      const padding = Number(counter.dataset.counterPad || 0);

      if (reducedMotion.matches || !Number.isFinite(target)) {
        finishCounter(counter);
        return;
      }

      const startValue = target > 100 ? target - 25 : 0;
      const startedAt = performance.now();
      const duration = 1050;

      const update = (now) => {
        if (reducedMotion.matches) {
          finishCounter(counter);
          counterFrames.delete(counter);
          return;
        }
        const progress = clamp((now - startedAt) / duration);
        const eased = 1 - Math.pow(1 - progress, 4);
        const value = Math.round(startValue + (target - startValue) * eased);
        counter.textContent = String(value).padStart(padding, '0');
        if (progress < 1) {
          counterFrames.set(counter, window.requestAnimationFrame(update));
        } else {
          counterFrames.delete(counter);
        }
      };

      counterFrames.set(counter, window.requestAnimationFrame(update));
    });
  };

  let revealObserver;
  if (reducedMotion.matches || !('IntersectionObserver' in window)) {
    revealElements.forEach((element) => element.classList.add('is-visible', 'reveal-complete'));
    document.querySelectorAll('[data-counter]').forEach(finishCounter);
  } else {
    revealObserver = new IntersectionObserver((entries, observer) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        entry.target.classList.add('is-visible');
        animateCounters(entry.target);
        window.setTimeout(() => entry.target.classList.add('reveal-complete'), 1700);
        observer.unobserve(entry.target);
      });
    }, {
      threshold: 0.14,
      rootMargin: '0px 0px -7% 0px'
    });

    revealElements.forEach((element) => revealObserver.observe(element));
  }

  /* Elementos contínuos só ficam promovidos ou em loop enquanto estão visíveis. */
  const hero = document.querySelector('[data-parallax-root]');
  const heroStage = document.querySelector('[data-hero-stage]');
  const scenes = [...document.querySelectorAll('[data-scroll-scene]')];
  const marquee = document.querySelector('.brand-marquee');
  const marqueeTrack = marquee?.querySelector('.marquee-track');
  const footer = document.querySelector('.landing-footer');
  const activityTargets = [hero, ...scenes, marquee, footer].filter(Boolean);
  let marqueeAnimation;

  const refreshMarqueeAnimation = () => {
    const activeAnimation = marqueeTrack?.getAnimations()[0];
    marqueeAnimation = activeAnimation || undefined;
    return marqueeAnimation;
  };

  const syncMarqueePlayback = () => {
    const activeAnimation = refreshMarqueeAnimation();
    if (!activeAnimation) return;
    if (document.hidden || reducedMotion.matches || !marquee?.classList.contains('is-in-view')) {
      activeAnimation.pause();
    } else {
      activeAnimation.play();
    }
  };

  if ('IntersectionObserver' in window) {
    const activityObserver = new IntersectionObserver((entries) => {
      entries.forEach((entry) => entry.target.classList.toggle('is-in-view', entry.isIntersecting));
      syncMarqueePlayback();
    }, { rootMargin: '18% 0px 18% 0px' });
    activityTargets.forEach((element) => activityObserver.observe(element));
  } else {
    activityTargets.forEach((element) => element.classList.add('is-in-view'));
  }

  document.addEventListener('visibilitychange', syncMarqueePlayback);

  /* Um único ciclo para header, scroll progressivo, parallax e respostas ao ponteiro. */
  const header = document.querySelector('[data-site-header]');
  const heroLetters = [...document.querySelectorAll('.hero-word > span')];
  const finalOrbit = document.querySelector('.final-cta__orbit');
  const pointerStates = new Map();
  const metrics = { viewportHeight: window.innerHeight, hero: null, scenes: new Map() };
  let frame = 0;
  let measureDirty = true;
  let scrollDirty = true;
  let pointerDirty = false;
  let lastScroll = Math.max(window.scrollY, 0);
  let marqueeRate = 1;
  let marqueeTargetRate = 1;
  let marqueeBoostUntil = 0;

  header?.addEventListener('focusin', () => header.classList.remove('escondido'));

  const measureLayout = () => {
    const scrollTop = Math.max(window.scrollY, 0);
    metrics.viewportHeight = window.innerHeight;

    if (heroStage) {
      const bounds = heroStage.getBoundingClientRect();
      metrics.hero = {
        top: bounds.top + scrollTop,
        height: heroStage.offsetHeight
      };
    }

    scenes.forEach((scene) => {
      const bounds = scene.getBoundingClientRect();
      metrics.scenes.set(scene, {
        top: bounds.top + scrollTop,
        height: scene.offsetHeight
      });
    });

    measureDirty = false;
  };

  const readPointerUpdates = () => {
    const writes = [];

    pointerStates.forEach((state, element) => {
      if (!state.active) {
        writes.push({ element, type: state.type, reset: true });
        return;
      }

      const bounds = element.getBoundingClientRect();
      const normalizedX = clamp((state.clientX - bounds.left) / Math.max(bounds.width, 1));
      const normalizedY = clamp((state.clientY - bounds.top) / Math.max(bounds.height, 1));
      writes.push({ element, type: state.type, normalizedX, normalizedY });
    });

    return writes;
  };

  const writePointerUpdates = (writes) => {
    writes.forEach(({ element, type, reset, normalizedX, normalizedY }) => {
      if (type === 'hero') {
        element.style.setProperty('--hero-pointer-x', reset ? '0px' : `${((normalizedX - 0.5) * 13).toFixed(2)}px`);
        element.style.setProperty('--hero-pointer-y', reset ? '0px' : `${((normalizedY - 0.5) * 9).toFixed(2)}px`);
      } else if (type === 'tilt') {
        element.style.setProperty('--tilt-x', reset ? '0deg' : `${((0.5 - normalizedY) * 4).toFixed(2)}deg`);
        element.style.setProperty('--tilt-y', reset ? '0deg' : `${((normalizedX - 0.5) * 5).toFixed(2)}deg`);
        if (!reset) {
          element.style.setProperty('--spot-x', `${(normalizedX * 100).toFixed(1)}%`);
          element.style.setProperty('--spot-y', `${(normalizedY * 100).toFixed(1)}%`);
        }
      } else if (type === 'magnetic') {
        element.style.setProperty('--magnetic-x', reset ? '0px' : `${((normalizedX - 0.5) * 11).toFixed(2)}px`);
        element.style.setProperty('--magnetic-y', reset ? '0px' : `${((normalizedY - 0.5) * 8).toFixed(2)}px`);
      }
    });
  };

  const setSceneMotion = (scene, progress) => {
    scene.style.setProperty('--scene-p', progress.toFixed(4));

    switch (scene.dataset.scrollScene) {
      case 'essence':
        scene.style.setProperty('--scene-heading-y', `${(38 - progress * 76).toFixed(2)}px`);
        break;
      case 'story':
        scene.style.setProperty('--scene-visual-y', `${(52 - progress * 104).toFixed(2)}px`);
        scene.style.setProperty('--scene-copy-y', `${(28 - progress * 56).toFixed(2)}px`);
        scene.style.setProperty('--scene-image-y', `${(1.4 - progress * 2.8).toFixed(3)}%`);
        scene.style.setProperty('--scene-image-scale', (1.075 - progress * 0.015).toFixed(4));
        break;
      case 'menu':
        scene.style.setProperty('--scene-visual-y', `${(46 - progress * 92).toFixed(2)}px`);
        scene.style.setProperty('--scene-card-x', `${(30 - progress * 48).toFixed(2)}px`);
        scene.style.setProperty('--scene-card-y', `${(34 - progress * 68).toFixed(2)}px`);
        scene.style.setProperty('--scene-image-y', `${(1.6 - progress * 3.2).toFixed(3)}%`);
        scene.style.setProperty('--scene-image-scale', (1.085 - progress * 0.02).toFixed(4));
        break;
      case 'final':
        scene.style.setProperty('--scene-content-y', `${(42 - progress * 84).toFixed(2)}px`);
        if (finalOrbit) {
          finalOrbit.style.setProperty('--orbit-scale', (0.7 + progress * 0.52).toFixed(4));
          finalOrbit.style.setProperty('--orbit-rotate', `${(-14 + progress * 28).toFixed(2)}deg`);
        }
        break;
      default:
        break;
    }
  };

  const resetContinuousMotion = () => {
    if (hero) {
      hero.style.setProperty('--hero-shift', '0px');
      hero.style.setProperty('--hero-scale', '1.02');
      hero.style.setProperty('--hero-heading-y', '0px');
      hero.style.setProperty('--hero-heading-scale', '1');
      hero.style.setProperty('--hero-heading-opacity', '1');
      hero.style.setProperty('--hero-meta-y', '0px');
      hero.style.setProperty('--hero-meta-opacity', '1');
      hero.style.setProperty('--hero-bottom-y', '0px');
      hero.style.setProperty('--hero-bottom-opacity', '1');
    }
    heroLetters.forEach((letter) => {
      letter.style.setProperty('--letter-x', '0px');
      letter.style.setProperty('--letter-y', '0px');
      letter.style.setProperty('--letter-r', '0deg');
    });
    scenes.forEach((scene) => setSceneMotion(scene, 0.5));
    if (finalOrbit) {
      finalOrbit.style.setProperty('--orbit-scale', '1');
      finalOrbit.style.setProperty('--orbit-rotate', '0deg');
    }
  };

  const renderFrame = (now) => {
    frame = 0;
    if (measureDirty) measureLayout();

    const canMove = !reducedMotion.matches;
    const pointerWrites = pointerDirty ? readPointerUpdates() : [];
    const scrollTop = Math.max(window.scrollY, 0);
    const scrollDelta = scrollTop - lastScroll;

    if (scrollDirty) {
      if (header) {
        const navigationLocked = menuIsOpen || header.contains(document.activeElement);
        header.classList.toggle('is-scrolled', scrollTop > 24);
        if (navigationLocked || scrollTop <= 100 || scrollDelta < -2) {
          header.classList.remove('escondido');
        } else if (scrollDelta > 2) {
          header.classList.add('escondido');
        }
      }

      if (canMove) {
        if (hero && metrics.hero) {
          const range = Math.max(metrics.hero.height - metrics.viewportHeight, 1);
          const progress = clamp((scrollTop - metrics.hero.top) / range);
          hero.style.setProperty('--hero-p', progress.toFixed(4));
          const exitProgress = clamp((progress - 0.16) / 0.84);
          const softExit = exitProgress * exitProgress * (3 - 2 * exitProgress);
          const metaExit = clamp((progress - 0.26) / 0.64);
          const bottomExit = clamp((progress - 0.34) / 0.58);

          hero.style.setProperty('--hero-shift', `${(progress * 48).toFixed(2)}px`);
          hero.style.setProperty('--hero-scale', (1.09 + progress * 0.025).toFixed(4));
          hero.style.setProperty('--hero-heading-y', `${(-softExit * 30).toFixed(2)}px`);
          hero.style.setProperty('--hero-heading-scale', (1 - softExit * 0.018).toFixed(4));
          hero.style.setProperty('--hero-heading-opacity', (1 - softExit).toFixed(4));
          hero.style.setProperty('--hero-meta-y', `${(-metaExit * 12).toFixed(2)}px`);
          hero.style.setProperty('--hero-meta-opacity', (1 - metaExit).toFixed(4));
          hero.style.setProperty('--hero-bottom-y', `${(-bottomExit * 12).toFixed(2)}px`);
          hero.style.setProperty('--hero-bottom-opacity', (1 - bottomExit).toFixed(4));
        }

        scenes.forEach((scene) => {
          const sceneMetrics = metrics.scenes.get(scene);
          if (!sceneMetrics) return;
          const isPinnedStage = (
            scene.dataset.scrollScene === 'story' || scene.dataset.scrollScene === 'menu'
          ) && pinnedStages.matches;
          const progress = isPinnedStage
            ? clamp(
              (scrollTop - sceneMetrics.top + metrics.viewportHeight * 0.085) /
              Math.max(sceneMetrics.height - metrics.viewportHeight, 1)
            )
            : clamp(
              (scrollTop + metrics.viewportHeight - sceneMetrics.top) /
              Math.max(sceneMetrics.height + metrics.viewportHeight, 1)
            );
          setSceneMotion(scene, progress);
        });
      } else {
        resetContinuousMotion();
      }

      if (Math.abs(scrollDelta) > 0.5) {
        const intensity = clamp(1 + Math.abs(scrollDelta) * 0.065, 1, 3.6);
        marqueeTargetRate = scrollDelta < 0 ? -intensity : intensity;
        marqueeBoostUntil = now + 180;
      }

      lastScroll = scrollTop;
      scrollDirty = false;
    }

    if (pointerDirty) {
      writePointerUpdates(pointerWrites);
      pointerDirty = false;
    }

    if (now > marqueeBoostUntil) marqueeTargetRate = 1;
    marqueeRate += (marqueeTargetRate - marqueeRate) * 0.13;
    const activeMarqueeAnimation = refreshMarqueeAnimation();
    if (activeMarqueeAnimation && !reducedMotion.matches) {
      activeMarqueeAnimation.updatePlaybackRate(marqueeRate);
    }

    if (Math.abs(marqueeTargetRate - marqueeRate) > 0.015) scheduleFrame();
  };

  function scheduleFrame() {
    if (frame) return;
    frame = window.requestAnimationFrame(renderFrame);
  }

  const registerPointerMotion = (element, type) => {
    if (!element) return;
    const state = { type, active: false, clientX: 0, clientY: 0 };
    pointerStates.set(element, state);

    element.addEventListener('pointermove', (event) => {
      if (reducedMotion.matches || !finePointer.matches || event.pointerType === 'touch') return;
      state.active = true;
      state.clientX = event.clientX;
      state.clientY = event.clientY;
      pointerDirty = true;
      scheduleFrame();
    }, { passive: true });

    element.addEventListener('pointerleave', () => {
      state.active = false;
      pointerDirty = true;
      scheduleFrame();
    });
  };

  registerPointerMotion(hero, 'hero');
  document.querySelectorAll('[data-tilt]').forEach((element) => registerPointerMotion(element, 'tilt'));
  document.querySelectorAll('[data-magnetic]').forEach((element) => registerPointerMotion(element, 'magnetic'));

  window.addEventListener('scroll', () => {
    scrollDirty = true;
    scheduleFrame();
  }, { passive: true });

  window.addEventListener('resize', () => {
    measureDirty = true;
    scrollDirty = true;
    scheduleFrame();
  }, { passive: true });

  window.addEventListener('load', () => {
    measureDirty = true;
    scrollDirty = true;
    scheduleFrame();
  }, { once: true });

  document.fonts?.ready.then(() => {
    measureDirty = true;
    scrollDirty = true;
    scheduleFrame();
  });

  const handleMotionPreference = () => {
    if (reducedMotion.matches) {
      revealElements.forEach((element) => element.classList.add('is-visible', 'reveal-complete'));
      counterFrames.forEach((counterFrameId) => window.cancelAnimationFrame(counterFrameId));
      counterFrames.clear();
      document.querySelectorAll('[data-counter]').forEach(finishCounter);
    }
    if (reducedMotion.matches || !finePointer.matches) {
      pointerStates.forEach((state) => { state.active = false; });
      pointerDirty = true;
    }
    measureDirty = true;
    scrollDirty = true;
    syncMarqueePlayback();
    scheduleFrame();
  };

  document.addEventListener('madero:motionchange', handleMotionPreference);

  if (typeof finePointer.addEventListener === 'function') {
    finePointer.addEventListener('change', handleMotionPreference);
    pinnedStages.addEventListener('change', handleMotionPreference);
  } else {
    finePointer.addListener(handleMotionPreference);
    pinnedStages.addListener(handleMotionPreference);
  }

  measureLayout();
  scheduleFrame();
  syncMarqueePlayback();

  if (window.__landingMotionFallback) {
    window.clearTimeout(window.__landingMotionFallback);
    window.__landingMotionFallback = 0;
  }
})();
