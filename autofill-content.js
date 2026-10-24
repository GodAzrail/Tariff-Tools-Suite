
(function() {
'use strict';

console.log('🚀 Auto Filler загружен');

let currentTableData = null;

// Целевые столбцы
const TARGET_COLUMNS = [
    'Цена внутренняя, ₽ *',
    'Цена покупателя, ₽ *', 
    'Цена возврата (не обязательно), ₽'
];

// Функция для поиска заголовка "Заполните цены"
function findPricesHeader() {
    const headers = document.querySelectorAll('span, h1, h2, h3, h4, div');
    for (const el of headers) {
        if (el.textContent.trim() === 'Заполните цены') {
            return el;
        }
    }
    return null;
}

// Функция для поиска полей с ценами
function findPriceFields() {
    console.log('🔍 Ищем поля с ценами...');
    
    const result = {
        rows: [],
        totalFields: 0
    };
    
    const tables = document.querySelectorAll('table');
    
    tables.forEach((table, tableIndex) => {
        const headers = Array.from(table.querySelectorAll('th')).map(h => h.textContent.trim());
        const columnIndices = {};
        
        TARGET_COLUMNS.forEach((colName, i) => {
            const index = headers.findIndex(h => h.includes(colName));
            if (index !== -1) columnIndices[i] = index;
        });
        
        if (Object.keys(columnIndices).length === 0) return;
        
        let dataRowCounter = 0;
        
        table.querySelectorAll('tr').forEach((row, ri) => {
            if (row.querySelector('th')) return;
            
            const cells = row.querySelectorAll('td');
            if (cells.length < 5) return;
            
            const first = cells[0]?.textContent.trim();
            if (!first || first === 'on' || first.includes(':') || isNaN(parseFloat(first))) return;
            
            const context = cells[0]?.textContent || '';
            
            const rowData = { 
                context, 
                cols: {},
                dataIndex: dataRowCounter,
                rowElement: row,
                cells: cells
            };
            
            [0,1,2].forEach(i => {
                if (columnIndices[i] !== undefined && cells[columnIndices[i]]) {
                    const input = cells[columnIndices[i]].querySelector('input');
                    if (input) {
                        rowData.cols[i] = {
                            value: input.value,
                            element: input,
                            row: ri, 
                            col: columnIndices[i], 
                            table: tableIndex,
                            dataIndex: dataRowCounter
                        };
                        result.totalFields++;
                    }
                }
            });
            
            if (Object.keys(rowData.cols).length) {
                result.rows.push(rowData);
                dataRowCounter++;
            }
        });
    });
    
    console.log(`Найдено строк: ${result.rows.length}, полей: ${result.totalFields}`);
    return result;
}

// Функция для встраивания панели управления в окно тарифов
function injectPanelIntoPricesWindow() {
    if (window.__tariffCleanDOMMode) return false;
    const pricesWindow = findPricesWindow();
    if (!pricesWindow) {
        console.log('Окно тарифов не найдено');
        return false;
    }
    
    if (document.getElementById('af-tariff-panel')) {
        return true;
    }
    
    const header = findPricesHeader();
    if (!header) {
        console.log('Заголовок "Заполните цены" не найден');
        return false;
    }
    
    const panel = createTariffPanel();
    header.insertAdjacentElement('afterend', panel);
    
    console.log('✅ Панель управления тарифами встроена');
    return true;
}

// Функция для поиска окна тарифов
function findPricesWindow() {
    const possibleContainers = [
        document.querySelector('.modal-content'),
        document.querySelector('.ant-modal-content'),
        document.querySelector('[class*="modal"]'),
        document.querySelector('[class*="Modal"]'),
        document.querySelector('[class*="dialog"]'),
        document.querySelector('[class*="Dialog"]')
    ];
    
    for (const container of possibleContainers) {
        if (container && container.querySelector('table')) {
            return container;
        }
    }
    
    const header = findPricesHeader();
    if (header) {
        let parent = header.parentElement;
        while (parent && parent !== document.body) {
            if (parent.querySelector('table')) {
                return parent;
            }
            parent = parent.parentElement;
        }
        return header.parentElement;
    }
    
    return null;
}

// Создание компактной панели управления
function createTariffPanel() {
    const tableData = findPriceFields();
    currentTableData = tableData;
    
    const panel = document.createElement('div');
    panel.id = 'af-tariff-panel';
    panel.style.cssText = `
        margin: 20px 24px;
        background: #2c3e50;
        border-radius: 12px;
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
        overflow: hidden;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
        animation: slideDown 0.3s ease-out;
        border: 1px solid #405b73;
        max-width: 100%;
        box-sizing: border-box;
    `;
    
    panel.innerHTML = createPanelHTML(tableData);
    
    // Добавляем анимацию и адаптивные стили
    const style = document.createElement('style');
    style.textContent = `
        @keyframes slideDown {
            from {
                opacity: 0;
                transform: translateY(-20px);
            }
            to {
                opacity: 1;
                transform: translateY(0);
            }
        }
        
        @keyframes pulse {
            0% {
                transform: scale(1);
            }
            50% {
                transform: scale(1.02);
            }
            100% {
                transform: scale(1);
            }
        }
        
        .af-input-focus {
            border-color: #3498db !important;
            box-shadow: 0 0 0 3px rgba(52, 152, 219, 0.1) !important;
        }
        
        /* Адаптивные стили */
        @media (max-width: 768px) {
            #af-tariff-panel {
                margin: 16px !important;
            }
            
            .af-grid-container {
                grid-template-columns: 1fr !important;
                gap: 12px !important;
            }
            
            .af-textarea {
                min-height: 80px !important;
            }
            
            .af-header-row {
                flex-direction: column !important;
                align-items: flex-start !important;
            }
            
            .af-action-buttons {
                flex-direction: column !important;
            }
        }
        
        /* Стили для скролла */
        #af-tariff-panel textarea::-webkit-scrollbar {
            width: 8px;
        }
        
        #af-tariff-panel textarea::-webkit-scrollbar-track {
            background: #2c3e50;
            border-radius: 4px;
        }
        
        #af-tariff-panel textarea::-webkit-scrollbar-thumb {
            background: #5a7a96;
            border-radius: 4px;
        }
        
        #af-tariff-panel textarea::-webkit-scrollbar-thumb:hover {
            background: #3498db;
        }
        
        /* Анимация для статуса */
        @keyframes fadeInOut {
            0% {
                opacity: 0;
                transform: translateX(20px);
            }
            10% {
                opacity: 1;
                transform: translateX(0);
            }
            90% {
                opacity: 1;
                transform: translateX(0);
            }
            100% {
                opacity: 0;
                transform: translateX(20px);
            }
        }
        
        .af-status-message {
            animation: fadeInOut 3s ease forwards;
        }
    `;
    document.head.appendChild(style);
    
    setTimeout(() => attachPanelHandlers(panel), 0);
    
    return panel;
}

function createPanelHTML(tableData) {
    const rowsCount = tableData?.rows?.length || 0;
    const totalFields = tableData?.totalFields || 0;
    
    return `
        <div style="padding: 20px 24px;">
            <!-- Верхняя строка с заголовком, статусом и кнопкой обновления -->
            <div class="af-header-row" style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px; flex-wrap: wrap; gap: 12px;">
                <div style="display: flex; align-items: center; gap: 16px; flex-wrap: wrap;">
                    <div>
                        <h3 style="margin: 0; font-size: 16px; font-weight: 600; color: #ecf0f1; letter-spacing: -0.2px;">
                            📊 Управление тарифами
                        </h3>
                        <div style="font-size: 12px; color: #95a5a6; margin-top: 4px;">
                            Найдено ${rowsCount} строк | ${totalFields} полей
                        </div>
                    </div>
                    
                    <!-- Статус бар справа от заголовка -->
                    <div id="af-status" style="
                        background: #34495e;
                        border-radius: 8px;
                        padding: 8px 16px;
                        font-size: 12px;
                        color: #bdc3c7;
                        border-left: 3px solid #3498db;
                        display: none;
                        align-items: center;
                        gap: 8px;
                        white-space: nowrap;
                    ">
                        <span id="af-status-icon">ℹ️</span>
                        <span id="af-status-text">Готов к работе</span>
                    </div>
                </div>
                
                <button id="af-refresh-data" style="
                    background: #405b73;
                    color: #ecf0f1;
                    border: 1px solid #5a7a96;
                    border-radius: 6px;
                    padding: 6px 14px;
                    font-size: 12px;
                    cursor: pointer;
                    transition: all 0.2s;
                    font-weight: 500;
                    white-space: nowrap;
                ">🔄 Обновить</button>
            </div>
            
            <div class="af-grid-container" style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; margin-bottom: 20px;">
                <div style="background: #34495e; border-radius: 10px; padding: 12px; border: 1px solid #405b73; overflow: hidden;">
                    <label style="display: block; font-size: 11px; font-weight: 600; color: #bdc3c7; margin-bottom: 6px; text-transform: uppercase; letter-spacing: 0.5px;">
                        💎 Цена внутренняя, ₽ *
                    </label>
                    <textarea id="af-bulk0" class="af-textarea" style="
                        width: 100%;
                        padding: 8px;
                        background: #2c3e50;
                        border: 1px solid #5a7a96;
                        color: #ecf0f1;
                        border-radius: 6px;
                        font-family: 'SF Mono', 'Monaco', monospace;
                        font-size: 11px;
                        min-height: 100px;
                        resize: vertical;
                        transition: all 0.2s;
                        box-sizing: border-box;
                    " placeholder="Введите значения через Enter&#10;1420&#10;2770&#10;3370"></textarea>
                </div>
                
                <div style="background: #34495e; border-radius: 10px; padding: 12px; border: 1px solid #405b73; overflow: hidden;">
                    <label style="display: block; font-size: 11px; font-weight: 600; color: #bdc3c7; margin-bottom: 6px; text-transform: uppercase; letter-spacing: 0.5px;">
                        💰 Цена покупателя, ₽ *
                    </label>
                    <textarea id="af-bulk1" class="af-textarea" style="
                        width: 100%;
                        padding: 8px;
                        background: #2c3e50;
                        border: 1px solid #5a7a96;
                        color: #ecf0f1;
                        border-radius: 6px;
                        font-family: 'SF Mono', 'Monaco', monospace;
                        font-size: 11px;
                        min-height: 100px;
                        resize: vertical;
                        transition: all 0.2s;
                        box-sizing: border-box;
                    " placeholder="Введите значения через Enter&#10;1620&#10;2620&#10;3220"></textarea>
                </div>
                
                <div style="background: #34495e; border-radius: 10px; padding: 12px; border: 1px solid #405b73; overflow: hidden;">
                    <label style="display: block; font-size: 11px; font-weight: 600; color: #bdc3c7; margin-bottom: 6px; text-transform: uppercase; letter-spacing: 0.5px;">
                        🔄 Цена возврата (не обязательно), ₽
                    </label>
                    <textarea id="af-bulk2" class="af-textarea" style="
                        width: 100%;
                        padding: 8px;
                        background: #2c3e50;
                        border: 1px solid #5a7a96;
                        color: #ecf0f1;
                        border-radius: 6px;
                        font-family: 'SF Mono', 'Monaco', monospace;
                        font-size: 11px;
                        min-height: 100px;
                        resize: vertical;
                        transition: all 0.2s;
                        box-sizing: border-box;
                    " placeholder="Введите значения через Enter&#10;1420&#10;2770&#10;3370"></textarea>
                </div>
            </div>
            
            <div class="af-action-buttons" style="display: flex; gap: 12px; flex-wrap: wrap;">
                <button id="af-transfer-all" style="
                    flex: 2;
                    min-width: 200px;
                    background: #2980b9;
                    color: white;
                    border: none;
                    border-radius: 10px;
                    padding: 14px 20px;
                    font-size: 14px;
                    font-weight: 700;
                    cursor: pointer;
                    transition: all 0.3s;
                    box-shadow: 0 2px 8px rgba(0,0,0,0.1);
                    text-transform: uppercase;
                    letter-spacing: 0.5px;
                    white-space: nowrap;
                ">🚀 ПЕРЕНЕСТИ ТАРИФЫ</button>
                
                <button id="af-copy-excel" style="
                    flex: 1;
                    min-width: 120px;
                    background: #405b73;
                    color: #ecf0f1;
                    border: 1px solid #5a7a96;
                    border-radius: 8px;
                    padding: 14px 20px;
                    font-size: 13px;
                    font-weight: 600;
                    cursor: pointer;
                    transition: all 0.2s;
                    white-space: nowrap;
                ">📋 Копировать в Excel</button>
            </div>
        </div>
    `;
}

function attachPanelHandlers(panel) {
    // Обновление данных
    const refreshBtn = document.getElementById('af-refresh-data');
    if (refreshBtn) {
        refreshBtn.addEventListener('click', () => {
            currentTableData = findPriceFields();
            showStatus('Данные обновлены', 'success');
        });
        
        refreshBtn.addEventListener('mouseenter', () => {
            refreshBtn.style.background = '#5a7a96';
        });
        refreshBtn.addEventListener('mouseleave', () => {
            refreshBtn.style.background = '#405b73';
        });
    }
    
    // Главная кнопка - Перенести тарифы
    const transferBtn = document.getElementById('af-transfer-all');
    if (transferBtn) {
        transferBtn.addEventListener('click', async () => {
            // Применяем все значения из текстовых полей
            applyAllColumnsValues();
            
            showStatus('⏳ Перенос тарифов...', 'info');
            
            // Сохраняем на сайт
            await saveToSite();
        });
        
        transferBtn.addEventListener('mouseenter', () => {
            transferBtn.style.background = '#3498db';
            transferBtn.style.transform = 'translateY(-2px)';
            transferBtn.style.boxShadow = '0 4px 12px rgba(41, 128, 185, 0.3)';
        });
        transferBtn.addEventListener('mouseleave', () => {
            transferBtn.style.background = '#2980b9';
            transferBtn.style.transform = 'translateY(0)';
            transferBtn.style.boxShadow = '0 2px 8px rgba(0,0,0,0.1)';
        });
    }
    
    // Копировать в Excel
    const copyBtn = document.getElementById('af-copy-excel');
    if (copyBtn) {
        copyBtn.addEventListener('click', copyTariffsToExcel);
        
        copyBtn.addEventListener('mouseenter', () => {
            copyBtn.style.background = '#5a7a96';
            copyBtn.style.transform = 'translateY(-1px)';
        });
        copyBtn.addEventListener('mouseleave', () => {
            copyBtn.style.background = '#405b73';
            copyBtn.style.transform = 'translateY(0)';
        });
    }
    
    // Эффекты для текстовых полей
    document.querySelectorAll('#af-tariff-panel textarea').forEach(textarea => {
        textarea.addEventListener('focus', () => {
            textarea.classList.add('af-input-focus');
        });
        textarea.addEventListener('blur', () => {
            textarea.classList.remove('af-input-focus');
        });
    });
}

function applyAllColumnsValues() {
    // Применяем значения для всех трех столбцов
    for (let colIndex = 0; colIndex <= 2; colIndex++) {
        const textarea = document.getElementById(`af-bulk${colIndex}`);
        if (!textarea) continue;
        
        const values = textarea.value
            .split('\n')
            .map(v => v.trim())
            .filter(v => v !== '');
        
        if (values.length === 0) {
            console.log(`Столбец ${colIndex + 1}: нет значений`);
            continue;
        }
        
        // Обновляем данные в currentTableData
        if (currentTableData && currentTableData.rows) {
            currentTableData.rows.forEach((row, index) => {
                if (row.cols[colIndex]) {
                    let value = index < values.length ? values[index] : values[values.length - 1];
                    const num = parseFloat(value);
                    if (!isNaN(num)) {
                        row.cols[colIndex].value = num;
                    } else {
                        row.cols[colIndex].value = value;
                    }
                }
            });
        }
        
        const filledCount = Math.min(values.length, currentTableData?.rows?.length || 0);
        const labels = ['внутренние', 'покупателя', 'возврата'];
        console.log(`✅ ${labels[colIndex]} цены: заполнено ${filledCount} строк`);
    }
    
    showStatus('✅ Все тарифы подготовлены к переносу', 'success');
}

async function saveToSite() {
    if (!currentTableData || !currentTableData.rows) {
        showStatus('❌ Нет данных для сохранения', 'error');
        return;
    }
    
    const transferBtn = document.getElementById('af-transfer-all');
    const originalText = transferBtn.textContent;
    transferBtn.textContent = '⏳ ПЕРЕНЕСЕНИЕ...';
    transferBtn.disabled = true;
    
    let savedCount = 0;
    let errorCount = 0;
    
    for (const row of currentTableData.rows) {
        for (let colIndex = 0; colIndex <= 2; colIndex++) {
            const field = row.cols[colIndex];
            if (field && field.element) {
                const newValue = field.value;
                try {
                    field.element.value = newValue;
                    field.element.dispatchEvent(new Event('input', { bubbles: true }));
                    field.element.dispatchEvent(new Event('change', { bubbles: true }));
                    
                    const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
                        window.HTMLInputElement.prototype, 'value'
                    )?.set;
                    
                    if (nativeInputValueSetter) {
                        nativeInputValueSetter.call(field.element, newValue);
                        field.element.dispatchEvent(new Event('input', { bubbles: true }));
                    }
                    
                    savedCount++;
                    
                    field.element.style.transition = 'background-color 0.3s';
                    field.element.style.backgroundColor = '#27ae60';
                    setTimeout(() => {
                        field.element.style.backgroundColor = '';
                    }, 1000);
                    
                } catch (err) {
                    errorCount++;
                    console.error('Ошибка сохранения:', err);
                }
            }
        }
    }
    
    transferBtn.textContent = originalText;
    transferBtn.disabled = false;
    
    if (savedCount > 0) {
        const message = errorCount > 0 
            ? ` Перенесено ${savedCount} тарифов (⚠️ ${errorCount} ошибок)`
            : ` Успешно перенесено ${savedCount} тарифов!`;
        showStatus(message, 'success');
        
        transferBtn.style.animation = 'pulse 0.5s ease';
        setTimeout(() => {
            transferBtn.style.animation = '';
        }, 500);
    } else {
        showStatus(' Нет тарифов для переноса', 'warning');
    }
}

function copyTariffsToExcel() {
    if (!currentTableData || !currentTableData.rows) {
        showStatus('❌ Нет данных для копирования', 'error');
        return;
    }
    
    const rows = [];
    rows.push(['Вес', 'Цена внутренняя', 'Цена покупателя', 'Цена возврата']);
    
    currentTableData.rows.forEach(row => {
        rows.push([
            row.context,
            row.cols[0]?.value || '',
            row.cols[1]?.value || '',
            row.cols[2]?.value || ''
        ]);
    });
    
    const textToCopy = rows.map(row => row.join('\t')).join('\n');
    
    navigator.clipboard.writeText(textToCopy).then(() => {
        showStatus(' Тарифы скопированы в буфер обмена', 'success');
        
        const copyBtn = document.getElementById('af-copy-excel');
        const originalText = copyBtn.textContent;
        copyBtn.textContent = '✅ Скопировано!';
        setTimeout(() => {
            copyBtn.textContent = originalText;
        }, 2000);
    }).catch(() => {
        showStatus('❌ Ошибка копирования', 'error');
    });
}

function showStatus(message, type = 'info') {
    const statusEl = document.getElementById('af-status');
    const statusIcon = document.getElementById('af-status-icon');
    const statusText = document.getElementById('af-status-text');
    
    if (!statusEl || !statusText) return;
    
    // Иконки для разных типов сообщений
    const icons = {
        success: '✅',
        error: '❌',
        warning: '⚠️',
        info: 'ℹ️'
    };
    
    const colors = {
        success: '#27ae60',
        error: '#e74c3c',
        warning: '#f39c12',
        info: '#3498db'
    };
    
    if (statusIcon) {
        statusIcon.textContent = icons[type] || icons.info;
    }
    
    statusText.textContent = message;
    statusEl.style.display = 'flex';
    statusEl.style.borderLeftColor = colors[type] || colors.info;
    
    // Добавляем класс для анимации
    statusEl.classList.add('af-status-message');
    
    setTimeout(() => {
        statusEl.style.display = 'none';
        statusEl.classList.remove('af-status-message');
    }, 3000);
}

// ==================== ПАНЕЛЬ ЗАПОЛНЕНИЯ ПОДЪЕМА НА ЭТАЖ ====================

function findLiftingTable() {
    return document.querySelector('table[test-id="lifting-table"]');
}

function injectLiftingPanel() {
    if (window.__tariffCleanDOMMode) return false;
    const table = findLiftingTable();
    if (!table) return false;
    if (document.getElementById('af-lifting-panel')) return true;

    const dialog = table.closest('dialog, [role="dialog"]') || table.parentElement;
    if (!dialog) return false;

    const panel = document.createElement('div');
    panel.id = 'af-lifting-panel';
    panel.setAttribute('data-tts-inspector-ignore', 'true');
    panel.style.cssText = `
        margin: 10px 0 16px;
        background: linear-gradient(135deg, #1e293b 0%, #0f172a 100%);
        border: 1px solid rgba(59, 130, 246, 0.35);
        border-radius: 12px;
        padding: 14px 18px;
        color: #e2e8f0;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
        box-shadow: 0 8px 24px rgba(0, 0, 0, 0.28);
        box-sizing: border-box;
    `;

    panel.innerHTML = `
        <style>
            #af-lifting-panel input:focus {
                outline: none !important;
                border-color: #3b82f6 !important;
                box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.3) !important;
                background: #1e293b !important;
            }
            #af-lift-apply-btn:hover {
                background: linear-gradient(135deg, #1d4ed8, #1e40af) !important;
                transform: translateY(-1px);
                box-shadow: 0 4px 12px rgba(37,99,235,0.45) !important;
            }
            #af-lift-apply-btn:active {
                transform: translateY(0);
            }
            #af-lift-sync-btn:hover {
                background: #2563eb !important;
                color: #ffffff !important;
                border-color: #60a5fa !important;
            }
            #af-lift-clear-btn:hover {
                background: rgba(239, 68, 68, 0.15) !important;
                color: #f87171 !important;
                border-color: #ef4444 !important;
            }
        </style>
        
        <!-- Верхняя плашка с заголовком и статусом -->
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px; padding-bottom:8px; border-bottom:1px solid rgba(148, 163, 184, 0.15);">
            <div style="display:flex; align-items:center; gap:8px;">
                <span style="font-size:16px;">🚀</span>
                <span style="font-weight:700; font-size:13px; color:#ffffff; letter-spacing:-0.2px;">
                    Быстрое заполнение подъема на этаж
                </span>
                <span style="font-size:11px; color:#94a3b8; margin-left:4px;">
                    (автозаполнение лифта и всех строк таблицы)
                </span>
            </div>
            <div id="af-lift-status" style="display:none; padding:3px 10px; border-radius:6px; font-size:11px; font-weight:600; background:rgba(34,197,94,0.15); border:1px solid rgba(34,197,94,0.3); color:#4ade80;"></div>
        </div>

        <!-- Две визуальные карточки: Лифт и Лестница -->
        <div style="display:grid; grid-template-columns: minmax(240px, 1fr) minmax(460px, 1.8fr); gap:12px; margin-bottom:12px;">
            
            <!-- Карточка 1: Лифт -->
            <div style="background:rgba(255,255,255,0.03); border:1px solid rgba(148, 163, 184, 0.12); border-radius:8px; padding:10px 12px; display:flex; flex-direction:column; justify-content:space-between;">
                <div style="font-size:11px; font-weight:700; color:#38bdf8; text-transform:uppercase; letter-spacing:0.5px; margin-bottom:8px; display:flex; align-items:center; gap:5px;">
                    <span>🛗</span> Стоимость на лифте
                </div>
                <div style="display:grid; grid-template-columns: 1fr 1fr; gap:8px;">
                    <div>
                        <label style="display:block; font-size:10px; font-weight:600; color:#cbd5e1; margin-bottom:4px;">🏢 Внутренняя, ₽</label>
                        <input id="af-lift-in" type="number" placeholder="0" style="width:100%; height:32px; padding:0 8px; border-radius:6px; border:1px solid #334155; background:#0f172a; color:#fff; font-size:13px; font-weight:600; box-sizing:border-box;">
                    </div>
                    <div>
                        <label style="display:block; font-size:10px; font-weight:600; color:#cbd5e1; margin-bottom:4px;">👤 Для клиента, ₽</label>
                        <input id="af-lift-cust" type="number" placeholder="0" style="width:100%; height:32px; padding:0 8px; border-radius:6px; border:1px solid #334155; background:#0f172a; color:#fff; font-size:13px; font-weight:600; box-sizing:border-box;">
                    </div>
                </div>
            </div>

            <!-- Карточка 2: Лестница -->
            <div style="background:rgba(255,255,255,0.03); border:1px solid rgba(148, 163, 184, 0.12); border-radius:8px; padding:10px 12px;">
                <div style="font-size:11px; font-weight:700; color:#60a5fa; text-transform:uppercase; letter-spacing:0.5px; margin-bottom:8px; display:flex; align-items:center; gap:5px;">
                    <span>🪜</span> Стоимость по лестнице (за 1 этаж)
                </div>
                <div style="display:grid; grid-template-columns: repeat(4, 1fr); gap:8px;">
                    <div>
                        <label style="display:block; font-size:10px; font-weight:600; color:#cbd5e1; margin-bottom:4px;">🏢 За 1 этаж, ₽</label>
                        <input id="af-floor-in" type="number" placeholder="0" style="width:100%; height:32px; padding:0 8px; border-radius:6px; border:1px solid #334155; background:#0f172a; color:#fff; font-size:13px; font-weight:600; box-sizing:border-box;">
                    </div>
                    <div>
                        <label style="display:block; font-size:10px; font-weight:600; color:#94a3b8; margin-bottom:4px;">С этажа (внутр.)</label>
                        <input id="af-thresh-in" type="number" value="1" placeholder="1" style="width:100%; height:32px; padding:0 8px; border-radius:6px; border:1px solid #334155; background:#0f172a; color:#fff; font-size:13px; font-weight:600; box-sizing:border-box;">
                    </div>
                    <div>
                        <label style="display:block; font-size:10px; font-weight:600; color:#cbd5e1; margin-bottom:4px;">👤 Клиент 1 этаж, ₽</label>
                        <input id="af-floor-cust" type="number" placeholder="0" style="width:100%; height:32px; padding:0 8px; border-radius:6px; border:1px solid #334155; background:#0f172a; color:#fff; font-size:13px; font-weight:600; box-sizing:border-box;">
                    </div>
                    <div>
                        <label style="display:block; font-size:10px; font-weight:600; color:#94a3b8; margin-bottom:4px;">С этажа (клиент)</label>
                        <input id="af-thresh-cust" type="number" value="1" placeholder="1" style="width:100%; height:32px; padding:0 8px; border-radius:6px; border:1px solid #334155; background:#0f172a; color:#fff; font-size:13px; font-weight:600; box-sizing:border-box;">
                    </div>
                </div>
            </div>
        </div>

        <!-- Нижний блок кнопок управления -->
        <div style="display:flex; justify-content:space-between; align-items:center; gap:8px; flex-wrap:wrap;">
            <div style="display:flex; gap:8px; align-items:center;">
                <button id="af-lift-apply-btn" type="button" style="background:linear-gradient(135deg, #2563eb, #1d4ed8); color:#ffffff; border:none; padding:8px 16px; border-radius:6px; font-weight:600; font-size:12px; cursor:pointer; display:inline-flex; align-items:center; gap:6px; box-shadow:0 2px 6px rgba(37,99,235,0.35); transition:all 0.15s ease;">
                    <span>⚡</span> Применить ко всем строкам таблицы
                </button>
                <button id="af-lift-sync-btn" type="button" style="background:#1e293b; color:#93c5fd; border:1px solid #3b82f6; padding:8px 12px; border-radius:6px; font-weight:600; font-size:12px; cursor:pointer; display:inline-flex; align-items:center; gap:5px; transition:all 0.15s ease;" title="Скопировать введенные внутренние тарифы в поля клиента">
                    <span>👥</span> Внутр. → Клиент
                </button>
            </div>
            <div>
                <button id="af-lift-clear-btn" type="button" style="background:transparent; color:#94a3b8; border:1px solid #475569; padding:8px 12px; border-radius:6px; font-weight:600; font-size:12px; cursor:pointer; transition:all 0.15s ease;">
                    Очистить
                </button>
            </div>
        </div>
    `;

    table.parentElement.insertBefore(panel, table);

    const applyBtn = panel.querySelector('#af-lift-apply-btn');
    const syncBtn = panel.querySelector('#af-lift-sync-btn');
    const clearBtn = panel.querySelector('#af-lift-clear-btn');
    const statusMsg = panel.querySelector('#af-lift-status');

    const showLiftStatus = (txt) => {
        statusMsg.textContent = txt;
        statusMsg.style.display = 'block';
        setTimeout(() => { statusMsg.style.display = 'none'; }, 2800);
    };

    // Быстрое копирование тарифов: Внутр. -> Клиент
    syncBtn?.addEventListener('click', (e) => {
        e.preventDefault();
        const liftIn = panel.querySelector('#af-lift-in')?.value;
        const floorIn = panel.querySelector('#af-floor-in')?.value;
        const threshIn = panel.querySelector('#af-thresh-in')?.value;

        if (liftIn !== undefined && liftIn !== '') {
            panel.querySelector('#af-lift-cust').value = liftIn;
        }
        if (floorIn !== undefined && floorIn !== '') {
            panel.querySelector('#af-floor-cust').value = floorIn;
        }
        if (threshIn !== undefined && threshIn !== '') {
            panel.querySelector('#af-thresh-cust').value = threshIn;
        }
        showLiftStatus('📋 Скопировано: Внутр. → Клиент');
    });

    applyBtn?.addEventListener('click', (e) => {
        e.preventDefault();
        const liftInVal = panel.querySelector('#af-lift-in')?.value;
        const liftCustVal = panel.querySelector('#af-lift-cust')?.value;
        const floorInVal = panel.querySelector('#af-floor-in')?.value;
        const threshInVal = panel.querySelector('#af-thresh-in')?.value || '1';
        const floorCustVal = panel.querySelector('#af-floor-cust')?.value;
        const threshCustVal = panel.querySelector('#af-thresh-cust')?.value || '1';

        // 1. Верхние поля лифта
        const liftInInput = dialog.querySelector('input[placeholder="Внутренняя"]');
        if (liftInInput && liftInVal !== '') {
            liftInInput.value = liftInVal;
            liftInInput.dispatchEvent(new Event('input', { bubbles: true }));
            liftInInput.dispatchEvent(new Event('change', { bubbles: true }));
        }

        const liftCustInput = dialog.querySelector('input[placeholder="Для клиента"]');
        if (liftCustInput && liftCustVal !== '') {
            liftCustInput.value = liftCustVal;
            liftCustInput.dispatchEvent(new Event('input', { bubbles: true }));
            liftCustInput.dispatchEvent(new Event('change', { bubbles: true }));
        }

        // 2. Строки таблицы подъема
        const rows = table.querySelectorAll('tbody tr');
        let count = 0;
        rows.forEach(row => {
            const setInput = (selector, val) => {
                if (val === undefined || val === '') return;
                const inp = row.querySelector(selector);
                if (inp) {
                    inp.value = val;
                    inp.dispatchEvent(new Event('input', { bubbles: true }));
                    inp.dispatchEvent(new Event('change', { bubbles: true }));
                }
            };

            setInput('td[test-id="handlingInternalPrice"] input', floorInVal);
            setInput('td[test-id="handlingInternalThreshold"] input', threshInVal);
            setInput('td[test-id="handlingPrice"] input', floorCustVal);
            setInput('td[test-id="handlingThreshold"] input', threshCustVal);
            count++;
        });

        showLiftStatus(`✅ Заполнено: ${count} строк таблицы + лифт`);
    });

    clearBtn?.addEventListener('click', (e) => {
        e.preventDefault();
        panel.querySelectorAll('input').forEach(inp => { 
            if (inp.id.includes('thresh')) {
                inp.value = '1';
            } else {
                inp.value = ''; 
            }
        });
        showLiftStatus('Поля сброшены');
    });

    return true;
}

// Наблюдаем за появлением окна тарифов и окна подъема на этаж
let checkTimeout = null;
const observer = new MutationObserver(() => {
    if (checkTimeout) return;
    checkTimeout = setTimeout(() => {
        checkTimeout = null;
        if (window.__tariffCleanDOMMode) return;
        
        const pricesWindow = findPricesWindow();
        if (pricesWindow && !document.getElementById('af-tariff-panel')) {
            injectPanelIntoPricesWindow();
        }

        if (findLiftingTable() && !document.getElementById('af-lifting-panel')) {
            injectLiftingPanel();
        }
    }, 100);
});

observer.observe(document.body, {
    childList: true,
    subtree: true
});

// Первоначальная проверка
setTimeout(() => {
    if (findPricesWindow() && !document.getElementById('af-tariff-panel')) {
        injectPanelIntoPricesWindow();
    }
    if (findLiftingTable() && !document.getElementById('af-lifting-panel')) {
        injectLiftingPanel();
    }
}, 1000);

window.addEventListener('spa-route-changed', () => {
    setTimeout(() => {
        if (findPricesWindow() && !document.getElementById('af-tariff-panel')) {
            injectPanelIntoPricesWindow();
        }
        if (findLiftingTable() && !document.getElementById('af-lifting-panel')) {
            injectLiftingPanel();
        }
    }, 400);
});
})();
