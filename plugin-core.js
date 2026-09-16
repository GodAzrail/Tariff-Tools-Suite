// plugin-core.js
// Общий utility-слой проекта

// ==================== Существующие функции (оставлены без изменений) ====================

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
  localStorage.setItem(key, JSON.stringify(value));
}

function createSidebar(title, id = 'tariff-tools-sidebar') {
  // Здесь оставлена оригинальная логика создания сайдбара (если была)
  // Можно расширять при необходимости
  console.log('[plugin-core] createSidebar вызван:', title);
}

function calculateResponsiveHeight() {
  // Оригинальная логика расчёта высоты
  return window.innerHeight * 0.85;
}

function diagnoseModules() {
  console.log('[plugin-core] Диагностика модулей...');
}

// ==================== НОВЫЕ ФУНКЦИИ ДЛЯ ПОДДЕРЖКИ ПВЗ ====================

/**
 * Определяет, является ли текущий тариф тарифом ПВЗ
 */
function isPVZTariff() {
  // Ищем бейдж "ПВЗ"
  const badges = document.querySelectorAll('span[class*="_badge_"], [class*="badge"]');
  for (const badge of badges) {
    if (badge.textContent && badge.textContent.includes('ПВЗ')) {
      return true;
    }
  }

  // Дополнительная проверка по заголовку или другим элементам (можно расширять)
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

    // Ждём появления диалога
    const dialog = await waitForElement('dialog[open], [role="dialog"]', 8000);

    if (!dialog) {
      console.warn('[PVZ] Диалог не найден');
      return false;
    }

    // Ищем кнопку "Доставка в ПВЗ"
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

// ==================== Экспорт функций ====================

// Если в проекте используется window или глобальный объект — можно добавить:
window.TariffToolsCore = {
  isPVZTariff,
  waitForElement,
  handlePVZTypeDialog,
  getCurrentRoute,
  // ... другие функции при необходимости
};

console.log('[plugin-core] Загружен с поддержкой ПВЗ');

// ==================== SPA ROUTER OBSERVER ====================
// Отслеживает смену URL в Single Page Application без перезагрузки страницы
(function initSPARouter() {
  let lastUrl = location.href;
  
  const observer = new MutationObserver(() => {
    const currentUrl = location.href;
    if (currentUrl !== lastUrl) {
      lastUrl = currentUrl;
      console.log('[plugin-core] SPA маршрут изменился:', currentUrl);
      // Генерируем кастомное событие, чтобы другие скрипты могли на него реагировать
      window.dispatchEvent(new CustomEvent('spa-route-changed', { detail: currentUrl }));
    }
  });

  const startObserving = () => observer.observe(document.body, { childList: true, subtree: true });
  
  if (document.body) {
    startObserving();
  } else {
    window.addEventListener('DOMContentLoaded', startObserving, { once: true });
  }
})();

// ==================== UI TWEAKS OBSERVER ====================
// Заменяет длинные тексты интерфейса на компактные аббревиатуры
(function initUITweaks() {
  const observer = new MutationObserver(() => {
    // Ищем элементы бейджей (по тем же классам, что мы использовали для ПВЗ)
    const badges = document.querySelectorAll('[class*="_badge_"], [class*="badge"]');
    
    for (const badge of badges) {
      // Проверяем точное совпадение, чтобы случайно не сломать другие бейджи
      if (badge.textContent && badge.textContent.trim() === 'Курьерская доставка') {
        badge.textContent = 'КД';
        badge.title = 'Курьерская доставка'; // Оставляем полное название при наведении мышкой
      }
    }
  });

  // Запускаем слежение за всем документом
  const startObserving = () => observer.observe(document.body, { childList: true, subtree: true });
  
  if (document.body) {
    startObserving();
  } else {
    window.addEventListener('DOMContentLoaded', startObserving, { once: true });
  }
})();