(function () {
  if (window.TariffResizeCore && typeof window.TariffResizeCore.watchDialog === 'function') {
    console.log('[ResizeCore] TariffResizeCore with watchDialog already exists');
    return;
  }

  const BLOCKED_PATH_PREFIX = '/configurator/tariffs';

  function isBlockedPage() {
    try {
      return window.location.pathname.startsWith(BLOCKED_PATH_PREFIX);
    } catch (e) {
      return false;
    }
  }

  function getResponsiveHeight(percent = 80, minHeight = 400, maxHeight = 900) {
    const screenHeight = window.innerHeight || document.documentElement.clientHeight || 900;
    let calculatedHeight = Math.round(screenHeight * (percent / 100));
    calculatedHeight = Math.max(minHeight, Math.min(calculatedHeight, maxHeight));
    return calculatedHeight;
  }

  function isVisible(el) {
    if (!el) return false;
    const style = window.getComputedStyle(el);
    return style.display !== 'none' && style.visibility !== 'hidden';
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

  function createObserver({ dialogId, resizedAttr, delay = 400, resizeFn, rowCountFn, observerWindowKey }) {
    if (isBlockedPage()) {
      return createNoopObserver(observerWindowKey);
    }

    const observer = new MutationObserver(() => {
      if (window.__disableResizeObservers) return;
      if (isBlockedPage()) return; // Защита от SPA-переходов

      const dialog = document.getElementById(dialogId);
      if (!dialog || !isVisible(dialog) || dialog.hasAttribute(resizedAttr)) return;

      setTimeout(() => {
        try {
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
          console.error('[ResizeCore] resize error for', dialogId, e);
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

  // Compatibility API expected by newer wrappers
  function watchDialog(options = {}) {
    const {
      observerKey,
      startKey,
      stopKey,
      id,
      flag,
      delay = 400,
      resize,
      getRowCount
    } = options;

    const resizedAttr = flag ? `data-${flag}` : 'data-resized';

    const start = () => {
      if (isBlockedPage()) {
        console.log('[ResizeCore] watchDialog skipped on blocked page:', window.location.pathname, id);
        return createNoopObserver(observerKey);
      }

      // Initial pass
      setTimeout(() => {
        if (window.__disableResizeObservers) return;
        if (isBlockedPage()) return; // Доп. защита при инициализации
        const dialog = document.getElementById(id);
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
          console.error('[ResizeCore] initial watchDialog resize error for', id, e);
        }
      }, Math.max(delay, 300));

      return createObserver({
        dialogId: id,
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
    disabled: isBlockedPage(),
    getResponsiveHeight,
    applyDialogPosition,
    createObserver,
    watchDialog,
    isVisible,
  };

  if (isBlockedPage()) {
    console.log('[ResizeCore] Compatibility mode enabled; resize disabled on /configurator/tariffs');
  } else {
    console.log('[ResizeCore] Compatibility mode enabled with watchDialog');
  }

  // Обновляем статус блокировки при переходе по ссылкам SPA
  window.addEventListener('spa-route-changed', () => {
    window.TariffResizeCore.disabled = isBlockedPage();
  });
})();