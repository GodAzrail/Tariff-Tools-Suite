(function () {
  'use strict';

  if (window.TariffResizeCore && typeof window.TariffResizeCore.watchDialog === 'function') {
    console.log('[ResizeCore] TariffResizeCore with watchDialog already exists');
    return;
  }

  function isBlockedPage() {
    // Ресайз модалок отключен на страницах тарифов
    if (window.location.pathname.includes('/tariffs')) {
      return true;
    }
    return false;
  }

  function getResponsiveHeight(percent = 85, minHeight = 450, maxHeight = 950) {
    const screenHeight = window.innerHeight || document.documentElement.clientHeight || 900;
    let calculatedHeight = Math.round(screenHeight * (percent / 100));
    calculatedHeight = Math.max(minHeight, Math.min(calculatedHeight, maxHeight));
    return calculatedHeight;
  }

  function isVisible(el) {
    if (!el) return false;
    const style = window.getComputedStyle(el);
    return style.display !== 'none' && style.visibility !== 'hidden' && (el.offsetWidth > 0 || el.offsetHeight > 0 || el.open);
  }

  function findDialog(id, selector, title) {
    // 1. По ID, если передан
    if (id) {
      const el = document.getElementById(id);
      if (el) return el;
    }
    // 2. По селектору, если передан
    if (selector) {
      try {
        const el = document.querySelector(selector);
        if (el) return el;
      } catch (e) {}
    }
    // 3. Поиск среди открытых диалогов по заголовку
    if (title) {
      const dialogs = document.querySelectorAll('dialog[open], [role="dialog"]');
      const targetTitle = title.toLowerCase().trim();
      for (const dlg of dialogs) {
        if (dlg.hasAttribute('data-tts-inspector-ignore')) continue;
        const titleEl = dlg.querySelector('._title_1ghey_45, [class*="title"], h1, h2, h3, [role="heading"]');
        if (titleEl && titleEl.textContent && titleEl.textContent.toLowerCase().trim().includes(targetTitle)) {
          return dlg;
        }
      }
    }
    return null;
  }

  function applyDialogPosition(dialog, responsiveHeight) {
    if (!dialog || isBlockedPage()) return false;

    dialog.style.height = responsiveHeight + 'px';
    dialog.style.minHeight = responsiveHeight + 'px';
    dialog.style.maxHeight = responsiveHeight + 'px';
    dialog.style.top = Math.max(0, (window.innerHeight - responsiveHeight) / 2) + 'px';
    return true;
  }

  function createNoopObserver(observerWindowKey) {
    const noopObserver = {
      observe() {},
      disconnect() {},
      takeRecords() { return []; }
    };
    if (observerWindowKey) {
      window[observerWindowKey] = noopObserver;
    }
    return noopObserver;
  }

  function createObserver({ dialogId, selector, title, resizedAttr, delay = 350, resizeFn, rowCountFn, observerWindowKey }) {
    if (isBlockedPage()) {
      return createNoopObserver(observerWindowKey);
    }

    const observer = new MutationObserver(() => {
      if (window.__disableResizeObservers) return;
      if (isBlockedPage()) return;

      const dialog = findDialog(dialogId, selector, title);
      if (!dialog || !isVisible(dialog) || dialog.hasAttribute(resizedAttr)) return;

      setTimeout(() => {
        try {
          if (window.__disableResizeObservers) return;
          const success = typeof resizeFn === 'function' ? resizeFn(dialog) : false;
          if (success) {
            dialog.setAttribute(resizedAttr, 'true');
            if (typeof rowCountFn === 'function') {
              const count = rowCountFn(dialog);
              if (count !== undefined && count !== null) {
                dialog.setAttribute(resizedAttr + '-row-count', String(count));
              }
            }
          }
        } catch (e) {
          console.error('[ResizeCore] resize error for', dialogId || title, e);
        }
      }, delay);
    });

    const start = () => {
      if (!document.body) return;
      observer.observe(document.body, { childList: true, subtree: true });
    };

    if (document.body) {
      start();
    } else {
      window.addEventListener('DOMContentLoaded', start, { once: true });
    }

    if (observerWindowKey) {
      window[observerWindowKey] = observer;
    }
    return observer;
  }

  // Compatibility API expected by dialog resizers
  function watchDialog(options = {}) {
    const {
      observerKey,
      startKey,
      stopKey,
      id,
      selector,
      title,
      flag,
      delay = 350,
      resize,
      getRowCount
    } = options;

    const resizedAttr = flag ? `data-${flag}` : 'data-resized';

    const start = () => {
      if (isBlockedPage()) {
        return createNoopObserver(observerKey);
      }

      // Начальный проход
      setTimeout(() => {
        if (window.__disableResizeObservers) return;
        if (isBlockedPage()) return;
        const dialog = findDialog(id, selector, title);
        if (!dialog || dialog.hasAttribute(resizedAttr)) return;

        try {
          const success = typeof resize === 'function' ? resize(dialog) : false;
          if (success) {
            dialog.setAttribute(resizedAttr, 'true');
            if (typeof getRowCount === 'function') {
              const count = getRowCount(dialog);
              if (count !== undefined && count !== null) {
                dialog.setAttribute(resizedAttr + '-row-count', String(count));
              }
            }
          }
        } catch (e) {
          console.error('[ResizeCore] initial watchDialog resize error for', id || title, e);
        }
      }, Math.max(delay, 250));

      return createObserver({
        dialogId: id,
        selector,
        title,
        resizedAttr,
        delay,
        resizeFn: resize,
        rowCountFn: getRowCount,
        observerWindowKey: observerKey
      });
    };

    const stop = () => {
      if (observerKey && window[observerKey] && typeof window[observerKey].disconnect === 'function') {
        try {
          window[observerKey].disconnect();
        } catch (e) {
          console.error('[ResizeCore] stop error for', observerKey, e);
        }
      }
      if (observerKey) {
        window[observerKey] = null;
      }
    };

    if (startKey) {
      window[startKey] = start;
    }
    if (stopKey) {
      window[stopKey] = stop;
    }

    return start();
  }

  window.TariffResizeCore = {
    disabled: false,
    getResponsiveHeight,
    applyDialogPosition,
    createObserver,
    watchDialog,
    findDialog,
    isVisible,
  };

  console.log('[ResizeCore] Ядро ресайза диалогов инициализировано (универсальный режим)');

  window.addEventListener('spa-route-changed', () => {
    window.TariffResizeCore.disabled = false;
  });
})();
