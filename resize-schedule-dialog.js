// resize-schedule-dialog.js - Автоматическое увеличение высоты диалогового окна графика работы
(function() {
'use strict';
console.log('📏 Модуль автоматического увеличения высоты окна графика работы загружен (v5 FIXED - no recursion loop)');

let isUpdating = false;
let isApplyingChanges = false; // НОВЫЙ ФЛАГ для предотвращения рекурсии
let appliedStyles = false;
let debugMode = false;
window.setScheduleDebug = function(val) { debugMode = !!val; console.log('[ScheduleDialog] debugMode set to', debugMode); };
let toggleObserver = null;
let toggleUpdateTimeout = null;
let tableObserver = null;
let refreshTimeout = null;
let lastToggleState = false;
let observerRefreshTimeout = null;

// Функция для логирования с меткой времени
function logDebug(message, data = null) {
    if (!debugMode) return;
    const time = new Date().toLocaleTimeString('ru-RU', {
        hour12: false,
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        fractionalSecondDigits: 3
    });
    console.log(`[${time}] 🔍 ${message}`);
    if (data) {
        console.log(`[${time}] 📊 Данные:`, data);
    }
}

function getScheduleDialog() {
    if (window.location.pathname.includes('/tariffs')) return null;
    return document.getElementById('select-schedule-dlg');
}

function getTableContainer(dialog = getScheduleDialog()) {
    return dialog ? dialog.querySelector('._wrapper_niek1_4') : null;
}

function getWeekTable(dialog = getScheduleDialog()) {
    const tableContainer = getTableContainer(dialog);
    if (!tableContainer) return null;
    return tableContainer.querySelector('table[test-id="week_table"]') || tableContainer.querySelector('table');
}

function getBodyContent(dialog = getScheduleDialog()) {
    return dialog ? dialog.querySelector('._body_1ghey_73') : null;
}

function getMainContainer(dialog = getScheduleDialog()) {
    return dialog ? dialog.querySelector('._body_1ghey_73 > div') : null;
}

function getTableWrapper(dialog = getScheduleDialog()) {
    return dialog ? dialog.querySelector('.css-1u0iono.e9kpsol0') : null;
}

function getHeaderDayKey(headerCell) {
    if (!headerCell) return '';
    return headerCell.getAttribute('test-id') || '';
}

function getCellDayKey(cell) {
    const target = cell?.closest?.('[test-id^="week_day_"]') || cell;
    if (!target) return '';
    return target.getAttribute('test-id') || '';
}

function getRowDayCheckboxes(row) {
    return Array.from(row.querySelectorAll('td[test-id^="week_day_"] input[type="checkbox"]'));
}

function getColumnDayCheckboxes(dayKey, tableContainer = getTableContainer()) {
    if (!tableContainer || !dayKey) return [];
    return Array.from(tableContainer.querySelectorAll(`td[test-id="${dayKey}"] input[type="checkbox"]`));
}

function getColumnMasterCheckbox(dayKey, tableContainer = getTableContainer()) {
    if (!tableContainer || !dayKey) return null;
    return tableContainer.querySelector(`th[test-id="${dayKey}"] .column-master-checkbox`);
}

function getWeekDayHeaders(tableContainer = getTableContainer()) {
    if (!tableContainer) return [];
    return Array.from(tableContainer.querySelectorAll('th[test-id^="week_day_"]'));
}

function getEffectiveBackgroundColor(element, fallback = '#ffffff') {
    let current = element;
    while (current && current !== document.documentElement) {
        const style = window.getComputedStyle(current);
        const bg = style.backgroundColor;
        if (bg && bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent') {
            return bg;
        }
        current = current.parentElement;
    }
    return fallback;
}

function configureTableScrollArea() {
    const dialog = getScheduleDialog();
    if (!dialog) return false;

    const bodyContent = getBodyContent(dialog);
    const mainContainer = getMainContainer(dialog);
    const tableWrapper = getTableWrapper(dialog);
    const tableContainer = getTableContainer(dialog);

    if (!bodyContent || !tableContainer) {
        return false;
    }

    bodyContent.style.overflow = 'hidden';
    bodyContent.style.position = bodyContent.style.position || 'relative';

    if (mainContainer) {
        mainContainer.style.height = '100%';
        mainContainer.style.maxHeight = 'none';
        mainContainer.style.overflow = 'hidden';
        mainContainer.style.position = mainContainer.style.position || 'relative';
    }

    if (tableWrapper) {
        tableWrapper.style.width = '100%';
        tableWrapper.style.maxWidth = '100%';
        tableWrapper.style.margin = '0';
        tableWrapper.style.padding = '0';
        tableWrapper.style.overflow = 'visible';
    }

    const bodyRect = bodyContent.getBoundingClientRect();
    const containerRect = tableContainer.getBoundingClientRect();
    const offsetTop = Math.max(0, Math.round(containerRect.top - bodyRect.top));
    const availableHeight = Math.max(220, Math.round(bodyContent.clientHeight - offsetTop - 8));

    tableContainer.style.height = availableHeight + 'px';
    tableContainer.style.maxHeight = availableHeight + 'px';
    tableContainer.style.overflowY = 'auto';
    tableContainer.style.overflowX = 'auto';
    tableContainer.style.position = 'relative';
    tableContainer.style.width = '100%';
    tableContainer.style.maxWidth = '100%';
    tableContainer.style.minHeight = '220px';
    tableContainer.dataset.stickyScrollContainer = 'true';

    logDebug(`📦 Настроен scroll-container таблицы: ${availableHeight}px`);
    return true;
}

function scheduleObserverRefresh(delay = 120, reason = 'observer') {
    const dialog = getScheduleDialog();
    if (!dialog || !dialog.hasAttribute('data-schedule-resized')) return;
    if (isApplyingChanges || isUpdating) return; // Пропускаем, если скрипт активен

    if (observerRefreshTimeout) {
        clearTimeout(observerRefreshTimeout);
    }

    observerRefreshTimeout = setTimeout(() => {
        observerRefreshTimeout = null;
        if (isUpdating || isApplyingChanges) return;
        logDebug(`🔄 Запуск отложенного обновления таблицы (${reason})`);
        const savedState = saveCheckboxState();
        rebuildTableEnhancements(savedState, reason);
    }, delay);
}

function updateRowMasterState(row) {
    if (!row) return;

    const masterCheckbox = row.querySelector('.row-master-checkbox');
    const dayCheckboxes = getRowDayCheckboxes(row);

    if (!masterCheckbox || dayCheckboxes.length === 0) return;

    const allChecked = dayCheckboxes.every(cb => cb.checked);
    const someChecked = dayCheckboxes.some(cb => cb.checked);

    masterCheckbox.checked = allChecked;
    masterCheckbox.indeterminate = !allChecked && someChecked;
}

function updateColumnMasterState(dayKey, tableContainer = getTableContainer()) {
    if (!tableContainer || !dayKey) return;

    const columnMaster = getColumnMasterCheckbox(dayKey, tableContainer);
    if (!columnMaster) return;

    const dayCheckboxes = getColumnDayCheckboxes(dayKey, tableContainer);
    if (dayCheckboxes.length === 0) {
        columnMaster.checked = false;
        columnMaster.indeterminate = false;
        return;
    }

    const allChecked = dayCheckboxes.every(cb => cb.checked);
    const someChecked = dayCheckboxes.some(cb => cb.checked);

    columnMaster.checked = allChecked;
    columnMaster.indeterminate = !allChecked && someChecked;
}

function updateAllMasterStates() {
    const dialog = getScheduleDialog();
    const tableContainer = getTableContainer(dialog);
    if (!tableContainer) return;

    const rows = tableContainer.querySelectorAll('tbody tr');
    rows.forEach(row => updateRowMasterState(row));

    getWeekDayHeaders(tableContainer).forEach(header => {
        updateColumnMasterState(getHeaderDayKey(header), tableContainer);
    });
}

function applyStickyHeader() {
    const dialog = getScheduleDialog();
    if (!dialog) return false;

    const tableContainer = getTableContainer(dialog);
    const table = getWeekTable(dialog);

    if (!tableContainer || !table) {
        logDebug('❌ Не удалось применить sticky header: отсутствуют контейнеры');
        return false;
    }

    configureTableScrollArea();

    table.style.borderCollapse = 'separate';
    table.style.borderSpacing = '0';
    table.style.width = '100%';
    table.style.tableLayout = 'fixed';

    const thead = table.querySelector('thead');
    const headerCells = table.querySelectorAll('thead th');

    headerCells.forEach((th) => {
        if (!th.dataset.originalBgColor) {
            th.dataset.originalBgColor = getEffectiveBackgroundColor(th, '#ffffff');
        }

        const bgColor = th.classList.contains('row-select-header')
            ? '#34495e'
            : th.dataset.originalBgColor || getEffectiveBackgroundColor(th, '#ffffff');

        th.style.position = 'sticky';
        th.style.top = '0';
        th.style.zIndex = th.classList.contains('row-select-header') ? '12' : '11';
        th.style.background = bgColor;
        th.style.backgroundColor = bgColor;
        th.style.backgroundClip = 'padding-box';
        th.style.boxShadow = '0 1px 0 #dfe6ee';
        th.style.verticalAlign = 'middle';
    });

    if (thead) {
        thead.style.position = 'relative';
        thead.style.zIndex = '10';
    }

    logDebug('✅ Sticky header применен');
    return true;
}

function rebuildTableEnhancements(savedState = null, context = 'rebuild') {
    const dialog = getScheduleDialog();
    if (!dialog || !dialog.hasAttribute('data-schedule-resized')) return false;

    if (isUpdating || isApplyingChanges) {
        logDebug(`⏭️ Пропускаем rebuild (${context}) — уже идет обновление`);
        return false;
    }

    // Включаем блокировку перед началом изменений
    isApplyingChanges = true;
    isUpdating = true;
    logDebug(`🛠️ Пересборка таблицы (${context})...`);

    try {
        configureTableScrollArea();
        applyTableStyles();
        addRowSelectCheckboxes();
        addColumnSelectCheckboxes();
        applyStickyHeader();
        forceCenterAllCheckboxes();
        fixAllZonesRow();

        if (savedState) {
            restoreCheckboxState(savedState);
        } else {
            updateAllMasterStates();
        }

        setTimeout(() => {
            configureTableScrollArea();
            applyStickyHeader();
            updateAllMasterStates();
            isUpdating = false;
            
            // Снимаем блокировку с задержкой, чтобы все события успели завершиться
            setTimeout(() => {
                isApplyingChanges = false;
                logDebug(`✅ Пересборка таблицы завершена (${context}), блокировка снята`);
            }, 200);
        }, 160);

        return true;
    } catch (error) {
        isUpdating = false;
        isApplyingChanges = false;
        logDebug(`❌ Ошибка пересборки таблицы (${context}): ${error}`);
        return false;
    }
}

function forceSetCheckboxState(checkbox, checked) {
    if (!checkbox) return false;

    try {
        if (checkbox._forceSetting) return false;
        checkbox._forceSetting = true;

        logDebug(`  🔧 Принудительная установка чекбокса в ${checked ? '✅' : '❌'}`);

        if (checkbox.checked === checked && checkbox.indeterminate === false) {
            checkbox._forceSetting = false;
            return true;
        }

        const originalChecked = checkbox.checked;

        checkbox.indeterminate = false;
        checkbox.checked = checked;

        const events = [
            'change',
            'input',
            'click',
            'mousedown',
            'mouseup',
            'mouseclick'
        ];

        events.forEach(eventName => {
            try {
                const event = new Event(eventName, {
                    bubbles: true,
                    cancelable: true,
                    composed: true
                });
                checkbox.dispatchEvent(event);
            } catch (e) {}
        });

        if (checked !== originalChecked) {
            setTimeout(() => {
                try {
                    const reactPropsKey = Object.keys(checkbox).find(key =>
                        key.startsWith('__reactProps$') ||
                        key.startsWith('__reactEventHandlers$')
                    );

                    if (reactPropsKey && checkbox[reactPropsKey]) {
                        const props = checkbox[reactPropsKey];
                        if (props.onChange) {
                            props.onChange({ target: checkbox, type: 'change' });
                        }
                        if (props.onInput) {
                            props.onInput({ target: checkbox, type: 'input' });
                        }
                    }
                } catch (e) {}

                const extraEvent = new Event('change', { bubbles: true });
                checkbox.dispatchEvent(extraEvent);

                checkbox._forceSetting = false;
            }, 10);
        } else {
            checkbox._forceSetting = false;
        }

        logDebug(`  ✅ Чекбокс принудительно установлен, события отправлены`);
        return true;
    } catch (error) {
        logDebug(`  ❌ Ошибка при установке чекбокса: ${error}`);
        checkbox._forceSetting = false;
        return false;
    }
}

function clickCheckbox(checkbox) {
    if (!checkbox) return;

    try {
        const targetState = !checkbox.checked;
        checkbox.click();

        setTimeout(() => {
            forceSetCheckboxState(checkbox, targetState);
        }, 50);

        logDebug(`  🖱️ Выполнен клик по чекбоксу, целевое состояние: ${targetState ? '✅' : '❌'}`);
    } catch (error) {
        logDebug(`  ❌ Ошибка при клике: ${error}`);
    }
}

function processRowWithMaster(row, shouldCheck) {
    const masterCheckbox = row.querySelector('.row-master-checkbox');
    const dayCheckboxes = getRowDayCheckboxes(row);

    if (!masterCheckbox || dayCheckboxes.length === 0) return;

    logDebug(`  📌 Обработка строки через мастер: ${shouldCheck ? '✅' : '❌'}`);

    if (shouldCheck) {
        if (!masterCheckbox.checked || masterCheckbox.indeterminate) {
            clickCheckbox(masterCheckbox);
        }

        setTimeout(() => {
            dayCheckboxes.forEach(cb => {
                if (!cb.checked) {
                    forceSetCheckboxState(cb, true);
                }
            });
            updateRowMasterState(row);
            updateAllMasterStates();
        }, 100);
    } else {
        if (masterCheckbox.checked || masterCheckbox.indeterminate) {
            clickCheckbox(masterCheckbox);
        }

        setTimeout(() => {
            dayCheckboxes.forEach(cb => {
                if (cb.checked) {
                    forceSetCheckboxState(cb, false);
                }
            });
            updateRowMasterState(row);
            updateAllMasterStates();
        }, 100);
    }
}

function logTableDimensions(dialog, context) {
    if (!dialog) return;

    const tableContainer = getTableContainer(dialog);
    if (!tableContainer) return;

    const table = getWeekTable(dialog);
    if (!table) return;

    const thead = table.querySelector('thead');

    logDebug(`📏 [${context}] РАЗМЕРЫ ТАБЛИЦЫ:`);

    const dialogRect = dialog.getBoundingClientRect();
    logDebug(`  Диалог: ${Math.round(dialogRect.width)}x${Math.round(dialogRect.height)}px`);

    const containerRect = tableContainer.getBoundingClientRect();
    logDebug(`  Контейнер: ${Math.round(containerRect.width)}x${Math.round(containerRect.height)}px`);

    const tableRect = table.getBoundingClientRect();
    logDebug(`  Таблица: ${Math.round(tableRect.width)}x${Math.round(tableRect.height)}px`);

    if (thead) {
        const headers = thead.querySelectorAll('th');
        const headerWidths = Array.from(headers).map(h => {
            const style = window.getComputedStyle(h);
            return `${Math.round(parseFloat(style.width))}px`;
        }).join(' | ');
        logDebug(`  Ширина колонок: ${headerWidths}`);
    }

    const masterColumn = thead?.querySelector('th.row-select-header');
    if (masterColumn) {
        const masterStyle = window.getComputedStyle(masterColumn);
        logDebug(`  ✅ Колонка чекбоксов: ${Math.round(parseFloat(masterStyle.width))}px`);
    } else {
        logDebug(`  ❌ Колонка чекбоксов отсутствует`);
    }
}

function logCheckboxPositions(dialog, context) {
    if (!dialog) return;

    const tableContainer = getTableContainer(dialog);
    if (!tableContainer) return;

    const masterCheckboxes = tableContainer.querySelectorAll('.row-master-checkbox');
    const dayCheckboxes = tableContainer.querySelectorAll('td[test-id^="week_day_"] input[type="checkbox"]');
    const columnMasterCheckboxes = tableContainer.querySelectorAll('.column-master-checkbox');

    logDebug(`📍 [${context}] ПОЛОЖЕНИЕ ЧЕКБОКСОВ:`);
    logDebug(`  Всего мастер-чекбоксов строк: ${masterCheckboxes.length}`);
    logDebug(`  Всего мастер-чекбоксов дней: ${columnMasterCheckboxes.length}`);
    logDebug(`  Всего дневных чекбоксов: ${dayCheckboxes.length}`);

    masterCheckboxes.forEach((cb, index) => {
        const rect = cb.getBoundingClientRect();
        const parentTd = cb.closest('td');

        logDebug(`  Мастер строки #${index + 1}:`);
        logDebug(`    → Координаты: (${Math.round(rect.left)}, ${Math.round(rect.top)})`);
        logDebug(`    → Размер: ${Math.round(rect.width)}x${Math.round(rect.height)}px`);

        if (parentTd) {
            const tdRect = parentTd.getBoundingClientRect();
            const offsetX = Math.round(rect.left - tdRect.left);
            const offsetY = Math.round(rect.top - tdRect.top);
            logDebug(`    → Смещение в ячейке: (${offsetX}, ${offsetY})px`);
        }
    });

    if (columnMasterCheckboxes.length > 0) {
        const firstColumn = columnMasterCheckboxes[0];
        const rect = firstColumn.getBoundingClientRect();
        logDebug(`  Пример мастер-чекбокса дня: (${Math.round(rect.left)}, ${Math.round(rect.top)})`);
    }
}

function logCheckboxState(dialog, context) {
    if (!dialog) return;

    const tableContainer = getTableContainer(dialog);
    if (!tableContainer) return;

    logDebug(`🔘 [${context}] СОСТОЯНИЕ ЧЕКБОКСОВ:`);

    const masterCheckboxes = tableContainer.querySelectorAll('.row-master-checkbox');
    logDebug(`  Мастер-чекбоксы строк (${masterCheckboxes.length}):`);
    masterCheckboxes.forEach((cb, index) => {
        logDebug(`    #${index + 1}: checked=${cb.checked}, indeterminate=${cb.indeterminate}`);
    });

    const columnMasters = tableContainer.querySelectorAll('.column-master-checkbox');
    logDebug(`  Мастер-чекбоксы дней (${columnMasters.length}):`);
    columnMasters.forEach((cb, index) => {
        logDebug(`    #${index + 1}: day=${cb.dataset.dayKey}, checked=${cb.checked}, indeterminate=${cb.indeterminate}`);
    });

    const rows = tableContainer.querySelectorAll('tbody tr');
    rows.forEach((row, rowIndex) => {
        const dayCbs = getRowDayCheckboxes(row);
        const states = Array.from(dayCbs).map(cb => cb.checked ? '✅' : '❌').join(' ');
        logDebug(`  Строка #${rowIndex + 1}: ${states}`);
    });
}

function getResponsiveHeight() {
    const screenHeight = window.innerHeight;
    const basePercent = 80;

    let calculatedHeight = Math.round(screenHeight * (basePercent / 100));

    const minHeight = 500;
    const maxHeight = 900;

    calculatedHeight = Math.max(minHeight, Math.min(calculatedHeight, maxHeight));

    logDebug(`Высота экрана: ${screenHeight}px, Высота окна: ${calculatedHeight}px (${basePercent}%)`);

    return calculatedHeight;
}

function saveCheckboxState() {
    const dialog = getScheduleDialog();
    if (!dialog) return {};

    const tableContainer = getTableContainer(dialog);
    if (!tableContainer) return {};

    const rows = tableContainer.querySelectorAll('tbody tr');
    const state = {
        master: [],
        days: []
    };

    rows.forEach((row, rowIndex) => {
        const master = row.querySelector('.row-master-checkbox');
        if (master) {
            state.master.push({
                rowIndex,
                checked: master.checked,
                indeterminate: master.indeterminate
            });
        }

        const dayCheckboxes = getRowDayCheckboxes(row);
        dayCheckboxes.forEach((cb, colIndex) => {
            state.days.push({
                rowIndex,
                colIndex,
                checked: cb.checked
            });
        });
    });

    logDebug(`💾 Сохранено состояние: ${state.master.length} мастер-чекбоксов, ${state.days.length} дневных чекбоксов`);
    return state;
}

function restoreCheckboxState(savedState) {
    if (!savedState || !savedState.days) {
        logDebug('❌ Нет сохраненного состояния для восстановления');
        updateAllMasterStates();
        return;
    }

    const dialog = getScheduleDialog();
    if (!dialog) return;

    const tableContainer = getTableContainer(dialog);
    if (!tableContainer) return;

    const rows = tableContainer.querySelectorAll('tbody tr');

    logDebug('🔄 Восстанавливаем состояние чекбоксов...');

    savedState.days.forEach(item => {
        if (item.rowIndex < rows.length) {
            const row = rows[item.rowIndex];
            const dayCheckboxes = getRowDayCheckboxes(row);
            if (item.colIndex < dayCheckboxes.length) {
                const cb = dayCheckboxes[item.colIndex];
                if (cb.checked !== item.checked) {
                    forceSetCheckboxState(cb, item.checked);
                }
            }
        }
    });

    setTimeout(() => {
        updateAllMasterStates();
        logDebug('✅ Состояние чекбоксов восстановлено');
    }, 200);
}

function centerCheckboxInCell(cell) {
    if (!cell) return;

    cell.style.padding = '4px 2px';
    cell.style.textAlign = 'center';
    cell.style.verticalAlign = 'middle';

    const divs = cell.querySelectorAll('div');
    divs.forEach(div => {
        div.style.display = 'flex';
        div.style.justifyContent = 'center';
        div.style.alignItems = 'center';
        div.style.width = '100%';
        div.style.height = '100%';
        div.style.margin = '0';
        div.style.padding = '0';
    });

    const checkbox = cell.querySelector('input[type="checkbox"]');
    if (checkbox) {
        checkbox.style.margin = '0';
        checkbox.style.position = 'relative';
        checkbox.style.top = 'auto';
        checkbox.style.left = 'auto';
        checkbox.style.transform = 'scale(1.2)';
    }
}

function forceCenterAllCheckboxes() {
    const dialog = getScheduleDialog();
    if (!dialog) return;

    logDebug('🎯 Принудительное центрирование всех чекбоксов...');

    const tableContainer = getTableContainer(dialog);
    if (!tableContainer) return;

    const dayCells = tableContainer.querySelectorAll('td[test-id^="week_day_"]');
    dayCells.forEach(cell => {
        centerCheckboxInCell(cell);
    });

    const masterCells = tableContainer.querySelectorAll('td .row-master-checkbox');
    masterCells.forEach(cb => {
        const parentTd = cb.closest('td');
        if (parentTd) {
            parentTd.style.padding = '4px 2px';
            parentTd.style.textAlign = 'center';
            parentTd.style.verticalAlign = 'middle';

            const container = parentTd.querySelector('div');
            if (container) {
                container.style.display = 'flex';
                container.style.justifyContent = 'center';
                container.style.alignItems = 'center';
                container.style.width = '100%';
                container.style.height = '100%';
                container.style.margin = '0';
                container.style.padding = '0';
            }

            cb.style.margin = '0';
            cb.style.transform = 'scale(1.2)';
        }
    });

    const headerCheckboxes = tableContainer.querySelectorAll('.column-master-checkbox');
    headerCheckboxes.forEach(cb => {
        cb.style.display = 'block';
        cb.style.margin = '0 auto';
        cb.style.transform = 'scale(1.15)';
        cb.style.cursor = 'pointer';
    });

    const headerWrappers = tableContainer.querySelectorAll('.column-master-header-content');
    headerWrappers.forEach(wrapper => {
        wrapper.style.display = 'grid';
        wrapper.style.gridTemplateRows = 'auto auto';
        wrapper.style.justifyItems = 'center';
        wrapper.style.alignItems = 'center';
        wrapper.style.rowGap = '4px';
        wrapper.style.width = '100%';
        wrapper.style.minHeight = '42px';
        wrapper.style.textAlign = 'center';
    });

    const headerLabels = tableContainer.querySelectorAll('.column-master-label');
    headerLabels.forEach(label => {
        label.style.display = 'block';
        label.style.width = '100%';
        label.style.textAlign = 'center';
        label.style.lineHeight = '1.1';
        label.style.margin = '0';
    });

    logDebug('✅ Центрирование завершено');
}

function fixAllZonesRow() {
    const dialog = getScheduleDialog();
    if (!dialog) return;

    const tableContainer = getTableContainer(dialog);
    if (!tableContainer) return;

    const allZonesRow = Array.from(tableContainer.querySelectorAll('tbody tr')).find(row => {
        const nameCell = row.querySelector('td[test-id="name"]');
        return nameCell && nameCell.textContent.includes('Все зоны');
    });

    if (!allZonesRow) {
        return;
    }

    logDebug('🔧 Исправляем строку "Все зоны"...');

    const dayCells = allZonesRow.querySelectorAll('td[test-id^="week_day_"]');

    dayCells.forEach((cell) => {
        cell.style.removeProperty('max-width');
        cell.style.removeProperty('width');

        cell.style.width = '80px';
        cell.style.minWidth = '80px';
        cell.style.maxWidth = '80px';
        cell.style.padding = '4px 2px';
        cell.style.textAlign = 'center';
        cell.style.verticalAlign = 'middle';

        centerCheckboxInCell(cell);
    });

    const nameCell = allZonesRow.querySelector('td[test-id="name"]');
    if (nameCell) {
        nameCell.style.width = '250px';
        nameCell.style.minWidth = '250px';
        nameCell.style.maxWidth = '250px';
        nameCell.style.fontSize = '13px';
        nameCell.style.padding = '6px 8px';
        nameCell.style.whiteSpace = 'normal';
        nameCell.style.wordWrap = 'break-word';
    }

    logDebug('✅ Строка "Все зоны" исправлена');
}

function applyTableStyles() {
    const dialog = getScheduleDialog();
    if (!dialog) {
        logDebug('❌ Диалог не найден при применении стилей');
        return false;
    }

    logDebug('Применяем стили к таблице...');

    const tableContainer = getTableContainer(dialog);
    if (!tableContainer) {
        logDebug('❌ Контейнер таблицы не найден');
        return false;
    }

    const table = getWeekTable(dialog);
    if (!table) {
        logDebug('❌ Таблица не найдена');
        return false;
    }

    configureTableScrollArea();

    const rows = tableContainer.querySelectorAll('tbody tr');
    logDebug(`Найдено строк для стилизации: ${rows.length}`);

    table.style.width = '100%';
    table.style.tableLayout = 'fixed';

    const zoneHeaders = tableContainer.querySelectorAll('th[test-id="name"]');
    zoneHeaders.forEach((header) => {
        header.style.width = '250px';
        header.style.minWidth = '250px';
        header.style.maxWidth = '250px';
        header.style.padding = '8px 8px';
    });

    const dayHeaders = tableContainer.querySelectorAll('th[test-id^="week_day_"]');
    dayHeaders.forEach((header) => {
        header.style.width = '80px';
        header.style.minWidth = '80px';
        header.style.maxWidth = '80px';
        header.style.textAlign = 'center';
        header.style.verticalAlign = 'middle';
        header.style.padding = '6px 2px 8px';
    });

    rows.forEach((row, index) => {
        row.style.marginBottom = '2px';

        const nameCell = row.querySelector('td[test-id="name"]');
        if (nameCell) {
            nameCell.style.width = '250px';
            nameCell.style.minWidth = '250px';
            nameCell.style.maxWidth = '250px';
            nameCell.style.fontSize = '13px';
            nameCell.style.padding = '6px 8px';
            nameCell.style.whiteSpace = 'normal';
            nameCell.style.wordWrap = 'break-word';
        }

        const dayCells = row.querySelectorAll('td[test-id^="week_day_"]');
        dayCells.forEach(cell => {
            cell.style.width = '80px';
            cell.style.minWidth = '80px';
            cell.style.maxWidth = '80px';
            cell.style.padding = '4px 2px';
            cell.style.textAlign = 'center';
            cell.style.verticalAlign = 'middle';

            centerCheckboxInCell(cell);
        });

        if (index < rows.length - 1) {
            row.style.borderBottom = '1px solid #eef2f6';
        }
    });

    const rowSelectHeader = tableContainer.querySelector('th.row-select-header');
    if (rowSelectHeader) {
        rowSelectHeader.style.width = '50px';
        rowSelectHeader.style.minWidth = '50px';
        rowSelectHeader.style.maxWidth = '50px';
        rowSelectHeader.style.textAlign = 'center';
        rowSelectHeader.style.padding = '8px 2px';
    }

    fixAllZonesRow();

    appliedStyles = true;
    return true;
}

function addColumnSelectCheckboxes() {
    const dialog = getScheduleDialog();
    if (!dialog) {
        logDebug('❌ Диалог не найден при добавлении чекбоксов дней');
        return false;
    }

    const tableContainer = getTableContainer(dialog);
    const table = getWeekTable(dialog);

    if (!tableContainer || !table) {
        logDebug('❌ Таблица не найдена при добавлении чекбоксов дней');
        return false;
    }

    const dayHeaders = getWeekDayHeaders(tableContainer);
    if (!dayHeaders.length) {
        logDebug('❌ Заголовки дней не найдены');
        return false;
    }

    dayHeaders.forEach((header) => {
        const dayKey = getHeaderDayKey(header);
        if (!dayKey) return;

        if (!header.dataset.originalText) {
            header.dataset.originalText = (header.textContent || '').replace(/\s+/g, ' ').trim();
        }
        if (!header.dataset.originalBgColor) {
            header.dataset.originalBgColor = getEffectiveBackgroundColor(header, '#ffffff');
        }

        let wrapper = header.querySelector('.column-master-header-content');
        let labelSpan = header.querySelector('.column-master-label');
        let checkbox = header.querySelector('.column-master-checkbox');

        if (!wrapper) {
            header.innerHTML = '';

            wrapper = document.createElement('div');
            wrapper.className = 'column-master-header-content';
            wrapper.style.cssText = `
                display: grid !important;
                grid-template-rows: auto auto !important;
                justify-items: center !important;
                align-items: center !important;
                row-gap: 4px !important;
                width: 100% !important;
                min-height: 42px !important;
                line-height: 1.1 !important;
                text-align: center !important;
                margin: 0 auto !important;
            `;

            labelSpan = document.createElement('span');
            labelSpan.className = 'column-master-label';
            labelSpan.style.cssText = `
                display: block !important;
                width: 100% !important;
                text-align: center !important;
                font-size: 12px !important;
                font-weight: 600 !important;
                line-height: 1.1 !important;
                white-space: nowrap !important;
                margin: 0 !important;
            `;

            checkbox = document.createElement('input');
            checkbox.type = 'checkbox';
            checkbox.className = 'column-master-checkbox';
            checkbox.title = 'Выделить/снять все чекбоксы этого дня';
            checkbox.style.cssText = `
                display: block !important;
                transform: scale(1.15) !important;
                cursor: pointer !important;
                margin: 0 auto !important;
                place-self: center !important;
            `;

            wrapper.appendChild(labelSpan);
            wrapper.appendChild(checkbox);
            header.appendChild(wrapper);
        }

        if (labelSpan) {
            labelSpan.textContent = header.dataset.originalText || '';
            labelSpan.style.width = '100%';
            labelSpan.style.textAlign = 'center';
            labelSpan.style.margin = '0';
        }

        if (wrapper) {
            wrapper.style.display = 'grid';
            wrapper.style.gridTemplateRows = 'auto auto';
            wrapper.style.justifyItems = 'center';
            wrapper.style.alignItems = 'center';
            wrapper.style.rowGap = '4px';
            wrapper.style.width = '100%';
            wrapper.style.minHeight = '42px';
            wrapper.style.textAlign = 'center';
            wrapper.style.margin = '0 auto';
        }

        header.dataset.columnMasterInitialized = 'true';
        header.style.background = header.dataset.originalBgColor;
        header.style.backgroundColor = header.dataset.originalBgColor;

        if (checkbox) {
            checkbox.dataset.dayKey = dayKey;
        }

        setupSingleColumnHandler(header);
    });

    updateAllMasterStates();
    logDebug('✅ Заголовочные мастер-чекбоксы по дням добавлены/обновлены');
    return true;
}

function setupSingleColumnHandler(header) {
    const checkbox = header.querySelector('.column-master-checkbox');
    if (!checkbox) return;

    const dayKey = getHeaderDayKey(header);
    checkbox.dataset.dayKey = dayKey;

    if (checkbox._oldHandler) {
        checkbox.removeEventListener('change', checkbox._oldHandler);
    }

    const columnHandler = function(e) {
        if (checkbox._processing) return;
        checkbox._processing = true;

        try {
            const newState = e.target.checked;
            const tableContainer = getTableContainer();
            const dayCheckboxes = getColumnDayCheckboxes(dayKey, tableContainer);

            logDebug(`📅 Мастер-чекбокс дня ${dayKey} изменен: ${newState ? '✅' : '❌'} (${dayCheckboxes.length} ячеек)`);

            dayCheckboxes.forEach((cb) => {
                if (cb.checked !== newState || cb.indeterminate) {
                    forceSetCheckboxState(cb, newState);
                }
            });

            checkbox.indeterminate = false;

            setTimeout(() => {
                const rows = tableContainer ? tableContainer.querySelectorAll('tbody tr') : [];
                rows.forEach(row => updateRowMasterState(row));
                updateColumnMasterState(dayKey, tableContainer);
            }, 120);
        } finally {
            setTimeout(() => {
                checkbox._processing = false;
            }, 150);
        }
    };

    checkbox.addEventListener('change', columnHandler);
    checkbox._oldHandler = columnHandler;
}

function addRowSelectCheckboxes() {
    const dialog = getScheduleDialog();
    if (!dialog) {
        logDebug('❌ Диалог не найден при добавлении чекбоксов');
        return false;
    }

    logDebug('Начинаем добавление колонки с чекбоксами...');

    const tableContainer = getTableContainer(dialog);
    if (!tableContainer) {
        logDebug('❌ Контейнер таблицы не найден');
        return false;
    }

    const table = getWeekTable(dialog);
    if (!table) {
        logDebug('❌ Таблица не найдена');
        return false;
    }

    const thead = table.querySelector('thead');
    const tbody = table.querySelector('tbody');

    if (!thead || !tbody) {
        logDebug('❌ thead или tbody не найдены');
        return false;
    }

    if (!thead.querySelector('th.row-select-header')) {
        logDebug('➕ Добавляем заголовок колонки...');
        const headerRow = thead.querySelector('tr');
        if (headerRow) {
            const newHeader = document.createElement('th');
            newHeader.className = 'row-select-header';
            newHeader.innerHTML = '⚡';
            newHeader.title = 'Выделить все дни в строке';
            newHeader.style.cssText = `
                width: 50px !important;
                min-width: 50px !important;
                max-width: 50px !important;
                text-align: center !important;
                padding: 8px 2px !important;
                background: #34495e !important;
                color: white !important;
                font-weight: 600 !important;
                font-size: 14px !important;
                border-left: 1px solid #456789 !important;
            `;
            headerRow.appendChild(newHeader);
        }
    }

    const rows = tbody.querySelectorAll('tr');
    logDebug(`Найдено строк для добавления чекбоксов: ${rows.length}`);

    rows.forEach((row, index) => {
        if (!row.querySelector('.row-master-checkbox')) {
            addMasterCheckboxToRow(row, index);
        } else {
            setupRowHandlers(row, index);
        }
    });

    addColumnSelectCheckboxes();

    logDebug('✅ Колонка с мастер-чекбоксами проверена/добавлена');
    return true;
}

function addMasterCheckboxToRow(row, rowIndex) {
    logDebug(`Строка #${rowIndex + 1}: добавляем мастер-чекбокс...`);

    const masterCell = document.createElement('td');
    masterCell.style.cssText = `
        width: 50px !important;
        min-width: 50px !important;
        max-width: 50px !important;
        text-align: center !important;
        vertical-align: middle !important;
        padding: 4px 2px !important;
        border-bottom: 1px solid #eef2f6 !important;
    `;

    const container = document.createElement('div');
    container.style.cssText = `
        display: flex !important;
        justify-content: center !important;
        align-items: center !important;
        width: 100% !important;
        height: 100% !important;
        margin: 0 !important;
        padding: 0 !important;
    `;

    const masterCheckbox = document.createElement('input');
    masterCheckbox.type = 'checkbox';
    masterCheckbox.className = 'row-master-checkbox';
    masterCheckbox.title = 'Выделить все дни в этой строке';
    masterCheckbox.dataset.rowIndex = rowIndex;
    masterCheckbox.style.cssText = `
        transform: scale(1.2) !important;
        cursor: pointer !important;
        margin: 0 !important;
        position: relative !important;
    `;

    container.appendChild(masterCheckbox);
    masterCell.appendChild(container);
    row.appendChild(masterCell);

    logDebug(`Строка #${rowIndex + 1}: мастер-чекбокс добавлен, настраиваем обработчики...`);

    setupRowHandlers(row, rowIndex);
}

function setupRowHandlers(row, rowIndex) {
    const masterCheckbox = row.querySelector('.row-master-checkbox');
    if (!masterCheckbox) {
        logDebug(`❌ Строка #${rowIndex + 1}: мастер-чекбокс не найден`);
        return;
    }

    const dayCheckboxes = getRowDayCheckboxes(row);
    logDebug(`Строка #${rowIndex + 1}: найдено дневных чекбоксов: ${dayCheckboxes.length}`);

    if (dayCheckboxes.length === 0) {
        logDebug(`❌ Строка #${rowIndex + 1}: нет дневных чекбоксов`);
        return;
    }

    if (masterCheckbox._oldHandler) {
        masterCheckbox.removeEventListener('change', masterCheckbox._oldHandler);
    }

    dayCheckboxes.forEach(cb => {
        if (cb._oldHandler) {
            cb.removeEventListener('change', cb._oldHandler);
        }
    });

    const masterHandler = function(e) {
        if (masterCheckbox._processing) return;
        masterCheckbox._processing = true;

        try {
            const newState = e.target.checked;
            logDebug(`📌 Мастер-чекбокс в строке #${rowIndex + 1} изменен: ${newState ? '✅' : '❌'}`);

            dayCheckboxes.forEach((cb, colIndex) => {
                if (cb.checked !== newState || cb.indeterminate) {
                    forceSetCheckboxState(cb, newState);
                }
                logDebug(`  → День ${colIndex + 1}: ${newState ? '✅' : '❌'}`);
            });

            masterCheckbox.indeterminate = false;

            setTimeout(() => {
                updateRowMasterState(row);
                dayCheckboxes.forEach(cb => {
                    const dayKey = getCellDayKey(cb);
                    updateColumnMasterState(dayKey);
                });
            }, 120);
        } finally {
            setTimeout(() => {
                masterCheckbox._processing = false;
            }, 100);
        }
    };

    const dayHandler = function(e) {
        const dayCheckbox = e.target;
        const dayKey = getCellDayKey(dayCheckbox);

        if (dayCheckbox._processing) return;
        dayCheckbox._processing = true;

        try {
            updateRowMasterState(row);
            updateColumnMasterState(dayKey);
        } finally {
            setTimeout(() => {
                dayCheckbox._processing = false;
            }, 100);
        }
    };

    masterCheckbox.addEventListener('change', masterHandler);
    masterCheckbox._oldHandler = masterHandler;

    dayCheckboxes.forEach((cb, colIndex) => {
        cb.addEventListener('change', dayHandler);
        cb._oldHandler = dayHandler;
        cb.dataset.rowIndex = rowIndex;
        cb.dataset.colIndex = colIndex;
    });

    updateRowMasterState(row);

    logDebug(`✓ Строка #${rowIndex + 1}: обработчики настроены`);
}

window.setAllCheckboxes = function(checked) {
    const dialog = getScheduleDialog();
    if (!dialog) {
        console.log('❌ Диалог не найден');
        return;
    }

    logDebug(`🔄 Массовая установка всех чекбоксов в: ${checked ? '✅' : '❌'}`);

    const tableContainer = getTableContainer(dialog);
    if (!tableContainer) return;

    const rows = tableContainer.querySelectorAll('tbody tr');

    rows.forEach((row, rowIndex) => {
        const masterCheckbox = row.querySelector('.row-master-checkbox');
        const dayCheckboxes = getRowDayCheckboxes(row);

        if (masterCheckbox) {
            if (checked && (!masterCheckbox.checked || masterCheckbox.indeterminate)) {
                clickCheckbox(masterCheckbox);
            } else if (!checked && (masterCheckbox.checked || masterCheckbox.indeterminate)) {
                clickCheckbox(masterCheckbox);
            }
        }

        setTimeout(() => {
            dayCheckboxes.forEach(cb => {
                if (cb.checked !== checked) {
                    forceSetCheckboxState(cb, checked);
                }
            });

            updateRowMasterState(row);
            dayCheckboxes.forEach(cb => updateColumnMasterState(getCellDayKey(cb)));
        }, 100 * (rowIndex + 1));
    });

    setTimeout(() => {
        updateAllMasterStates();
    }, Math.max(250, rows.length * 110));

    logDebug(`✅ Массовая установка завершена`);
};

function handleToggleChange() {
    const dialog = getScheduleDialog();
    if (!dialog || !dialog.hasAttribute('data-schedule-resized')) {
        return;
    }

    const toggleWrapper = dialog.querySelector('._togglerWrapper_ka3ed_1');
    const isActive = toggleWrapper ? toggleWrapper.classList.contains('_active_ka3ed_53') : false;

    if (lastToggleState === isActive) {
        return;
    }
    lastToggleState = isActive;

    logDebug(`🔄 Обнаружено переключение тумблера! Новое состояние: ${isActive ? 'ВКЛ' : 'ВЫКЛ'}`);

    const savedState = saveCheckboxState();

    if (toggleUpdateTimeout) {
        clearTimeout(toggleUpdateTimeout);
    }

    const restoreAfterToggle = () => {
        logDebug('🔄 Восстанавливаем таблицу после переключения тумблера...');

        const responsiveHeight = getResponsiveHeight();
        dialog.style.height = responsiveHeight + 'px';
        dialog.style.minHeight = responsiveHeight + 'px';
        dialog.style.maxHeight = responsiveHeight + 'px';

        rebuildTableEnhancements(savedState, 'toggle');

        logDebug('✅ Восстановление после тумблера завершено');
    };

    toggleUpdateTimeout = setTimeout(restoreAfterToggle, 300);
    setTimeout(restoreAfterToggle, 600);
    setTimeout(restoreAfterToggle, 1000);
}

function refreshTable() {
    const dialog = getScheduleDialog();
    if (!dialog || !dialog.hasAttribute('data-schedule-resized')) {
        logDebug('❌ Диалог не готов для обновления');
        return;
    }

    logDebug('🔄 НАЧАЛО ОБНОВЛЕНИЯ ТАБЛИЦЫ ПОСЛЕ ПЕРЕКЛЮЧЕНИЯ ВКЛАДКИ');

    logTableDimensions(dialog, 'ДО ОБНОВЛЕНИЯ');
    logCheckboxPositions(dialog, 'ДО ОБНОВЛЕНИЯ');
    logCheckboxState(dialog, 'ДО ОБНОВЛЕНИЯ');

    const savedState = saveCheckboxState();

    const responsiveHeight = getResponsiveHeight();
    const newWidth = '1520px';

    dialog.style.height = responsiveHeight + 'px';
    dialog.style.minHeight = responsiveHeight + 'px';
    dialog.style.maxHeight = responsiveHeight + 'px';
    dialog.style.width = newWidth;
    dialog.style.minWidth = newWidth;
    dialog.style.maxWidth = newWidth;
    dialog.style.transform = 'none';

    const bodyContent = getBodyContent(dialog);
    if (bodyContent) {
        bodyContent.style.maxHeight = 'none';
        bodyContent.style.height = (responsiveHeight - 80) + 'px';
    }

    const mainContainer = getMainContainer(dialog);
    if (mainContainer) {
        mainContainer.style.height = 'auto';
        mainContainer.style.maxHeight = 'none';
    }

    const tableContainer = getTableContainer(dialog);
    if (tableContainer) {
        tableContainer.style.width = '100%';
        tableContainer.style.maxWidth = '100%';
    }

    const newTop = Math.max(0, (window.innerHeight - responsiveHeight) / 2);
    dialog.style.top = newTop + 'px';

    configureTableScrollArea();
    applyTableStyles();

    setTimeout(() => {
        rebuildTableEnhancements(savedState, 'refreshTable');

        logDebug('🔄 СОСТОЯНИЕ ПОСЛЕ ОБНОВЛЕНИЯ:');
        logTableDimensions(dialog, 'ПОСЛЕ ОБНОВЛЕНИЯ');
        logCheckboxPositions(dialog, 'ПОСЛЕ ОБНОВЛЕНИЯ');
        logCheckboxState(dialog, 'ПОСЛЕ ОБНОВЛЕНИЯ');

        logDebug('✅ ОБНОВЛЕНИЕ ТАБЛИЦЫ ЗАВЕРШЕНО');
    }, 100);
}

function autoEnlargeScheduleDialog() {
    const dialog = getScheduleDialog();

    if (!dialog) {
        logDebug('❌ Диалоговое окно графика работы не найдено');
        return false;
    }

    logDebug('✅ Диалоговое окно графика работы найдено, начинаем увеличение...');

    logTableDimensions(dialog, 'НАЧАЛЬНОЕ');
    logCheckboxPositions(dialog, 'НАЧАЛЬНОЕ');

    const mainContainer = getMainContainer(dialog);
    const tableContainer = getTableContainer(dialog);

    if (!mainContainer || !tableContainer) {
        logDebug('❌ Контейнеры не найдены');
        return false;
    }

    const rows = tableContainer.querySelectorAll('tbody tr');
    const rowCount = rows.length;

    logDebug(`Найдено строк в графике: ${rowCount}`);

    const currentWidth = dialog.style.minWidth || '1470px';
    const responsiveHeight = getResponsiveHeight();

    logDebug(`Текущая ширина: ${currentWidth}, Новая высота: ${responsiveHeight}px`);

    dialog.style.height = responsiveHeight + 'px';
    dialog.style.minHeight = responsiveHeight + 'px';
    dialog.style.maxHeight = responsiveHeight + 'px';

    const newWidth = '1520px';
    dialog.style.width = newWidth;
    dialog.style.minWidth = newWidth;
    dialog.style.maxWidth = newWidth;

    dialog.style.transform = 'none';

    const currentLeft = parseInt(dialog.style.left, 10) || 521;
    const newTop = Math.max(0, (window.innerHeight - responsiveHeight) / 2);
    dialog.style.left = currentLeft + 'px';
    dialog.style.top = newTop + 'px';

    const bodyContent = getBodyContent(dialog);
    if (bodyContent) {
        bodyContent.style.maxHeight = 'none';
        bodyContent.style.height = (responsiveHeight - 80) + 'px';
    }

    if (mainContainer) {
        mainContainer.style.height = 'auto';
        mainContainer.style.maxHeight = 'none';
    }

    configureTableScrollArea();
    applyTableStyles();

    setTimeout(() => {
        rebuildTableEnhancements(null, 'autoEnlarge');

        setTimeout(() => {
            logDebug('Проверка состояния после добавления:');
            logTableDimensions(dialog, 'ПОСЛЕ ДОБАВЛЕНИЯ');
            logCheckboxPositions(dialog, 'ПОСЛЕ ДОБАВЛЕНИЯ');
            logCheckboxState(dialog, 'ПОСЛЕ ДОБАВЛЕНИЯ');

            observeToggleButton();
            setupTableObserver();
        }, 500);
    }, 200);

    logDebug(`📊 Готово: высота=${responsiveHeight}px, ширина=${newWidth}`);

    return true;
}

function observeToggleButton() {
    const dialog = getScheduleDialog();
    if (!dialog) return;

    const toggleWrapper = dialog.querySelector('._togglerWrapper_ka3ed_1');

    if (toggleWrapper) {
        logDebug('🔍 Найден тумблер, начинаем наблюдение...');

        lastToggleState = toggleWrapper.classList.contains('_active_ka3ed_53');
        logDebug(`📌 Начальное состояние тумблера: ${lastToggleState ? 'ВКЛ' : 'ВЫКЛ'}`);

        if (toggleObserver) {
            toggleObserver.disconnect();
        }

        toggleObserver = new MutationObserver((mutations) => {
            mutations.forEach(mutation => {
                if (mutation.type === 'attributes' && mutation.attributeName === 'class') {
                    logDebug(`🔄 Обнаружено изменение класса тумблера`);
                    handleToggleChange();
                }
            });
        });

        toggleObserver.observe(toggleWrapper, {
            attributes: true,
            attributeFilter: ['class']
        });

        logDebug('👀 Наблюдатель за тумблером запущен');
    } else {
        logDebug('❌ Тумблер не найден, пробуем найти позже...');
        setTimeout(observeToggleButton, 1000);
    }
}

const tabObserver = new MutationObserver((mutations) => {
    const dialog = getScheduleDialog();
    if (!dialog || !dialog.hasAttribute('data-schedule-resized')) {
        return;
    }

    mutations.forEach(mutation => {
        if (mutation.type === 'attributes' && mutation.attributeName === 'class') {
            const tab = mutation.target;
            if (tab.classList.contains('_selectedTab_fpp4q_38')) {
                logDebug(`🔄 Обнаружено переключение вкладки на: "${tab.textContent.trim()}"`);

                if (refreshTimeout) clearTimeout(refreshTimeout);
                refreshTimeout = setTimeout(() => {
                    refreshTable();
                    refreshTimeout = null;
                }, 500);
            }
        }
    });
});

const scheduleObserver = new MutationObserver((mutations) => {
    const dialog = getScheduleDialog();

    if (dialog) {
        if (!dialog.hasAttribute('data-schedule-resized')) {
            logDebug('🔍 Обнаружено новое диалоговое окно графика работы');

            setTimeout(() => {
                const success = autoEnlargeScheduleDialog();
                if (success) {
                    dialog.setAttribute('data-schedule-resized', 'true');
                    dialog.setAttribute('data-schedule-row-count',
                        dialog.querySelectorAll('tbody tr').length);

                    logDebug('✓ Диалог отмечен как обработанный');

                    const tabs = dialog.querySelectorAll('._tab_fpp4q_26');
                    logDebug(`Найдено вкладок для наблюдения: ${tabs.length}`);
                    tabs.forEach((tab) => {
                        tabObserver.observe(tab, { attributes: true });
                    });
                }
            }, 400);
        } else {
            // Пропускаем обработку, если скрипт активен
            if (isApplyingChanges || isUpdating) {
                return;
            }
            
            const hasRelevantDomChange = mutations.some(mutation =>
                mutation.type === 'childList' &&
                (Array.from(mutation.addedNodes).some(node =>
                    node.nodeType === 1 &&
                    (node.id === 'select-schedule-dlg' ||
                     node.matches?.('table, tbody, tr, th, td, input') ||
                     node.querySelector?.('table, tbody, tr, th, td, input'))
                ) || Array.from(mutation.removedNodes).length > 0)
            );

            if (hasRelevantDomChange) {
                scheduleObserverRefresh(150, 'scheduleObserver');
            }
        }
    }
});

scheduleObserver.observe(document.body, {
    childList: true,
    subtree: true
});

setTimeout(() => {
    const dialog = getScheduleDialog();
    if (dialog && !dialog.hasAttribute('data-schedule-resized')) {
        logDebug('🔍 Диалог найден при загрузке');
        autoEnlargeScheduleDialog();
        dialog.setAttribute('data-schedule-resized', 'true');
        dialog.setAttribute('data-schedule-row-count',
            dialog.querySelectorAll('tbody tr').length);
        setupTableObserver();
    }
}, 1000);

// ОСНОВНОЕ ИСПРАВЛЕНИЕ: Улучшенный наблюдатель таблицы без рекурсии
function setupTableObserver() {
    const dialog = getScheduleDialog();
    if (!dialog || !dialog.hasAttribute('data-schedule-resized')) {
        return;
    }

    const tableContainer = getTableContainer(dialog);
    if (!tableContainer) return;

    if (tableObserver) {
        tableObserver.disconnect();
    }

    tableObserver = new MutationObserver((mutations) => {
        // КЛЮЧЕВОЕ ИСПРАВЛЕНИЕ: Пропускаем обработку, если скрипт сам вносит изменения
        if (isApplyingChanges || isUpdating) {
            logDebug('⏭️ Пропускаем изменения в таблице (скрипт активен)');
            return;
        }

        let needsRefresh = false;
        let needsCentering = false;
        let needsStickyUpdate = false;

        mutations.forEach(mutation => {
            if (mutation.type === 'attributes') {
                const target = mutation.target;
                if (mutation.attributeName === 'style' || mutation.attributeName === 'class') {
                    if (target === tableContainer || target.closest?.('thead') || target.closest?.('tbody') || target.closest?.('tr')) {
                        needsRefresh = true;
                    }
                    if (target.closest?.('thead')) {
                        needsStickyUpdate = true;
                    }
                }
            }

            if (mutation.type === 'childList') {
                needsRefresh = true;
                needsCentering = true;
                needsStickyUpdate = true;
            }
        });

        if (needsRefresh) {
            logDebug('🔄 Обнаружены изменения в таблице, запускаем отложенное восстановление...');
            if (refreshTimeout) clearTimeout(refreshTimeout);
            refreshTimeout = setTimeout(() => {
                // Дополнительная проверка перед перестройкой
                if (!isApplyingChanges && !isUpdating) {
                    const savedState = saveCheckboxState();
                    rebuildTableEnhancements(savedState, 'tableObserver');
                } else {
                    logDebug('⏭️ Пропускаем отложенную перестройку (скрипт активен)');
                }
                refreshTimeout = null;
            }, 200);
            return;
        }

        if (needsCentering) {
            logDebug('🎯 Обнаружены изменения структуры, центрируем чекбоксы...');
            setTimeout(() => {
                if (!isApplyingChanges && !isUpdating) {
                    forceCenterAllCheckboxes();
                    fixAllZonesRow();
                    updateAllMasterStates();
                }
            }, 100);
        }

        if (needsStickyUpdate) {
            setTimeout(() => {
                if (!isApplyingChanges && !isUpdating) {
                    configureTableScrollArea();
                    applyStickyHeader();
                }
            }, 50);
        }
    });

    tableObserver.observe(tableContainer, {
        attributes: true,
        attributeFilter: ['style', 'class'],
        childList: true,
        subtree: true
    });

    logDebug('👀 Наблюдатель за таблицей запущен (с защитой от рекурсии)');
}

const originalObserver = scheduleObserver.observe;
scheduleObserver.observe = function(target, config) {
    originalObserver.call(this, target, config);

    setTimeout(() => {
        const dialog = getScheduleDialog();
        if (dialog && dialog.hasAttribute('data-schedule-resized')) {
            setupTableObserver();
        }
    }, 1000);
};

window.checkScheduleState = function() {
    const dialog = getScheduleDialog();
    if (!dialog) {
        console.log('❌ Диалог не найден');
        return;
    }
    logDebug('Ручная проверка состояния:');
    logTableDimensions(dialog, 'РУЧНАЯ');
    logCheckboxPositions(dialog, 'РУЧНАЯ');
    logCheckboxState(dialog, 'РУЧНАЯ');
};

window.checkTableWidth = function() {
    const dialog = getScheduleDialog();
    if (!dialog) {
        console.log('❌ Диалог не найден');
        return;
    }
    logTableDimensions(dialog, 'РУЧНАЯ ПРОВЕРКА ШИРИНЫ');
};

window.checkCheckboxPositions = function() {
    const dialog = getScheduleDialog();
    if (!dialog) {
        console.log('❌ Диалог не найден');
        return;
    }
    logCheckboxPositions(dialog, 'РУЧНАЯ ПРОВЕРКА ПОЛОЖЕНИЯ');
};

window.forceCenterCheckboxes = function() {
    forceCenterAllCheckboxes();
    fixAllZonesRow();
    updateAllMasterStates();
    console.log('✅ Принудительное центрирование выполнено');
};

window.handleToggleManually = function() {
    handleToggleChange();
    console.log('🔄 Ручной запуск обработки тумблера выполнен');
};

window.fixAllZonesManually = function() {
    fixAllZonesRow();
    console.log('🔧 Строка "Все зоны" исправлена');
};

window.setupTableObserverManually = function() {
    setupTableObserver();
    console.log('👀 Наблюдатель таблицы запущен вручную');
};

window.debugToggle = function() {
    const dialog = getScheduleDialog();
    if (!dialog) {
        console.log('❌ Диалог не найден');
        return;
    }

    const toggleWrapper = dialog.querySelector('._togglerWrapper_ka3ed_1');
    const toggleBackground = dialog.querySelector('._background_ka3ed_18');
    const toggleBall = dialog.querySelector('._ball_ka3ed_39');
    const toggleText = dialog.querySelector('._text_ka3ed_5');

    console.log('🔍 ДИАГНОСТИКА ТУМБЛЕРА:');
    console.log('  Обертка (wrapper):', toggleWrapper);
    if (toggleWrapper) {
        console.log('  → Классы:', toggleWrapper.className);
        console.log('  → Активен:', toggleWrapper.classList.contains('_active_ka3ed_53'));
    }
    console.log('  Фон (background):', toggleBackground);
    console.log('  Шарик (ball):', toggleBall);
    console.log('  Текст:', toggleText);
    if (toggleText) {
        console.log('  → Классы текста:', toggleText.className);
        console.log('  → Выбран:', toggleText.classList.contains('_selected_ka3ed_11'));
    }
};

window.forceToggleRestore = function() {
    handleToggleChange();
    console.log('🔄 Принудительное восстановление после тумблера выполнено');
};

window.refreshScheduleEnhancements = function() {
    const savedState = saveCheckboxState();
    rebuildTableEnhancements(savedState, 'manual');
    console.log('🔄 Принудительное обновление улучшений таблицы выполнено');
};

console.log('✅ Установлены команды: setAllCheckboxes(true/false) для массовой установки');
})();