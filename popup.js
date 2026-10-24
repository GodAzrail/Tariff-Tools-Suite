document.addEventListener('DOMContentLoaded', () => {
  const status = document.getElementById('status');
  const inspectorStatus = document.getElementById('inspector-status');
  const btnToggleInspector = document.getElementById('btn-toggle-inspector');
  const btnInspectorSnap = document.getElementById('btn-inspector-snap');
  const btnInspectorDownload = document.getElementById('btn-inspector-download');
  const btnInspectorClear = document.getElementById('btn-inspector-clear');

  let activeTabId = null;
  let isRecording = false;
  let captureCount = 0;

  // 1. Проверка активной вкладки
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const activeTab = tabs?.[0];
    const url = activeTab?.url || '';
    activeTabId = activeTab?.id || null;

    const isTariffs = url.includes('/configurator/tariffs');
    const isDelOrgs = url.includes('/configurator/del-orgs');
    const isConfigurator = url.includes('/configurator');

    if (status) {
      if (isTariffs) {
        status.innerHTML = `✅ Активная вкладка: страница тарифов.`;
      } else if (isDelOrgs) {
        status.innerHTML = '✅ Активная вкладка: страница del-orgs. Здесь работают resize-скрипты.';
      } else if (isConfigurator) {
        status.innerHTML = '✅ Активная вкладка: конфигуратор доставки.';
      } else {
        status.innerHTML = `⚠️ Открой поддерживаемую страницу:
\`/configurator/tariffs\` или \`/configurator/del-orgs\``;
      }
    }

    // Запрос статуса инспектора
    refreshInspectorUI();
  });

  function updateInspectorDisplay() {
    if (!inspectorStatus || !btnToggleInspector) return;

    if (isRecording) {
      inspectorStatus.innerHTML = `🔴 <strong>Идет запись (Clean DOM)</strong>: сохранено <b>${captureCount}</b> снимков.`;
      inspectorStatus.style.borderColor = 'rgba(239, 68, 68, 0.4)';
      btnToggleInspector.textContent = '⏹ Остановить запись';
      btnToggleInspector.className = 'btn-action btn-insp-toggle-stop';
    } else {
      inspectorStatus.innerHTML = `⏸ <strong>Инспектор выключен</strong>: в буфере <b>${captureCount}</b> снимков.`;
      inspectorStatus.style.borderColor = 'rgba(148, 163, 184, 0.16)';
      btnToggleInspector.textContent = '▶ Начать запись';
      btnToggleInspector.className = 'btn-action btn-insp-toggle-start';
    }
  }

  function refreshInspectorUI() {
    // Сначала читаем локальное хранилище
    try {
      chrome.storage.local.get(['tariff_inspector_recording', 'tariff_inspector_captures'], (res) => {
        if (res) {
          isRecording = !!res.tariff_inspector_recording;
          captureCount = Array.isArray(res.tariff_inspector_captures) ? res.tariff_inspector_captures.length : 0;
          updateInspectorDisplay();
        }
      });
    } catch (e) {
      console.warn('[popup] Ошибка чтения storage:', e);
    }

    // Также опрашиваем активную вкладку
    if (activeTabId) {
      chrome.tabs.sendMessage(activeTabId, { action: 'getInspectorState' }, (response) => {
        if (!chrome.runtime.lastError && response) {
          isRecording = !!response.isRecording;
          captureCount = response.captureCount || 0;
          updateInspectorDisplay();
        }
      });
    }
  }

  // Кнопка включения/выключения инспектора
  btnToggleInspector?.addEventListener('click', () => {
    if (!activeTabId) return;

    const action = isRecording ? 'stopInspector' : 'startInspector';
    chrome.tabs.sendMessage(activeTabId, { action }, (response) => {
      if (chrome.runtime.lastError) {
        alert('Не удалось связаться со страницей. Убедитесь, что открыт конфигуратор тарифов и обновите вкладку.');
        return;
      }
      if (response) {
        isRecording = !isRecording;
        if (typeof response.captureCount === 'number') {
          captureCount = response.captureCount;
        }
        updateInspectorDisplay();
      }
    });
  });

  // Кнопка ручного снимка
  btnInspectorSnap?.addEventListener('click', () => {
    if (!activeTabId) return;

    chrome.tabs.sendMessage(activeTabId, { action: 'captureInspectorNow' }, (response) => {
      if (chrome.runtime.lastError) {
        alert('Не удалось сделать снимок. Обновите вкладку конфигуратора.');
        return;
      }
      if (response && response.success) {
        captureCount = response.captureCount;
        updateInspectorDisplay();
      }
    });
  });

  // Кнопка скачивания MD
  btnInspectorDownload?.addEventListener('click', () => {
    if (!activeTabId) return;

    chrome.tabs.sendMessage(activeTabId, { action: 'downloadInspectorReport' }, (response) => {
      if (chrome.runtime.lastError) {
        alert('Не удалось скачать отчет. Обновите вкладку конфигуратора.');
        return;
      }
      if (response) {
        captureCount = response.captureCount;
        updateInspectorDisplay();
      }
    });
  });

  // Кнопка очистки снимков
  btnInspectorClear?.addEventListener('click', () => {
    if (!confirm('Очистить все сохраненные снимки инспектора?')) return;

    chrome.storage.local.set({ tariff_inspector_captures: [] }, () => {
      captureCount = 0;
      updateInspectorDisplay();
    });

    if (activeTabId) {
      chrome.tabs.sendMessage(activeTabId, { action: 'clearInspectorCaptures' }, () => {
        // Ignored callback
      });
    }
  });
});
