// plugin-core.js
// Общий utility-слой проекта
(function() {
  'use strict';

  function getCurrentRoute() {
    const path = window.location.pathname;
    if (path.includes('/configurator/tariffs')) return 'tariffs';
    if (path.includes('/configurator/del-orgs')) return 'del-orgs';
    return 'unknown';
  }

  function getLocalStorageItem(key) {
    try {
      return JSON.parse(localStorage.getItem(key));
    } catch {
      return null;
    }
  }

  function setLocalStorageItem(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch (e) {
      console.warn('[plugin-core] Ошибка сохранения localStorage:', key, e);
    }
  }

  function closeAllSidebars() {
    const sidebarIds = [
      'tariff-tools-sidebar',
      'tariff-export-sidebar',
      'tariff-create-config-sidebar',
      'tariff-create-progress-sidebar',
      'tariff-update-sidebar',
      'tariff-rename-config-sidebar',
      'tariff-rename-progress-sidebar',
      'pvz-creator-sidebar'
    ];

    sidebarIds.forEach(id => {
      const el = document.getElementById(id);
      if (el) {
        el.remove();
      }
    });

    if (window.pvzTariffCreator && typeof window.pvzTariffCreator.hideSidebar === 'function') {
      window.pvzTariffCreator.sidebar = null;
    }
    if (window.tariffCreatorPro && typeof window.tariffCreatorPro.hideSidebar === 'function') {
      window.tariffCreatorPro.sidebar = null;
    }
    if (window.tariffUpdaterPro && typeof window.tariffUpdaterPro.hideSidebar === 'function') {
      window.tariffUpdaterPro.sidebar = null;
    }
    if (window.tariffRenamerPro && typeof window.tariffRenamerPro.hideSidebar === 'function') {
      window.tariffRenamerPro.sidebar = null;
    }
    if (window.tariffExportPro && typeof window.tariffExportPro.hideSidebar === 'function') {
      window.tariffExportPro.sidebar = null;
    }
  }

  function createSidebar(title, id = 'tariff-tools-sidebar') {
    console.log('[plugin-core] createSidebar вызван:', title, id);
  }

  function calculateResponsiveHeight() {
    return Math.round(window.innerHeight * 0.85);
  }

  function diagnoseModules() {
    console.log('[plugin-core] Диагностика модулей...');
  }

  /**
   * Определяет, является ли текущий тариф тарифом ПВЗ
   */
  function isPVZTariff() {
    const badges = document.querySelectorAll('span[class*="_badge_"], [class*="badge"]');
    for (const badge of badges) {
      if (badge.textContent && badge.textContent.includes('ПВЗ')) {
        return true;
      }
    }

    const title = document.querySelector('h2');
    if (title && title.textContent.includes('ПВЗ')) {
      return true;
    }

    return false;
  }

  /**
   * Универсальная функция ожидания появления элемента в DOM
   */
  function waitForElement(selector, timeout = 15000) {
    return new Promise((resolve, reject) => {
      const element = document.querySelector(selector);
      if (element) {
        resolve(element);
        return;
      }

      const observer = new MutationObserver(() => {
        const el = document.querySelector(selector);
        if (el) {
          observer.disconnect();
          resolve(el);
        }
      });

      observer.observe(document.body, {
        childList: true,
        subtree: true
      });

      setTimeout(() => {
        observer.disconnect();
        reject(new Error(`Элемент ${selector} не появился за ${timeout}мс`));
      }, timeout);
    });
  }

  /**
   * Ожидает появления диалога выбора типа тарифа и автоматически нажимает "Доставка в ПВЗ"
   */
  async function handlePVZTypeDialog() {
    try {
      console.log('[PVZ] Ожидаем появления диалога выбора типа тарифа...');
      const dialog = await waitForElement('dialog[open], [role="dialog"]', 8000);

      if (!dialog) {
        console.warn('[PVZ] Диалог не найден');
        return false;
      }

      const buttons = dialog.querySelectorAll('button');
      let pvzButton = null;

      for (const btn of buttons) {
        const text = btn.textContent.trim();
        if (text.includes('Доставка в ПВЗ') || text.includes('ПВЗ')) {
          pvzButton = btn;
          break;
        }
      }

      if (pvzButton) {
        console.log('[PVZ] Нажимаем кнопку "Доставка в ПВЗ"');
        pvzButton.click();
        return true;
      } else {
        console.warn('[PVZ] Кнопка "Доставка в ПВЗ" не найдена в диалоге');
        return false;
      }
    } catch (error) {
      console.error('[PVZ] Ошибка при обработке диалога:', error);
      return false;
    }
  }

  // ==================== CLEAN DOM MODE ====================
  /**
   * Включает режим "чистого DOM":
   * Снимает все модификации расширения, чтобы инспектор или экспорт
   * могли захватывать оригинальный исходный код страниц и модальных окон.
   */
  function enterCleanDOMMode() {
    console.log('[plugin-core] 🧹 Включение режима чистого DOM...');
    window.__tariffCleanDOMMode = true;
    window.__disableResizeObservers = true;
    window.__tariffExportPauseCustomizer = true;

    // 1. Восстанавливаем оригинальный DOM кастомайзера тарифов
    if (window.tariffCustomizerInstance && typeof window.tariffCustomizerInstance.restoreOriginalDOM === 'function') {
      try {
        window.tariffCustomizerInstance.restoreOriginalDOM();
      } catch (err) {
        console.warn('[plugin-core] Ошибка при restoreOriginalDOM:', err);
      }
    }

    // 2. Убираем навигационные кнопки Pro
    if (window.tariffExportPro && typeof window.tariffExportPro.removeNavigationButtons === 'function') {
      try {
        window.tariffExportPro.removeNavigationButtons();
      } catch (err) {
        console.warn('[plugin-core] Ошибка при removeNavigationButtons:', err);
      }
    }

    // 3. Закрываем все открытые сайдбары и модалы расширения
    closeAllSidebars();
    if (window.tariffManager && typeof window.tariffManager.close === 'function') {
      window.tariffManager.close();
    }
    const tmModal = document.getElementById('tariff-manager-modal');
    if (tmModal) {
      tmModal.remove();
    }

    // 4. Удаляем панели автозаполнения и тулбары, если открыты
    const afPanel = document.getElementById('af-tariff-panel');
    if (afPanel) {
      afPanel.remove();
    }
    const afLiftingPanel = document.getElementById('af-lifting-panel');
    if (afLiftingPanel) {
      afLiftingPanel.remove();
    }

    // 5. Возвращаем оригинальные названия бейджей
    const badges = document.querySelectorAll('[class*="_badge_"], [class*="badge"]');
    for (const badge of badges) {
      if (badge.textContent && badge.textContent.trim() === 'КД' && badge.title === 'Курьерская доставка') {
        badge.textContent = 'Курьерская доставка';
        badge.removeAttribute('title');
      }
    }

    console.log('[plugin-core] ✅ Режим чистого DOM активирован');
  }

  /**
   * Выключает режим чистого DOM и восстанавливает привычную работу расширения.
   */
  function exitCleanDOMMode() {
    console.log('[plugin-core] 🔄 Выключение режима чистого DOM...');
    window.__tariffCleanDOMMode = false;
    window.__disableResizeObservers = false;
    window.__tariffExportPauseCustomizer = false;

    // 1. Восстанавливаем кнопки Pro
    if (window.tariffExportPro && typeof window.tariffExportPro.checkAndAddButtons === 'function') {
      try {
        window.tariffExportPro.checkAndAddButtons();
      } catch (err) {
        console.warn('[plugin-core] Ошибка при checkAndAddButtons:', err);
      }
    }

    // 2. Восстанавливаем кастомизацию тарифов
    if (window.tariffCustomizerInstance && typeof window.tariffCustomizerInstance.startInitialization === 'function') {
      try {
        window.tariffCustomizerInstance.startInitialization();
      } catch (err) {
        console.warn('[plugin-core] Ошибка при startInitialization:', err);
      }
    }

    console.log('[plugin-core] ✅ Обычный режим расширения восстановлен');
  }

  // ==================== Экспорт функций ====================
  window.TariffToolsCore = {
    isPVZTariff,
    waitForElement,
    handlePVZTypeDialog,
    getCurrentRoute,
    getLocalStorageItem,
    setLocalStorageItem,
    closeAllSidebars,
    createSidebar,
    calculateResponsiveHeight,
    diagnoseModules,
    enterCleanDOMMode,
    exitCleanDOMMode
  };

  console.log('[plugin-core] Загружен и инициализирован');

  // ==================== SPA ROUTER OBSERVER ====================
  (function initSPARouter() {
    let lastUrl = location.href;
    
    const observer = new MutationObserver(() => {
      const currentUrl = location.href;
      if (currentUrl !== lastUrl) {
        lastUrl = currentUrl;
        console.log('[plugin-core] SPA маршрут изменился:', currentUrl);
        window.dispatchEvent(new CustomEvent('spa-route-changed', { detail: currentUrl }));
      }
    });

    const startObserving = () => {
      if (document.body) {
        observer.observe(document.body, { childList: true, subtree: true });
      }
    };
    
    if (document.body) {
      startObserving();
    } else {
      window.addEventListener('DOMContentLoaded', startObserving, { once: true });
    }
  })();

  // ==================== UI TWEAKS OBSERVER ====================
  (function initUITweaks() {
    let debounceTimer = null;

    const applyTweaks = () => {
      if (window.__tariffCleanDOMMode) return;
      const badges = document.querySelectorAll('[class*="_badge_"], [class*="badge"]');
      for (const badge of badges) {
        if (badge.textContent && badge.textContent.trim() === 'Курьерская доставка') {
          badge.textContent = 'КД';
          badge.title = 'Курьерская доставка';
        }
      }
    };

    const observer = new MutationObserver(() => {
      if (debounceTimer) return;
      debounceTimer = setTimeout(() => {
        debounceTimer = null;
        applyTweaks();
      }, 150);
    });

    const startObserving = () => {
      if (document.body) {
        observer.observe(document.body, { childList: true, subtree: true });
        applyTweaks();
      }
    };
    
    if (document.body) {
      startObserving();
    } else {
      window.addEventListener('DOMContentLoaded', startObserving, { once: true });
    }
  })();
})();
