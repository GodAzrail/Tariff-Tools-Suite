// ============================================================================
// Tariff Tools Suite - Page & Modal Inspector Module (page-inspector.js)
// Сбор чистого исходного кода страниц и модальных окон в Markdown (Clean DOM Mode)
// ============================================================================
(function() {
  'use strict';

  if (window.__tariffPageInspectorLoaded) return;
  window.__tariffPageInspectorLoaded = true;

  console.log('[page-inspector] Инициализация модуля инспектора страниц...');

  // Ключи локального хранилища
  const STORAGE_KEY_RECORDING = 'tariff_inspector_recording';
  const STORAGE_KEY_CAPTURES = 'tariff_inspector_captures';

  // Локальное состояние
  let isRecording = false;
  let captures = [];
  let floatingWidget = null;
  let modalObserver = null;
  let lastCapturedFingerprint = '';
  let lastCaptureTime = 0;

  // ==================== Утилиты очистки и санитизации HTML ====================

  /**
   * Заменяет громоздкие SVG и Base64 data-URL на компактные плейсхолдеры,
   * чтобы Markdown файл не раздувался до десятков мегабайт пустых SVG путей.
   */
  function sanitizeHTML(element) {
    if (!element) return '';
    const clone = element.cloneNode(true);

    // Удаляем служебные элементы инспектора и уведомления
    const ignored = clone.querySelectorAll('[data-tts-inspector-ignore="true"], .tariff-notification');
    ignored.forEach(el => el.remove());

    // Заменяем SVG на компактные метки с сохранением классов
    const svgs = clone.querySelectorAll('svg');
    svgs.forEach(svg => {
      const iconPlaceholder = document.createElement('span');
      const className = svg.getAttribute('class') || '';
      const ariaLabel = svg.getAttribute('aria-label') || '';
      iconPlaceholder.className = `tts-icon-placeholder ${className}`.trim();
      iconPlaceholder.textContent = ariaLabel ? `[SVG Icon: ${ariaLabel}]` : '[SVG Icon]';
      svg.parentNode?.replaceChild(iconPlaceholder, svg);
    });

    // Очищаем base64 data-urls
    const images = clone.querySelectorAll('img');
    images.forEach(img => {
      const src = img.getAttribute('src') || '';
      if (src.startsWith('data:')) {
        img.setAttribute('src', '[data-url:image]');
      }
    });

    // Форматирование HTML
    return formatHTML(clone.outerHTML);
  }

  /**
   * Простое и быстрое форматирование HTML с отступами
   */
  function formatHTML(html) {
    let formatted = '';
    const reg = new RegExp('(>)(<)(/?)', 'g');
    html = html.replace(reg, '$1\r\n$2$3');
    let pad = 0;
    
    html.split('\r\n').forEach(node => {
      let indent = 0;
      if (node.match(/.+<\/\w[^>]*>$/)) {
        indent = 0;
      } else if (node.match(/^<\/\w/)) {
        if (pad !== 0) pad -= 1;
      } else if (node.match(/^<\w[^>]*[^\/]>.*$/)) {
        indent = 1;
      } else {
        indent = 0;
      }

      let padding = '';
      for (let i = 0; i < pad; i++) {
        padding += '  ';
      }

      formatted += padding + node + '\n';
      pad += indent;
    });

    return formatted.trim();
  }

  // ==================== Извлечение интерактивных элементов ====================

  function extractInteractiveElements(container) {
    if (!container) return { buttons: [], inputs: [], tables: [] };

    // Кнопки
    const buttonElements = Array.from(container.querySelectorAll('button, a[role="button"], [role="button"]'))
      .filter(el => !el.closest('[data-tts-inspector-ignore="true"]'));
    const buttons = buttonElements.map(btn => ({
      text: (btn.textContent || '').trim().replace(/\s+/g, ' '),
      id: btn.id || '',
      classes: (btn.className || '').toString().trim(),
      type: btn.getAttribute('type') || 'button',
      disabled: btn.hasAttribute('disabled') || btn.classList.contains('disabled'),
      ariaLabel: btn.getAttribute('aria-label') || ''
    })).filter(b => b.text || b.id || b.ariaLabel);

    // Поля ввода
    const inputElements = Array.from(container.querySelectorAll('input, textarea, select'))
      .filter(el => !el.closest('[data-tts-inspector-ignore="true"]'));
    const inputs = inputElements.map(inp => {
      const label = findLabelForInput(inp);
      return {
        tag: inp.tagName.toLowerCase(),
        type: inp.getAttribute('type') || (inp.tagName.toLowerCase() === 'textarea' ? 'textarea' : 'text'),
        name: inp.getAttribute('name') || '',
        placeholder: inp.getAttribute('placeholder') || '',
        label: label,
        value: inp.type === 'checkbox' || inp.type === 'radio' ? (inp.checked ? 'checked' : 'unchecked') : (inp.value || ''),
        disabled: inp.hasAttribute('disabled'),
        required: inp.hasAttribute('required')
      };
    });

    // Таблицы
    const tableElements = Array.from(container.querySelectorAll('table, [role="table"]'))
      .filter(el => !el.closest('[data-tts-inspector-ignore="true"]'));
    const tables = tableElements.map(tbl => {
      const headers = Array.from(tbl.querySelectorAll('th, [role="columnheader"]'))
        .map(th => (th.textContent || '').trim().replace(/\s+/g, ' '))
        .filter(Boolean);
      const rows = tbl.querySelectorAll('tr, [role="row"]').length;
      return {
        headers,
        rowCount: rows
      };
    });

    return { buttons, inputs, tables };
  }

  function findLabelForInput(input) {
    if (input.id) {
      const labelEl = document.querySelector(`label[for="${input.id}"]`);
      if (labelEl) return labelEl.textContent.trim();
    }
    const parentLabel = input.closest('label');
    if (parentLabel) {
      return parentLabel.textContent.trim().replace(input.value || '', '').trim();
    }
    const prev = input.previousElementSibling;
    if (prev && (prev.tagName === 'LABEL' || prev.classList?.contains('label'))) {
      return prev.textContent.trim();
    }
    return input.getAttribute('aria-label') || '';
  }

  // ==================== Логика захвата снимка ====================

  /**
   * Выполняет снимок текущей страницы или активного модального окна
   */
  function captureCurrent(triggerType = 'auto', customTitle = null) {
    if (!isRecording && triggerType === 'auto') return null;

    // Гарантируем чистый DOM перед анализом
    if (window.TariffToolsCore && typeof window.TariffToolsCore.enterCleanDOMMode === 'function') {
      window.TariffToolsCore.enterCleanDOMMode();
    }

    const currentUrl = window.location.href;
    const now = new Date();
    const timestampStr = now.toLocaleString('ru-RU');

    // 1. Проверяем наличие открытого модального окна
    const modalSelector = 'dialog[open], [role="dialog"], .ant-modal-content, .modal-content, [class*="modal_"][open], [class*="dialog_"][open]';
    const candidateModals = Array.from(document.querySelectorAll(modalSelector))
      .filter(el => !el.closest('[data-tts-inspector-ignore="true"]'));

    let targetElement = null;
    let captureType = 'Page';
    let title = customTitle || '';

    if (candidateModals.length > 0) {
      // Берем верхнее видимое модальное окно
      targetElement = candidateModals[candidateModals.length - 1];
      captureType = 'Modal/Dialog';

      if (!title) {
        const headerEl = targetElement.querySelector('h1, h2, h3, h4, [class*="title"], [class*="header"], [role="heading"]');
        title = headerEl ? headerEl.textContent.trim() : (targetElement.getAttribute('aria-label') || 'Безымянное модальное окно');
      }
    } else {
      // Снимок всей страницы (основного контейнера приложения)
      captureType = 'Page';
      const mainContainer = document.querySelector('main, #root, #app, .css-1fttcpj, .content') || document.body;
      targetElement = mainContainer;

      if (!title) {
        const h1 = document.querySelector('h1');
        title = h1 ? h1.textContent.trim() : (document.title || window.location.pathname);
      }
    }

    // Дедупликация автоматических снимков
    const fingerprint = `${captureType}::${window.location.pathname}::${title}`;
    const timeDelta = Date.now() - lastCaptureTime;
    if (triggerType === 'auto' && fingerprint === lastCapturedFingerprint && timeDelta < 4000) {
      return null;
    }

    lastCapturedFingerprint = fingerprint;
    lastCaptureTime = Date.now();

    // Извлекаем элементы и очищенный HTML
    const interactive = extractInteractiveElements(targetElement);
    const cleanHTML = sanitizeHTML(targetElement);

    const snapshot = {
      id: 'snap_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5),
      timestamp: timestampStr,
      url: currentUrl,
      type: captureType,
      title: title || 'Страница тарификатора',
      route: window.location.pathname + window.location.search,
      buttons: interactive.buttons,
      inputs: interactive.inputs,
      tables: interactive.tables,
      html: cleanHTML
    };

    captures.push(snapshot);
    saveCapturesToStorage();
    updateFloatingWidgetBadge();

    console.log(`[page-inspector] 📸 Захвачен ${captureType}: "${snapshot.title}" (Всего: ${captures.length})`);
    showToast(`📸 Захвачен ${captureType}: "${snapshot.title}"`);

    return snapshot;
  }

  // ==================== Синхронизация с chrome.storage.local ====================

  function saveCapturesToStorage() {
    try {
      if (chrome?.storage?.local) {
        chrome.storage.local.set({ [STORAGE_KEY_CAPTURES]: captures });
      }
    } catch (err) {
      console.warn('[page-inspector] Ошибка сохранения снимков в storage:', err);
    }
  }

  function setRecordingState(active) {
    isRecording = active;
    try {
      if (chrome?.storage?.local) {
        chrome.storage.local.set({ [STORAGE_KEY_RECORDING]: active });
      }
    } catch (err) {
      console.warn('[page-inspector] Ошибка сохранения статуса записи:', err);
    }

    if (active) {
      // 1. Активируем Clean DOM Mode
      if (window.TariffToolsCore && typeof window.TariffToolsCore.enterCleanDOMMode === 'function') {
        window.TariffToolsCore.enterCleanDOMMode();
      }
      // 2. Отображаем плавающий виджет на странице
      renderFloatingWidget();
      // 3. Запускаем автоматические наблюдатели
      startObservers();
      // 4. Захватываем текущую страницу
      setTimeout(() => {
        captureCurrent('auto');
      }, 500);
      showToast('🔴 Запись инспектора запущена (Clean DOM Mode)');
    } else {
      // 1. Скрываем виджет
      removeFloatingWidget();
      // 2. Отключаем наблюдатели
      stopObservers();
      // 3. Возвращаем обычный режим расширения
      if (window.TariffToolsCore && typeof window.TariffToolsCore.exitCleanDOMMode === 'function') {
        window.TariffToolsCore.exitCleanDOMMode();
      }
      showToast('⏹ Запись инспектора остановлена. Модификации восстановлены.');
    }
  }

  // ==================== Наблюдатели за страницей и модальными окнами ====================

  function startObservers() {
    stopObservers();

    // 1. Наблюдатель за SPA роутингом
    window.addEventListener('spa-route-changed', onRouteChanged);

    // 2. Наблюдатель за появлением модальных окон
    let modalTimer = null;
    modalObserver = new MutationObserver((mutations) => {
      if (!isRecording) return;
      for (const m of mutations) {
        if (m.addedNodes.length > 0) {
          for (const node of m.addedNodes) {
            if (node.nodeType === 1) {
              if (node.hasAttribute?.('data-tts-inspector-ignore')) continue;
              if (node.matches?.('dialog[open], [role="dialog"], .ant-modal, .modal-content, [class*="dialog"]') ||
                  node.querySelector?.('dialog[open], [role="dialog"], .ant-modal, [class*="dialog"]')) {
                clearTimeout(modalTimer);
                modalTimer = setTimeout(() => {
                  captureCurrent('auto');
                }, 400);
                return;
              }
            }
          }
        }
      }
    });

    if (document.body) {
      modalObserver.observe(document.body, { childList: true, subtree: true });
    }
  }

  function stopObservers() {
    window.removeEventListener('spa-route-changed', onRouteChanged);
    if (modalObserver) {
      modalObserver.disconnect();
      modalObserver = null;
    }
  }

  function onRouteChanged() {
    if (!isRecording) return;
    setTimeout(() => {
      captureCurrent('auto');
    }, 600);
  }

  // ==================== Плавающий виджет на странице ====================

  function renderFloatingWidget() {
    if (floatingWidget && floatingWidget.parentNode) return;

    floatingWidget = document.createElement('div');
    floatingWidget.id = 'tts-inspector-floating-widget';
    floatingWidget.setAttribute('data-tts-inspector-ignore', 'true');
    floatingWidget.style.cssText = `
      position: fixed;
      bottom: 24px;
      right: 24px;
      z-index: 2147483647;
      background: linear-gradient(135deg, #0f172a 0%, #1e293b 100%);
      color: #e2e8f0;
      border: 1px solid rgba(96, 165, 250, 0.4);
      border-radius: 14px;
      padding: 10px 14px;
      display: flex;
      align-items: center;
      gap: 10px;
      box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.5), 0 0 15px rgba(59, 130, 246, 0.2);
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      font-size: 13px;
      user-select: none;
      backdrop-filter: blur(8px);
      transition: transform 0.2s ease, opacity 0.2s ease;
    `;

    floatingWidget.innerHTML = `
      <div style="display:flex; align-items:center; gap:8px;">
        <span style="display:inline-block; width:10px; height:10px; border-radius:50%; background:#ef4444; box-shadow:0 0 8px #ef4444; animation: ttsPulse 1.5s infinite;"></span>
        <strong style="color:#f8fafc; font-size:12px; letter-spacing:0.3px;">Инспектор:</strong>
        <span id="tts-inspector-badge-count" style="background:#3b82f6; color:#ffffff; font-size:11px; font-weight:700; padding:2px 7px; border-radius:10px;">${captures.length} снимков</span>
      </div>
      <div style="display:flex; align-items:center; gap:6px;">
        <button id="tts-insp-btn-snap" style="background:#334155; color:#f8fafc; border:1px solid #475569; padding:5px 9px; border-radius:8px; cursor:pointer; font-size:11px; font-weight:600; display:flex; align-items:center; gap:4px;" title="Сделать снимок экрана/модалки прямо сейчас">
          📸 Снимок
        </button>
        <button id="tts-insp-btn-download" style="background:#2563eb; color:#ffffff; border:none; padding:5px 9px; border-radius:8px; cursor:pointer; font-size:11px; font-weight:600; display:flex; align-items:center; gap:4px;" title="Скачать готовый отчет в Markdown">
          💾 Скачать MD
        </button>
        <button id="tts-insp-btn-stop" style="background:#dc2626; color:#ffffff; border:none; padding:5px 9px; border-radius:8px; cursor:pointer; font-size:11px; font-weight:600; display:flex; align-items:center; gap:4px;" title="Остановить запись и восстановить интерфейс">
          ⏹ Стоп
        </button>
      </div>
    `;

    // Инжектим анимацию пульса
    if (!document.getElementById('tts-inspector-styles')) {
      const style = document.createElement('style');
      style.id = 'tts-inspector-styles';
      style.setAttribute('data-tts-inspector-ignore', 'true');
      style.textContent = `
        @keyframes ttsPulse {
          0% { transform: scale(0.95); opacity: 0.8; }
          50% { transform: scale(1.15); opacity: 1; }
          100% { transform: scale(0.95); opacity: 0.8; }
        }
      `;
      document.head.appendChild(style);
    }

    document.body.appendChild(floatingWidget);

    // События кнопок виджета
    document.getElementById('tts-insp-btn-snap')?.addEventListener('click', () => {
      captureCurrent('manual');
    });

    document.getElementById('tts-insp-btn-download')?.addEventListener('click', () => {
      downloadMarkdownReport();
    });

    document.getElementById('tts-insp-btn-stop')?.addEventListener('click', () => {
      setRecordingState(false);
    });
  }

  function updateFloatingWidgetBadge() {
    const badge = document.getElementById('tts-inspector-badge-count');
    if (badge) {
      badge.textContent = `${captures.length} снимков`;
    }
  }

  function removeFloatingWidget() {
    if (floatingWidget) {
      floatingWidget.remove();
      floatingWidget = null;
    }
  }

  function showToast(message) {
    const toast = document.createElement('div');
    toast.setAttribute('data-tts-inspector-ignore', 'true');
    toast.style.cssText = `
      position: fixed;
      bottom: 80px;
      right: 24px;
      z-index: 2147483647;
      background: rgba(15, 23, 42, 0.95);
      color: #38bdf8;
      border: 1px solid rgba(56, 189, 248, 0.3);
      border-radius: 8px;
      padding: 8px 14px;
      font-size: 12px;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
      pointer-events: none;
      transition: opacity 0.3s ease, transform 0.3s ease;
      opacity: 0;
      transform: translateY(10px);
    `;
    toast.textContent = message;
    document.body.appendChild(toast);

    requestAnimationFrame(() => {
      toast.style.opacity = '1';
      toast.style.transform = 'translateY(0)';
    });

    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateY(-10px)';
      setTimeout(() => toast.remove(), 350);
    }, 2200);
  }

  // ==================== Генератор отчета Markdown ====================

  function generateMarkdownReport() {
    const now = new Date();
    const dateStr = now.toLocaleString('ru-RU');
    const pageCaptures = captures.filter(c => c.type === 'Page');
    const modalCaptures = captures.filter(c => c.type === 'Modal/Dialog');

    let md = `# Отчет инспекции страниц и модальных окон (Clean DOM Mode)\n\n`;
    md += `> Сгенерировано расширением **Tariff Tools Suite** (модуль \`page-inspector.js\`).\n`;
    md += `> Внимание: перед сканированием был активирован режим чистого DOM, все кастомизации, кнопки Pro и сторонние элементы расширения были временно скрыты.\n\n`;

    md += `## 📋 Сводка сканирования\n`;
    md += `- **Дата и время:** \`${dateStr}\`\n`;
    md += `- **Всего сохранено снимков:** \`${captures.length}\`\n`;
    md += `- **Страниц (Page):** \`${pageCaptures.length}\`\n`;
    md += `- **Модальных окон (Modal/Dialog):** \`${modalCaptures.length}\`\n`;
    md += `- **Хост приложения:** \`${window.location.origin}\`\n\n`;

    // Оглавление
    md += `## 📑 Оглавление снимков\n\n`;
    captures.forEach((cap, idx) => {
      const anchor = `snap-${idx + 1}-${cap.type.toLowerCase().replace(/[^a-z0-9]/g, '-')}-${cap.title.toLowerCase().replace(/[^a-zа-я0-9]/gi, '-')}`;
      md += `${idx + 1}. [**[${cap.type}]** ${escapeMarkdown(cap.title)} (\`${cap.route}\`)](#${anchor})\n`;
    });
    md += `\n---\n\n`;

    // Детальные разделы
    captures.forEach((cap, idx) => {
      const anchor = `snap-${idx + 1}-${cap.type.toLowerCase().replace(/[^a-z0-9]/g, '-')}-${cap.title.toLowerCase().replace(/[^a-zа-я0-9]/gi, '-')}`;
      md += `<a id="${anchor}"></a>\n\n`;
      md += `## ${idx + 1}. [${cap.type}] ${escapeMarkdown(cap.title)}\n\n`;
      md += `- **Маршрут (Route):** \`${cap.route}\`\n`;
      md += `- **Полный URL:** [${cap.url}](${cap.url})\n`;
      md += `- **Время снимка:** \`${cap.timestamp}\`\n\n`;

      // Таблица кнопок
      if (cap.buttons && cap.buttons.length > 0) {
        md += `### 🔘 Интерактивные кнопки (${cap.buttons.length})\n\n`;
        md += `| № | Текст кнопки | ID / Селектор | Классы | Статус |\n`;
        md += `|---|--------------|---------------|--------|--------|\n`;
        cap.buttons.forEach((b, bIdx) => {
          md += `| ${bIdx + 1} | **${escapeMarkdown(b.text || b.ariaLabel || '(без текста)')}** | \`${b.id || '-'}\` | \`${truncate(b.classes, 30)}\` | ${b.disabled ? '🔴 Отключена' : '🟢 Активна'} |\n`;
        });
        md += `\n`;
      }

      // Таблица полей ввода
      if (cap.inputs && cap.inputs.length > 0) {
        md += `### 📝 Поля ввода и формы (${cap.inputs.length})\n\n`;
        md += `| № | Метка / Название | Тип | Name / Placeholder | Значение | Обязательное |\n`;
        md += `|---|------------------|-----|--------------------|----------|--------------|\n`;
        cap.inputs.forEach((inp, iIdx) => {
          md += `| ${iIdx + 1} | ${escapeMarkdown(inp.label || inp.placeholder || '-')} | \`${inp.type}\` | \`${inp.name || inp.placeholder || '-'}\` | \`${truncate(inp.value, 20)}\` | ${inp.required ? 'Да' : 'Нет'} |\n`;
        });
        md += `\n`;
      }

      // Таблицы
      if (cap.tables && cap.tables.length > 0) {
        md += `### 📊 Обнаруженные таблицы (${cap.tables.length})\n\n`;
        cap.tables.forEach((t, tIdx) => {
          md += `**Таблица #${tIdx + 1}:** Строк: \`${t.rowCount}\`, Колонки: ${t.headers.map(h => `\`${h}\``).join(', ') || '(нет заголовков)'}\n\n`;
        });
      }

      // Очищенный исходный код HTML
      md += `### 💻 Исходный код HTML (Clean DOM)\n\n`;
      md += '```html\n';
      md += cap.html + '\n';
      md += '```\n\n';
      md += `---\n\n`;
    });

    md += `## 💡 Рекомендации для разработки улучшений расширения\n`;
    md += `1. Используйте селекторы кнопок и полей из таблиц выше для надежной адресации элементов без завязки на сгенерированные хэши классов.\n`;
    md += `2. Проверьте структуру модальных окон для интеграции автоматического изменения размеров (resize) и горячих клавиш.\n`;
    md += `3. При создании новых функций сверяйтесь с кодом чистого DOM, чтобы расширение не конфликтовало с родными скриптами платформы.\n`;

    return md;
  }

  function escapeMarkdown(text) {
    if (!text) return '';
    return text.replace(/\|/g, '\\|').replace(/\*/g, '\\*').replace(/\r?\n/g, ' ');
  }

  function truncate(str, max) {
    if (!str) return '-';
    return str.length > max ? str.substring(0, max) + '…' : str;
  }

  function downloadMarkdownReport() {
    if (captures.length === 0) {
      // Делаем хотя бы снимок текущей страницы
      captureCurrent('manual');
    }

    const reportContent = generateMarkdownReport();
    const now = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    const dateFormatted = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
    const filename = `tariff_tools_clean_dump_${dateFormatted}.md`;

    const blob = new Blob([reportContent], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);

    showToast(`💾 Отчет сохранен: ${filename}`);
  }

  // ==================== Обработчик сообщений Chrome ====================

  chrome.runtime?.onMessage?.addListener((request, sender, sendResponse) => {
    if (request.action === 'getInspectorState') {
      sendResponse({
        isRecording,
        captureCount: captures.length
      });
      return true;
    }

    if (request.action === 'startInspector') {
      setRecordingState(true);
      sendResponse({ success: true, captureCount: captures.length });
      return true;
    }

    if (request.action === 'stopInspector') {
      setRecordingState(false);
      sendResponse({ success: true, captureCount: captures.length });
      return true;
    }

    if (request.action === 'captureInspectorNow') {
      const snap = captureCurrent('manual');
      sendResponse({ success: !!snap, captureCount: captures.length });
      return true;
    }

    if (request.action === 'downloadInspectorReport') {
      downloadMarkdownReport();
      sendResponse({ success: true, captureCount: captures.length });
      return true;
    }

    if (request.action === 'clearInspectorCaptures') {
      captures = [];
      saveCapturesToStorage();
      updateFloatingWidgetBadge();
      showToast('🗑 Снимки инспектора очищены');
      sendResponse({ success: true, captureCount: 0 });
      return true;
    }
  });

  // ==================== Инициализация при загрузке ====================

  try {
    if (chrome?.storage?.local) {
      chrome.storage.local.get([STORAGE_KEY_RECORDING, STORAGE_KEY_CAPTURES], (result) => {
        if (result && Array.isArray(result[STORAGE_KEY_CAPTURES])) {
          captures = result[STORAGE_KEY_CAPTURES];
        }
        if (result && result[STORAGE_KEY_RECORDING] === true) {
          console.log('[page-inspector] Восстановление сессии записи инспектора...');
          setRecordingState(true);
        }
      });
    }
  } catch (e) {
    console.warn('[page-inspector] Не удалось прочитать storage при старте:', e);
  }

  // Публичный интерфейс модуля
  window.TariffPageInspector = {
    start: () => setRecordingState(true),
    stop: () => setRecordingState(false),
    capture: (title) => captureCurrent('manual', title),
    download: downloadMarkdownReport,
    clear: () => {
      captures = [];
      saveCapturesToStorage();
      updateFloatingWidgetBadge();
    },
    getState: () => ({ isRecording, captureCount: captures.length })
  };

  console.log('[page-inspector] Модуль успешно загружен');
})();
