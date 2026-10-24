// Tariff Updater Pro - обновление существующих тарифов из Excel
(function() {
    'use strict';
    
    class TariffUpdater {
        constructor() {
            this.isImporting = false;
            this.shouldStop = false;
            this.tariffsToCreate = [];
            this.currentIndex = 0;
            this.sidebar = null;
            this.logEntries = [];
            this.xlsxLoaded = false;
            this.importStarted = false;
            this.debugEnabled = false;
            this.fastModeMultiplier = 0.45;
            this.config = this.normalizeConfig({
                paymentCard: false,
                paymentCash: false,
                acceptanceSameDay: false,
                acceptanceNextDay: false,
                saleProduct: true,
                saleMarkdown: false,
                saleLegal: false,
                saleService: false
            });
            
            this.debugLog('[TariffUpdater] ========== ЗАГРУЗКА ==========');
            this.debugLog('[TariffUpdater] URL:', window.location.href);
            
            this.loadXLSXLibrary();
            this.restoreFromStorage();
            this.restoreSidebarFromStorage();
            this.removeLegacyImportButton();
            this.checkForContinueImport();
            
            setTimeout(() => {
                this.debugLog('[TariffUpdater] Принудительная проверка после загрузки');
                this.restoreSidebarFromStorage();
                this.checkForContinueImport();
            }, 250);
            
            setTimeout(() => {
                this.debugLog('[TariffUpdater] Повторная проверка через 2 секунды');
                this.restoreSidebarFromStorage();
                this.checkForContinueImport();
            }, 1000);
            
            this.formCheckInterval = setInterval(() => {
                this.checkForCreateForm();
            }, 500);
            
            window.addEventListener('storage', (e) => {
                if (e.key === 'tariff_update_state') {
                    this.restoreFromStorage();
                    if (this.sidebar) {
                        this.updateSidebarDisplay();
                        this.restoreLogFromStorage();
                    }
                }
                if (e.key === 'tariff_update_stop') {
                    this.handleStopSignal();
                }
                if (e.key === 'tariff_update_data') {
                    this.handleImportData(e.newValue);
                }
                if (e.key === 'tariff_update_config') {
                    this.handleConfigUpdate(e.newValue);
                }
            });
        }
        
        debugLog(...args) {
            if (this.debugEnabled) console.log(...args);
        }

        isFromTariffManager() {
            if (this.fromTariffManager === true) return true;
            if (this.config && this.config.fromTariffManager === true) return true;
            if (localStorage.getItem('tariff_to_save') || localStorage.getItem('tariff_to_collect')) return true;
            try {
                const updateData = localStorage.getItem('tariff_update_data');
                if (updateData) {
                    const parsed = JSON.parse(updateData);
                    if (parsed.fromTariffManager === true) return true;
                }
            } catch (_) {}
            return false;
        }

        debugWarn(...args) {
            if (this.debugEnabled) console.warn(...args);
        }

        getScaledDelay(ms) {
            const normalized = Number(ms) || 0;
            if (normalized <= 0) return 0;
            return Math.max(80, Math.round(normalized * this.fastModeMultiplier));
        }

        restoreSidebarFromStorage() {
            if (this.isCreatorFlowActive() || this.isFromTariffManager()) return;
            if (!this.isImporting && this.currentIndex >= this.tariffsToCreate.length) return;
            const savedData = localStorage.getItem('tariff_update_data');
            if (savedData) {
                const data = JSON.parse(savedData);
                if (data.stoppedByUser || data.shouldStart === false || localStorage.getItem('tariff_update_manual_stop') === '1') {
                    this.shouldStop = true;
                    this.isImporting = false;
                    return;
                }
                if (data.tariffs && data.tariffs.length > 0 && data.currentIndex < data.tariffs.length) {
                    this.tariffsToCreate = data.tariffs;
                    this.config = data.config;
                    this.currentIndex = data.currentIndex;
                    this.isImporting = true;
                    
                    if (this.sidebar) {
                        this.sidebar.remove();
                        this.sidebar = null;
                    }
                    this.createSidebar();
                    this.showSidebar();
                    this.updateSidebarDisplay();
                    this.restoreLogFromStorage();
                    
                    this.addSidebarLog(`📊 Продолжение импорта: ${this.currentIndex + 1}/${this.tariffsToCreate.length}`, 'info');
                    
                    if (!window.location.href.includes('/create')) {
                        this.openTariffForUpdate(this.tariffsToCreate[this.currentIndex]?.name);
                    }
                }
            }
        }
        
        checkForContinueImport() {
            if (this.isCreatorFlowActive() || this.isFromTariffManager()) return;
            if (!this.isImporting && this.currentIndex >= this.tariffsToCreate.length) return;
            const savedData = localStorage.getItem('tariff_update_data');
            if (savedData && !this.importStarted) {
                const data = JSON.parse(savedData);
                if (data.stoppedByUser || data.shouldStart === false || localStorage.getItem('tariff_update_manual_stop') === '1') {
                    this.shouldStop = true;
                    this.isImporting = false;
                    return;
                }
                if (data.tariffs && data.tariffs.length > 0 && data.currentIndex !== undefined && data.currentIndex < data.tariffs.length) {
                    this.tariffsToCreate = data.tariffs;
                    this.config = data.config;
                    this.currentIndex = data.currentIndex;
                    this.isImporting = true;
                    
                    if (!this.sidebar) {
                        this.createSidebar();
                        this.showSidebar();
                        this.updateSidebarDisplay();
                        this.restoreLogFromStorage();
                    } else {
                        this.showSidebar();
                    }
                    
                    this.addSidebarLog(`🔄 Продолжаем импорт: ${this.currentIndex + 1}/${this.tariffsToCreate.length}`, 'info');
                    
                    if (!window.location.href.includes('/create')) {
                        this.openTariffForUpdate(this.tariffsToCreate[this.currentIndex]?.name);
                    }
                }
            }
        }
        
        checkForCreateForm() {
            if (this.isCreatorFlowActive() || this.isFromTariffManager()) return;
            if (!this.isImporting || this.currentIndex >= this.tariffsToCreate.length || this.tariffsToCreate.length === 0) return;
            const nameInput = document.querySelector('input[placeholder*="Введите название тарифа"]');
            
            if (nameInput && !this.importStarted && this.isImporting && !this.stopRequested()) {
                this.importStarted = true;
                let checkCount = 0;
                const waitForPageLoad = setInterval(() => {
                    checkCount++;
                    const nameInputCheck = document.querySelector('input[placeholder*="Введите название тарифа"]');
                    if (nameInputCheck || document.readyState === 'complete' || checkCount > 30) {
                        clearInterval(waitForPageLoad);
                        setTimeout(() => this.startImportOnPage(), 400);
                    }
                }, 250);
            }
        }
        
        loadXLSXLibrary() {
            this.xlsxLoaded = typeof XLSX !== 'undefined';
        }

        getDefaultImportBlocks() {
            return {
                zones: true,
                branches: true,
                mgx: true,
                intervals: true,
                deliveryParams: true,
                costLimit: true,      
                validityDates: true,  
                payment: true,
                acceptance: true,
                saleTypes: true,
                floor: true
            };
        }

        normalizeConfig(config = {}) {
            const defaults = this.getDefaultImportBlocks();
            const currentBlocks = config.importBlocks && typeof config.importBlocks === 'object' ? config.importBlocks : {};
            return {
                paymentCard: !!config.paymentCard,
                paymentCash: !!config.paymentCash,
                acceptanceSameDay: !!config.acceptanceSameDay,
                acceptanceNextDay: !!config.acceptanceNextDay,
                saleProduct: config.saleProduct !== false,
                saleMarkdown: !!config.saleMarkdown,
                saleLegal: !!config.saleLegal,
                saleService: !!config.saleService,
                importBlocks: { ...defaults, ...currentBlocks }
            };
        }

        getImportBlockDefinitions() {
            return [
                { key: 'zones', label: 'Зоны доставки' },
                { key: 'branches', label: 'Филиалы' },
                { key: 'mgx', label: 'МГХ сетка' },
                { key: 'intervals', label: 'Интервалы' },
                { key: 'deliveryParams', label: 'Дни, отсечка' },
                { key: 'costLimit', label: 'Лимит суммы' },
                { key: 'validityDates', label: 'Даты действия' },
                { key: 'payment', label: 'Оплата' },
                { key: 'acceptance', label: 'Прием заявок' },
                { key: 'saleTypes', label: 'Вид продажи' },
                { key: 'floor', label: 'Подъем на этаж' }
            ];
        }

        isImportBlockEnabled(blockKey) {
            if (this.isFromTariffManager()) {
                return !!this.config?.importBlocks?.[blockKey];
            }
            return this.config?.importBlocks?.[blockKey] !== false;
        }

        hasTariffBlockData(tariff, blockKey) {
            if (!tariff) return false;
            switch (blockKey) {
                case 'zones': return Array.isArray(tariff.zones) && tariff.zones.length > 0;
                case 'branches': return Array.isArray(tariff.branches) && tariff.branches.length > 0;
                case 'mgx': return Array.isArray(tariff.mgxRows) && tariff.mgxRows.length > 0;
                case 'intervals': return Array.isArray(tariff.intervals) && tariff.intervals.length > 0;
                case 'deliveryParams': return !!(tariff.deliveryDays || tariff.cutoffTime);
                case 'costLimit': return !!tariff.maxOrderCost;
                case 'validityDates': return !!(tariff.startDate || tariff.endDate);
                case 'payment': return !!(tariff.payment && (typeof tariff.payment.card === 'boolean' || typeof tariff.payment.cash === 'boolean'));
                case 'acceptance': return !!(tariff.acceptance && (typeof tariff.acceptance.sameDay === 'boolean' || typeof tariff.acceptance.nextDay === 'boolean'));
                case 'saleTypes': return !!(tariff.saleTypes && ['product', 'markdown', 'legal', 'service'].some(key => typeof tariff.saleTypes[key] === 'boolean'));
                case 'floor': return !!((tariff.elevatorPrice && (tariff.elevatorPrice.internalPrice || tariff.elevatorPrice.customerPrice || tariff.elevatorPrice.internal || tariff.elevatorPrice.customer)) || (Array.isArray(tariff.floorRows) && tariff.floorRows.length > 0));
                default: return false;
            }
        }

        shouldImportBlock(tariff, blockKey, blockLabel) {
            // Если передан tariff.importBlocks (точечное сохранение из Tariff Manager)
            // или запрос инициирован Tariff Manager, строго ориентируемся на importBlocks:
            // выполнять блок только если он явно включен (true)!
            if (tariff && tariff.importBlocks && typeof tariff.importBlocks === 'object') {
                return tariff.importBlocks[blockKey] === true;
            }
            if (this.isFromTariffManager()) {
                if (this.config && this.config.importBlocks && typeof this.config.importBlocks === 'object') {
                    return this.config.importBlocks[blockKey] === true;
                }
                return false;
            }
            if (!this.isImportBlockEnabled(blockKey)) return false;
            if (!this.hasTariffBlockData(tariff, blockKey)) return false;
            return true;
        }

        getImportBlockCheckboxId(blockKey) {
            return `config-import-block-${blockKey}`;
        }

        renderImportBlockCheckboxes() {
            return this.getImportBlockDefinitions().map(block => `
                <label style="display: flex; align-items: center; gap: 6px; color: #e2e8f0; font-size: 11px; cursor: pointer; padding: 4px 8px; background: #1e293b; border-radius: 4px; border: 1px solid #334155; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; transition: all 0.2s;" onmouseover="this.style.borderColor='#10b981'" onmouseout="this.style.borderColor='#334155'" title="${block.label}">
                    <input type="checkbox" id="${this.getImportBlockCheckboxId(block.key)}" style="cursor: pointer; margin: 0; min-width: 13px;" ${this.isImportBlockEnabled(block.key) ? 'checked' : ''}>
                    <span style="overflow: hidden; text-overflow: ellipsis;">${block.label}</span>
                </label>
            `).join('');
        }

        bindImportBlockCheckboxes() {
            this.getImportBlockDefinitions().forEach(block => {
                const checkbox = document.getElementById(this.getImportBlockCheckboxId(block.key));
                if (checkbox) checkbox.onchange = () => this.saveConfig(false);
            });
        }

        isCreatorFlowActive() {
            try {
                const createState = JSON.parse(localStorage.getItem('tariff_create_state') || 'null');
                if (createState?.isImporting) return true;
                const createData = JSON.parse(localStorage.getItem('tariff_create_data') || 'null');
                return !!createData?.shouldStart;
            } catch (error) {
                return false;
            }
        }

        prepareForCreatorRun() {
            this.clearManualStopFlag();
            this.shouldStop = false;
            this.lastCreateFailure = null;
            return true;
        }

        setCreateFailure(step, details = {}) {
            const payload = { step, details, url: window.location.href, timestamp: new Date().toISOString() };
            this.lastCreateFailure = payload;
            this.addSidebarLog(`❌ Ошибка: ${step}`, 'error');
            return false;
        }

        getLastCreateFailure() {
            return this.lastCreateFailure || null;
        }

        stopRequested() {
            return !!this.shouldStop || localStorage.getItem('tariff_update_manual_stop') === '1';
        }

        ensureCanContinue(contextMessage) {
            if (this.stopRequested()) {
                this.applyStoppedState(contextMessage || 'Импорт остановлен пользователем');
                return false;
            }
            return true;
        }

        applyStoppedState(detailMessage = 'Импорт остановлен пользователем') {
            this.shouldStop = true;
            this.isImporting = false;
            this.importStarted = false;
            this.saveStateToStorage();
            this.persistStoppedImportData();
            this.updateSidebarStatus('⏹️ Импорт остановлен', detailMessage);
            this.updateConfigStatus('⏹️ Импорт остановлен', detailMessage);
            this.updateSidebarDisplay();
            this.updateButtonsForImportState();
        }

        persistStoppedImportData() {
            localStorage.setItem('tariff_update_manual_stop', '1');
            localStorage.setItem('tariff_update_state', JSON.stringify({
                isImporting: false,
                tariffsToCreate: this.tariffsToCreate,
                currentIndex: this.currentIndex,
                shouldStop: true
            }));
            localStorage.setItem('tariff_update_data', JSON.stringify({
                tariffs: this.tariffsToCreate,
                config: this.config,
                shouldStart: false,
                stoppedByUser: true,
                currentIndex: this.currentIndex
            }));
        }

        clearManualStopFlag() {
            localStorage.removeItem('tariff_update_manual_stop');
        }
        
        restoreFromStorage() {
            const savedState = localStorage.getItem('tariff_update_state');
            if (savedState) {
                const state = JSON.parse(savedState);
                this.isImporting = state.isImporting || false;
                this.tariffsToCreate = state.tariffsToCreate || [];
                this.currentIndex = state.currentIndex || 0;
                this.shouldStop = state.shouldStop || false;
            }
            const savedConfig = localStorage.getItem('tariff_update_config');
            if (savedConfig) {
                this.config = this.normalizeConfig(JSON.parse(savedConfig));
            }
        }
        
        saveStateToStorage() {
            const state = {
                isImporting: this.isImporting,
                tariffsToCreate: this.tariffsToCreate,
                currentIndex: this.currentIndex,
                shouldStop: this.shouldStop
            };
            localStorage.setItem('tariff_update_state', JSON.stringify(state));
        }
        
        saveLogToStorage() {
            localStorage.setItem('tariff_update_log', JSON.stringify(this.logEntries));
        }
        
        restoreLogFromStorage() {
            const savedLog = localStorage.getItem('tariff_update_log');
            if (savedLog && this.sidebar) {
                this.logEntries = JSON.parse(savedLog);
                this.renderLog();
                this.renderConfigLog();
            }
        }
        
        // ==================== ИНТЕРФЕЙС И ОТОБРАЖЕНИЕ ====================

        renderLog() {
            const logDiv = document.getElementById('sidebar-update-log');
            if (!logDiv) return;
            logDiv.innerHTML = '';
            if (this.logEntries.length === 0) {
                const emptyMsg = document.createElement('div');
                emptyMsg.style.color = '#10b981';
                emptyMsg.textContent = '💡 Готов к импорту';
                logDiv.appendChild(emptyMsg);
                return;
            }
            const colors = { success: '#4ade80', error: '#f87171', info: '#60a5fa', warning: '#fbbf24' };
            for (const entry of this.logEntries) {
                const entryDiv = document.createElement('div');
                entryDiv.style.color = colors[entry.type] || '#cbd5e1';
                entryDiv.style.marginBottom = '4px';
                entryDiv.style.fontSize = '11px';
                entryDiv.textContent = `[${entry.time}] ${entry.message}`;
                logDiv.appendChild(entryDiv);
            }
            requestAnimationFrame(() => { logDiv.scrollTop = logDiv.scrollHeight; });
        }

        renderConfigLog() {
            const logDiv = document.getElementById('sidebar-update-config-log');
            if (!logDiv) return;
            logDiv.innerHTML = '';
            if (this.logEntries.length === 0) {
                logDiv.innerHTML = '<div style="color: #10b981;">💡 Готов к импорту</div>';
                return;
            }
            const colors = { success: '#4ade80', error: '#f87171', info: '#60a5fa', warning: '#fbbf24' };
            for (const entry of this.logEntries) {
                const div = document.createElement('div');
                div.style.color = colors[entry.type] || '#cbd5e1';
                div.style.marginBottom = '4px';
                div.style.fontSize = '11px';
                div.textContent = `[${entry.time}] ${entry.message}`;
                logDiv.appendChild(div);
            }
            requestAnimationFrame(() => { logDiv.scrollTop = logDiv.scrollHeight; });
        }
        
        removeLegacyImportButton() {
            const legacyButton = document.querySelector('#tariff-import-list-btn');
            if (legacyButton) legacyButton.remove();
        }

        findTariffCardByName(name) {
            const normalizedTarget = String(name || '').trim().toLowerCase();
            if (!normalizedTarget) return null;

            const cards = Array.from(document.querySelectorAll('.css-nr5n4g, .e1wi2kqa9, .css-15ttl8p'));
            const getTitleText = (card) => {
                const title = card.querySelector('.css-17i8ct5') || card.querySelector('a, span, h3, h4');
                return String(title?.textContent || card.textContent || '').trim().toLowerCase();
            };

            for (const card of cards) {
                if (getTitleText(card) === normalizedTarget) return card;
            }

            for (const card of cards) {
                if (getTitleText(card).includes(normalizedTarget)) return card;
            }

            return null;
        }

        findEditButtonInTariffCard(card) {
            if (!card) return null;
            const buttons = Array.from(card.querySelectorAll('button'));
            for (const button of buttons) {
                if (button.querySelector('.icomoon-icon__pencil, span[class*="pencil"]')) {
                    return button;
                }
            }
            return null;
        }

        openTariffForUpdate(tariffName) {
            let attempts = 0;
            const maxAttempts = 30;

            const checkInterval = setInterval(() => {
                attempts++;
                if (this.stopRequested()) {
                    clearInterval(checkInterval);
                    return;
                }
                const card = this.findTariffCardByName(tariffName);

                if (card) {
                    clearInterval(checkInterval);
                    const editButton = this.findEditButtonInTariffCard(card);

                    if (editButton) {
                        editButton.click();
                        this.addSidebarLog(`✏️ Открываем тариф: ${tariffName}`, 'info');
                    } else {
                        const titleElement = card.querySelector('.css-17i8ct5') || card.querySelector('a, span, h3, h4');
                        if (titleElement) titleElement.click();
                        else this.addSidebarLog(`❌ Не удалось открыть тариф: ${tariffName}`, 'error');
                    }
                } else if (attempts >= maxAttempts) {
                    clearInterval(checkInterval);
                    this.addSidebarLog(`❌ Не удалось найти тариф: ${tariffName}`, 'error');
                }
            }, 500);
        }

        showConfigSidebar() {
            this.removeLegacyImportButton();
            
            const savedData = localStorage.getItem('tariff_update_data');
            const manuallyStopped = localStorage.getItem('tariff_update_manual_stop') === '1';
            let hasSavedTariffs = false;
            let savedDataIndicatesActiveImport = false;

            if (savedData) {
                try {
                    const data = JSON.parse(savedData);
                    if (data.tariffs && data.tariffs.length > 0) {
                        this.tariffsToCreate = data.tariffs;
                        this.config = this.normalizeConfig(data.config || this.config);
                        this.currentIndex = data.currentIndex || 0;
                        hasSavedTariffs = true;
                        savedDataIndicatesActiveImport = !data.stoppedByUser && data.shouldStart !== false && this.currentIndex < this.tariffsToCreate.length;
                    }
                } catch (error) {}
            }

            this.isImporting = !manuallyStopped && (this.isImporting || savedDataIndicatesActiveImport);

            if (this.isImporting) {
                if (this.sidebar && this.sidebar.id === 'tariff-update-sidebar') {
                    this.showSidebar();
                } else {
                    this.createSidebar();
                    this.showSidebar();
                    this.updateSidebarDisplay();
                    this.restoreLogFromStorage();
                }
                return;
            }
            
            if (this.sidebar && this.sidebar.id === 'tariff-update-config-sidebar') {
                this.hideOtherSidebars();
                this.sidebar.style.display = 'flex';
                this.restoreSidebar();
                this.restoreLogFromStorage();
                this.updateButtonsForImportState();
                if (manuallyStopped && hasSavedTariffs) {
                    this.updateConfigStatus('⏹️ Обновление остановлено', 'Можно запустить заново с тем же файлом');
                }
                return;
            }
            
            this.createConfigSidebar();
            this.hideOtherSidebars();
        }

        createConfigSidebar() {
            if (window.TariffToolsCore && typeof window.TariffToolsCore.closeAllSidebars === 'function') {
                window.TariffToolsCore.closeAllSidebars();
            }
            this.removeLegacyImportButton();
            if (this.sidebar) {
                this.sidebar.remove();
                this.sidebar = null;
            }

            this.sidebar = document.createElement('div');
            this.sidebar.id = 'tariff-update-config-sidebar';
            this.sidebar.style.cssText = `
                position: fixed; top: 0; right: 0; width: 420px; height: 100vh;
                background: #1e293b; box-shadow: -2px 0 20px rgba(0,0,0,0.3); z-index: 1000001;
                display: flex; flex-direction: column; font-family: 'Segoe UI', Arial, sans-serif;
                border-left: 1px solid #334155; transition: transform 0.3s ease;
            `;

            this.sidebar.innerHTML = `
                <div style="padding: 16px 20px; background: #0f172a; border-bottom: 1px solid #334155; display: flex; justify-content: space-between; align-items: center;">
                    <div>
                        <h3 style="color: #10b981; margin: 0; font-size: 18px;">📥 Обновление</h3>
                        <div style="color: #94a3b8; font-size: 11px; margin-top: 4px;">Обновление существующих тарифов из Excel</div>
                    </div>
                    <div style="display: flex; gap: 8px;">
                        <button id="sidebar-update-config-minimize" style="background: none; border: none; color: #94a3b8; font-size: 22px; cursor: pointer; padding: 0; line-height: 1;"></button>
                        <button id="sidebar-update-config-close" style="background: none; border: none; color: #94a3b8; font-size: 22px; cursor: pointer; padding: 0; line-height: 1;">×</button>
                    </div>
                </div>

                <div style="padding: 16px; flex: 1; display: flex; flex-direction: column; min-height: 0;">
                    
                    <div id="sidebar-update-config-status" style="margin-bottom: 12px; background: #0f172a; padding: 12px; border-radius: 8px; border-left: 3px solid #10b981;">
                        <div style="color: #10b981; font-size: 13px; font-weight: 500;" id="sidebar-update-config-status-title">📋 Загрузите данные</div>
                        <div style="color: #94a3b8; font-size: 11px; margin-top: 6px;" id="sidebar-update-config-status-detail">Выберите файл и нужные блоки</div>
                    </div>

                    <div style="margin-bottom: 12px; position: relative; background: #334155; border: 2px dashed #64748b; border-radius: 8px; padding: 14px 16px; text-align: center; transition: all 0.2s ease;">
                         <input type="file" id="excel-file-input-config" accept=".xls,.xlsx,.xlsm" style="position: absolute; top: 0; left: 0; width: 100%; height: 100%; opacity: 0; cursor: pointer; z-index: 10;" 
                         onmouseover="this.parentElement.style.borderColor='#10b981'; this.parentElement.style.background='#475569';" 
                        onmouseout="this.parentElement.style.borderColor='#64748b'; this.parentElement.style.background='#334155';">
                      <div style="font-size: 22px; margin-bottom: 4px; pointer-events: none; opacity: 0.9;">📄</div>
                      <div style="color: #f8fafc; font-size: 13px; font-weight: 500; margin-bottom: 4px; pointer-events: none;">1. Выберите файл Excel</div>
                      <div id="sidebar-update-file-status" style="font-size: 11px; color: #cbd5e1; pointer-events: none;">Нажмите и выберите файл (.xls, .xlsx)</div>
                    </div>

                    <div style="margin-bottom: 12px; background: #0f172a; padding: 12px; border-radius: 8px; border: 1px solid #334155;">
                        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
                            <div style="color: #cbd5e1; font-size: 12px;">🧩 Блоки для обновления:</div>
                            <button id="sidebar-update-config-import-all" style="background: none; border: none; color: #10b981; font-size: 11px; cursor: pointer; padding: 0;">Выбрать все</button>
                        </div>
                        <div id="sidebar-update-import-blocks" style="display: grid; grid-template-columns: 1fr 1fr; gap: 6px;">
                            ${this.renderImportBlockCheckboxes()}
                        </div>
                    </div>

                    <div style="display: flex; justify-content: space-between; margin-bottom: 4px; align-items: center;">
                        <div style="color: #94a3b8; font-size: 12px;">Логи подготовки:</div>
                        <button id="sidebar-update-clear-log-config" style="background: none; border: none; color: #ef4444; font-size: 11px; cursor: pointer; padding: 0;">🗑️ Очистить</button>
                    </div>
                    <div id="sidebar-update-config-log" style="flex: 1; min-height: 70px; background: #0f172a; border-radius: 8px; padding: 10px; overflow-y: auto; font-size: 11px; font-family: monospace; margin-bottom: 12px; border: 1px solid #334155;"></div>

                    <div style="display: flex; gap: 8px;">
                        <button id="sidebar-update-config-start" disabled style="width: 100%; padding: 12px; background: #475569; color: #94a3b8; border: none; border-radius: 6px; cursor: not-allowed; font-weight: bold; font-size: 14px; transition: 0.2s;">🚀 2. Начать обновление</button>
                        <button id="sidebar-update-config-stop" style="flex: 1; padding: 12px; background: #dc2626; color: white; border: none; border-radius: 6px; cursor: pointer; font-weight: bold; font-size: 14px; display: none;">⏹️ Остановить</button>
                    </div>
                </div>
            `;

            document.body.appendChild(this.sidebar);

            document.getElementById('sidebar-update-config-close').onclick = () => this.hideSidebar();
            document.getElementById('sidebar-update-config-minimize').onclick = () => this.minimizeSidebar();
            document.getElementById('sidebar-update-config-start').onclick = () => this.startImport();
            document.getElementById('sidebar-update-config-stop').onclick = () => this.stopImport();
            document.getElementById('sidebar-update-config-import-all').onclick = () => this.selectAllBlocks(); // <--- ИСПРАВЛЕННАЯ ПРИВЯЗКА
            document.getElementById('excel-file-input-config').onchange = (e) => this.loadExcelFile(e.target.files[0]);
            
            document.getElementById('sidebar-update-clear-log-config').onclick = () => {
                this.logEntries = [];
                this.saveLogToStorage();
                this.renderConfigLog();
            };

            this.bindImportBlockCheckboxes();
            this.loadSavedConfig();
            this.updateButtonsForImportState();
        }

        createSidebar() {
            if (this.isFromTariffManager()) return;
            if (this.sidebar && this.sidebar.id === 'tariff-update-sidebar') return;
            if (window.TariffToolsCore && typeof window.TariffToolsCore.closeAllSidebars === 'function') {
                window.TariffToolsCore.closeAllSidebars();
            }
            if (this.sidebar) this.sidebar.remove();
            
            this.sidebar = document.createElement('div');
            this.sidebar.id = 'tariff-update-sidebar';
            this.sidebar.style.cssText = `
                position: fixed; top: 0; right: 0; width: 420px; height: 100vh;
                background: #1e293b; box-shadow: -2px 0 20px rgba(0,0,0,0.3); z-index: 1000001;
                display: flex; flex-direction: column; font-family: 'Segoe UI', Arial, sans-serif;
                border-left: 1px solid #334155; transition: transform 0.3s ease;
            `;
            
            this.sidebar.innerHTML = `
                <div style="padding: 16px 20px; background: #0f172a; border-bottom: 1px solid #334155; display: flex; justify-content: space-between; align-items: center;">
                    <div>
                        <h3 style="color: #10b981; margin: 0; font-size: 18px;">⏳ Идёт обновление...</h3>
                        <div style="color: #94a3b8; font-size: 11px; margin-top: 4px;">Массовое обновление тарифов из Excel</div>
                    </div>
                    <div style="display: flex; gap: 8px;">
                        <button id="sidebar-update-minimize" style="background: none; border: none; color: #94a3b8; font-size: 22px; cursor: pointer; padding: 0; line-height: 1;"></button>
                        <button id="sidebar-update-close" style="background: none; border: none; color: #94a3b8; font-size: 22px; cursor: pointer; padding: 0; line-height: 1;">×</button>
                    </div>
                </div>
                
                <div style="padding: 16px; flex: 1; display: flex; flex-direction: column; min-height: 0;">
                    
                    <div style="margin-bottom: 12px;">
                        <div style="display: flex; justify-content: space-between; margin-bottom: 6px; color: #94a3b8; font-size: 13px;">
                            <span>Прогресс</span>
                            <span id="sidebar-update-progress-text">0 / 0</span>
                        </div>
                        <div style="height: 8px; background: #334155; border-radius: 4px; overflow: hidden;">
                            <div id="sidebar-update-progress-fill" style="width: 0%; height: 100%; background: linear-gradient(90deg, #10b981, #34d399);"></div>
                        </div>
                    </div>

                    <div id="sidebar-update-status" style="margin-bottom: 16px; background: #0f172a; padding: 12px; border-radius: 8px; border-left: 3px solid #10b981;">
                        <div style="color: #10b981; font-size: 13px; font-weight: 500;" id="sidebar-update-status-title">⏳ Подготовка</div>
                        <div style="color: #94a3b8; font-size: 11px; margin-top: 6px;" id="sidebar-update-status-detail">Ожидание перехода на форму...</div>
                    </div>
                    
                    <div style="display: flex; justify-content: space-between; margin-bottom: 6px; align-items: center;">
                        <div style="color: #94a3b8; font-size: 12px;">Логи:</div>
                        <button id="sidebar-update-clear-log" style="background: none; border: none; color: #ef4444; font-size: 11px; cursor: pointer; padding: 0;">🗑️ Очистить</button>
                    </div>
                    <div id="sidebar-update-log" style="flex: 1; background: #0f172a; border-radius: 8px; padding: 12px; overflow-y: auto; font-size: 12px; font-family: monospace; margin-bottom: 16px; border: 1px solid #334155;"></div>
                    
                    <div style="padding-top: 16px; border-top: 1px solid #334155;">
                        <button id="sidebar-update-stop-btn" style="width: 100%; padding: 10px; background: #dc2626; color: white; border: none; border-radius: 6px; cursor: pointer; font-weight: bold;">⏹️ Остановить</button>
                    </div>
                </div>
            `;
            
            document.body.appendChild(this.sidebar);
            document.getElementById('sidebar-update-close').onclick = () => this.hideSidebar();
            document.getElementById('sidebar-update-minimize').onclick = () => this.minimizeSidebar();
            document.getElementById('sidebar-update-stop-btn').onclick = () => this.stopImport();
            
            document.getElementById('sidebar-update-clear-log').onclick = () => {
                this.logEntries = [];
                this.saveLogToStorage();
                this.renderLog();
            };
        }

        // <--- НОВЫЙ ЧИСТЫЙ МЕТОД ВЫБОРА ВСЕХ БЛОКОВ
        selectAllBlocks() {
            this.getImportBlockDefinitions().forEach(block => {
                const checkbox = document.getElementById(this.getImportBlockCheckboxId(block.key));
                if (checkbox) checkbox.checked = true;
            });
            this.saveConfig(false); 
            this.addSidebarLog('📦 Выбраны все блоки', 'info');
        }
        
        loadSavedConfig() {
            const savedConfig = localStorage.getItem('tariff_update_config');
            if (savedConfig) {
                this.config = this.normalizeConfig(JSON.parse(savedConfig));
            } else {
                this.config = this.normalizeConfig(this.config);
            }

            this.getImportBlockDefinitions().forEach(block => {
                const checkbox = document.getElementById(this.getImportBlockCheckboxId(block.key));
                if (checkbox) checkbox.checked = this.isImportBlockEnabled(block.key);
            });
        }

        saveConfig(showLog = true) {
            const nextImportBlocks = { ...this.getDefaultImportBlocks() };
            this.getImportBlockDefinitions().forEach(block => {
                const el = document.getElementById(this.getImportBlockCheckboxId(block.key));
                if (el) nextImportBlocks[block.key] = !!el.checked;
                else nextImportBlocks[block.key] = this.isImportBlockEnabled(block.key);
            });

            this.config = this.normalizeConfig({
                ...this.config,
                importBlocks: nextImportBlocks
            });
            localStorage.setItem('tariff_update_config', JSON.stringify(this.config));
            if (showLog) this.addSidebarLog('✅ Настройки сохранены', 'success');
        }
        
        async loadExcelFile(file) {
            if (!file) return;
            
            if (typeof XLSX === 'undefined') {
                this.addSidebarLog('⏳ Библиотека Excel загружается...', 'info');
                let attempts = 0;
                const wait = setInterval(() => {
                    attempts++;
                    if (typeof XLSX !== 'undefined') {
                        clearInterval(wait);
                        this.processExcelFile(file);
                    } else if (attempts > 20) {
                        clearInterval(wait);
                        this.addSidebarLog('❌ Библиотека Excel не загрузилась', 'error');
                    }
                }, 500);
                return;
            }
            this.processExcelFile(file);
        }
        
        parseExcelDateString(val) {
            if (!val) return '';
            if (typeof val === 'number') {
                const date = new Date(Math.round((val - 25569) * 86400 * 1000));
                return date.toISOString().split('T')[0]; 
            }
            let s = String(val).trim();
            if (s.includes('.')) {
                s = s.split('.').reverse().join('-'); 
            }
            return s;
        }

        processExcelFile(file) {
            this.addSidebarLog(`📁 Загрузка: ${file.name}`, 'info');
            
            const reader = new FileReader();
            reader.onload = (e) => {
                try {
                    const data = new Uint8Array(e.target.result);
                    const workbook = XLSX.read(data, { type: 'array' });
                    const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
                    const rows = XLSX.utils.sheet_to_json(firstSheet, { header: 1, defval: '' });
                    
                    this.parseTariffs(rows);
                    this.saveConfig(false);
                    
                    this.addSidebarLog(`✅ Загружено ${this.tariffsToCreate.length} тарифов`, 'success');
                    this.updateButtonsForImportState();
                } catch (error) {
                    this.addSidebarLog(`❌ Ошибка: ${error.message}`, 'error');
                }
            };
            reader.readAsArrayBuffer(file);
        }
        
        parseTariffs(rows) {
            this.tariffsToCreate = [];
            if (rows.length === 0) return;

            const parseBool = (value) => {
                const text = String(value ?? '').replace(/ /g, ' ').trim().toLowerCase();
                return text === 'да' || text === 'true' || text === '1' || text === 'yes';
            };

            const normalizeCell = (value) => {
                const text = String(value ?? '').replace(/ /g, ' ').trim();
                return text && text !== '-' && text !== '—' ? text : '';
            };

            const headerRow = (rows[0] || []).map(value => String(value ?? '').replace(/ /g, ' ').trim());
            const headerIndex = new Map(headerRow.map((header, index) => [header, index]));
            const getCell = (row, header, fallbackIndex = -1) => {
                const index = headerIndex.has(header) ? headerIndex.get(header) : fallbackIndex;
                return index >= 0 ? row[index] : '';
            };

            const parseIntervals = (value) => {
                const raw = String(value ?? '').trim();
                if (!raw || raw === '-' || raw === '—') return [];
                return raw.split(';').map(item => item.trim()).filter(Boolean).map(item => {
                    const match = item.match(/^(\d{2}:\d{2})(?::\d{2})?-(\d{2}:\d{2})(?::\d{2})?\s*\(до\s*(\d{2}:\d{2})(?::\d{2})?,\s*вн:\s*([^,]+),\s*кл:\s*([^\)]+)\)$/i);
                    if (!match) return null;
                    return {
                        startTime: match[1], endTime: match[2], orderBefore: match[3],
                        internalPriceAdjustment: normalizeCell(match[4]), priceAdjustment: normalizeCell(match[5])
                    };
                }).filter(Boolean);
            };

            for (let i = 1; i < rows.length; i++) {
                const row = rows[i];
                if (!row || row.length < 3) continue;

                const tariffName = normalizeCell(getCell(row, 'Название тарифа', 0));
                if (!tariffName) continue;

                const zonesValue = getCell(row, 'Зоны доставки', 1);
                const branchesValue = getCell(row, 'Филиалы', 2);

                const zones = normalizeCell(zonesValue) ? String(zonesValue).split(';').map(z => z.trim()).filter(Boolean) : [];
                const branches = normalizeCell(branchesValue) ? String(branchesValue).split(';').map(b => b.trim()).filter(Boolean) : [];
                const intervals = parseIntervals(getCell(row, 'Интервалы доставки', 3));
                const elevatorPrice = {
                    internalPrice: normalizeCell(getCell(row, 'Подъем на лифте внутренняя, руб', 4)),
                    customerPrice: normalizeCell(getCell(row, 'Подъем на лифте клиент, руб', 5))
                };

                const mgxRow = {
                    weight: normalizeCell(getCell(row, 'Макс. вес (МГХ), кг', 6)),
                    internal: normalizeCell(getCell(row, 'Цена внутренняя, руб', 7)),
                    customer: normalizeCell(getCell(row, 'Цена покупателя, руб', 8)),
                    return: normalizeCell(getCell(row, 'Цена возврата, руб', 9))
                };

                const floorRow = {
                    weight: normalizeCell(getCell(row, 'Макс. вес (подъем), кг', 10)),
                    internalPrice: normalizeCell(getCell(row, 'Стоимость внутренняя за 1 этаж, руб', 11)),
                    internalThreshold: normalizeCell(getCell(row, 'Начиная с этажа (внутр.)', 12)),
                    customerPrice: normalizeCell(getCell(row, 'Стоимость для клиента за 1 этаж, руб', 13)),
                    customerThreshold: normalizeCell(getCell(row, 'Начиная с этажа (клиент)', 14))
                };

                const paymentCard = parseBool(getCell(row, 'Оплата картой', 15));
                const paymentCash = parseBool(getCell(row, 'Оплата наличными', 16));
                const acceptanceSameDay = parseBool(getCell(row, 'В день оформления', 17));
                const acceptanceNextDay = parseBool(getCell(row, 'На следующий день', 18));
                const saleProduct = parseBool(getCell(row, 'Исправный товар', 19));
                const saleMarkdown = parseBool(getCell(row, 'Уцененный товар', 20));
                const saleLegal = parseBool(getCell(row, 'Юридические лица', 21));
                const saleService = parseBool(getCell(row, 'Сервисный центр', 22));

                const deliveryDays = normalizeCell(getCell(row, 'Количество дней доставки', -1));
                const cutoffTime = normalizeCell(getCell(row, 'Отсечка оформления заказа', -1));
                const maxOrderCost = normalizeCell(getCell(row, 'Лимит стоимости заказа, руб', -1)) || normalizeCell(getCell(row, 'Лимит стоимости', -1)) || normalizeCell(getCell(row, 'Ограничение максимальной стоимости заказа', -1));
                const rawStartDate = getCell(row, 'Дата начала', -1);
                const rawEndDate = getCell(row, 'Дата окончания', -1) || getCell(row, 'С конечной датой', -1);
                
                const startDate = this.parseExcelDateString(rawStartDate);
                const endDate = this.parseExcelDateString(rawEndDate);

                let tariff = this.tariffsToCreate.find(t => t.name === tariffName);

                if (!tariff) {
                    tariff = {
                        name: tariffName,
                        zones,
                        branches,
                        intervals,
                        elevatorPrice,
                        mgxRows: [],
                        floorRows: [],
                        payment: { card: paymentCard, cash: paymentCash },
                        acceptance: { sameDay: acceptanceSameDay, nextDay: acceptanceNextDay },
                        saleTypes: { product: saleProduct, markdown: saleMarkdown, legal: saleLegal, service: saleService }
                    };
                    
                    if (deliveryDays) tariff.deliveryDays = deliveryDays;
                    if (cutoffTime) tariff.cutoffTime = cutoffTime;
                    if (maxOrderCost) tariff.maxOrderCost = maxOrderCost;
                    if (startDate) tariff.startDate = startDate;
                    if (endDate) tariff.endDate = endDate;

                    this.tariffsToCreate.push(tariff);
                }

                if ((!tariff.intervals || tariff.intervals.length === 0) && intervals.length > 0) {
                    tariff.intervals = intervals;
                }
                if ((!tariff.elevatorPrice?.internalPrice && !tariff.elevatorPrice?.customerPrice) &&
                    (elevatorPrice.internalPrice || elevatorPrice.customerPrice)) {
                    tariff.elevatorPrice = elevatorPrice;
                }

                if (mgxRow.weight) tariff.mgxRows.push(mgxRow);
                if (floorRow.weight) tariff.floorRows.push(floorRow);
            }
        }
        
        async startImport() {
            this.saveConfig();
            if (this.tariffsToCreate.length === 0) {
                this.addSidebarLog('❌ Нет данных для импорта', 'error');
                return;
            }

            this.clearManualStopFlag();
            this.shouldStop = false;
            this.isImporting = true;
            this.currentIndex = 0;
            this.importStarted = false;
            this.updateButtonsForImportState();

            this.addSidebarLog(`🚀 Запуск импорта: ${this.tariffsToCreate.length} тарифов`, 'info');

            localStorage.setItem('tariff_update_data', JSON.stringify({
                tariffs: this.tariffsToCreate,
                config: this.normalizeConfig(this.config),
                shouldStart: true,
                stoppedByUser: false,
                currentIndex: 0
            }));

            this.saveStateToStorage();
            
            this.createSidebar();
            this.showSidebar();
            this.updateSidebarDisplay();

            const firstTariff = this.tariffsToCreate[0];
            if (!firstTariff) return;

            this.openTariffForUpdate(firstTariff.name);
            this.addSidebarLog(`🔎 Ищем тариф: ${firstTariff.name}`, 'info');
        }

        handleImportData(dataStr) {
            if (!dataStr) return;
            const data = JSON.parse(dataStr);
            this.tariffsToCreate = data.tariffs || [];
            this.config = this.normalizeConfig(data.config || this.config);
            this.currentIndex = data.currentIndex || 0;
        }
        
        async startImportOnPage() {
            if (!this.ensureCanContinue('до старта обработки страницы')) return;
            if (this.tariffsToCreate.length === 0) return;
            if (this.currentIndex >= this.tariffsToCreate.length) {
                this.finishImport();
                return;
            }

            this.isImporting = true;
            this.shouldStop = false;

            this.createSidebar();
            this.showSidebar();

            const tariff = this.tariffsToCreate[this.currentIndex];

            this.addSidebarLog(`📝 ${tariff.name} (${this.currentIndex + 1}/${this.tariffsToCreate.length})`, 'info');
            this.updateSidebarStatus('🔄 Импорт', `Обновляем: ${tariff.name}`);
            this.updateSidebarDisplay();
            this.saveStateToStorage();

            const success = await this.createTariff(tariff);
            if (!this.ensureCanContinue(`после обработки тарифа ${tariff.name}`)) return;

            if (success) {
                this.addSidebarLog(`✅ Успешно: ${tariff.name}`, 'success');
                this.currentIndex++;
                this.saveStateToStorage();

                if (this.currentIndex < this.tariffsToCreate.length) {
                    localStorage.setItem('tariff_update_data', JSON.stringify({
                        tariffs: this.tariffsToCreate,
                        config: this.normalizeConfig(this.config),
                        shouldStart: true,
                        stoppedByUser: false,
                        currentIndex: this.currentIndex
                    }));

                    this.saveStateToStorage();
                    if (!this.ensureCanContinue('перед переходом на страницу списка')) return;

                    setTimeout(() => {
                        if (!this.ensureCanContinue('перед сменой страницы')) return;
                        const baseUrl = window.location.origin + window.location.pathname.replace(/\/[^\/]+$/, '');
                        window.location.href = baseUrl;
                    }, 1000);
                    return;
                } else {
                    this.finishImport();
                    this.addSidebarLog('↩️ Завершено! Возвращаемся к списку...', 'info');
                    await this.delay(2000);
                    const baseUrl = window.location.origin + window.location.pathname.replace(/\/[^\/]+$/, '');
                    window.location.href = baseUrl;
                }
            } else {
                this.addSidebarLog(`❌ Ошибка сохранения: ${tariff.name}`, 'error');
                this.finishImport();
            }
        }
        
        finishImport() {
            this.isImporting = false;
            this.shouldStop = true;
            this.clearManualStopFlag();
            if (this.formCheckInterval) {
                clearInterval(this.formCheckInterval);
                this.formCheckInterval = null;
            }
            this.addSidebarLog('✨ Все тарифы обновлены!', 'success');

            localStorage.removeItem('tariff_update_data');
            localStorage.removeItem('tariff_update_state');
            this.importStarted = false;
            this.currentIndex = 0;
            this.tariffsToCreate = [];
            
            this.updateSidebarDisplay();
        }
        
        findTariffNameInput(root = document) {
            return root.querySelector('input[placeholder*="Введите название тарифа"]')
                || root.querySelector('input[placeholder*="название тарифа"]')
                || root.querySelector('input[placeholder*="Название тарифа"]')
                || root.querySelector('input[name="name"]')
                || root.querySelector('input[test-id*="tariff-name"]')
                || root.querySelector('input[test-id*="name"]');
        }

        findMainSaveButton(root = document, requireEnabled = false) {
            const allButtons = Array.from(root.querySelectorAll('button, [role="button"], input[type="submit"]'));
            for (const btn of allButtons) {
                if (btn.closest('#tariff-export-pro-sidebar, #tariff-manager-modal, #af-tariff-panel')) continue;
                if (btn.closest('dialog[open], [role="dialog"], [aria-modal="true"]')) continue;

                const text = (btn.textContent || btn.value || '').replace(/\s+/g, ' ').trim().toLowerCase();
                const isSave = text === 'сохранить' ||
                               text.startsWith('сохранить ') ||
                               text.endsWith(' сохранить') ||
                               text.includes('сохранить тариф') ||
                               text.includes('сохранить изменения') ||
                               btn.getAttribute('data-action') === 'save' ||
                               btn.getAttribute('test-id') === 'save-button';

                if (isSave) {
                    if (!requireEnabled || !btn.disabled) {
                        return btn;
                    }
                }
            }
            return null;
        }

        findTariffEditButtonOnPage() {
            // Если на странице уже доступно поле ввода названия тарифа,
            // страница УЖЕ находится в режиме редактирования — никаких кнопок нажимать не нужно!
            if (this.findTariffNameInput()) {
                return null;
            }

            // Список запрещенных ключевых слов разделов:
            // Карандаши внутри этих секций открывают внутренние модальные окна настроек секций,
            // и НИ В КОЕМ СЛУЧАЕ не должны нажиматься для перехода страницы тарифа в режим редактирования!
            const blockedSectionKeywords = [
                'зоны', 'зона', 'филиал', 'мгх', 'сетка', 'интервал',
                'подъем', 'этаж', 'лифт', 'лестниц', 'оплат', 'прием',
                'виды продажи', 'вид продажи', 'параметр', 'лимит', 'срок'
            ];

            const isSectionElement = (el) => {
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

            // 1. Поиск кнопок с текстом "Редактировать" или "Изменить" (строго вне секций)
            const buttons = Array.from(document.querySelectorAll('button, a[role="button"], div[role="button"]'));
            for (const btn of buttons) {
                if (isSectionElement(btn)) continue;
                const text = (btn.textContent || '').trim();
                const title = (btn.title || btn.getAttribute('aria-label') || '').trim();
                if (/^(редактировать|изменить)$/i.test(text) || /^(редактировать|изменить)/i.test(title)) {
                    return btn;
                }
            }

            // 2. Карточка тарифа (для списочного режима)
            const card = document.querySelector('.css-nr5n4g, .e1wi2kqa9, .css-15ttl8p');
            if (card) {
                const cardBtn = this.findEditButtonInTariffCard(card);
                if (cardBtn && !isSectionElement(cardBtn)) return cardBtn;
            }

            // 3. Карандашик в главном заголовке тарифа (header / title-wrap)
            const headerContainer = document.querySelector('header, [class*="header"], [class*="title-wrap"], h1, h2');
            if (headerContainer && !isSectionElement(headerContainer)) {
                const headerPencil = headerContainer.querySelector('.icomoon-icon__pencil, span[class*="pencil"], [class*="pencil"]');
                if (headerPencil) {
                    const btn = headerPencil.closest('button, a, div[role="button"]') || headerPencil;
                    if (!isSectionElement(btn)) return btn;
                }
            }

            return null;
        }

        async waitForCreateFormReady(tariffName = '') {
            let nameInput = null;

            // Форма готова к редактированию сразу, как только появилось поле названия (не требуем включенную кнопку Сохранить до внесения правок!)
            for (let attempt = 1; attempt <= 25; attempt++) {
                nameInput = this.findTariffNameInput();

                if (nameInput) {
                    return {
                        nameInput,
                        saveButton: this.findMainSaveButton(document, false)
                    };
                }

                // Если поле названия не появилось после 1.5 сек (10 попыток), проверяем кнопку "Редактировать"
                if (attempt === 10 || attempt === 20) {
                    const editBtn = this.findTariffEditButtonOnPage();
                    if (editBtn) {
                        this.debugLog('[TariffUpdater] Нажатие кнопки перехода в режим редактирования:', editBtn);
                        editBtn.click();
                    }
                }

                await this.delay(150);
            }

            return {
                nameInput: this.findTariffNameInput(),
                saveButton: this.findMainSaveButton(document, false)
            };
        }

        async createTariff(tariff) {
            this.lastCreateFailure = null;
            window.currentTariff = tariff;

            this.prepareForCreatorRun();
            if (!this.ensureCanContinue(`перед стартом тарифа ${tariff.name}`)) return false;

            const readyState = await this.waitForCreateFormReady(tariff.name);
            if (!readyState.nameInput) return this.setCreateFailure('name_input_not_found_before_blocks', { tariffName: tariff.name });

            const blockHandlers = [
                {
                    key: 'zones', label: 'Зоны доставки',
                    run: async () => {
                        this.addSidebarLog(`🧩 Зоны доставки`, 'info');
                        const success = await this.openAndSelectZones(tariff.zones);
                        if (!success) this.addSidebarLog(`⚠️ Ошибка выбора зон для ${tariff.name}`, 'warning');
                    }
                },
                {
                    key: 'branches', label: 'Филиалы обслуживания',
                    run: async () => {
                        this.addSidebarLog(`🧩 Филиалы обслуживания`, 'info');
                        const success = await this.openAndSelectBranches(tariff.branches);
                        if (!success) this.addSidebarLog(`⚠️ Ошибка выбора филиалов для ${tariff.name}`, 'warning');
                    }
                },
                {
                    key: 'mgx', label: 'МГХ сетка',
                    run: async () => {
                        this.addSidebarLog(`🧩 МГХ сетка`, 'info');
                        const success = await this.fillMgxGridWithValues(tariff.mgxRows);
                        if (!success) this.addSidebarLog(`⚠️ Ошибка заполнения МГХ сетки для ${tariff.name}`, 'warning');
                    }
                },
                {
                    key: 'intervals', label: 'Интервалы доставки',
                    run: async () => {
                        this.addSidebarLog(`🧩 Интервалы доставки`, 'info');
                        const success = await this.openAndSetupIntervals(tariff.intervals);
                        if (!success) this.addSidebarLog(`⚠️ Ошибка настройки интервалов для ${tariff.name}`, 'warning');
                    }
                },
                {
                    key: 'deliveryParams', label: 'Параметры доставки',
                    run: async () => {
                        this.addSidebarLog(`🧩 Параметры доставки`, 'info');
                        const success = await this.setupDeliveryParams(tariff);
                        if (!success) this.addSidebarLog(`⚠️ Ошибка параметров доставки`, 'warning');
                    }
                },
                {
                    key: 'costLimit', label: 'Лимит стоимости',
                    run: async () => {
                        this.addSidebarLog(`🧩 Лимит стоимости`, 'info');
                        const success = await this.setupCostLimit(tariff);
                        if (!success) this.addSidebarLog(`⚠️ Ошибка лимита стоимости`, 'warning');
                    }
                },
                {
                    key: 'validityDates', label: 'Даты действия',
                    run: async () => {
                        this.addSidebarLog(`🧩 Даты действия тарифа`, 'info');
                        const success = await this.setupValidityDates(tariff);
                        if (!success) this.addSidebarLog(`⚠️ Ошибка дат действия`, 'warning');
                    }
                },
                {
                    key: 'floor', label: 'Подъем на этаж',
                    run: async () => {
                        this.addSidebarLog(`🧩 Подъем на этаж`, 'info');
                        const success = await this.openAndSetupFloorLifting(tariff);
                        if (!success) this.addSidebarLog(`⚠️ Ошибка настройки подъема на этаж для ${tariff.name}`, 'warning');
                    }
                },
                {
                    key: 'payment', label: 'Способ оплаты при получении',
                    run: async () => {
                        this.addSidebarLog(`🧩 Способ оплаты`, 'info');
                        const success = await this.setupPayment(tariff);
                        if (!success) this.addSidebarLog(`⚠️ Ошибка настройки оплаты для ${tariff.name}`, 'warning');
                    }
                },
                {
                    key: 'acceptance', label: 'Прием заявок',
                    run: async () => {
                        this.addSidebarLog(`🧩 Прием заявок`, 'info');
                        const success = await this.setupAcceptance(tariff);
                        if (!success) this.addSidebarLog(`⚠️ Ошибка настройки приема заявок для ${tariff.name}`, 'warning');
                    }
                },
                {
                    key: 'saleTypes', label: 'Допустимый к оформлению вид продажи',
                    run: async () => {
                        this.addSidebarLog(`🧩 Вид продажи`, 'info');
                        const success = await this.setupSaleTypes(tariff);
                        if (!success) this.addSidebarLog(`⚠️ Ошибка настройки видов продажи для ${tariff.name}`, 'warning');
                    }
                }
            ];

            const enabledBlocks = blockHandlers.filter(b => this.shouldImportBlock(tariff, b.key, b.label));
            this.addSidebarLog(`⚙️ Применяются блоки: ${enabledBlocks.map(b => b.label).join(', ') || 'нет'}`, 'info');

            for (const block of blockHandlers) {
                if (!this.ensureCanContinue(`перед блоком ${block.label}`)) return false;
                if (!this.shouldImportBlock(tariff, block.key, block.label)) continue;
                await block.run();
                if (!this.ensureCanContinue(`после блока ${block.label}`)) return false;
                await this.delay(500);
            }

            if (!this.ensureCanContinue(`перед заполнением названия тарифа ${tariff.name}`)) return false;

            if (tariff.hasNameChange || (tariff.name && tariff.originalName && tariff.name !== tariff.originalName)) {
                let nameInput = null;
                let attempts = 0;
                while (!nameInput && attempts < 20) {
                    if (!this.ensureCanContinue(`во время поиска поля названия для ${tariff.name}`)) return false;
                    nameInput = document.querySelector('input[placeholder*="Введите название тарифа"]');
                    if (!nameInput) {
                        await this.delay(300);
                        attempts++;
                    }
                }
                if (nameInput) {
                    this.setInputValue(nameInput, tariff.name);
                    nameInput.blur();
                    await this.delay(300);
                }
            }

            if (!this.ensureCanContinue(`перед сохранением тарифа ${tariff.name}`)) return false;

            let saveButton = null;
            let saveAttempts = 0;
            this.addSidebarLog('🔍 Поиск и ожидание кнопки «Сохранить»...', 'info');
            while (!saveButton && saveAttempts < 35) {
                if (!this.ensureCanContinue(`во время ожидания кнопки сохранения для ${tariff.name}`)) return false;

                // Убеждаемся, что диалоги закрыты перед поиском главной кнопки сохранения
                const openDialog = document.querySelector('dialog[open], [role="dialog"][open]');
                if (!openDialog) {
                    const allButtons = Array.from(document.querySelectorAll('button, [role="button"], input[type="submit"], input[type="button"]'));
                    for (const btn of allButtons) {
                        if (btn.closest('#tariff-export-pro-sidebar, #tariff-manager-modal, #af-tariff-panel')) continue;
                        if (btn.closest('dialog[open], [role="dialog"], [aria-modal="true"]')) continue;

                        const text = (btn.textContent || btn.value || '').replace(/\s+/g, ' ').trim().toLowerCase();
                        const isSave = text === 'сохранить' ||
                                       text.startsWith('сохранить ') ||
                                       text.endsWith(' сохранить') ||
                                       text.includes('сохранить тариф') ||
                                       text.includes('сохранить изменения') ||
                                       btn.getAttribute('data-action') === 'save' ||
                                       btn.getAttribute('test-id') === 'save-button';

                        if (isSave && !btn.disabled) {
                            saveButton = btn;
                            break;
                        }
                    }
                } else {
                    // Если еще открыт диалог, нажимаем сохранить в диалоге
                    const dlgSave = Array.from(openDialog.querySelectorAll('button, [role="button"]')).find(b => {
                        const t = (b.textContent || b.value || '').replace(/\s+/g, ' ').trim().toLowerCase();
                        return (t.includes('сохранить') || b.getAttribute('data-action') === 'save') && !b.disabled;
                    });
                    if (dlgSave) {
                        this.addSidebarLog('💾 Нажимаем сохранить во внутреннем диалоге...', 'info');
                        dlgSave.click();
                        await this.delay(600);
                    }
                }

                if (!saveButton) {
                    await this.delay(350);
                    saveAttempts++;
                }
            }

            if (!saveButton) {
                this.addSidebarLog(`❌ Кнопка «Сохранить» не найдена или отключена (disabled) после ${saveAttempts} попыток`, 'error');
                return this.setCreateFailure('save_button_not_found', { tariffName: tariff.name });
            }

            if (!this.ensureCanContinue(`непосредственно перед кликом по кнопке сохранения для ${tariff.name}`)) return false;
            this.addSidebarLog('💾 Нажимаем главную кнопку «Сохранить» формы тарифа...', 'info');
            saveButton.click();
            await this.delay(3000);
            if (this.stopRequested()) return false;
            this.addSidebarLog('🎉 Форма тарифа успешно сохранена на сайте!', 'success');
            return true;
        }

        async setupDeliveryParams(tariff) {
            let updated = false;
            if (tariff.deliveryDays !== undefined) {
                const daysInput = document.querySelector('input[placeholder*="Количество дней доставки"]');
                if (daysInput) {
                    this.setInputValue(daysInput, tariff.deliveryDays);
                    updated = true;
                }
            }
            if (tariff.cutoffTime !== undefined) {
                const cutoffInput = document.querySelector('input[placeholder*="Отсечка оформления заказа"]');
                if (cutoffInput) {
                    this.setInputValue(cutoffInput, tariff.cutoffTime);
                    updated = true;
                }
            }
            if (updated) await this.delay(500);
            return true;
        }

        async setupCostLimit(tariff) {
            if (tariff.maxOrderCost !== undefined) {
                const costInput = document.querySelector('input[placeholder*="Стоимость заказа"]');
                if (costInput) {
                    this.setInputValue(costInput, tariff.maxOrderCost);
                    await this.delay(500);
                }
            }
            return true;
        }

        async setupValidityDates(tariff) {
            let updated = false;
            const dateInputs = document.querySelectorAll('input[type="date"]');
            
            if (tariff.startDate && dateInputs[0]) {
                this.setInputValue(dateInputs[0], tariff.startDate);
                updated = true;
            }

            const timeInputs = document.querySelectorAll('input[type="time"], input[placeholder*="чч:мм"], input[placeholder*="00:00"]');
            if (tariff.startTime && timeInputs[0]) {
                this.setInputValue(timeInputs[0], tariff.startTime);
                updated = true;
            }

            const endDateCheckbox = this.findCheckboxByText(document.body, 'С конечной датой');
            if (endDateCheckbox) {
                const shouldHaveEnd = !!tariff.endDate;
                
                if (endDateCheckbox.checked !== shouldHaveEnd) {
                    endDateCheckbox.click();
                    await this.delay(300);
                }

                if (shouldHaveEnd) {
                    const newDateInputs = document.querySelectorAll('input[type="date"]');
                    if (newDateInputs[1]) {
                        this.setInputValue(newDateInputs[1], tariff.endDate);
                        updated = true;
                    }
                }
            }
            if (updated) await this.delay(500);
            return true;
        }

        async fillMgxGridWithValues(mgxRows) {
            let pencilIcon = null;
            const allElements = document.querySelectorAll('div, span, label, p');
            for (const el of allElements) {
                if (el.textContent.trim() === 'МГХ сетка') {
                    const container = el.closest('div');
                    if (container) {
                        pencilIcon = container.querySelector('span[class*="pencil"], .icomoon-icon__pencil');
                        if (pencilIcon) break;
                    }
                }
            }
            
            if (!pencilIcon) {
                const titleEl = Array.from(document.querySelectorAll('span, div, label, p, h1, h2, h3, h4')).find(el => el.textContent.trim() === 'МГХ сетка');
                pencilIcon = titleEl?.parentElement?.querySelector('span[class*="pencil"], .icomoon-icon__pencil')
                    || titleEl?.closest('div')?.querySelector('span[class*="pencil"], .icomoon-icon__pencil');
            }

            if (!pencilIcon) return false;
            
            pencilIcon.click();
            await this.delay(1500);
            
            let dialog = null;
            let attempts = 0;
            while (!dialog && attempts < 30) {
                dialog = document.querySelector('dialog[open]');
                if (!dialog) {
                    await this.delay(500);
                    attempts++;
                }
            }
            
            if (!dialog) return false;
            
            let bulkInternal = null;
            let bulkCustomer = null;
            let bulkReturn = null;
            let transferBtn = null;

            for (let wait = 0; wait < 30; wait++) {
                bulkInternal = dialog.querySelector('#af-bulk0');
                bulkCustomer = dialog.querySelector('#af-bulk1');
                bulkReturn = dialog.querySelector('#af-bulk2');
                transferBtn = dialog.querySelector('#af-transfer-all');
                if (bulkInternal && bulkCustomer && transferBtn) break;
                await this.delay(200);
            }

            if (!bulkInternal || !bulkCustomer) {
                this.addSidebarLog('❌ Панель автозаполнения цен МГХ (#af-bulk) не появилась', 'error');
                return false;
            }
            
            if (bulkInternal && bulkCustomer) {
                const cleanMgxValue = (val) => {
                    if (!val) return '';
                    const s = String(val).trim();
                    const idxComma = s.indexOf(',');
                    const idxDot = s.indexOf('.');
                    let cutIdx = -1;
                    if (idxComma !== -1 && idxDot !== -1) {
                        cutIdx = Math.min(idxComma, idxDot);
                    } else if (idxComma !== -1) {
                        cutIdx = idxComma;
                    } else if (idxDot !== -1) {
                        cutIdx = idxDot;
                    }
                    if (cutIdx !== -1) {
                        return s.substring(0, cutIdx).trim();
                    }
                    return s;
                };

                const internalValues = mgxRows.map(r => cleanMgxValue(r.internal)).filter(v => v && v !== '');
                const customerValues = mgxRows.map(r => cleanMgxValue(r.customer)).filter(v => v && v !== '');
                const returnValues = mgxRows.map(r => cleanMgxValue(r.return)).filter(v => v && v !== '');
                
                if (internalValues.length > 0) {
                    bulkInternal.value = internalValues.join('\n');
                    bulkInternal.dispatchEvent(new Event('input', { bubbles: true }));
                }
                
                if (customerValues.length > 0) {
                    bulkCustomer.value = customerValues.join('\n');
                    bulkCustomer.dispatchEvent(new Event('input', { bubbles: true }));
                }
                
                if (returnValues.length > 0 && bulkReturn) {
                    bulkReturn.value = returnValues.join('\n');
                    bulkReturn.dispatchEvent(new Event('input', { bubbles: true }));
                }
                
                const transferBtn = dialog.querySelector('#af-transfer-all');
                if (transferBtn) {
                    transferBtn.click();
                    await this.delay(2000);
                }
                
                let saveButton = null;
                let waitAttempts = 0;
                while (!saveButton && waitAttempts < 30) {
                    const buttons = dialog.querySelectorAll('button');
                    for (const btn of buttons) {
                        if (btn.textContent.trim() === 'Сохранить' && !btn.disabled) {
                            saveButton = btn;
                            break;
                        }
                    }
                    if (!saveButton) {
                        await this.delay(500);
                        waitAttempts++;
                    }
                }
                
                if (saveButton) {
                    saveButton.click();
                    await this.delay(1500);
                    return true;
                } else return false;
            } else return false;
        }
        
        async openAndSelectZones(zones) {
            let pencilIcon = null;
            const allElements = document.querySelectorAll('div, span, label, p');
            for (const el of allElements) {
                if (el.textContent.trim() === 'Зоны доставки') {
                    const container = el.closest('div');
                    if (container) {
                        pencilIcon = container.querySelector('span[class*="pencil"], .icomoon-icon__pencil');
                        if (pencilIcon) break;
                    }
                }
            }
            if (!pencilIcon) {
                const titleEl = Array.from(document.querySelectorAll('span, div, label, p, h1, h2, h3, h4')).find(el => el.textContent.trim() === 'Зоны доставки');
                pencilIcon = titleEl?.parentElement?.querySelector('span[class*="pencil"], .icomoon-icon__pencil')
                    || titleEl?.closest('div')?.querySelector('span[class*="pencil"], .icomoon-icon__pencil');
            }

            if (!pencilIcon) return false;
            
            pencilIcon.click();
            await this.delay(1500);
            
            let dialog = null;
            let attempts = 0;
            while (!dialog && attempts < 20) {
                dialog = document.querySelector('dialog[open]');
                if (!dialog) {
                    await this.delay(500);
                    attempts++;
                }
            }
            if (!dialog) return false;
            
            for (const zoneName of zones) {
                const zoneCheckbox = this.findCheckboxByText(dialog, zoneName);
                if (zoneCheckbox && !zoneCheckbox.checked) {
                    zoneCheckbox.click();
                    await this.delay(200);
                }
            }
            
            const saveBtn = Array.from(dialog.querySelectorAll('button')).find(b => b.textContent.trim() === 'Сохранить');
            if (saveBtn) {
                saveBtn.click();
                await this.delay(1500);
            }
            return true;
        }
        
        async openAndSelectBranches(branches) {
            let pencilIcon = null;
            const allElements = document.querySelectorAll('div, span, label, p');
            for (const el of allElements) {
                if (el.textContent.trim() === 'Филиалы обслуживания') {
                    const container = el.closest('div');
                    if (container) {
                        pencilIcon = container.querySelector('span[class*="pencil"], .icomoon-icon__pencil');
                        if (pencilIcon) break;
                    }
                }
            }
            if (!pencilIcon) {
                const titleEl = Array.from(document.querySelectorAll('span, div, label, p, h1, h2, h3, h4')).find(el => el.textContent.trim() === 'Филиалы обслуживания');
                pencilIcon = titleEl?.parentElement?.querySelector('span[class*="pencil"], .icomoon-icon__pencil')
                    || titleEl?.closest('div')?.querySelector('span[class*="pencil"], .icomoon-icon__pencil');
            }

            if (!pencilIcon) return false;
            
            pencilIcon.click();
            await this.delay(1500);
            
            let dialog = null;
            let attempts = 0;
            while (!dialog && attempts < 20) {
                dialog = document.querySelector('dialog[open]');
                if (!dialog) {
                    await this.delay(500);
                    attempts++;
                }
            }
            if (!dialog) return false;
            
            for (const branchName of branches) {
                const branchCheckbox = this.findCheckboxByText(dialog, branchName);
                if (branchCheckbox && !branchCheckbox.checked) {
                    branchCheckbox.click();
                    await this.delay(200);
                }
            }
            
            const saveBtn = Array.from(dialog.querySelectorAll('button')).find(b => b.textContent.trim() === 'Сохранить');
            if (saveBtn) {
                saveBtn.click();
                await this.delay(1500);
            }
            return true;
        }
        
        async openAndSetupIntervals(intervalsData) {
            if (!intervalsData || !intervalsData.length) intervalsData = window.currentTariff?.intervals || [];
            if (!intervalsData || !intervalsData.length) return true;

            const titleSpan = Array.from(document.querySelectorAll('span')).find(el => el.textContent.trim() === 'Интервалы доставки');
            const pencilIcon = titleSpan?.parentElement?.querySelector('span[class*="pencil"], .icomoon-icon__pencil');
            if (!pencilIcon) {
                const titleEl = Array.from(document.querySelectorAll('span, div, label, p, h1, h2, h3, h4')).find(el => el.textContent.trim() === 'Интервалы доставки');
                pencilIcon = titleEl?.parentElement?.querySelector('span[class*="pencil"], .icomoon-icon__pencil')
                    || titleEl?.closest('div')?.querySelector('span[class*="pencil"], .icomoon-icon__pencil');
            }

            if (!pencilIcon) return false;

            pencilIcon.click();
            await this.delay(1000);

            let dialog = null;
            for (let attempts = 0; attempts < 20; attempts++) {
                dialog = Array.from(document.querySelectorAll('dialog[open]')).find(d => (d.textContent || '').includes('Интервалы доставки'));
                if (dialog) break;
                await this.delay(300);
            }
            if (!dialog) return false;

            const normalizeTime = (value) => {
                const m = String(value || '').match(/\d{1,2}:\d{2}/);
                return m ? m[0] : String(value || '').trim().slice(0, 5);
            };
            const rows = dialog.querySelectorAll('tbody tr');
            rows.forEach(row => {
                const start = normalizeTime(row.querySelector('[test-id="startTime"] span')?.textContent);
                const end = normalizeTime(row.querySelector('[test-id="endTime"] span')?.textContent);
                const orderBefore = normalizeTime(row.querySelector('[test-id="orderBefore"] span')?.textContent);
                const match = intervalsData.find(i => normalizeTime(i.startTime) === start && normalizeTime(i.endTime) === end && normalizeTime(i.orderBefore) === orderBefore);
                const checkbox = row.querySelector('input[type="checkbox"]');
                if (!checkbox) return;

                if (match) {
                    const shouldBeChecked = match.enabled !== false;
                    if (shouldBeChecked && !checkbox.checked) checkbox.click();
                    else if (!shouldBeChecked && checkbox.checked) checkbox.click();

                    const internalInput = row.querySelector('[test-id="internalPriceAdjustment"] input');
                    const customerInput = row.querySelector('[test-id="priceAdjustment"] input');
                    if (internalInput) this.setInputValue(internalInput, match.internalPriceAdjustment || '');
                    if (customerInput) this.setInputValue(customerInput, match.priceAdjustment || '');
                } else if (checkbox.checked) {
                    checkbox.click();
                }
            });

            let saveBtn = null;
            for (let attempts = 0; attempts < 30; attempts++) {
                saveBtn = Array.from(dialog.querySelectorAll('button')).find(btn => btn.textContent.trim() === 'Сохранить');
                if (saveBtn && !saveBtn.disabled) break;
                await this.delay(300);
            }

            if (!saveBtn || saveBtn.disabled) return false;
            saveBtn.click();
            await this.delay(1000);
            return true;
        }
        
        async setupPayment(tariff) {
            const paymentCard = tariff.payment?.card !== undefined ? tariff.payment.card : this.config.paymentCard;
            const paymentCash = tariff.payment?.cash !== undefined ? tariff.payment.cash : this.config.paymentCash;

            const cardCheckbox = document.querySelector('input[id*="cashless"]');
            const cashCheckbox = document.querySelector('input[id*="cash"]');

            if (cardCheckbox && paymentCard !== undefined && cardCheckbox.checked !== paymentCard) cardCheckbox.click();
            if (cashCheckbox && paymentCash !== undefined && cashCheckbox.checked !== paymentCash) cashCheckbox.click();

            await this.delay(200);
            return true;
        }

        async setupAcceptance(tariff) {
            const acceptanceSameDay = tariff.acceptance?.sameDay !== undefined ? tariff.acceptance.sameDay : this.config.acceptanceSameDay;
            const acceptanceNextDay = tariff.acceptance?.nextDay !== undefined ? tariff.acceptance.nextDay : this.config.acceptanceNextDay;

            const sameDayRadio = document.querySelector('#sameDay input[type="radio"]');
            const nextDayRadio = document.querySelector('#nextDay input[type="radio"]');

            if (acceptanceSameDay && sameDayRadio && !sameDayRadio.checked) sameDayRadio.click();
            else if (acceptanceNextDay && nextDayRadio && !nextDayRadio.checked) nextDayRadio.click();
            else if (!acceptanceSameDay && !acceptanceNextDay && sameDayRadio && !sameDayRadio.checked) sameDayRadio.click();

            await this.delay(200);
            return true;
        }

        async setupSaleTypes(tariff) {
            this.addSidebarLog('🏷️ Настройка видов продажи...', 'info');
            const saleProduct = tariff.saleTypes?.product !== undefined ? tariff.saleTypes.product : this.config.saleProduct;
            const saleMarkdown = tariff.saleTypes?.markdown !== undefined ? tariff.saleTypes.markdown : this.config.saleMarkdown;
            const saleLegal = tariff.saleTypes?.legal !== undefined ? tariff.saleTypes.legal : this.config.saleLegal;
            const saleService = tariff.saleTypes?.service !== undefined ? tariff.saleTypes.service : this.config.saleService;

            const resProd = await this.setSaleTypeCheckbox('Исправный товар', 'product', saleProduct);
            this.addSidebarLog(`  • Исправный товар: ${saleProduct ? 'включен' : 'выключен'} ${resProd ? '✓' : '⚠️ не переключился'}`, resProd ? 'info' : 'warning');

            const resMark = await this.setSaleTypeCheckbox('Уцененный товар', 'markdown', saleMarkdown);
            this.addSidebarLog(`  • Уцененный товар: ${saleMarkdown ? 'включен' : 'выключен'} ${resMark ? '✓' : '⚠️ не переключился'}`, resMark ? 'info' : 'warning');

            const resLeg = await this.setSaleTypeCheckbox('Юридические лица', 'legal', saleLegal);
            this.addSidebarLog(`  • Юридические лица: ${saleLegal ? 'включен' : 'выключен'} ${resLeg ? '✓' : '⚠️ не переключился'}`, resLeg ? 'info' : 'warning');

            const resServ = await this.setSaleTypeCheckbox('Сервисный центр', 'service', saleService);
            this.addSidebarLog(`  • Сервисный центр: ${saleService ? 'включен' : 'выключен'} ${resServ ? '✓' : '⚠️ не переключился'}`, resServ ? 'info' : 'warning');

            const productState = this.findSaleTypeCheckbox('Исправный товар', 'product');
            const markdownState = this.findSaleTypeCheckbox('Уцененный товар', 'markdown');
            const legalState = this.findSaleTypeCheckbox('Юридические лица', 'legal');
            const serviceState = this.findSaleTypeCheckbox('Сервисный центр', 'service');

            const anyChecked = this.isSaleTypeChecked(productState) || this.isSaleTypeChecked(markdownState) ||
                               this.isSaleTypeChecked(legalState) || this.isSaleTypeChecked(serviceState);

            if (!anyChecked) {
                this.addSidebarLog('⚠️ Ни один вид продажи не выбран, включаем «Исправный товар» по умолчанию', 'warning');
                await this.setSaleTypeCheckbox('Исправный товар', 'product', true);
            }

            await this.delay(200);
            return true;
        }

        normalizeText(value) {
            return String(value ?? '').replace(/ /g, ' ').replace(/\s+/g, ' ').trim();
        }

        isSaleTypeChecked(target) {
            if (!target) return false;
            if (target.type === 'checkbox') return !!target.checked;
            if (target.getAttribute) {
                const ariaChecked = target.getAttribute('aria-checked');
                if (ariaChecked === 'true') return true;
                if (ariaChecked === 'false') return false;
            }
            const nestedCheckbox = target.querySelector?.('input[type="checkbox"]');
            return !!nestedCheckbox?.checked;
        }

        triggerSaleTypeClick(target) {
            if (!target) return false;
            const input = target.tagName === 'INPUT' ? target : target.querySelector?.('input[type="checkbox"]');
            if (input && typeof input.click === 'function') {
                input.click();
                return true;
            }
            if (typeof target.click === 'function') {
                target.click();
                return true;
            }
            const clickable = target.closest?.('label, [role="checkbox"], button') || target;
            if (typeof clickable.click === 'function') {
                clickable.click();
                return true;
            }
            clickable.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
            return true;
        }

        async setSaleTypeCheckbox(labelText, idPart, expectedState) {
            if (expectedState === undefined) return false;

            for (let attempt = 0; attempt < 6; attempt++) {
                const target = this.findSaleTypeCheckbox(labelText, idPart);
                if (!target) {
                    await this.delay(200);
                    continue;
                }

                // Находим непосредственный <input type="checkbox"> если target - это контейнер или label
                const inputEl = target.tagName === 'INPUT' ? target : (target.querySelector?.('input[type="checkbox"], [role="checkbox"]') || target);

                const currentChecked = this.isSaleTypeChecked(inputEl);
                if (currentChecked === expectedState) return true;

                // 1. Прямой клик по самому input (в большинстве браузеров и React переключает состояние и генерирует события)
                if (typeof inputEl.click === 'function') {
                    inputEl.click();
                } else if (typeof target.click === 'function') {
                    target.click();
                }

                await this.delay(180);
                if (this.isSaleTypeChecked(inputEl) === expectedState) return true;

                // 2. Клик по родительскому label
                const label = inputEl.closest?.('label') || target.closest?.('label') || (inputEl.id ? document.querySelector(`label[for="${inputEl.id}"]`) : null);
                if (label && typeof label.click === 'function') {
                    label.click();
                }

                await this.delay(180);
                if (this.isSaleTypeChecked(inputEl) === expectedState) return true;

                // 3. React prototype setter + dispatch input & change
                if (inputEl.tagName === 'INPUT' && inputEl.type === 'checkbox') {
                    const inputProto = window.HTMLInputElement.prototype;
                    const checkedDescriptor = Object.getOwnPropertyDescriptor(inputProto, 'checked');
                    if (checkedDescriptor && checkedDescriptor.set) {
                        checkedDescriptor.set.call(inputEl, expectedState);
                    } else {
                        inputEl.checked = expectedState;
                    }
                    inputEl.dispatchEvent(new Event('input', { bubbles: true }));
                    inputEl.dispatchEvent(new Event('change', { bubbles: true }));
                } else if (inputEl.getAttribute?.('role') === 'checkbox') {
                    inputEl.setAttribute('aria-checked', String(expectedState));
                    inputEl.dispatchEvent(new Event('change', { bubbles: true }));
                }

                await this.delay(200);
                const refreshed = this.findSaleTypeCheckbox(labelText, idPart) || inputEl;
                if (this.isSaleTypeChecked(refreshed) === expectedState) return true;
            }
            return false;
        }

        findCheckboxByText(container, text) {
            const wanted = this.normalizeText(text);
            const candidates = container.querySelectorAll('label, span, div, p');

            for (const element of candidates) {
                if (this.normalizeText(element.textContent) !== wanted) continue;

                const directFor = element.getAttribute?.('for');
                if (directFor) {
                    const byFor = document.getElementById(directFor);
                    if (byFor) return byFor;
                }

                const label = element.closest('label');
                if (label) {
                    const inLabel = label.querySelector('input[type="checkbox"], [role="checkbox"]');
                    if (inLabel) return inLabel;
                }

                const row = element.closest('[class*="row"], [class*="item"], [class*="option"], div, li');
                if (row) {
                    const inRow = row.querySelector('input[type="checkbox"], [role="checkbox"]');
                    if (inRow) return inRow;
                }

                let node = element.parentElement;
                for (let depth = 0; node && depth < 4; depth++, node = node.parentElement) {
                    const nested = node.querySelector('input[type="checkbox"], [role="checkbox"]');
                    if (nested) return nested;
                }
            }
            return null;
        }

        findSaleTypeCheckbox(labelText, idPart) {
            // Приоритет 1: выделенная секция "вид продажи"
            const saleSection = Array.from(document.querySelectorAll('div, section, fieldset, form'))
                .find(el => {
                    const txt = (el.textContent || '').toLowerCase();
                    return (txt.includes('вид продажи') || txt.includes('допустимый к оформлению')) &&
                           (txt.includes('сервис') || txt.includes('исправн') || txt.includes('уцен') || txt.includes('юр'));
                });

            const roots = [saleSection, document.querySelector('form'), document.body].filter(Boolean);

            const keywordsMap = {
                service: ['сервис', 'сервисный'],
                product: ['исправн', 'исправный'],
                markdown: ['уцен', 'уцененный'],
                legal: ['юр', 'юрид']
            };
            const keywords = keywordsMap[idPart] || [labelText.toLowerCase()];

            for (const root of roots) {
                const candidates = Array.from(root.querySelectorAll('label, div, span, p, tr, td'));
                for (const el of candidates) {
                    const directText = Array.from(el.childNodes)
                        .filter(n => n.nodeType === Node.TEXT_NODE)
                        .map(n => n.textContent)
                        .join(' ')
                        .toLowerCase();
                    const fullText = (el.textContent || '').trim().toLowerCase();

                    if (keywords.some(kw => directText.includes(kw) || (fullText.includes(kw) && fullText.length < 50))) {
                        if (el.tagName === 'INPUT' && el.type === 'checkbox') return el;
                        const innerCb = el.querySelector('input[type="checkbox"], [role="checkbox"]');
                        if (innerCb) return innerCb;
                        const forId = el.getAttribute?.('for') || el.closest('label')?.getAttribute?.('for');
                        if (forId) {
                            const forEl = document.getElementById(forId);
                            if (forEl) return forEl;
                        }
                        const label = el.closest('label');
                        if (label) {
                            const cbInLabel = label.querySelector('input[type="checkbox"], [role="checkbox"]');
                            if (cbInLabel) return cbInLabel;
                        }
                    }
                }

                const checkboxByText = this.findCheckboxByText(root, labelText);
                if (checkboxByText) return checkboxByText;
            }

            return document.querySelector(`input[type="checkbox"][id*="${idPart}"], [role="checkbox"][id*="${idPart}"], [aria-label*="${labelText}"]`);
        }
        
        hideOtherSidebars() {
            const sidebarIds = ['tariff-export-sidebar', 'tariff-create-config-sidebar', 'tariff-create-progress-sidebar', 'tariff-update-config-sidebar', 'tariff-update-sidebar'];
            sidebarIds.forEach(id => {
                if (!this.sidebar || id !== this.sidebar.id) {
                    const el = document.getElementById(id);
                    if (el) el.style.display = 'none';
                }
            });
        }

        hideSidebar() {
            if (this.sidebar) this.sidebar.style.display = 'none';
        }

        minimizeSidebar() {
            if (this.sidebar) {
                this.sidebar.style.transform = 'translateX(calc(100% - 40px))';
                const minimizeBtn = document.getElementById('sidebar-update-config-minimize') || document.getElementById('sidebar-update-minimize');
                if (minimizeBtn) {
                    minimizeBtn.textContent = '+';
                    minimizeBtn.onclick = () => this.restoreSidebar();
                }
            }
        }
        
        restoreSidebar() {
            if (this.sidebar) {
                this.sidebar.style.transform = 'translateX(0)';
                const minimizeBtn = document.getElementById('sidebar-update-config-minimize') || document.getElementById('sidebar-update-minimize');
                if (minimizeBtn) {
                    minimizeBtn.textContent = '';
                    minimizeBtn.onclick = () => this.minimizeSidebar();
                }
            }
        }

        showSidebar() {
            if (this.isFromTariffManager()) return;
            this.hideOtherSidebars();
            if (this.sidebar) {
                this.sidebar.style.display = 'flex';
                this.restoreSidebar();
                this.updateButtonsForImportState();
                this.restoreLogFromStorage();
            } else {
                this.showConfigSidebar();
            }
        }

        updateButtonsForImportState() {
            if (!this.sidebar) return;
            const configStartBtn = document.getElementById('sidebar-update-config-start');
            const configStopBtn = document.getElementById('sidebar-update-config-stop');
            const importAllBtn = document.getElementById('sidebar-update-config-import-all');
            const progressStopBtn = document.getElementById('sidebar-update-stop-btn');
            const fileStatus = document.getElementById('sidebar-update-file-status');
            
            const total = this.tariffsToCreate ? this.tariffsToCreate.length : 0;

            if (this.isImporting) {
                if (configStartBtn) configStartBtn.style.display = 'none';
                if (configStopBtn) configStopBtn.style.display = 'block';
                if (importAllBtn) importAllBtn.disabled = true;
                if (progressStopBtn) progressStopBtn.disabled = false;
            } else {
                if (configStartBtn) {
                    configStartBtn.style.display = 'block';
                    if (total > 0) {
                        configStartBtn.disabled = false;
                        configStartBtn.style.background = '#10b981';
                        configStartBtn.style.color = '#ffffff';
                        configStartBtn.style.cursor = 'pointer';
                    } else {
                        configStartBtn.disabled = true;
                        configStartBtn.style.background = '#475569';
                        configStartBtn.style.color = '#94a3b8';
                        configStartBtn.style.cursor = 'not-allowed';
                    }
                }
                if (configStopBtn) configStopBtn.style.display = 'none';
                if (importAllBtn) importAllBtn.disabled = false;
                if (progressStopBtn) progressStopBtn.disabled = false;
            }
            
            if (fileStatus) {
                if (total > 0) {
                    fileStatus.textContent = `Готово к обновлению: ${total} шт.`;
                    fileStatus.style.color = '#4ade80';
                } else {
                    fileStatus.textContent = 'Нажмите и выберите файл (.xls, .xlsx)';
                    fileStatus.style.color = '#cbd5e1';
                }
            }
        }

        updateSidebarDisplay() {
            if (!this.sidebar || this.sidebar.id !== 'tariff-update-sidebar') return;
            const total = this.tariffsToCreate.length > 0 ? (this.currentIndex / this.tariffsToCreate.length * 100) : 0;
            const fill = document.getElementById('sidebar-update-progress-fill');
            const text = document.getElementById('sidebar-update-progress-text');
            if (fill) fill.style.width = `${total}%`;
            if (text) text.textContent = `${Math.round(total)}% (${this.currentIndex}/${this.tariffsToCreate.length})`;
        }

        updateConfigStatus(title, detail) {
            const titleDiv = document.getElementById('sidebar-update-config-status-title');
            const detailDiv = document.getElementById('sidebar-update-config-status-detail');
            if (titleDiv) titleDiv.textContent = title;
            if (detailDiv) detailDiv.textContent = detail;
        }
        
        updateSidebarStatus(title, detail) {
            const titleDiv = document.getElementById('sidebar-update-status-title');
            const detailDiv = document.getElementById('sidebar-update-status-detail');
            if (titleDiv) titleDiv.textContent = title;
            if (detailDiv) detailDiv.textContent = detail;
        }
        
        handleStopSignal() {
            this.applyStoppedState('Получен сигнал остановки');
        }
        
        stopImport() {
            if (this.stopRequested()) {
                this.applyStoppedState('Импорт уже остановлен пользователем');
                return;
            }
            localStorage.setItem('tariff_update_stop', String(Date.now()));
            this.addSidebarLog('⏹️ Обновление остановлено пользователем', 'warning');
            this.applyStoppedState('Обновление остановлено пользователем');
        }
        
        handleConfigUpdate(dataStr) {
            if (dataStr) {
                this.config = this.normalizeConfig(JSON.parse(dataStr));
                this.loadSavedConfig();
            }
        }
        
        addSidebarLog(message, type = 'info') {
            const lastEntry = this.logEntries[this.logEntries.length - 1];
            if (lastEntry && lastEntry.message === message && lastEntry.type === type) return;

            const timeStr = new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
            const entry = { time: timeStr, message: message, type: type };
            this.logEntries.push(entry);

            if (this.isFromTariffManager()) {
                try {
                    const events = JSON.parse(localStorage.getItem('tariff_save_events') || '[]');
                    events.push(entry);
                    localStorage.setItem('tariff_save_events', JSON.stringify(events));
                } catch (_) {}
            }
            while (this.logEntries.length > 120) this.logEntries.shift();
            this.saveLogToStorage();
            this.renderLog();
            this.renderConfigLog();
        }
        
        setInputValue(input, value) {
            if (!input) return;
            const normalized = (value === '-' || value === '—' || value == null) ? '' : String(value);
            const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
            if (setter) setter.call(input, normalized);
            else input.value = normalized;
            input.dispatchEvent(new Event('input', { bubbles: true }));
            input.dispatchEvent(new Event('change', { bubbles: true }));
            input.dispatchEvent(new Event('blur', { bubbles: true }));
        }

        async openAndSetupFloorLifting(tariff) {
            const titleSpan = Array.from(document.querySelectorAll('span')).find(el => el.textContent.trim() === 'Подъем на этаж');
            const pencilIcon = titleSpan?.parentElement?.querySelector('span[class*="pencil"], .icomoon-icon__pencil');
            if (!pencilIcon) {
                const titleEl = Array.from(document.querySelectorAll('span, div, label, p, h1, h2, h3, h4')).find(el => el.textContent.trim() === 'Подъем на этаж');
                pencilIcon = titleEl?.parentElement?.querySelector('span[class*="pencil"], .icomoon-icon__pencil')
                    || titleEl?.closest('div')?.querySelector('span[class*="pencil"], .icomoon-icon__pencil');
            }

            if (!pencilIcon) return false;

            pencilIcon.click();
            await this.delay(1000);

            let dialog = null;
            for (let attempts = 0; attempts < 20; attempts++) {
                dialog = Array.from(document.querySelectorAll('dialog[open]')).find(d => (d.textContent || '').includes('Подъем на этаж'));
                if (dialog) break;
                await this.delay(300);
            }
            if (!dialog) return false;

            const internalElevator = tariff.elevatorPrice?.internalPrice ?? tariff.elevatorPrice?.internal ?? '';
            const customerElevator = tariff.elevatorPrice?.customerPrice ?? tariff.elevatorPrice?.customer ?? '';

            let topInputs = dialog.querySelectorAll('div._inputWrapper_17t87_8._medium_17t87_141 input[type="text"]');
            if (!topInputs || topInputs.length < 2) {
                topInputs = dialog.querySelectorAll('input[type="text"]');
            }
            if (topInputs[0]) this.setInputValue(topInputs[0], internalElevator);
            if (topInputs[1]) this.setInputValue(topInputs[1], customerElevator);

            const floorRows = tariff.floorRows || [];
            const rows = dialog.querySelectorAll('table[test-id="lifting-table"] tbody tr');
            rows.forEach(row => {
                const weight = String(row.querySelector('[test-id="maxWeight"] span')?.textContent || '').trim();
                const match = floorRows.find(item => String(item.weight || '').trim() === weight);
                if (!match) return;
                this.setInputValue(row.querySelector('[test-id="handlingInternalPrice"] input'), match.internalPrice || '');
                this.setInputValue(row.querySelector('[test-id="handlingInternalThreshold"] input'), match.internalThreshold || '');
                this.setInputValue(row.querySelector('[test-id="handlingPrice"] input'), match.customerPrice || '');
                this.setInputValue(row.querySelector('[test-id="handlingThreshold"] input'), match.customerThreshold || '');
            });

            let saveBtn = null;
            for (let attempts = 0; attempts < 30; attempts++) {
                saveBtn = Array.from(dialog.querySelectorAll('button')).find(btn => btn.textContent.trim() === 'Сохранить');
                if (saveBtn && !saveBtn.disabled) break;
                await this.delay(300);
            }

            if (!saveBtn || saveBtn.disabled) return false;

            saveBtn.click();
            await this.delay(1000);
            return true;
        }

        delay(ms) {
            return new Promise(resolve => {
                const targetDelay = this.getScaledDelay(ms);
                if (targetDelay <= 0) {
                    resolve();
                    return;
                }
                const step = Math.min(80, targetDelay);
                let elapsed = 0;
                const timer = setInterval(() => {
                    elapsed += step;
                    if (this.stopRequested() || elapsed >= targetDelay) {
                        clearInterval(timer);
                        resolve();
                    }
                }, step);
            });
        }
    }
    
    if (!window.tariffUpdaterPro) {
        window.tariffUpdaterPro = new TariffUpdater();
    }
    
    setTimeout(() => {
        if (window.tariffUpdaterPro) {
            window.tariffUpdaterPro.restoreSidebarFromStorage();
            window.tariffUpdaterPro.checkForContinueImport();
        }
    }, 700);
})();