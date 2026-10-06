(() => {
  'use strict';

  const page = document.querySelector('[data-dashboard]');
  if (!page) return;

  const listenToQuery = (query, listener) => {
    if (query?.addEventListener) query.addEventListener('change', listener);
    else query?.addListener?.(listener);
  };

  // O menu continua sendo um <details> nativo, inclusive sem JavaScript.
  const navigation = document.querySelector('[data-dashboard-navigation]');
  const desktopNavigation = window.matchMedia?.('(min-width: 1100px)');
  if (navigation && desktopNavigation) {
    let wasDesktop = desktopNavigation.matches;
    navigation.open = wasDesktop;
    listenToQuery(desktopNavigation, (event) => {
      if (event.matches === wasDesktop) return;
      wasDesktop = event.matches;
      navigation.open = wasDesktop;
    });
    document.addEventListener('keydown', (event) => {
      if (event.key !== 'Escape' || desktopNavigation.matches || !navigation.open) return;
      navigation.open = false;
      navigation.querySelector('summary')?.focus();
    });
  }

  // A busca filtra somente as linhas; os títulos e as ações permanecem no lugar.
  const search = page.querySelector('[data-stock-search]');
  const searchControl = page.querySelector('[data-stock-search-control]');
  const filterEmpty = page.querySelector('[data-stock-filter-empty]');
  const filterCount = page.querySelector('[data-stock-filter-count]');
  const rows = [...page.querySelectorAll('[data-stock-row]')];
  const normalize = (value) => String(value || '').normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('pt-BR').replace(/\s+/g, ' ').trim();

  if (search) {
    const searchableRows = rows.map((row) => ({
      row,
      text: normalize(row.dataset.search || row.textContent),
    }));
    const filterRows = () => {
      const query = normalize(search.value);
      let visible = 0;
      searchableRows.forEach(({ row, text }) => {
        row.hidden = !text.includes(query);
        if (!row.hidden) visible += 1;
      });
      if (filterEmpty) filterEmpty.hidden = rows.length === 0 || visible !== 0;
      if (filterCount) filterCount.textContent = `${visible} de ${rows.length} produtos`;
    };
    search.addEventListener('input', filterRows);
    search.addEventListener('search', filterRows);
    if (searchControl) searchControl.hidden = rows.length === 0;
    filterRows();
    // Restaura corretamente a busca que o navegador preservou ao voltar à página.
    window.addEventListener('pageshow', filterRows);
  }

  page.querySelectorAll('[data-product-image]').forEach((image) => {
    const showFallback = () => {
      image.hidden = true;
      image.closest('[data-product-thumb]')?.classList.add('has-image-error');
    };
    image.addEventListener('error', showFallback, { once: true });
    if (image.complete && image.naturalWidth === 0) showFallback();
  });

  document.querySelectorAll('[data-dashboard-logout]').forEach((link) => {
    link.addEventListener('click', (event) => {
      if (!window.confirm('Deseja sair da área interna do Madero?')) event.preventDefault();
    });
  });

  // Usa o fuso do visitante sem alterar os valores e links renderizados pelo servidor.
  const formatDate = (element, options) => {
    const raw = element.getAttribute('datetime');
    if (!raw) return;
    // Datas sem horário não devem retroceder um dia pela conversão UTC.
    const date = new Date(/^\d{4}-\d{2}-\d{2}$/.test(raw) ? `${raw}T12:00:00` : raw);
    if (!Number.isFinite(date.getTime())) return;
    try { element.textContent = new Intl.DateTimeFormat('pt-BR', options).format(date); }
    catch (_) { /* A data SSR continua disponível em navegadores sem Intl completo. */ }
  };
  page.querySelectorAll('[data-dashboard-date]').forEach((element) => {
    const hasTime = (element.getAttribute('datetime') || '').includes('T');
    formatDate(element, {
      weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
      ...(hasTime ? { hour: '2-digit', minute: '2-digit' } : {}),
    });
  });
  page.querySelectorAll('[data-movement-date]').forEach((element) => formatDate(element, {
    day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
  }));

  // A interface nasce no estado final: animação nunca é requisito para ler os dados.
  const motionQuery = window.matchMedia?.('(prefers-reduced-motion: reduce)');
  const animations = new Set();
  let observer = null;
  let entrancesActive = true;
  const reducedMotion = () => {
    let savedReduced = false;
    try { savedReduced = window.localStorage.getItem('madero-motion') === 'reduced'; }
    catch (_) { /* Armazenamento bloqueado não impede o uso do painel. */ }
    return Boolean(motionQuery?.matches || savedReduced
      || document.documentElement.classList.contains('motion-reduced'));
  };
  const cancelMotion = () => {
    animations.forEach((animation) => animation.cancel());
    animations.clear();
    entrancesActive = false;
    observer?.disconnect();
  };
  const animate = (element, keyframes) => {
    if (typeof element.animate !== 'function') return;
    try {
      const animation = element.animate(keyframes, {
        duration: 240, easing: 'ease-out', fill: 'backwards',
      });
      animations.add(animation);
      animation.onfinish = () => animations.delete(animation);
      animation.oncancel = () => animations.delete(animation);
    } catch (_) { /* Sem WAAPI, o estado final já está no HTML/CSS. */ }
  };

  // Uma entrada curta reforça a hierarquia sem adiar o acesso aos dados.
  if (!document.hidden && !reducedMotion()) {
    const entrances = new Map();
    page.querySelectorAll('[data-dashboard-reveal]').forEach((element) => {
      entrances.set(element, [
        { opacity: 0.88, transform: 'translateY(6px)' },
        { opacity: 1, transform: 'translateY(0)' },
      ]);
    });
    page.querySelectorAll('[data-dashboard-bar]').forEach((element) => {
      entrances.set(element, [{ transform: 'scaleX(0.96)' }, { transform: 'scaleX(1)' }]);
    });
    if (typeof window.IntersectionObserver === 'function') {
      observer = new window.IntersectionObserver((entries) => {
        if (!entrancesActive || document.hidden || reducedMotion()) return;
        entries.forEach((entry) => {
          if (!entry.isIntersecting || !entrances.has(entry.target)) return;
          animate(entry.target, entrances.get(entry.target));
          entrances.delete(entry.target);
          observer.unobserve(entry.target);
        });
        if (entrances.size === 0) observer.disconnect();
      }, { threshold: 0.08 });
      entrances.forEach((_, element) => observer.observe(element));
    } else {
      entrances.forEach((frames, element) => animate(element, frames));
    }
  }

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) cancelMotion();
  });
  window.addEventListener('pagehide', cancelMotion);
  window.addEventListener('pageshow', (event) => {
    if (event.persisted) cancelMotion();
  });
  window.addEventListener('storage', (event) => {
    if (event.key === null || event.key === 'madero-motion') cancelMotion();
  });
  listenToQuery(motionQuery, cancelMotion);
})();
