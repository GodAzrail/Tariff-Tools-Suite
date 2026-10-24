// pvz-tariff-creator.js
(function() {
'use strict';
console.log('[pvz-tariff-creator] Загружен с интерфейсом предзагрузки, умным наблюдателем и ценой возврата');

class PVZTariffCreator {
    constructor() {
        this.isCreating = false;
        this.shouldStop = false;
        this.tariffsToCreate = [];
        this.currentIndex = 0;
        this.sidebar = null;
        this.logEntries = [];
        this.baseTariffsUrl = ''; 
        this.isProcessingStep = false; 

        this.loadStateFromStorage();

        if (this.isCreating) {
            this.createProgressSidebar();
            this.renderLog();
            this.updateSidebarDisplay();
            this.addLog('🔄 Возобновление автоматического создания тарифов...', 'info');
        }

        this.startPageWatcher();
    }

    // === Работа с памятью (localStorage) ===
    saveStateToStorage() {
        const state = {
            isCreating: this.isCreating,
            currentIndex: this.currentIndex,
            tariffsToCreate: this.tariffsToCreate,
            baseTariffsUrl: this.baseTariffsUrl,
            logEntries: this.logEntries
        };
        localStorage.setItem('pvz_automation_state', JSON.stringify(state));
    }

    loadStateFromStorage() {
        const raw = localStorage.getItem('pvz_automation_state');
        if (!raw) return;
        try {
            const state = JSON.parse(raw);
            this.isCreating = !!state.isCreating;
            this.currentIndex = Number(state.currentIndex || 0);
            this.tariffsToCreate = Array.isArray(state.tariffsToCreate) ? state.tariffsToCreate : [];
            this.baseTariffsUrl = state.baseTariffsUrl || '';
            this.logEntries = Array.isArray(state.logEntries) ? state.logEntries : [];
        } catch (e) {
            console.error('[PVZ Creator] Ошибка чтения localStorage:', e);
        }
    }

    clearStorage() {
        localStorage.removeItem('pvz_automation_state');
    }

    // === Логика очистки логов ===
    clearLogs() {
        this.logEntries = [];
        this.saveStateToStorage();
        this.renderLog();
        this.addLog('🗑️ Логи очищены', 'info');
    }

    // === Открытие начального меню ===
    openMenu() {
        if (window.TariffToolsCore && typeof window.TariffToolsCore.closeAllSidebars === 'function') {
            window.TariffToolsCore.closeAllSidebars();
        }
        if (this.isCreating) {
            this.createProgressSidebar();
            this.updateSidebarDisplay();
            return;
        }
        this.createConfigSidebar();
    }

    // === Обработка загрузки файла из UI ===
    async handleFileSelect(event) {
        const file = event.target.files[0];
        if (!file) return;

        this.tariffsToCreate = [];
        this.currentIndex = 0;
        this.logEntries = [];
        this.renderLog();
        
        this.addLog(`📁 Чтение файла: ${file.name}`, 'info');
        const statusEl = document.getElementById('pvz-status');
        if (statusEl) statusEl.textContent = 'Обработка файла...';

        try {
            const rows = await this.readExcelFile(file);
            this.parseTariffs(rows);
            this.addLog(`📊 Успешно распарсено: ${this.tariffsToCreate.length} тарифов`, 'success');
            
            if (statusEl) {
                statusEl.textContent = `Готово к загрузке: ${this.tariffsToCreate.length} шт.`;
                statusEl.style.color = '#4ade80';
            }

            const startBtn = document.getElementById('pvz-start');
            if (startBtn && this.tariffsToCreate.length > 0) {
                startBtn.disabled = false;
                startBtn.style.background = '#3b82f6';
                startBtn.style.color = '#ffffff';
                startBtn.style.cursor = 'pointer';
            }
        } catch (e) {
            this.addLog(`❌ Ошибка: ${e.message}`, 'error');
            if (statusEl) {
                statusEl.textContent = 'Ошибка чтения файла';
                statusEl.style.color = '#f87171';
            }
        }
    }

    startProcess() {
        if (!this.tariffsToCreate || this.tariffsToCreate.length === 0) return;

        this.isCreating = true;
        this.shouldStop = false;
        this.baseTariffsUrl = window.location.href;

        this.saveStateToStorage();
        this.createProgressSidebar();
        
        this.addLog('🚀 Запуск массового создания ПВЗ-тарифов', 'info');
        this.updateSidebarDisplay();
    }

    startPageWatcher() {
        setInterval(async () => {
            if (!this.isCreating || this.shouldStop || this.isProcessingStep) return;

            this.isProcessingStep = true; 

            const nameInput = document.querySelector('input[placeholder*="Введите название тарифа"]');
            const dialog = document.querySelector('dialog[open]');
            const isTypeDialog = dialog && dialog.textContent.includes('Выберите тип тарифа');

            if (nameInput) {
                await this.processCreatePage();
            } 
            else if (isTypeDialog) {
                this.addLog('💬 Выбираем тип тарифа...', 'info');
                const pvzButton = Array.from(dialog.querySelectorAll('button')).find(btn => {
                    const text = (btn.textContent || '').trim().toUpperCase();
                    return text === 'ДОСТАВКА В ПВЗ';
                });
                
                if (pvzButton) {
                    pvzButton.click();
                    this.addLog('✅ Нажата кнопка "Доставка в ПВЗ"', 'success');
                    await this.delay(500); 
                } else {
                    this.addLog('⚠️ Кнопка "Доставка в ПВЗ" не найдена', 'warning');
                }
            } 
            else {
                const createBtn = Array.from(document.querySelectorAll('button')).find(b => {
                    const text = (b.textContent || '').trim().toLowerCase();
                    return text.includes('создать') && text.length < 30 && !b.closest('#pvz-creator-sidebar');
                });

                if (createBtn) {
                    this.addLog('🖱️ Находимся в списке. Нажимаем кнопку "Создать"...', 'info');
                    createBtn.click();
                    await this.delay(500); 
                } else {
                    if (this.baseTariffsUrl && window.location.href !== this.baseTariffsUrl) {
                        this.addLog('↩️ Неверный URL. Направляем на страницу старта...', 'warning');
                        window.location.href = this.baseTariffsUrl;
                    }
                }
            }

            this.isProcessingStep = false; 
        }, 1500);
    }

    async processCreatePage() {
        if (this.currentIndex >= this.tariffsToCreate.length) {
            this.finishImport();
            return;
        }

        const tariff = this.tariffsToCreate[this.currentIndex];
        this.addLog(`➡️ Заполняем тариф (${this.currentIndex + 1}/${this.tariffsToCreate.length}): ${tariff.name}`, 'info');
        this.updateSidebarDisplay();

        try {
            await this.fillFormFields(tariff);
            const isSaved = await this.clickMainSaveButton(); 

            if (isSaved) {
                this.currentIndex++;
                
                if (this.currentIndex >= this.tariffsToCreate.length) {
                    this.finishImport();
                    this.addLog('↩️ Завершено! Возвращаемся к списку...', 'info');
                    await this.delay(1000); 
                    window.location.href = this.baseTariffsUrl; 
                } else {
                    this.saveStateToStorage(); 
                    this.addLog('↩️ Тариф сохранен! Перенаправляем на страницу старта...', 'success');
                    await this.delay(500);
                    window.location.href = this.baseTariffsUrl; 
                }
            } else {
                this.addLog('❌ Не удалось сохранить тариф. Остановка.', 'error');
                this.stop();
            }
        } catch (e) {
            this.addLog(`❌ Критическая ошибка: ${e.message}`, 'error');
            this.stop();
        }
    }

    async fillFormFields(tariff) {
        const nameInput = document.querySelector('input[placeholder*="Введите название тарифа"]');
        if (nameInput) {
            nameInput.value = tariff.name;
            nameInput.dispatchEvent(new Event('input', {bubbles: true}));
            this.addLog(`📝 Название: ${tariff.name}`, 'success');
        }

        await this.openAndSelectZones(tariff.zones);
        await this.openAndSelectBranches(tariff.branches);

        const daysInput = document.querySelector('input[placeholder*="Количество дней доставки"]');
        if (daysInput) {
            daysInput.value = tariff.deliveryDays || '0';
            daysInput.dispatchEvent(new Event('input', {bubbles: true}));
            this.addLog(`📅 Дней: ${daysInput.value}`, 'success');
        }

        const cutoffInput = document.querySelector('input[placeholder*="Отсечка оформления заказа"]');
        if (cutoffInput) {
            cutoffInput.value = tariff.cutoffTime || '00:00';
            cutoffInput.dispatchEvent(new Event('input', {bubbles: true}));
            this.addLog(`⏰ Отсечка: ${cutoffInput.value}`, 'success');
        }

        const costLimitInput = document.querySelector('input[placeholder*="Стоимость заказа"]');
        if (costLimitInput && tariff.costLimit) {
            costLimitInput.value = tariff.costLimit;
            costLimitInput.dispatchEvent(new Event('input', {bubbles: true}));
            this.addLog(`💰 Лимит стоимости: ${costLimitInput.value}`, 'success');
        }

        await this.fillMgxGrid(tariff.mgxRows);
    }

    async clickMainSaveButton() {
        this.addLog('🔍 Ищем кнопку "Сохранить"...', 'info');
        let attempts = 0;
        while (attempts < 30) {
            if (this.shouldStop) return false;
            const saveBtn = Array.from(document.querySelectorAll('button')).find(btn => {
                const text = (btn.textContent || '').trim();
                return text === 'Сохранить' && !btn.disabled && !btn.closest('dialog[open]');
            });

            if (saveBtn) {
                saveBtn.scrollIntoView({ block: 'center', behavior: 'smooth' });
                saveBtn.focus();
                await this.delay(150); 
                saveBtn.click();
                this.addLog('💾 ✅ Нажата "Сохранить"', 'success');
                await this.delay(1250); 
                return true;
            }

            await this.delay(200);
            attempts++;
        }
        return false;
    }

    async clickDialogSaveButton(dialog) {
        const saveBtn = Array.from(dialog.querySelectorAll('button')).find(b => {
            return (b.textContent || '').trim() === 'Сохранить' && !b.disabled;
        });
        if (saveBtn) {
            saveBtn.click();
            await this.delay(400);
            return true;
        }
        return false;
    }

    async openAndSelectZones(zones) {
        if (!zones || zones.length === 0) return;
        const pencil = this.findPencilIcon('Зоны доставки');
        if (!pencil) return this.addLog('⚠️ Иконка Зон не найдена', 'warning');
        pencil.click();
        await this.delay(800);
        const dialog = document.querySelector('dialog[open]');
        if (!dialog) return;
        for (const zone of zones) {
            const cb = this.findCheckboxByText(dialog, zone);
            if (cb && !cb.checked) cb.click();
        }
        await this.clickDialogSaveButton(dialog);
        await this.delay(500);
        this.addLog(`📍 Зоны: ${zones.join(', ')}`, 'success');
    }

    async openAndSelectBranches(branches) {
        if (!branches || branches.length === 0) return;
        const pencil = this.findPencilIcon('Филиалы обслуживания');
        if (!pencil) return this.addLog('⚠️ Иконка Филиалов не найдена', 'warning');
        pencil.click();
        await this.delay(800);
        const dialog = document.querySelector('dialog[open]');
        if (!dialog) return;
        for (const branch of branches) {
            const cb = this.findCheckboxByText(dialog, branch);
            if (cb && !cb.checked) cb.click();
        }
        await this.clickDialogSaveButton(dialog);
        await this.delay(500);
        this.addLog(`🏢 Филиалы: ${branches.join(', ')}`, 'success');
    }

    async fillMgxGrid(mgxRows) {
        if (!mgxRows || mgxRows.length === 0) return;
        const pencil = this.findPencilIcon('МГХ сетка');
        if (!pencil) {
            this.addLog('⚠️ Иконка МГХ не найдена', 'warning');
            throw new Error('Иконка МГХ сетки не найдена');
        }
        pencil.click();
        await this.delay(800);
        let dialog = document.querySelector('dialog[open]');
        for (let attempt = 0; attempt < 20 && !dialog; attempt++) {
            await this.delay(200);
            dialog = document.querySelector('dialog[open]');
        }
        if (!dialog) {
            this.addLog('❌ Диалог МГХ не открылся', 'error');
            throw new Error('Диалог МГХ сетки не открылся');
        }

        let bulkInternal = null;
        let bulkCustomer = null;
        let bulkReturn = null;
        let transferBtn = null;

        for (let attempt = 0; attempt < 30; attempt++) {
            bulkInternal = dialog.querySelector('#af-bulk0');
            bulkCustomer = dialog.querySelector('#af-bulk1');
            bulkReturn = dialog.querySelector('#af-bulk2');
            transferBtn = dialog.querySelector('#af-transfer-all');
            if (bulkInternal && bulkCustomer && transferBtn) break;
            await this.delay(200);
        }

        if (!bulkInternal || !bulkCustomer || !transferBtn) {
            this.addLog('❌ Панель автозаполнения цен МГХ (#af-bulk) не появилась', 'error');
            throw new Error('Панель цен МГХ не появилась в диалоге');
        }

        bulkInternal.value = mgxRows.map(r => r.internal).join('\n');
        bulkCustomer.value = mgxRows.map(r => r.customer).join('\n');
        bulkInternal.dispatchEvent(new Event('input', { bubbles: true }));
        bulkCustomer.dispatchEvent(new Event('input', { bubbles: true }));

        if (bulkReturn) {
            bulkReturn.value = mgxRows.map(r => r.returnPrice).join('\n');
            bulkReturn.dispatchEvent(new Event('input', { bubbles: true }));
        }

        transferBtn.click();
        await this.delay(800);
        await this.clickDialogSaveButton(dialog);
        this.addLog(`📊 МГХ заполнена (${mgxRows.length} строк)`, 'success');
    }

    findPencilIcon(labelText) {
        const labels = Array.from(document.querySelectorAll('span, div, label'));
        for (const el of labels) {
            if (el.textContent.trim() === labelText) {
                return el.parentElement.querySelector('span[class*="pencil"], .icomoon-icon__pencil');
            }
        }
        return null;
    }

    findCheckboxByText(dialog, text) {
        const wanted = String(text).trim().toLowerCase();
        const candidates = dialog.querySelectorAll('label, span, div');
        for (const el of candidates) {
            if (String(el.textContent).trim().toLowerCase() === wanted) {
                const checkbox = el.querySelector('input[type="checkbox"]') || el.closest('label')?.querySelector('input[type="checkbox"]');
                if (checkbox) return checkbox;
            }
        }
        return null;
    }

    async readExcelFile(file) {
        return new Promise((resolve, reject) => {
            const r = new FileReader();
            r.onload = e => {
                try {
                    const wb = XLSX.read(new Uint8Array(e.target.result), {type: 'array'});
                    resolve(XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], {header: 1}));
                } catch (err) { reject(err); }
            };
            r.onerror = reject;
            r.readAsArrayBuffer(file);
        });
    }

    parseTariffs(rows) {
        this.tariffsToCreate = [];
        if (!rows || rows.length < 2) return;

        const header = rows[0].map(h => String(h || '').trim());
        const headerMap = new Map(header.map((h, i) => [h, i]));
        const get = (row, key, fb = -1) => row[headerMap.has(key) ? headerMap.get(key) : fb] || '';

        const truncatePrice = (val) => {
            const strVal = String(val || '').trim();
            if (!strVal) return '';
            return strVal.replace(/\s+/g, '').split(/[,.]/)[0];
        };

        for (let i = 1; i < rows.length; i++) {
            const row = rows[i];
            const name = String(get(row, 'Название тарифа', 0)).trim();
            if (!name) continue;

            let t = this.tariffsToCreate.find(x => x.name === name);
            if (!t) {
                t = {
                    name,
                    zones: String(get(row, 'Зоны доставки', 1)).split(';').map(z => z.trim()).filter(Boolean),
                    branches: String(get(row, 'Филиалы', 2)).split(';').map(b => b.trim()).filter(Boolean),
                    deliveryDays: get(row, 'Количество дней доставки', -1),
                    cutoffTime: get(row, 'Отсечка оформления заказа', -1),
                    costLimit: get(row, 'Лимит стоимости заказа, руб', -1) || get(row, 'Лимит стоимости', -1) || '',
                    mgxRows: []
                };
                this.tariffsToCreate.push(t);
            }

            t.mgxRows.push({
                weight: get(row, 'Макс. вес (МГХ), кг', 3), 
                internal: truncatePrice(get(row, 'Цена внутренняя, руб', 4)),
                customer: truncatePrice(get(row, 'Цена покупателя, руб', 5)),
                returnPrice: truncatePrice(get(row, 'Цена возврата, руб', 6))
            });
        }
    }

    createConfigSidebar() {
        if (this.sidebar) this.sidebar.remove();
        this.sidebar = document.createElement('div');
        this.sidebar.id = 'pvz-creator-sidebar';
        this.sidebar.style.cssText = `position:fixed;top:0;right:0;width:420px;height:100vh;background:#1e293b;box-shadow:-2px 0 20px rgba(0,0,0,0.3);z-index:1000002;display:flex;flex-direction:column;font-family:'Segoe UI',Arial,sans-serif;border-left:1px solid #334155;`;

        this.sidebar.innerHTML = `
            <div style="padding:16px 20px;background:#0f172a;border-bottom:1px solid #334155;display:flex;justify-content:space-between;align-items:center;">
                <div>
                    <h3 style="color:#60a5fa;margin:0;font-size:18px;">📦 ПВЗ-Тарифы</h3>
                    <div style="color:#94a3b8;font-size:11px;margin-top:4px;">Создание новых тарифов из Excel</div>
                </div>
                <button id="pvz-close" style="background:none;border:none;color:#94a3b8;font-size:22px;cursor:pointer;">×</button>
            </div>
            <div style="padding:16px;flex:1;display:flex;flex-direction:column;min-height:0;">
                <div id="tariff-create-status-box" style="margin-bottom: 16px; background: #0f172a; padding: 12px; border-radius: 8px; border-left: 3px solid #60a5fa;">
                    <div style="color: #60a5fa; font-size: 13px; font-weight: 500;" id="tariff-create-status-title">📋 Выберите файл</div>
                    <div style="color: #94a3b8; font-size: 11px; margin-top: 6px;" id="tariff-create-status-detail">После выбора файла нажмите «Начать создание»</div>
                </div>
                
                <div style="margin-bottom: 16px; position: relative; background: #334155; border: 2px dashed #64748b; border-radius: 8px; padding: 20px 16px; text-align: center; transition: all 0.2s ease;">
                     <input type="file" id="pvz-file" accept=".xls,.xlsx" style="position: absolute; top: 0; left: 0; width: 100%; height: 100%; opacity: 0; cursor: pointer; z-index: 10;">
                  <div style="font-size: 28px; margin-bottom: 8px; pointer-events: none; opacity: 0.9;">📄</div>
                  <div style="color: #f8fafc; font-size: 14px; font-weight: 500; margin-bottom: 4px; pointer-events: none;">1. Выберите файл Excel</div>
                  <div id="pvz-status" style="font-size: 12px; color: #cbd5e1; pointer-events: none;">Нажмите и выберите файл (.xls, .xlsx)</div>
                </div>
                
                <div style="display: flex; justify-content: space-between; margin-bottom: 6px; align-items: center;">
                    <div style="color:#94a3b8;font-size:12px;">Логи подготовки:</div>
                    <button id="pvz-clear-log" style="background:none; border:none; color:#ef4444; font-size:11px; cursor:pointer; padding:0;">🗑️ Очистить</button>
                </div>
                <div id="pvz-log" style="flex:1;background:#0f172a;border-radius:8px;padding:12px;overflow-y:auto;font-size:12px;font-family:monospace;margin-bottom:16px;border:1px solid #334155;"></div>
                <button id="pvz-start" disabled style="width:100%;padding:12px;background:#475569;color:#94a3b8;border:none;border-radius:6px;cursor:not-allowed;font-weight:bold;font-size:14px;transition:0.2s;">🚀 2. Начать создание</button>
            </div>
        `;

        document.body.appendChild(this.sidebar);
        
        document.getElementById('pvz-close').onclick = () => this.hideSidebar();
        document.getElementById('pvz-file').onchange = (e) => this.handleFileSelect(e);
        document.getElementById('pvz-start').onclick = () => this.startProcess();
        document.getElementById('pvz-clear-log').onclick = () => this.clearLogs();
        
        this.renderLog();
    }

    createProgressSidebar() {
        if (this.sidebar) this.sidebar.remove();
        this.sidebar = document.createElement('div');
        this.sidebar.id = 'pvz-creator-sidebar';
        this.sidebar.style.cssText = `position:fixed;top:0;right:0;width:420px;height:100vh;background:#1e293b;box-shadow:-2px 0 20px rgba(0,0,0,0.3);z-index:1000002;display:flex;flex-direction:column;font-family:'Segoe UI',Arial,sans-serif;border-left:1px solid #334155;`;

        this.sidebar.innerHTML = `
            <div style="padding:16px 20px;background:#0f172a;border-bottom:1px solid #334155;display:flex;justify-content:space-between;align-items:center;">
                <div>
                    <h3 style="color:#60a5fa;margin:0;font-size:18px;">⏳ Идёт создание тарифов ПВЗ...</h3>
                </div>
                <button id="pvz-close" style="background:none;border:none;color:#94a3b8;font-size:22px;cursor:pointer;">×</button>
            </div>
            <div style="padding:16px;flex:1;display:flex;flex-direction:column;min-height:0;">
                <div style="margin-bottom:12px;">
                    <div style="display:flex;justify-content:space-between;margin-bottom:6px;color:#94a3b8;font-size:13px;">
                        <span>Прогресс</span>
                        <span id="pvz-progress">0 / 0</span>
                    </div>
                    <div style="height:8px;background:#334155;border-radius:4px;overflow:hidden;">
                        <div id="pvz-fill" style="width:0%;height:100%;background:linear-gradient(90deg,#3b82f6,#60a5fa);"></div>
                    </div>
                </div>
                <div style="display:flex; justify-content:space-between; margin-bottom:6px; align-items:center;">
                    <div style="color:#94a3b8;font-size:12px;">Логи:</div>
                    <button id="pvz-clear-log" style="background:none; border:none; color:#ef4444; font-size:11px; cursor:pointer; padding:0;">🗑️ Очистить</button>
                </div>
                <div id="pvz-log" style="flex:1;background:#0f172a;border-radius:8px;padding:12px;overflow-y:auto;font-size:12px;font-family:monospace;"></div>
            </div>
            <div style="padding:16px;border-top:1px solid #334155;">
                <button id="pvz-stop" style="width:100%;padding:10px;background:#dc2626;color:white;border:none;border-radius:6px;cursor:pointer;font-weight:bold;">⏹️ Остановить</button>
            </div>
        `;

        document.body.appendChild(this.sidebar);
        document.getElementById('pvz-close').onclick = () => this.hideSidebar();
        document.getElementById('pvz-stop').onclick = () => this.stop();
        document.getElementById('pvz-clear-log').onclick = () => this.clearLogs();
        
        this.renderLog();
        this.updateSidebarDisplay();
    }

    addLog(message, type = 'info') {
        this.logEntries.push({ time: new Date().toLocaleTimeString(), message, type });
        this.saveStateToStorage(); 
        this.renderLog();
    }

    renderLog() {
        const logDiv = document.getElementById('pvz-log');
        if (!logDiv) return;
        logDiv.innerHTML = '';
        const colors = { success: '#4ade80', error: '#f87171', info: '#60a5fa', warning: '#fbbf24' };
        for (const entry of this.logEntries) {
            const div = document.createElement('div');
            div.style.color = colors[entry.type] || '#cbd5e1';
            div.style.marginBottom = '4px';
            div.textContent = `[${entry.time}] ${entry.message}`;
            logDiv.appendChild(div);
        }
        logDiv.scrollTop = logDiv.scrollHeight;
    }

    updateSidebarDisplay() {
        const progressEl = document.getElementById('pvz-progress');
        const fillEl = document.getElementById('pvz-fill');
        if (progressEl) progressEl.textContent = `${this.currentIndex} / ${this.tariffsToCreate.length}`;
        if (fillEl && this.tariffsToCreate.length > 0) {
            fillEl.style.width = `${(this.currentIndex / this.tariffsToCreate.length) * 100}%`;
        }
    }

    stop() {
        this.shouldStop = true;
        this.isCreating = false;
        this.clearStorage();
        this.addLog('Остановлено пользователем', 'warning');
        this.updateSidebarDisplay();
    }

    finishImport() {
        this.isCreating = false;
        this.addLog('🏁 Все тарифы успешно созданы!', 'success');
        this.updateSidebarDisplay();
        this.clearStorage();
    }

    hideSidebar() {
        if (this.sidebar) this.sidebar.remove();
        this.sidebar = null;
    }

    delay(ms) {
        return new Promise(r => setTimeout(r, ms));
    }
}

window.pvzTariffCreator = new PVZTariffCreator();

window.openPVZTariffCreator = () => window.pvzTariffCreator.openMenu();
})();