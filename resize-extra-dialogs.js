// ============================================================================
// Tariff Tools Suite - Extra Dialogs Resizer (resize-extra-dialogs.js)
// Ресайз модалок "Подъем на этаж" и "Квоты"
// ============================================================================
(function () {
  'use strict';

  if (window.__tariffResizeExtraLoaded) return;
  window.__tariffResizeExtraLoaded = true;

  console.log('[ResizeExtra] Модуль ресайза дополнительных диалогов загружен');

  function isVisible(el) {
    if (!el) return false;
    const style = window.getComputedStyle(el);
    return style.display !== 'none' && style.visibility !== 'hidden' && (el.offsetWidth > 0 || el.offsetHeight > 0 || el.open);
  }

  function getResponsiveHeight(percent = 85, minH = 500, maxH = 950) {
    const screenHeight = window.innerHeight || 900;
    return Math.max(minH, Math.min(Math.round(screenHeight * (percent / 100)), maxH));
  }

  function resizeLiftingDialog() {
    // Ищем диалог подъема на этаж (по таблице lifting-table или заголовку)
    const dialogs = document.querySelectorAll('dialog[open], [role="dialog"]');
    for (const dlg of dialogs) {
      if (dlg.hasAttribute('data-tts-inspector-ignore') || dlg.hasAttribute('data-lifting-resized')) continue;
      
      const hasLiftingTable = dlg.querySelector('table[test-id="lifting-table"]');
      const titleEl = dlg.querySelector('._title_1ghey_45, [class*="title"], h1, h2, h3');
      const isLifting = hasLiftingTable || (titleEl && titleEl.textContent && titleEl.textContent.trim().toLowerCase().includes('подъем на этаж'));

      if (isLifting && isVisible(dlg)) {
        const responsiveH = getResponsiveHeight(88, 620, 950);
        const responsiveW = Math.min(window.innerWidth - 60, 1200);

        dlg.style.height = responsiveH + 'px';
        dlg.style.minHeight = responsiveH + 'px';
        dlg.style.maxHeight = responsiveH + 'px';
        dlg.style.width = responsiveW + 'px';
        dlg.style.minWidth = responsiveW + 'px';
        dlg.style.maxWidth = responsiveW + 'px';
        dlg.style.top = Math.max(10, (window.innerHeight - responsiveH) / 2) + 'px';
        dlg.style.overflow = 'hidden';

        const body = dlg.querySelector('._body_1ghey_73, [class*="body"]');
        if (body) {
          body.style.maxHeight = (responsiveH - 70) + 'px';
          body.style.overflowY = 'auto';
        }

        dlg.setAttribute('data-lifting-resized', 'true');
        console.log('✅ Диалог "Подъем на этаж" увеличен:', { width: responsiveW, height: responsiveH });
        return true;
      }
    }
    return false;
  }

  function resizeQuoteDialog() {
    const dlg = document.getElementById('quote-dialog');
    if (!dlg || !isVisible(dlg) || dlg.hasAttribute('data-quote-resized')) return false;

    const responsiveH = getResponsiveHeight(75, 520, 750);
    const responsiveW = Math.min(window.innerWidth - 80, 1100);

    dlg.style.height = responsiveH + 'px';
    dlg.style.minHeight = responsiveH + 'px';
    dlg.style.maxHeight = responsiveH + 'px';
    dlg.style.width = responsiveW + 'px';
    dlg.style.minWidth = responsiveW + 'px';
    dlg.style.maxWidth = responsiveW + 'px';
    dlg.style.top = Math.max(10, (window.innerHeight - responsiveH) / 2) + 'px';

    const body = dlg.querySelector('._body_1ghey_73, [class*="body"]');
    if (body) {
      body.style.maxHeight = (responsiveH - 90) + 'px';
      body.style.overflowY = 'auto';
    }

    dlg.setAttribute('data-quote-resized', 'true');
    console.log('✅ Диалог "Квоты" увеличен:', { width: responsiveW, height: responsiveH });
    return true;
  }

  function isPageOk() {
    if (window.location.pathname.includes('/tariffs')) return false;
    return window.location.pathname.includes('/configurator/');
  }

  function processExtraDialogs() {
    if (window.__disableResizeObservers) return;
    if (!isPageOk()) return;
    resizeLiftingDialog();
    resizeQuoteDialog();
  }

  let debounceTimer = null;
  const observer = new MutationObserver(() => {
    if (window.__disableResizeObservers) return;
    if (debounceTimer) return;
    debounceTimer = setTimeout(() => {
      debounceTimer = null;
      processExtraDialogs();
    }, 150);
  });

  if (document.body) {
    observer.observe(document.body, { childList: true, subtree: true });
  } else {
    window.addEventListener('DOMContentLoaded', () => {
      observer.observe(document.body, { childList: true, subtree: true });
    }, { once: true });
  }

  window.addEventListener('resize', () => {
    if (window.__disableResizeObservers) return;
    processExtraDialogs();
  }, { passive: true });

  window.addEventListener('spa-route-changed', () => {
    setTimeout(processExtraDialogs, 300);
  });

  setTimeout(processExtraDialogs, 500);
})();
