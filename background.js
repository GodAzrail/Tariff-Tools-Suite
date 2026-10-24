// ============================================================================
// Tariff Tools Suite - Background Service Worker (background.js)
// Обеспечивает невидимый сбор данных в фоне (active: false), чтобы браузер
// не переключался на вкладку тарифа и оставался на окне панели управления.
// ============================================================================
'use strict';

console.log('[TTS-Background] Service Worker активен');

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'open_background_tab' || message.action === 'open_active_tab') {
    const url = message.url;
    if (!url) {
      sendResponse({ success: false, error: 'URL не указан' });
      return true;
    }

    const isActive = message.action === 'open_active_tab';
    // Открываем вкладку (active: false для фонового сканирования, active: true для применения правок)
    chrome.tabs.create({
      url,
      active: isActive
    }, (tab) => {
      if (chrome.runtime.lastError) {
        console.warn('[TTS-Background] Ошибка открытия вкладки:', chrome.runtime.lastError);
        sendResponse({ success: false, error: chrome.runtime.lastError.message });
      } else {
        sendResponse({ success: true, tabId: tab.id });
      }
    });
    return true; // Асинхронный ответ
  }

  if (message.action === 'close_tab' && message.tabId) {
    chrome.tabs.remove(message.tabId, () => {
      if (chrome.runtime.lastError) {
        // Игнорируем ошибку, если вкладка уже закрыта сама
      }
      sendResponse({ success: true });
    });
    return true;
  }

  if (message.action === 'close_current_tab' && sender.tab?.id) {
    chrome.tabs.remove(sender.tab.id, () => {
      if (chrome.runtime.lastError) {
        // Игнорируем ошибку, если вкладка уже закрыта
      }
      sendResponse({ success: true });
    });
    return true;
  }

  if (message.action === 'reload_tab') {
    const tabId = sender.tab?.id || message.tabId;
    if (tabId) {
      chrome.tabs.reload(tabId, { bypassCache: true }, () => {
        if (chrome.runtime.lastError) {
          // Игнорируем возможные ошибки перезагрузки
        }
        sendResponse({ success: true });
      });
      return true;
    }
  }
});
