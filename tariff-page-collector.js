// ==UserScript==
// @name         Tariff Page Collector (Fast & Robust)
// @namespace    http://tampermonkey.net/
// @version      2.2
// @description  Быстрый и надежный сбор данных со страницы тарифа через фоновую вкладку
// ==/UserScript==

(function() {
    'use strict';

    console.log('[TariffPageCollector] Loaded (fast & robust mode)');

    function safelyCloseCurrentTab() {
        if (typeof chrome !== 'undefined' && chrome.runtime && typeof chrome.runtime.sendMessage === 'function') {
            try {
                chrome.runtime.sendMessage({ action: 'close_current_tab' });
                return;
            } catch (_) {}
        }
        try {
            window.close();
        } catch (_) {}
    }

    function findCollectRequest() {
        const currentUrl = window.location.href.toLowerCase();
        const currentUuids = currentUrl.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi) || [];
        // Тарифный UUID - это последний UUID в URL (первый UUID в URL - это ID организации)
        const currentTariffUuid = currentUuids.length > 0 ? currentUuids[currentUuids.length - 1].toLowerCase() : null;

        try {
            const queue = JSON.parse(localStorage.getItem('tariff_collect_queue') || '{}');
            for (const key of Object.keys(queue)) {
                const req = queue[key];
                if (req && req.url) {
                    const reqUrl = req.url.toLowerCase();
                    const reqUuids = reqUrl.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi) || [];
                    const reqTariffUuid = reqUuids.length > 0 ? reqUuids[reqUuids.length - 1].toLowerCase() : null;

                    // Точное сопоставление по UUID самого тарифа
                    if (currentTariffUuid && reqTariffUuid && currentTariffUuid === reqTariffUuid) {
                        return req;
                    }
                    if (currentUrl.split('?')[0].split('#')[0] === reqUrl.split('?')[0].split('#')[0]) {
                        return req;
                    }
                }
            }
        } catch (_) {}

        try {
            const raw = localStorage.getItem('tariff_to_collect');
            if (raw) {
                const parsed = JSON.parse(raw);
                if (parsed && parsed.url) {
                    const reqUuids = parsed.url.toLowerCase().match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi) || [];
                    const reqTariffUuid = reqUuids.length > 0 ? reqUuids[reqUuids.length - 1].toLowerCase() : null;
                    if (!currentTariffUuid || !reqTariffUuid || currentTariffUuid === reqTariffUuid) {
                        return parsed;
                    }
                } else if (parsed) {
                    return parsed;
                }
            }
        } catch (_) {}

        return null;
    }

    const request = findCollectRequest();
    if (request && request.requestId) {

        console.log(`[TariffPageCollector] Collecting data for: ${request.name}`);

        async function enterEditModeIfPossible(timeoutMs = 3000) {
            let nameInput = document.querySelector('input[placeholder*="Введите название тарифа"]')
                || document.querySelector('input[placeholder*="название тарифа"]')
                || document.querySelector('input[name="name"]');
            if (nameInput) return true;

            const blockedSectionKeywords = [
                'зоны', 'зона', 'филиал', 'мгх', 'сетка', 'интервал',
                'подъем', 'этаж', 'лифт', 'лестниц', 'оплат', 'прием',
                'виды продажи', 'вид продажи', 'параметр', 'лимит', 'срок'
            ];

            const isSectionEl = (el) => {
                if (!el) return false;
                if (el.closest('#tariff-export-pro-sidebar, #tariff-manager-modal, #af-tariff-panel, dialog, [role="dialog"], table, tbody, tr, fieldset')) {
                    return true;
                }
                const parent = el.parentElement;
                if (!parent) return false;

                const parentText = (parent.textContent || '').trim().toLowerCase();
                if (parentText.length < 100 && blockedSectionKeywords.some(kw => parentText.includes(kw))) {
                    return true;
                }

                const prev = el.previousElementSibling;
                if (prev) {
                    const prevText = (prev.textContent || '').trim().toLowerCase();
                    if (blockedSectionKeywords.some(kw => prevText.includes(kw))) {
                        return true;
                    }
                }

                return false;
            };

            const buttons = Array.from(document.querySelectorAll('button, a[role="button"], div[role="button"]'));
            let editBtn = null;
            for (const btn of buttons) {
                if (isSectionEl(btn)) continue;
                const text = (btn.textContent || '').trim();
                const title = (btn.title || btn.getAttribute('aria-label') || '').trim();
                if (/^(редактировать|изменить)$/i.test(text) || /^(редактировать|изменить)/i.test(title)) {
                    editBtn = btn;
                    break;
                }
            }

            if (editBtn) {
                console.log('[TariffPageCollector] Входим в режим редактирования');
                editBtn.click();
                const started = Date.now();
                while (Date.now() - started < timeoutMs) {
                    nameInput = document.querySelector('input[placeholder*="Введите название тарифа"]')
                        || document.querySelector('input[placeholder*="название тарифа"]')
                        || document.querySelector('input[name="name"]');
                    if (nameInput) return true;
                    await new Promise(r => setTimeout(r, 150));
                }
            }
            return false;
        }

        async function openAndExtractIntervalsFromModal(timeoutMs = 4000) {
            let pencilIcon = null;
            const allElements = Array.from(document.querySelectorAll('span, div, label, p, h1, h2, h3, h4'));
            const titleEl = allElements.find(el => (el.textContent || '').trim() === 'Интервалы доставки');
            if (titleEl) {
                pencilIcon = titleEl.parentElement?.querySelector('span[class*="pencil"], .icomoon-icon__pencil, [class*="pencil"], button, svg')
                    || titleEl.closest('div')?.querySelector('span[class*="pencil"], .icomoon-icon__pencil, [class*="pencil"], button, svg');
            }

            if (!pencilIcon) {
                const headers = Array.from(document.querySelectorAll('[class*="header"], [class*="title"], div'));
                const invHeader = headers.find(h => (h.textContent || '').includes('Интервалы доставки') && h.querySelector('span[class*="pencil"], .icomoon-icon__pencil, [class*="pencil"], button, svg'));
                if (invHeader) {
                    pencilIcon = invHeader.querySelector('span[class*="pencil"], .icomoon-icon__pencil, [class*="pencil"], button, svg');
                }
            }

            if (!pencilIcon) {
                console.warn('[TariffPageCollector] Карандаш секции интервалов не найден');
                return null;
            }

            console.log('[TariffPageCollector] Открываем модальное окно интервалов...');
            pencilIcon.click();

            let dialog = null;
            const started = Date.now();
            while (Date.now() - started < timeoutMs) {
                dialog = document.getElementById('select-invervals-dlg')
                    || document.getElementById('select-intervals-dlg')
                    || Array.from(document.querySelectorAll('dialog[open], [role="dialog"], [aria-modal="true"]')).find(d => {
                        const txt = (d.textContent || '').toLowerCase();
                        return txt.includes('интервалы доставки') || txt.includes('создание интервалов');
                    });
                if (dialog) break;
                await new Promise(r => setTimeout(r, 100));
            }

            if (!dialog) {
                console.warn('[TariffPageCollector] Модальное окно интервалов не открылось вовремя');
                return null;
            }

            await new Promise(r => setTimeout(r, 250));

            // Извлекаем все интервалы, включая неактивные чекбоксы
            const intervals = extractIntervals(dialog);
            console.log(`[TariffPageCollector] Из модального окна собрано ${intervals.length} интервалов (включая неактивные):`, intervals);

            // Закрываем модальное окно интервалов
            try {
                const cancelBtn = Array.from(dialog.querySelectorAll('button')).find(btn => (btn.textContent || '').trim().toLowerCase() === 'отмена');
                const closeBtn = dialog.querySelector('button[class*="close"], .icomoon-icon__cross, [aria-label="Закрыть"]') || cancelBtn;
                if (closeBtn) {
                    closeBtn.click();
                } else if (typeof dialog.close === 'function') {
                    dialog.close();
                }
            } catch (_) {}

            await new Promise(r => setTimeout(r, 150));
            return intervals;
        }

        waitForTariffForm(8000).then(async (root) => {
            let modalIntervals = null;
            try {
                await enterEditModeIfPossible(3000);
                modalIntervals = await openAndExtractIntervalsFromModal(3000);
            } catch (err) {
                console.warn('[TariffPageCollector] Ошибка при сборе интервалов из модала:', err);
            }

            const data = extractFullTariffData(root || document.body, request.name, modalIntervals);

            localStorage.setItem(`collected_tariff_${request.requestId}`, JSON.stringify({
                requestId: request.requestId,
                tariffData: data
            }));
            localStorage.setItem('collected_tariff_data', JSON.stringify({
                requestId: request.requestId,
                tariffData: data
            }));
            try {
                const queue = JSON.parse(localStorage.getItem('tariff_collect_queue') || '{}');
                delete queue[request.requestId];
                localStorage.setItem('tariff_collect_queue', JSON.stringify(queue));
            } catch (_) {}
            localStorage.removeItem('tariff_to_collect');

            console.log('[TariffPageCollector] Data collected successfully:', data);
            safelyCloseCurrentTab();
        });
    }

    const tariffToSave = localStorage.getItem('tariff_to_save');
    if (tariffToSave) {
        let request = null;
        try {
            request = JSON.parse(tariffToSave);
        } catch (e) {
            console.warn('[TariffPageCollector] Не удалось распарсить tariff_to_save:', e);
            return;
        }

        if (!request || !request.requestId || !request.tariff) return;

        console.log(`[TariffPageCollector] Сохранение изменений для тарифа: ${request.tariff.name}`);

        const logToManager = (message, type = 'info') => {
            console.log(`[TariffPageCollector] ${message}`);
            try {
                const events = JSON.parse(localStorage.getItem('tariff_save_events') || '[]');
                events.push({
                    requestId: request.requestId,
                    time: new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
                    message,
                    type
                });
                localStorage.setItem('tariff_save_events', JSON.stringify(events));
            } catch (_) {}
        };

        const runSave = async () => {
            logToManager('📄 Форма тарифа открыта, инициализация...');
            await waitForTariffForm(6000);

            // Ждем инициализации tariffUpdaterPro
            let updater = window.tariffUpdaterPro;
            for (let wait = 0; wait < 20 && !updater; wait++) {
                await new Promise(r => setTimeout(r, 100));
                updater = window.tariffUpdaterPro;
            }

            if (!updater) {
                const errMsg = 'Модуль tariffUpdaterPro не загрузился на странице тарифа';
                logToManager(`❌ ${errMsg}`, 'error');
                throw new Error(errMsg);
            }

            updater.fromTariffManager = true;
            updater.shouldStop = false;
            updater.config = {
                ...(updater.config || {}),
                fromTariffManager: true,
                importBlocks: request.tariff.importBlocks || {
                    zones: false,
                    branches: false,
                    mgx: false,
                    intervals: false,
                    deliveryParams: false,
                    costLimit: false,
                    validityDates: false,
                    payment: false,
                    acceptance: false,
                    saleTypes: false,
                    floor: false
                }
            };

            // Быстрая проверка готовности поля названия тарифа
            let nameInput = document.querySelector('input[placeholder*="Введите название тарифа"]')
                || document.querySelector('input[placeholder*="название тарифа"]')
                || document.querySelector('input[name="name"]')
                || document.querySelector('input[test-id*="name"]');

            if (!nameInput) {
                for (let wait = 0; wait < 20; wait++) {
                    await new Promise(r => setTimeout(r, 120));
                    nameInput = document.querySelector('input[placeholder*="Введите название тарифа"]')
                        || document.querySelector('input[placeholder*="название тарифа"]')
                        || document.querySelector('input[name="name"]');
                    if (nameInput) break;
                }
            }

            if (!nameInput) {
                const editBtn = typeof updater.findTariffEditButtonOnPage === 'function' 
                    ? updater.findTariffEditButtonOnPage() 
                    : null;
                
                if (editBtn) {
                    logToManager('✏️ Нажимаем кнопку «Редактировать» тарифа...');
                    editBtn.click();
                    for (let retry = 0; retry < 15; retry++) {
                        await new Promise(r => setTimeout(r, 150));
                        nameInput = document.querySelector('input[placeholder*="Введите название тарифа"]')
                            || document.querySelector('input[placeholder*="название тарифа"]')
                            || document.querySelector('input[name="name"]');
                        if (nameInput) break;
                    }
                }
            }

            logToManager(nameInput ? '✅ Форма тарифа готова к записи' : 'ℹ️ Форма готова, начинаем запись');

            const success = await updater.createTariff(request.tariff);
            return {
                success,
                reason: success ? '' : (updater.getLastCreateFailure()?.step || 'Не удалось сохранить форму тарифа')
            };
        };

        runSave().then((result) => {
            console.log(`[TariffPageCollector] Результат сохранения для "${request.tariff.name}":`, result);
            if (result?.success) {
                logToManager('🎉 Вкладка успешно сохранена!', 'success');
            } else {
                logToManager(`❌ Сохранение не выполнено: ${result?.reason || 'неизвестная причина'}`, 'error');
            }
            localStorage.setItem('tariff_save_result', JSON.stringify({
                requestId: request.requestId,
                success: !!result?.success,
                reason: result?.reason || '',
                name: request.tariff.name
            }));
            localStorage.removeItem('tariff_to_save');
            setTimeout(() => {
                safelyCloseCurrentTab();
            }, 400);
        }).catch((err) => {
            const errStr = String(err?.message || err);
            console.error('[TariffPageCollector] Ошибка при сохранении тарифа:', err);
            logToManager(`❌ Критическая ошибка: ${errStr}`, 'error');
            localStorage.setItem('tariff_save_result', JSON.stringify({
                requestId: request.requestId,
                success: false,
                reason: errStr,
                name: request.tariff.name
            }));
            localStorage.removeItem('tariff_to_save');
            setTimeout(() => {
                safelyCloseCurrentTab();
            }, 800);
        });
    }

    function waitForTariffForm(timeoutMs) {
        return new Promise((resolve) => {
            const started = Date.now();

            const tryFind = () => {
                // 1. Поиск открытого диалога/модального окна
                const modal = document.querySelector('dialog[open], [role="dialog"], [aria-modal="true"], .css-ibn1fq, [class*="e12cj3rv"]');
                if (modal && (modal.textContent || '').trim().length > 50) {
                    resolve(modal);
                    return true;
                }

                // 2. Проверка наличия элементов управления формы тарифа на странице
                const hasTariffInputs = document.querySelector('input[id*="cashless"]')
                    || document.querySelector('#sameDay')
                    || document.querySelector('input[placeholder*="название тарифа"]')
                    || document.querySelector('table[test-id*="vwc-"]')
                    || document.querySelector('table[test-id*="lifting"]')
                    || document.querySelector('table');

                if (hasTariffInputs) {
                    const formRoot = document.querySelector('form')
                        || document.querySelector('main')
                        || document.querySelector('#root > div')
                        || document.body;
                    resolve(formRoot);
                    return true;
                }

                return false;
            };

            if (tryFind()) return;

            const interval = setInterval(() => {
                if (tryFind()) {
                    clearInterval(interval);
                    return;
                }
                if (Date.now() - started >= timeoutMs) {
                    clearInterval(interval);
                    console.warn('[TariffPageCollector] Таймаут поиска формы тарифа, используем document.body');
                    resolve(document.body);
                }
            }, 100);
        });
    }

    function normalizeCellText(value) {
        const text = String(value || '').trim();
        return text && text !== '—' ? text : '';
    }

    function cleanPrice(val) {
        if (val === undefined || val === null) return '';
        const s = String(val).replace(/[^\d.,-]/g, '').trim();
        return s.replace(',', '.');
    }

    function normalizeTime(value) {
        if (!value) return '';
        const m = String(value).match(/\d{1,2}:\d{2}/);
        return m ? m[0] : String(value).trim().slice(0, 5);
    }

    function getCellVal(cell) {
        if (!cell) return '';
        const inp = cell.tagName === 'INPUT' ? cell : cell.querySelector('input');
        if (inp && inp.value !== undefined && inp.value !== '') {
            return inp.value.trim();
        }
        return (cell.textContent || '').trim();
    }

    function extractIntervalsFromReactFiber(container) {
        try {
            const rootEl = container || document.querySelector('#root, #app, main') || document.body;
            const elements = [rootEl, ...Array.from(rootEl.querySelectorAll('table, [class*="layout"], [class*="content"], div'))];
            for (const el of elements) {
                const fiberKey = Object.keys(el).find(k => k.startsWith('__reactFiber') || k.startsWith('__reactProps'));
                if (!fiberKey) continue;
                let cur = el[fiberKey];
                let depth = 0;
                while (cur && depth < 25) {
                    const props = cur.memoizedProps || cur.props;
                    if (props) {
                        const intervals = props.intervals || props.tariff?.intervals || props.data?.intervals;
                        if (Array.isArray(intervals) && intervals.length > 0) {
                            const first = intervals[0];
                            if (first && (first.startTime !== undefined || first.orderBefore !== undefined || first.internalPriceAdjustment !== undefined)) {
                                console.log(`[TariffPageCollector] Извлечено ${intervals.length} интервалов напрямую из React Fiber!`);
                                return intervals.map(inv => ({
                                    enabled: inv.enabled !== false,
                                    startTime: normalizeTime(inv.startTime || inv.start),
                                    endTime: normalizeTime(inv.endTime || inv.end),
                                    orderBefore: normalizeTime(inv.orderBefore || inv.cutoff || inv.order_before),
                                    internalPriceAdjustment: cleanPrice(inv.internalPriceAdjustment ?? inv.internal_price_adjustment ?? '0'),
                                    priceAdjustment: cleanPrice(inv.priceAdjustment ?? inv.price_adjustment ?? '0')
                                }));
                            }
                        }
                    }
                    cur = cur.return;
                    depth++;
                }
            }
        } catch (e) {
            console.warn('[TariffPageCollector] React Fiber interval extraction failed:', e);
        }
        return null;
    }

    function extractElevatorPrices(root) {
        const result = { internalPrice: '', customerPrice: '' };
        const container = root || document.body;

        // 1. Поиск специализированной секции подъема на лифте
        const sections = Array.from(container.querySelectorAll('div, section, fieldset'));
        const elevatorSec = sections.find(el => {
            const t = (el.textContent || '').toLowerCase();
            return t.includes('подъем на лифте') || t.includes('подъема на лифте');
        });

        if (elevatorSec) {
            const inputs = Array.from(elevatorSec.querySelectorAll('input'));
            if (inputs.length >= 2) {
                result.internalPrice = normalizeCellText(inputs[0].value);
                result.customerPrice = normalizeCellText(inputs[1].value);
                return result;
            } else if (inputs.length === 1) {
                result.customerPrice = normalizeCellText(inputs[0].value);
                return result;
            }
            const secText = elevatorSec.textContent || '';
            const secMatch = secText.match(/([0-9.,]+)\s*руб[^\d-]*([0-9.,]+)\s*руб/i);
            if (secMatch) {
                result.internalPrice = normalizeCellText(secMatch[1]);
                result.customerPrice = normalizeCellText(secMatch[2]);
                return result;
            }
        }

        // 2. Поиск по тексту во всем контейнере
        const text = container.textContent || '';
        const match = text.match(/Стоимость\s+подъема\s+на\s+лифте[^\d]*([0-9.,]+)\s*руб[^\d-]*([0-9.,]+)\s*руб/i);
        if (match) {
            result.internalPrice = normalizeCellText(match[1]);
            result.customerPrice = normalizeCellText(match[2]);
            return result;
        }

        // 3. Поиск в секции подъема по старому Emotion классу
        const floorSection = container.querySelector('.edt22co2, [class*="edt22co"]');
        if (floorSection) {
            const secText = floorSection.textContent || '';
            const secMatch = secText.match(/([0-9.,]+)\s*руб[^\d-]*([0-9.,]+)\s*руб/i);
            if (secMatch) {
                result.internalPrice = normalizeCellText(secMatch[1]);
                result.customerPrice = normalizeCellText(secMatch[2]);
            }
        }

        return result;
    }

    function extractSaleTypes(root) {
        const saleTypes = {
            product: false,
            markdown: false,
            legal: false,
            service: false
        };

        const container = root || document.body;
        const section = Array.from(container.querySelectorAll('div, section, fieldset'))
            .find(el => (el.textContent || '').includes('вид продажи') || (el.textContent || '').includes('Допустимый к оформлению'));

        const target = section || container;

        const findCheckbox = (kind, ruKeywords) => {
            const byId = target.querySelector(`input[type="checkbox"][id*="sale-${kind}"], input[type="checkbox"][id*="${kind}"]`);
            if (byId) return byId;

            const allLabels = Array.from(target.querySelectorAll('label, .checkbox, [class*="checkbox"], div'));
            for (const el of allLabels) {
                const text = (el.textContent || '').trim().toLowerCase();
                if (ruKeywords.some(kw => text.includes(kw))) {
                    const cb = el.querySelector('input[type="checkbox"]') || (el.tagName === 'INPUT' ? el : null);
                    if (cb) return cb;
                    const forId = el.getAttribute('for');
                    if (forId) {
                        const forEl = document.getElementById(forId);
                        if (forEl && forEl.type === 'checkbox') return forEl;
                    }
                }
            }
            return null;
        };

        const cbProduct = findCheckbox('product', ['исправн', 'товар', 'испр']);
        const cbMarkdown = findCheckbox('markdown', ['уцен', 'уценен']);
        const cbLegal = findCheckbox('legal', ['юр', 'юрид']);
        const cbService = findCheckbox('service', ['сервис']);

        saleTypes.product = cbProduct ? !!cbProduct.checked : true;
        saleTypes.markdown = cbMarkdown ? !!cbMarkdown.checked : false;
        saleTypes.legal = cbLegal ? !!cbLegal.checked : false;
        saleTypes.service = cbService ? !!cbService.checked : false;

        return saleTypes;
    }

    function extractIntervals(root) {
        const intervals = [];
        const container = root || document.body;

        let intervalsTable = container.querySelector('table[test-id*="time-intervals"], table[test-id*="intervals"], .e15ujbib1 table');

        if (!intervalsTable) {
            const tables = Array.from(container.querySelectorAll('table'));
            for (const tbl of tables) {
                if (tbl.querySelector('[test-id="startTime"]') || tbl.querySelector('[test-id="endTime"]')) {
                    intervalsTable = tbl;
                    break;
                }
                const ths = Array.from(tbl.querySelectorAll('th')).map(th => (th.textContent || '').toLowerCase());
                if (ths.some(t => t.includes('интервал') || t.includes('отсечка'))) {
                    intervalsTable = tbl;
                    break;
                }
            }
        }

        if (!intervalsTable) return intervals;

        const tbody = intervalsTable.querySelector('tbody') || intervalsTable;
        tbody.querySelectorAll('tr').forEach(row => {
            if (row.querySelector('th')) return;
            const checkbox = row.querySelector('input[type="checkbox"]');
            const isEnabled = checkbox ? checkbox.checked : true;

            const startCell = row.querySelector('[test-id="startTime"]');
            const endCell = row.querySelector('[test-id="endTime"]');
            const orderCell = row.querySelector('[test-id="orderBefore"]');
            const intAdjCell = row.querySelector('[test-id="internalPriceAdjustment"]');
            const custAdjCell = row.querySelector('[test-id="priceAdjustment"]');

            if (startCell || endCell) {
                const startTime = normalizeTime(getCellVal(startCell));
                const endTime = normalizeTime(getCellVal(endCell));
                const orderBefore = normalizeTime(getCellVal(orderCell));
                const internalPriceAdjustment = cleanPrice(getCellVal(intAdjCell));
                const priceAdjustment = cleanPrice(getCellVal(custAdjCell));

                intervals.push({
                    enabled: isEnabled,
                    orderBefore: orderBefore || '',
                    startTime: startTime || '',
                    endTime: endTime || '',
                    internalPriceAdjustment: internalPriceAdjustment || '0',
                    priceAdjustment: priceAdjustment || '0'
                });
                return;
            }

            // Fallback: парсинг по ячейкам таблицы
            const cells = row.querySelectorAll('td');
            if (cells.length >= 6) {
                // [0]=checkbox, [1]=startTime, [2]=endTime, [3]=orderBefore, [4]=intPrice, [5]=custPrice
                intervals.push({
                    enabled: isEnabled,
                    startTime: normalizeTime(getCellVal(cells[1])),
                    endTime: normalizeTime(getCellVal(cells[2])),
                    orderBefore: normalizeTime(getCellVal(cells[3])),
                    internalPriceAdjustment: cleanPrice(getCellVal(cells[4])) || '0',
                    priceAdjustment: cleanPrice(getCellVal(cells[5])) || '0'
                });
            } else if (cells.length >= 4) {
                // Если ячейка 0 содержит интервал времени e.g. "10:00 - 18:00"
                const cell0Text = normalizeCellText(getCellVal(cells[0]));
                const timeMatch = cell0Text.match(/(\d{1,2}:\d{2})\s*[-–—]\s*(\d{1,2}:\d{2})/);
                if (timeMatch) {
                    intervals.push({
                        enabled: isEnabled,
                        startTime: timeMatch[1],
                        endTime: timeMatch[2],
                        orderBefore: normalizeTime(getCellVal(cells[1])),
                        internalPriceAdjustment: cleanPrice(getCellVal(cells[2])) || '0',
                        priceAdjustment: cleanPrice(getCellVal(cells[3])) || '0'
                    });
                } else {
                    intervals.push({
                        enabled: isEnabled,
                        startTime: normalizeTime(getCellVal(cells[0])),
                        endTime: normalizeTime(getCellVal(cells[1])),
                        orderBefore: normalizeTime(getCellVal(cells[2])),
                        internalPriceAdjustment: cleanPrice(getCellVal(cells[3])) || '0',
                        priceAdjustment: cleanPrice(getCellVal(cells[4])) || '0'
                    });
                }
            }
        });

        return intervals;
    }

    function extractChipsFromSection(root, keywords, fallbackSelector) {
        const results = [];
        const container = root || document.body;

        const allDivs = Array.from(container.querySelectorAll('div, section, fieldset'));
        const targetSection = allDivs.find(sec => {
            const h = sec.querySelector('h1, h2, h3, h4, h5, h6, label, legend, [class*="title"], [class*="header"]');
            const hText = (h ? h.textContent : '').toLowerCase();
            return keywords.some(k => hText.includes(k));
        });

        const searchContainer = targetSection || container;
        const chips = searchContainer.querySelectorAll('[class*="chip"] span, [class*="_chip_"] span, span[data-testid*="chip"], ._chip_134hh_1 span');
        chips.forEach(el => {
            const text = (el.textContent || '').trim();
            if (text && text !== '×' && text !== '✕' && text !== '+' && !results.includes(text)) {
                results.push(text);
            }
        });

        if (results.length === 0 && fallbackSelector) {
            container.querySelectorAll(fallbackSelector).forEach(el => {
                const text = el.textContent.trim();
                if (text && text !== '×' && text !== '✕' && !results.includes(text)) {
                    results.push(text);
                }
            });
        }

        return results;
    }

    function extractMgxRows(root) {
        const mgxRows = [];
        const container = root || document.body;

        let mgxTable = container.querySelector('table[test-id*="vwc-"], .e6l3n3q1 table');

        if (!mgxTable) {
            const tables = Array.from(container.querySelectorAll('table'));
            for (const tbl of tables) {
                if (tbl.getAttribute('test-id')?.includes('lifting') || tbl.querySelector('[test-id="handlingInternalPrice"]')) continue;
                const ths = Array.from(tbl.querySelectorAll('th')).map(th => (th.textContent || '').toLowerCase());
                if (ths.some(t => t.includes('внутренняя')) || ths.some(t => t.includes('покупателя') && !t.includes('лифт') && !t.includes('этаж'))) {
                    mgxTable = tbl;
                    break;
                }
            }
        }

        if (mgxTable) {
            // Определяем реальные индексы столбцов по заголовкам
            const thElements = Array.from(mgxTable.querySelectorAll('th'));
            const thTexts = thElements.map(th => (th.textContent || '').trim().toLowerCase());

            let weightIdx = thTexts.findIndex(t => t.includes('вес') || t.includes('макс') || t.includes('кг'));
            let internalIdx = thTexts.findIndex(t => t.includes('внутренняя') || t.includes('внутр'));
            let customerIdx = thTexts.findIndex(t => t.includes('покупателя') || t.includes('клиент'));
            let returnIdx = thTexts.findIndex(t => t.includes('возврат'));

            // Fallback индексы если th отсутствуют или не распознаны
            if (weightIdx === -1) weightIdx = 0;
            if (internalIdx === -1) internalIdx = thTexts.length >= 7 ? 4 : 1;
            if (customerIdx === -1) customerIdx = thTexts.length >= 7 ? 5 : 2;
            if (returnIdx === -1) returnIdx = thTexts.length >= 7 ? 6 : 3;

            const tbody = mgxTable.querySelector('tbody') || mgxTable;
            tbody.querySelectorAll('tr').forEach(row => {
                if (row.querySelector('th')) return;
                const cells = row.querySelectorAll('td');
                if (cells.length < 2) return;

                const getCellVal = (idx) => {
                    if (idx < 0 || idx >= cells.length) return '';
                    const cell = cells[idx];
                    return normalizeCellText(cell?.querySelector('input')?.value || cell?.textContent);
                };

                const rawWeight = getCellVal(weightIdx);
                // Извлекаем числовое значение веса: "до 15 кг" -> "15", "15" -> "15"
                const numMatch = rawWeight.match(/\d+(?:[.,]\d+)?/);
                const cleanWeight = numMatch ? numMatch[0].replace(',', '.') : rawWeight;

                if (!cleanWeight && !rawWeight) return;

                mgxRows.push({
                    weight: cleanWeight || rawWeight,
                    rawWeight: rawWeight,
                    internal: getCellVal(internalIdx),
                    customer: getCellVal(customerIdx),
                    return: getCellVal(returnIdx)
                });
            });
        }

        return mgxRows;
    }

    function extractFloorRows(root) {
        const floorRows = [];
        const container = root || document.body;

        let floorTable = container.querySelector('table[test-id="lifting-table"], table[test-id*="lifting"], table[test-id*="tariff-block"], .edt22co2 table');

        if (!floorTable) {
            const tables = Array.from(container.querySelectorAll('table'));
            for (const tbl of tables) {
                if (tbl.querySelector('[test-id="handlingInternalPrice"]') || tbl.querySelector('[test-id="maxWeight"]')) {
                    floorTable = tbl;
                    break;
                }
                const ths = Array.from(tbl.querySelectorAll('th')).map(th => (th.textContent || '').toLowerCase());
                if (ths.some(t => t.includes('этаж') || t.includes('подъем'))) {
                    floorTable = tbl;
                    break;
                }
            }
        }

        if (floorTable) {
            const tbody = floorTable.querySelector('tbody') || floorTable;
            tbody.querySelectorAll('tr').forEach(row => {
                if (row.querySelector('th')) return;

                const weightCell = row.querySelector('[test-id="maxWeight"]');
                const internalPriceCell = row.querySelector('[test-id="handlingInternalPrice"]');
                const internalThresholdCell = row.querySelector('[test-id="handlingInternalThreshold"]');
                const customerPriceCell = row.querySelector('[test-id="handlingPrice"]');
                const customerThresholdCell = row.querySelector('[test-id="handlingThreshold"]');

                if (weightCell || internalPriceCell) {
                    floorRows.push({
                        weight: normalizeCellText(getCellVal(weightCell)),
                        internalPrice: cleanPrice(getCellVal(internalPriceCell)),
                        internalThreshold: cleanPrice(getCellVal(internalThresholdCell)),
                        customerPrice: cleanPrice(getCellVal(customerPriceCell)),
                        customerThreshold: cleanPrice(getCellVal(customerThresholdCell))
                    });
                    return;
                }

                const cells = row.querySelectorAll('td');
                if (cells.length >= 8) {
                    floorRows.push({
                        weight: normalizeCellText(getCellVal(cells[0])),
                        internalPrice: cleanPrice(getCellVal(cells[4])),
                        internalThreshold: cleanPrice(getCellVal(cells[5])),
                        customerPrice: cleanPrice(getCellVal(cells[6])),
                        customerThreshold: cleanPrice(getCellVal(cells[7]))
                    });
                }
            });
        }

        return floorRows;
    }

    function extractPayment(root) {
        const payment = { card: false, cash: false };
        const container = root || document.body;

        // 1. Прямой поиск чекбоксов по ID
        const cardCheckbox = container.querySelector('input[type="checkbox"][id*="cashless"]')
            || document.querySelector('input[type="checkbox"][id*="cashless"]');

        const cashCheckbox = container.querySelector('input[type="checkbox"][id="cash"], input[type="checkbox"][id*="payment-cash"], input[type="checkbox"][id*="cash"]:not([id*="cashless"])')
            || document.querySelector('input[type="checkbox"][id="cash"], input[type="checkbox"][id*="payment-cash"], input[type="checkbox"][id*="cash"]:not([id*="cashless"])');

        if (cardCheckbox) {
            payment.card = !!cardCheckbox.checked;
        }
        if (cashCheckbox) {
            payment.cash = !!cashCheckbox.checked;
        }

        // 2. Fallback: поиск по тексту / лейблам
        if (!cardCheckbox || !cashCheckbox) {
            const allElements = Array.from(container.querySelectorAll('label, div, span'));
            if (!cardCheckbox) {
                const cardLabel = allElements.find(el => {
                    const t = (el.textContent || '').trim().toLowerCase();
                    return t === 'безналичный расчет' || t === 'безналичный' || t === 'банковская карта' || t === 'безнал' || (t.includes('безналичн') && !t.includes('наличн'));
                });
                if (cardLabel) {
                    const chk = cardLabel.querySelector('input[type="checkbox"]')
                        || document.getElementById(cardLabel.getAttribute('for'))
                        || cardLabel.closest('label')?.querySelector('input')
                        || cardLabel.parentElement?.querySelector('input[type="checkbox"]');
                    if (chk) payment.card = !!chk.checked;
                }
            }
            if (!cashCheckbox) {
                const cashLabel = allElements.find(el => {
                    const t = (el.textContent || '').trim().toLowerCase();
                    return (t === 'наличный расчет' || t === 'наличные' || t === 'наличный' || t === 'нал') && !t.includes('безналичн');
                });
                if (cashLabel) {
                    const chk = cashLabel.querySelector('input[type="checkbox"]')
                        || document.getElementById(cashLabel.getAttribute('for'))
                        || cashLabel.closest('label')?.querySelector('input')
                        || cashLabel.parentElement?.querySelector('input[type="checkbox"]');
                    if (chk) payment.cash = !!chk.checked;
                }
            }
        }

        // 3. Fallback: старый Emotion селектор
        if (!cardCheckbox && !cashCheckbox) {
            const legacySec = container.querySelector('.edlmfm3, [class*="edlmfm"]');
            if (legacySec) {
                const c = legacySec.querySelector('input[id*="cashless"]');
                const m = legacySec.querySelector('input[id*="cash"]');
                if (c) payment.card = !!c.checked;
                if (m) payment.cash = !!m.checked;
            }
        }

        return payment;
    }

    function extractAcceptance(root) {
        const acceptance = { sameDay: false, nextDay: false };
        const container = root || document.body;

        // 1. Прямой поиск по ID
        const sameDayRadio = container.querySelector('#sameDay input, input#sameDay, input[value="sameDay"], input[id*="sameDay"]')
            || document.querySelector('#sameDay input, input#sameDay, input[value="sameDay"], input[id*="sameDay"]');
        const nextDayRadio = container.querySelector('#nextDay input, input#nextDay, input[value="nextDay"], input[id*="nextDay"]')
            || document.querySelector('#nextDay input, input#nextDay, input[value="nextDay"], input[id*="nextDay"]');

        if (sameDayRadio) {
            acceptance.sameDay = !!sameDayRadio.checked;
        }
        if (nextDayRadio) {
            acceptance.nextDay = !!nextDayRadio.checked;
        }

        // 2. Fallback: поиск по тексту / лейблам
        if (!sameDayRadio || !nextDayRadio) {
            const allElements = Array.from(container.querySelectorAll('label, div, span'));
            if (!sameDayRadio) {
                const sameLabel = allElements.find(el => (el.textContent || '').trim().toLowerCase().includes('в день оформления'));
                if (sameLabel) {
                    const r = sameLabel.querySelector('input') || document.getElementById(sameLabel.getAttribute('for')) || sameLabel.parentElement?.querySelector('input');
                    if (r) acceptance.sameDay = !!r.checked;
                }
            }
            if (!nextDayRadio) {
                const nextLabel = allElements.find(el => (el.textContent || '').trim().toLowerCase().includes('следующий день'));
                if (nextLabel) {
                    const r = nextLabel.querySelector('input') || document.getElementById(nextLabel.getAttribute('for')) || nextLabel.parentElement?.querySelector('input');
                    if (r) acceptance.nextDay = !!r.checked;
                }
            }
        }

        // 3. Fallback: старый Emotion селектор
        if (!sameDayRadio && !nextDayRadio) {
            const legacySec = container.querySelector('.e1lmeb342, [class*="e1lmeb"]');
            if (legacySec) {
                const s = legacySec.querySelector('#sameDay input');
                const n = legacySec.querySelector('#nextDay input');
                if (s) acceptance.sameDay = !!s.checked;
                if (n) acceptance.nextDay = !!n.checked;
            }
        }

        return acceptance;
    }

    function extractFullTariffData(root, tariffName, modalIntervals) {
        const container = root || document.body;

        const zones = extractChipsFromSection(container, ['зоны доставки', 'зона доставки', 'зоны'], '.e1fyrg6v2 ._chip_134hh_1 span, [class*="e1fyrg"] ._chip_134hh_1 span');
        const branches = extractChipsFromSection(container, ['филиалы обслуживания', 'филиалы', 'филиал'], '.ememj2e2 ._chip_134hh_1 span, [class*="ememj"] ._chip_134hh_1 span');
        const mgxRows = extractMgxRows(container);
        const floorRows = extractFloorRows(container);
        const elevatorPrices = extractElevatorPrices(container);

        // 3-Tier Interval extraction:
        // Tier 1: Модальное окно (если удалось открыть в режиме редактирования)
        // Tier 2: React Fiber props/state (мгновенное точное извлечение без открытия диалогов)
        // Tier 3: DOM-таблица на странице (view-mode или edit-mode)
        let intervals = (modalIntervals && modalIntervals.length > 0) ? modalIntervals : null;
        if (!intervals || intervals.length === 0) {
            intervals = extractIntervalsFromReactFiber(container);
        }
        if (!intervals || intervals.length === 0) {
            intervals = extractIntervals(container);
        }
        if (!intervals) {
            intervals = [];
        }

        const payment = extractPayment(container);
        const acceptance = extractAcceptance(container);
        const saleTypes = extractSaleTypes(container);

        // Дополнительные поля для ПВЗ
        const deliveryDaysInput = container.querySelector('input[placeholder*="Количество дней доставки"]');
        const cutoffInput = container.querySelector('input[placeholder*="Отсечка оформления заказа"]');
        const costLimitInput = container.querySelector('input[placeholder*="Стоимость заказа"]');

        return {
            tariffName,
            name: tariffName,
            zones,
            branches,
            mgxRows,
            floorRows,
            elevatorPrices,
            intervals,
            payment,
            acceptance,
            saleTypes,
            deliveryDays: deliveryDaysInput ? deliveryDaysInput.value : '0',
            cutoffTime: cutoffInput ? cutoffInput.value : '00:00',
            costLimit: costLimitInput ? costLimitInput.value : ''
        };
    }
})();
