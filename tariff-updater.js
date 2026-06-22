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

        debugWarn(...args) {
            if (this.debugEnabled) console.warn(...args);
        }

        getScaledDelay(ms) {
            const normalized = Number(ms) || 0;
            if (normalized <= 0) return 0;
            return Math.max(80, Math.round(normalized * this.fastModeMultiplier));
        }

        restoreSidebarFromStorage() {
            if (this.isCreatorFlowActive()) return;
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
            if (this.isCreatorFlowActive()) return;
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
            if (this.isCreatorFlowActive()) return;
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
                deliveryParams: true, // Новое
                costLimit: true,      // Новое
                validityDates: true,  // Новое
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
                { key: 'branches', label: 'Филиалы обслуживания' },
                { key: 'mgx', label: 'МГХ сетка' },
                { key: 'intervals', label: 'Интервалы доставки' },
                { key: 'deliveryParams', label: 'Параметры доставки (дни, отсечка)' },
                { key: 'costLimit', label: 'Лимит стоимости заказа' },
                { key: 'validityDates', label: 'Даты действия тарифа' },
                { key: 'payment', label: 'Способ оплаты при получении' },
                { key: 'acceptance', label: 'Прием заявок' },
                { key: 'saleTypes', label: 'Допустимый к оформлению вид продажи' },
                { key: 'floor', label: 'Подъем на этаж' }
            ];
        }

        isImportBlockEnabled(blockKey) {
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
                case 'floor': return !!((tariff.elevatorPrice && (tariff.elevatorPrice.internalPrice || tariff.elevatorPrice.customerPrice)) || (Array.isArray(tariff.floorRows) && tariff.floorRows.length > 0));
                default: return false;
            }
        }

        shouldImportBlock(tariff, blockKey, blockLabel) {
            if (!this.isImportBlockEnabled(blockKey)) return false;
            if (!this.hasTariffBlockData(tariff, blockKey)) return false;
            return true;
        }

        getImportBlockCheckboxId(blockKey) {
            return `config-import-block-${blockKey}`;
        }

        renderImportBlockCheckboxes() {
            return this.getImportBlockDefinitions().map(block => `
                <label style="display: flex; align-items: center; gap: 8px; color: #e2e8f0; font-size: 12px; cursor: pointer; padding: 6px 8px; background: #1e293b; border-radius: 6px;">
                    <input type="checkbox" id="${this.getImportBlockCheckboxId(block.key)}" style="cursor: pointer;" ${this.isImportBlockEnabled(block.key) ? 'checked' : ''}>
                    <span>${block.label}</span>
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
            this.addSidebarLog(`❌ createTariff: ${step}`, 'error');
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
        
        renderLog() {
            const logDiv = document.getElementById('sidebar-update-log');
            if (!logDiv) return;
            logDiv.innerHTML = '';
            if (this.logEntries.length === 0) {
                const emptyMsg = document.createElement('div');
                emptyMsg.style.color = '#60a5fa';
                emptyMsg.textContent = '💡 Готов к импорту';
                logDiv.appendChild(emptyMsg);
                return;
            }
            const colors = { success: '#4ade80', error: '#f87171', info: '#60a5fa', warning: '#fbbf24' };
            for (const entry of this.logEntries) {
                const entryDiv = document.createElement('div');
                entryDiv.style.color = colors[entry.type] || '#94a3b8';
                entryDiv.style.marginBottom = '6px';
                entryDiv.style.padding = '4px 0';
                entryDiv.style.borderBottom = '1px solid #334155';
                entryDiv.style.fontSize = '11px';
                entryDiv.innerHTML = `[${entry.time}] ${entry.message}`;
                logDiv.appendChild(entryDiv);
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

            const cards = Array.from(document.querySelectorAll('.css-nr5n4g'));
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
                    this.updateConfigStatus('⏹️ Импорт остановлен', 'Можно запустить заново с тем же файлом');
                }
                return;
            }
            
            this.createConfigSidebar();
            this.hideOtherSidebars();
        }
        
        createConfigSidebar() {
            this.removeLegacyImportButton();
            if (this.sidebar) {
                this.sidebar.remove();
                this.sidebar = null;
            }

            this.sidebar = document.createElement('div');
            this.sidebar.id = 'tariff-update-config-sidebar';
            this.sidebar.style.cssText = `
                position: fixed; top: 0; right: 0; width: 450px; height: 100vh;
                background: #1e293b; box-shadow: -2px 0 20px rgba(0,0,0,0.3); z-index: 1000001;
                display: flex; flex-direction: column; font-family: 'Segoe UI', Arial, sans-serif;
                border-left: 1px solid #334155;
            `;

            this.sidebar.innerHTML = `
                <div style="padding: 16px 20px; background: #0f172a; border-bottom: 1px solid #334155; display: flex; justify-content: space-between; align-items: center;">
                    <div>
                        <h3 style="color: #10b981; margin: 0; font-size: 18px;">📥 Импорт тарифов</h3>
                        <div style="color: #94a3b8; font-size: 11px; margin-top: 4px;">Обновление существующих тарифов из Excel</div>
                    </div>
                    <div style="display: flex; gap: 8px;">
                        <button id="sidebar-update-config-minimize" style="background: none; border: none; color: #94a3b8; font-size: 18px; cursor: pointer; padding: 4px 8px;">−</button>
                        <button id="sidebar-update-config-close" style="background: none; border: none; color: #94a3b8; font-size: 20px; cursor: pointer; padding: 4px 8px;">×</button>
                    </div>
                </div>

                <div style="padding: 16px; background: #0f172a; margin: 16px; border-radius: 8px; display: flex; flex-direction: column; gap: 14px;">
                    <div>
                        <label style="color: #94a3b8; font-size: 12px; display: block; margin-bottom: 6px;">📁 Excel файл</label>
                        <input type="file" id="excel-file-input-config" accept=".xls,.xlsx,.xlsm" style="background: #334155; color: white; border: none; padding: 8px; border-radius: 6px; width: 100%; cursor: pointer;">
                    </div>
                    <div>
                        <div style="color: #94a3b8; font-size: 12px; margin-bottom: 8px;">🧩 Какие блоки импортировать</div>
                        <div id="sidebar-update-import-blocks" style="display: grid; grid-template-columns: 1fr; gap: 8px;">
                            ${this.renderImportBlockCheckboxes()}
                        </div>
                    </div>
                    <button id="sidebar-update-config-import-all" style="padding: 10px; background: #2563eb; color: white; border: none; border-radius: 6px; cursor: pointer;">📦 Импортировать все</button>
                </div>

                <div id="sidebar-update-config-status" style="background: #0f172a; margin: 0 16px 16ms 16ms; padding: 12px; border-radius: 8px; border-left: 3px solid #10b981;">
                    <div style="color: #10b981; font-size: 13px; font-weight: 500;" id="sidebar-update-config-status-title">📋 Выберите файл и настройки</div>
                    <div style="color: #94a3b8; font-size: 11px; margin-top: 6px;" id="sidebar-update-config-status-detail">После выбора файла нажмите "Начать импорт"</div>
                </div>

                <div id="sidebar-update-config-progress" style="margin: 0 16ms 16ms 16ms;">
                    <div style="height: 8px; background: #334155; border-radius: 4px; overflow: hidden;">
                        <div id="sidebar-update-config-progress-fill" style="width: 0%; height: 100%; background: linear-gradient(90deg, #10b981, #059669);"></div>
                    </div>
                    <div id="sidebar-update-config-progress-text" style="text-align: center; font-size: 12px; color: #94a3b8;">0%</div>
                </div>

                <div id="sidebar-update-config-log" style="flex: 1 1 auto; min-height: 0; background: #0f172a; margin: 0 16ms 16ms 16ms; padding: 12px; border-radius: 8px; overflow-y: auto; overflow-x: hidden; font-size: 11px; line-height: 1.4; font-family: monospace; white-space: pre-wrap; word-break: break-word;"></div>

                <div style="padding: 16px; border-top: 1px solid #334155;">
                    <div style="display: flex; gap: 8px;">
                        <button id="sidebar-update-config-start" style="flex: 1; padding: 10px; background: linear-gradient(135deg, #10b981, #059669); color: white; border: none; border-radius: 6px; cursor: pointer;">🚀 Начать импорт</button>
                        <button id="sidebar-update-config-stop" style="flex: 1; padding: 10px; background: #dc2626; color: white; border: none; border-radius: 6px; cursor: pointer; display: none;">⏹️ Остановить</button>
                    </div>
                </div>
            `;

            document.body.appendChild(this.sidebar);

            document.getElementById('sidebar-update-config-close').onclick = () => this.hideSidebar();
            document.getElementById('sidebar-update-config-minimize').onclick = () => this.minimizeSidebar();
            document.getElementById('sidebar-update-config-start').onclick = () => this.startImport();
            document.getElementById('sidebar-update-config-stop').onclick = () => this.stopImport();
            document.getElementById('sidebar-update-config-import-all').onclick = () => this.startImportAll();
            document.getElementById('excel-file-input-config').onchange = (e) => this.loadExcelFile(e.target.files[0]);

            this.bindImportBlockCheckboxes();
            this.loadSavedConfig();
            this.updateButtonsForImportState();
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
                    this.saveConfig();
                    
                    this.addSidebarLog(`✅ Загружено ${this.tariffsToCreate.length} тарифов`, 'success');
                    this.updateConfigProgress();
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
                const maxOrderCost = normalizeCell(getCell(row, 'Лимит стоимости', -1)) || normalizeCell(getCell(row, 'Ограничение максимальной стоимости заказа', -1));
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
            this.updateConfigStatus('🚀 Импорт запущен', 'Проверяем страницу тарифа и запускаем обновление');
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

            const firstTariff = this.tariffsToCreate[0];
            if (!firstTariff) return;

            this.openTariffForUpdate(firstTariff.name);
            this.addSidebarLog(`🔎 Открываем тариф: ${firstTariff.name}`, 'info');

            setTimeout(() => {
                if (this.sidebar && this.sidebar.id === 'tariff-update-config-sidebar') {
                    this.hideSidebar();
                }
            }, 1000);
        }
        
        async startImportAll() {
            this.getImportBlockDefinitions().forEach(block => {
                const checkbox = document.getElementById(this.getImportBlockCheckboxId(block.key));
                if (checkbox) checkbox.checked = true;
            });
            this.saveConfig();
            this.addSidebarLog('📦 Выбраны все блоки', 'info');
            await this.startImport();
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
            this.updateSidebarStatus('🔄 Импорт', `Обрабатываем тариф ${this.currentIndex + 1} из ${this.tariffsToCreate.length}: ${tariff.name}`);
            this.updateSidebarDisplay();
            this.saveStateToStorage();

            const success = await this.createTariff(tariff);
            if (!this.ensureCanContinue(`после обработки тарифа ${tariff.name}`)) return;

            if (success) {
                this.addSidebarLog(`✅ Обновлен: ${tariff.name}`, 'success');
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
                    this.addSidebarLog('↩️ Завершено! Возвращаемся к списку тарифов...', 'info');
                    await this.delay(2000);
                    const baseUrl = window.location.origin + window.location.pathname.replace(/\/[^\/]+$/, '');
                    window.location.href = baseUrl;
                }
            } else {
                this.addSidebarLog(`❌ Ошибка: ${tariff.name}`, 'error');
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
            this.addSidebarLog('✨ Импорт завершен', 'success');

            localStorage.removeItem('tariff_update_data');
            localStorage.removeItem('tariff_update_state');
            this.importStarted = false;
            this.currentIndex = 0;
            this.tariffsToCreate = [];
        }
        
        async waitForCreateFormReady(tariffName = '') {
            let nameInput = null;
            let saveButton = null;

            for (let attempt = 1; attempt <= 40; attempt++) {
                nameInput = document.querySelector('input[placeholder*="Введите название тарифа"]');
                saveButton = Array.from(document.querySelectorAll('button')).find(btn => {
                    const text = (btn.textContent || '').trim();
                    return text === 'Сохранить' && !btn.closest('dialog[open]') && !btn.disabled;
                });

                if (nameInput && saveButton) return { nameInput, saveButton };
                await this.delay(250);
            }

            return {
                nameInput: document.querySelector('input[placeholder*="Введите название тарифа"]'),
                saveButton: Array.from(document.querySelectorAll('button')).find(btn => {
                    const text = (btn.textContent || '').trim();
                    return text === 'Сохранить' && !btn.closest('dialog[open]') && !btn.disabled;
                })
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

            for (const block of blockHandlers) {
                if (!this.ensureCanContinue(`перед блоком ${block.label}`)) return false;
                if (!this.shouldImportBlock(tariff, block.key, block.label)) continue;
                await block.run();
                if (!this.ensureCanContinue(`после блока ${block.label}`)) return false;
                await this.delay(500);
            }

            if (!this.ensureCanContinue(`перед заполнением названия тарифа ${tariff.name}`)) return false;

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

            if (!nameInput) return this.setCreateFailure('name_input_not_found', { tariffName: tariff.name });

            this.setInputValue(nameInput, tariff.name);
            nameInput.blur();
            await this.delay(300);

            if (!this.ensureCanContinue(`перед сохранением тарифа ${tariff.name}`)) return false;

            let saveButton = null;
            attempts = 0;
            while (!saveButton && attempts < 30) {
                if (!this.ensureCanContinue(`во время ожидания кнопки сохранения для ${tariff.name}`)) return false;
                const allButtons = document.querySelectorAll('button');
                for (const btn of allButtons) {
                    const text = (btn.textContent || '').trim();
                    if (text === 'Сохранить') {
                        const inDialog = !!btn.closest('dialog[open]');
                        if (!inDialog && !btn.disabled) {
                            saveButton = btn;
                            break;
                        }
                    }
                }
                if (!saveButton) {
                    await this.delay(500);
                    attempts++;
                }
            }

            if (!saveButton) return this.setCreateFailure('save_button_not_found', { tariffName: tariff.name });

            if (!this.ensureCanContinue(`непосредственно перед кликом по кнопке сохранения для ${tariff.name}`)) return false;
            saveButton.click();
            await this.delay(3000);
            if (this.stopRequested()) return false;
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
            
            const bulkInternal = dialog.querySelector('#af-bulk0');
            const bulkCustomer = dialog.querySelector('#af-bulk1');
            const bulkReturn = dialog.querySelector('#af-bulk2');
            
            if (bulkInternal && bulkCustomer) {
                const cleanMgxValue = (val) => {
                    if (!val) return '';
                    const s = String(val).trim();
                    // Берем только целую часть до первой запятой или точки (дробная часть отбрасывается, чтобы тарификатор не склеивал цифры)
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

            const normalizeTime = (value) => String(value || '').trim().slice(0, 5);
            const rows = dialog.querySelectorAll('tbody tr');
            rows.forEach(row => {
                const start = normalizeTime(row.querySelector('[test-id="startTime"] span')?.textContent);
                const end = normalizeTime(row.querySelector('[test-id="endTime"] span')?.textContent);
                const orderBefore = normalizeTime(row.querySelector('[test-id="orderBefore"] span')?.textContent);
                const match = intervalsData.find(i => normalizeTime(i.startTime) === start && normalizeTime(i.endTime) === end && normalizeTime(i.orderBefore) === orderBefore);
                const checkbox = row.querySelector('input[type="checkbox"]');
                if (!checkbox) return;

                if (match) {
                    if (!checkbox.checked) checkbox.click();
                    const internalInput = row.querySelector('[test-id="internalPriceAdjustment"] input');
                    const customerInput = row.querySelector('[test-id="priceAdjustment"] input');
                    this.setInputValue(internalInput, match.internalPriceAdjustment || '');
                    this.setInputValue(customerInput, match.priceAdjustment || '');
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
            const saleProduct = tariff.saleTypes?.product !== undefined ? tariff.saleTypes.product : this.config.saleProduct;
            const saleMarkdown = tariff.saleTypes?.markdown !== undefined ? tariff.saleTypes.markdown : this.config.saleMarkdown;
            const saleLegal = tariff.saleTypes?.legal !== undefined ? tariff.saleTypes.legal : this.config.saleLegal;
            const saleService = tariff.saleTypes?.service !== undefined ? tariff.saleTypes.service : this.config.saleService;

            await this.setSaleTypeCheckbox('Исправный товар', 'product', saleProduct);
            await this.setSaleTypeCheckbox('Уцененный товар', 'markdown', saleMarkdown);
            await this.setSaleTypeCheckbox('Юридические лица', 'legal', saleLegal);
            await this.setSaleTypeCheckbox('Сервисный центр', 'service', saleService);

            const productState = this.findSaleTypeCheckbox('Исправный товар', 'product');
            const markdownState = this.findSaleTypeCheckbox('Уцененный товар', 'markdown');
            const legalState = this.findSaleTypeCheckbox('Юридические лица', 'legal');
            const serviceState = this.findSaleTypeCheckbox('Сервисный центр', 'service');

            const anyChecked = this.isSaleTypeChecked(productState) || this.isSaleTypeChecked(markdownState) ||
                               this.isSaleTypeChecked(legalState) || this.isSaleTypeChecked(serviceState);

            if (!anyChecked) await this.setSaleTypeCheckbox('Исправный товар', 'product', true);

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
            const clickable = target.closest?.('label, [role="checkbox"], button') || target;
            clickable.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
            return true;
        }

        async setSaleTypeCheckbox(labelText, idPart, expectedState) {
            if (expectedState === undefined) return false;

            for (let attempt = 0; attempt < 5; attempt++) {
                const target = this.findSaleTypeCheckbox(labelText, idPart);
                if (!target) {
                    await this.delay(200);
                    continue;
                }

                const before = this.isSaleTypeChecked(target);
                if (before === expectedState) return true;

                this.triggerSaleTypeClick(target);
                await this.delay(250);

                const refreshed = this.findSaleTypeCheckbox(labelText, idPart) || target;
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
            const roots = [document.querySelector('form'), document.body].filter(Boolean);
            for (const root of roots) {
                const checkboxByText = this.findCheckboxByText(root, labelText);
                if (checkboxByText) return checkboxByText;
            }
            return document.querySelector(`input[type="checkbox"][id*="${idPart}"], [role="checkbox"][id*="${idPart}"], [aria-label*="${labelText}"]`);
        }
        
        createSidebar() {
            if (this.sidebar && this.sidebar.id === 'tariff-update-sidebar') return;
            if (this.sidebar) this.sidebar.remove();
            
            this.sidebar = document.createElement('div');
            this.sidebar.id = 'tariff-update-sidebar';
            this.sidebar.style.cssText = `
                position: fixed; top: 0; right: 0; width: 450px; height: 100vh;
                background: #1e293b; box-shadow: -2px 0 20px rgba(0,0,0,0.3); z-index: 1000001;
                display: flex; flex-direction: column; font-family: 'Segoe UI', Arial, sans-serif;
                border-left: 1px solid #334155;
            `;
            
            this.sidebar.innerHTML = `
                <div style="padding: 16px 20px; background: #0f172a; border-bottom: 1px solid #334155; display: flex; justify-content: space-between; align-items: center;">
                    <div>
                        <h3 style="color: #10b981; margin: 0; font-size: 18px;">📥 Импорт тарифов</h3>
                        <div style="color: #94a3b8; font-size: 11px; margin-top: 4px;">Обновление существующих тарифов из Excel</div>
                    </div>
                    <div style="display: flex; gap: 8px;">
                        <button id="sidebar-update-minimize" style="background: none; border: none; color: #94a3b8; font-size: 18px; cursor: pointer; padding: 4px 8px;">−</button>
                        <button id="sidebar-update-close" style="background: none; border: none; color: #94a3b8; font-size: 20px; cursor: pointer; padding: 4px 8px;">×</button>
                    </div>
                </div>
                
                <div id="sidebar-update-status" style="background: #0f172a; margin: 16px; padding: 12px; border-radius: 8px; border-left: 3px solid #10b981;">
                    <div style="color: #10b981; font-size: 13px; font-weight: 500;" id="sidebar-update-status-title">🔄 Импорт</div>
                    <div style="color: #94a3b8; font-size: 11px; margin-top: 6px;" id="sidebar-update-status-detail">Обновление тарифов...</div>
                </div>
                
                <div id="sidebar-update-progress" style="margin: 0 16ms 16ms 16ms;">
                    <div style="height: 8px; background: #334155; border-radius: 4px; overflow: hidden;">
                        <div id="sidebar-update-progress-fill" style="width: 0%; height: 100%; background: linear-gradient(90deg, #10b981, #059669);"></div>
                    </div>
                    <div id="sidebar-update-progress-text" style="text-align: center; font-size: 12px; color: #94a3b8;">0%</div>
                </div>
                
                <div id="sidebar-update-log" style="flex: 1 1 auto; min-height: 0; background: #0f172a; margin: 0 16ms 16ms 16ms; padding: 12px; border-radius: 8px; overflow-y: auto; overflow-x: hidden; font-size: 11px; line-height: 1.4; font-family: monospace; white-space: pre-wrap; word-break: break-word;"></div>
                
                <div style="padding: 16px; border-top: 1px solid #334155;">
                    <button id="sidebar-update-stop-btn" style="width: 100%; padding: 10px; background: #dc2626; color: white; border: none; border-radius: 6px; cursor: pointer;">⏹️ Остановить импорт</button>
                </div>
            `;
            
            document.body.appendChild(this.sidebar);
            document.getElementById('sidebar-update-close').onclick = () => this.hideSidebar();
            document.getElementById('sidebar-update-minimize').onclick = () => this.minimizeSidebar();
            document.getElementById('sidebar-update-stop-btn').onclick = () => this.stopImport();
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
                    minimizeBtn.textContent = '−';
                    minimizeBtn.onclick = () => this.minimizeSidebar();
                }
            }
        }

        showSidebar() {
            this.hideOtherSidebars();
            if (this.sidebar) {
                this.sidebar.style.display = 'flex';
                this.restoreSidebar();
                this.updateButtonsForImportState();
                this.restoreLogFromStorage();
            } else {
                this.createSidebar();
                this.hideOtherSidebars();
            }
        }

        updateConfigProgress() {
            if (!this.sidebar || this.sidebar.id !== 'tariff-update-config-sidebar') return;
            const total = this.tariffsToCreate.length > 0 ? (this.currentIndex / this.tariffsToCreate.length * 100) : 0;
            const fill = document.getElementById('sidebar-update-config-progress-fill');
            const text = document.getElementById('sidebar-update-config-progress-text');
            if (fill) fill.style.width = `${total}%`;
            if (text) text.textContent = `${Math.round(total)}% (${this.currentIndex}/${this.tariffsToCreate.length})`;
        }
        
        updateSidebarDisplay() {
            if (!this.sidebar || this.sidebar.id !== 'tariff-update-sidebar') return;
            const total = this.tariffsToCreate.length > 0 ? (this.currentIndex / this.tariffsToCreate.length * 100) : 0;
            const fill = document.getElementById('sidebar-update-progress-fill');
            const text = document.getElementById('sidebar-update-progress-text');
            if (fill) fill.style.width = `${total}%`;
            if (text) text.textContent = `${Math.round(total)}% (${this.currentIndex}/${this.tariffsToCreate.length})`;
        }

        updateButtonsForImportState() {
            if (!this.sidebar) return;
            const startBtn = document.getElementById('sidebar-update-start');
            const stopBtn = document.getElementById('sidebar-update-stop');
            const configStartBtn = document.getElementById('sidebar-update-config-start');
            const configStopBtn = document.getElementById('sidebar-update-config-stop');
            const importAllBtn = document.getElementById('sidebar-update-config-import-all');
            const progressStopBtn = document.getElementById('sidebar-update-stop-btn');

            if (this.isImporting) {
                if (startBtn) startBtn.style.display = 'none';
                if (stopBtn) stopBtn.style.display = 'block';
                if (configStartBtn) configStartBtn.style.display = 'none';
                if (configStopBtn) configStopBtn.style.display = 'block';
                if (importAllBtn) importAllBtn.disabled = true;
                if (progressStopBtn) progressStopBtn.disabled = false;
            } else {
                if (startBtn) startBtn.style.display = 'block';
                if (stopBtn) stopBtn.style.display = 'none';
                if (configStartBtn) configStartBtn.style.display = 'block';
                if (configStopBtn) configStopBtn.style.display = 'none';
                if (importAllBtn) importAllBtn.disabled = false;
                if (progressStopBtn) progressStopBtn.disabled = false;
            }
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
            this.addSidebarLog('⏹️ Импорт остановлен пользователем', 'warning');
            this.applyStoppedState('Импорт остановлен пользователем');
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

            const entry = { time: new Date().toLocaleTimeString(), message: message, type: type };
            this.logEntries.push(entry);
            while (this.logEntries.length > 120) this.logEntries.shift();
            this.saveLogToStorage();
            this.renderLog();
            this.renderConfigLog();
        }

        renderConfigLog() {
            const logDiv = document.getElementById('sidebar-update-config-log');
            if (!logDiv) return;
            logDiv.innerHTML = '';
            if (this.logEntries.length === 0) {
                logDiv.innerHTML = '<div style="color: #60a5fa;">💡 Готов к импорту</div>';
                return;
            }
            const colors = { success: '#4ade80', error: '#f87171', info: '#60a5fa', warning: '#fbbf24' };
            for (const entry of this.logEntries) {
                const div = document.createElement('div');
                div.style.color = colors[entry.type] || '#94a3b8';
                div.style.marginBottom = '6px';
                div.style.fontSize = '11px';
                div.innerHTML = `[${entry.time}] ${entry.message}`;
                logDiv.appendChild(div);
            }
            requestAnimationFrame(() => { logDiv.scrollTop = logDiv.scrollHeight; });
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

            const topInputs = dialog.querySelectorAll('div._inputWrapper_17t87_8._medium_17t87_141 input[type="text"]');
            if (topInputs[0]) this.setInputValue(topInputs[0], tariff.elevatorPrice?.internalPrice || '');
            if (topInputs[1]) this.setInputValue(topInputs[1], tariff.elevatorPrice?.customerPrice || '');

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