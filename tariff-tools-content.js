// Tariff Export/Import Pro - полный функционал экспорта и импорта
(function() {
    'use strict';
    
    class TariffExporter {
        constructor() {
            this.isExporting = false;
            this.shouldStop = false;
            this.tariffsList = [];
            this.tariffsData = [];
            this.baseUrl = '';
            this.totalTariffs = 0;
            this.currentUuidIndex = 0;
            this.currentDataIndex = 0;
            this.exportPhase = 'idle';
            this.navButton = null;
            this.importButton = null;
            this.updateButton = null;
            this.renameButton = null;
            this.pvzCreateButton = null;
            this.sidebar = null;
            this.startTime = null;
            this.logEntries = [];
            this.currentTimeout = null;
            
            console.log('[TariffExportPro] Загружен');
            
            this.injectProStyles();
            this.restoreFromStorage();
            this.checkAndAddButtons();
            this.observeForTariffs();
            
            window.addEventListener('storage', (e) => {
                if (e.key === 'tariff_export_state') {
                    this.restoreFromStorage();
                    this.updateSidebarDisplay();
                    this.restoreLogFromStorage();
                }
                if (e.key === 'tariff_export_log') {
                    this.restoreLogFromStorage();
                }
                if (e.key === 'collected_tariff_data') {
                    this.handleCollectedData(e.newValue);
                }
                if (e.key === 'tariff_export_stop') {
                    this.handleStopSignal();
                }
            });
        }

        injectProStyles() {
            if (document.getElementById('tariff-pro-custom-styles')) return;
            const style = document.createElement('style');
            style.id = 'tariff-pro-custom-styles';
            style.textContent = `
                .tariff-pro-rows-group {
                    display: flex;
                    flex-direction: column;
                    gap: 10px;
                    width: 100%;
                }
                .tariff-pro-extra-actions-row {
                    display: flex;
                    justify-content: flex-end;
                    width: 100%;
                }
                .tariff-pro-extra-actions-inner {
                    display: flex;
                    gap: 8px;
                    flex-wrap: wrap;
                }
                .tariff-pro-btn {
                    color: #ffffff !important;
                    border-radius: 4px !important;
                    padding: 0 16px !important;
                    height: 32px !important;
                    font-size: 12px !important;
                    font-family: inherit !important;
                    font-weight: 600 !important;
                    text-transform: uppercase !important;
                    letter-spacing: 0.3px !important;
                    box-shadow: 0 1px 3px rgba(0,0,0,0.1), inset 0 1px 0 rgba(255,255,255,0.1) !important;
                    transition: all 0.2s ease !important;
                    display: inline-flex !important;
                    align-items: center !important;
                    border: 1px solid rgba(0,0,0,0.15) !important;
                    cursor: pointer !important;
                    text-decoration: none !important;
                    margin-right: 0px !important;
                }
                .tariff-pro-btn > div {
                    display: flex;
                    gap: 4px;
                    align-items: center;
                }
                .tariff-pro-btn:hover {
                    box-shadow: 0 2px 6px rgba(0,0,0,0.15), inset 0 1px 0 rgba(255,255,255,0.2) !important;
                    filter: brightness(1.08);
                }
                .tariff-pro-btn:active {
                    transform: translateY(1px);
                    box-shadow: none !important;
                }
                /* Строгие корпоративные цвета */
                .btn-pro-pvz { background: linear-gradient(180deg, #3b82f6 0%, #2563eb 100%) !important; }
                .btn-pro-create { background: linear-gradient(180deg, #10b981 0%, #059669 100%) !important; }
                .btn-pro-rename { background: linear-gradient(180deg, #8b5cf6 0%, #7c3aed 100%) !important; }
                .btn-pro-import { background: linear-gradient(180deg, #f59e0b 0%, #d97706 100%) !important; }
                .btn-pro-export { background: linear-gradient(180deg, #475569 0%, #334155 100%) !important; }
                .btn-pro-export-active { background: linear-gradient(180deg, #059669 0%, #047857 100%) !important; border-color: #047857 !important; }
            `;
            document.head.appendChild(style);
        }
        
        restoreFromStorage() {
            const savedState = localStorage.getItem('tariff_export_state');
            if (savedState) {
                const state = JSON.parse(savedState);
                this.isExporting = state.isExporting || false;
                this.tariffsData = state.tariffsData || [];
                this.tariffsList = state.tariffsList || [];
                this.totalTariffs = state.totalTariffs || 0;
                this.currentUuidIndex = state.currentUuidIndex || 0;
                this.currentDataIndex = state.currentDataIndex || 0;
                
                if (this.isExporting && !this.sidebar) {
                    this.createSidebar();
                    this.updateSidebarDisplay();
                    this.restoreLogFromStorage();
                }
            }
        }
        
        saveStateToStorage() {
            const state = {
                isExporting: this.isExporting,
                tariffsData: this.tariffsData,
                tariffsList: this.tariffsList,
                totalTariffs: this.totalTariffs,
                currentUuidIndex: this.currentUuidIndex,
                currentDataIndex: this.currentDataIndex,
                startTime: this.startTime
            };
            localStorage.setItem('tariff_export_state', JSON.stringify(state));
        }
        
        saveLogToStorage() {
            localStorage.setItem('tariff_export_log', JSON.stringify(this.logEntries));
        }
        
        restoreLogFromStorage() {
            const savedLog = localStorage.getItem('tariff_export_log');
            if (savedLog && this.sidebar) {
                this.logEntries = JSON.parse(savedLog);
                this.renderLog();
            }
        }
        
        renderLog() {
            const logDiv = document.getElementById('sidebar-log');
            if (!logDiv) return;
            
            logDiv.innerHTML = '';
            if (this.logEntries.length === 0) {
                const emptyMsg = document.createElement('div');
                emptyMsg.style.color = '#60a5fa';
                emptyMsg.textContent = '💡 Готов к работе';
                logDiv.appendChild(emptyMsg);
                return;
            }
            
            const colors = {
                success: '#4ade80',
                error: '#f87171',
                info: '#60a5fa',
                warning: '#fbbf24'
            };
            
            for (const entry of this.logEntries) {
                const entryDiv = document.createElement('div');
                entryDiv.style.color = colors[entry.type] || '#94a3b8';
                entryDiv.style.marginBottom = '6px';
                entryDiv.style.padding = '4px 0';
                entryDiv.style.borderBottom = '1px solid #334155';
                entryDiv.style.fontSize = '11px';
                entryDiv.textContent = `[${entry.time}] ${entry.message}`;
                logDiv.appendChild(entryDiv);
            }
            requestAnimationFrame(() => { logDiv.scrollTop = logDiv.scrollHeight; });
        }
        
        checkAndAddButtons() {
            if (this.shouldShowNavigationButtons()) {
                this.addNavigationButtons();
            } else {
                this.removeNavigationButtons();
            }
        }
        
        checkTariffsExist() {
            let cards = Array.from(document.querySelectorAll('.css-nr5n4g'));
            if (cards.length === 0) {
                const mainColumn = document.querySelector('.main-column');
                if (mainColumn) cards = Array.from(mainColumn.querySelectorAll('.css-nr5n4g'));
            }
            return cards.length > 0;
        }

        hasCreateTariffButton() {
            const buttons = Array.from(document.querySelectorAll('button'));
            return buttons.some(btn => {
                const btnText = (btn.textContent || '').trim();
                return btnText === 'Создать' || btnText.includes('Создать');
            });
        }

        hasEmptyTariffsState() {
            const pageText = document.body?.innerText || '';
            return pageText.includes('Нет тарифов') && this.hasCreateTariffButton();
        }

        shouldShowNavigationButtons() {
            return this.checkTariffsExist() || this.hasCreateTariffButton() || this.hasEmptyTariffsState();
        }
        
        findDisableAllButton() {
            const buttons = document.querySelectorAll('button');
            for (const btn of buttons) {
                const btnText = btn.textContent.trim();
                if (btnText === 'Отключить все' || btnText.includes('Отключить все')) {
                    return btn;
                }
            }
            return null;
        }
        
        getStandardButtonClasses() {
            const buttons = document.querySelectorAll('button');
            for (const btn of buttons) {
                const btnText = btn.textContent.trim();
                if (btnText === 'Создать' || btnText.includes('Создать')) {
                    let safeClasses = btn.className.replace(/_failureButton[^\s]*/g, '').replace(/_defaultButton[^\s]*/g, '');
                    return {
                        classes: `${safeClasses} tariff-pro-btn`, 
                        hasDiv: btn.querySelector('div') !== null
                    };
                }
            }
            return { classes: 'tariff-pro-btn', hasDiv: true };
        }
        
        addNavigationButtons() {
            this.injectProStyles();

            if (document.querySelector('#tariff-export-pro-nav-btn') && 
                document.querySelector('#tariff-create-pro-nav-btn') &&
                document.querySelector('#tariff-import-pro-nav-btn') &&
                document.querySelector('#tariff-rename-pro-nav-btn') &&
                document.querySelector('#tariff-pvz-create-pro-nav-btn')) return;

            const disableAllBtn = this.findDisableAllButton();
            if (!disableAllBtn || !disableAllBtn.parentNode) {
                this.addButtonsToContainer();
                return;
            }

            const standardClasses = this.getStandardButtonClasses();
            const standardRow = disableAllBtn.parentNode;
            const actionRow = standardRow.parentNode;
            const hostContainer = actionRow && actionRow.parentNode ? actionRow.parentNode : null;

            if (!actionRow || !hostContainer) {
                this.addButtonsToContainer();
                return;
            }

            let rowsGroup = hostContainer.querySelector(':scope > .tariff-pro-rows-group');
            if (!rowsGroup) {
                rowsGroup = document.createElement('div');
                rowsGroup.className = 'tariff-pro-rows-group';
                hostContainer.insertBefore(rowsGroup, actionRow);
                rowsGroup.appendChild(actionRow);
            }

            let extraRow = rowsGroup.querySelector(':scope > .tariff-pro-extra-actions-row');
            if (!extraRow) {
                extraRow = document.createElement('div');
                extraRow.className = 'tariff-pro-extra-actions-row';

                const innerRow = document.createElement('div');
                innerRow.className = 'tariff-pro-extra-actions-inner';
                extraRow.appendChild(innerRow);

                rowsGroup.appendChild(extraRow);
            }

            const targetContainer = extraRow.querySelector('.tariff-pro-extra-actions-inner') || extraRow;

            const createProButton = (id, text, colorClass, onClickAction) => {
                const btn = document.createElement('button');
                btn.id = id;
                btn.className = `${standardClasses.classes} ${colorClass}`;
                
                const innerDiv = document.createElement('div');
                const span = document.createElement('span');
                span.textContent = text;
                innerDiv.appendChild(span);
                btn.appendChild(innerDiv);
                
                btn.onclick = onClickAction;
                targetContainer.appendChild(btn);
                return btn;
            };

            // ИЗМЕНЕНО: Вызываем showPvzSidebar вместо input.click()
            this.pvzCreateButton = createProButton('tariff-pvz-create-pro-nav-btn', 'Массовое ПВЗ', 'btn-pro-pvz', () => this.showPvzSidebar());
            this.importButton = createProButton('tariff-create-pro-nav-btn', 'Массовое Доставка', 'btn-pro-create', () => this.showImportSidebar());
            this.renameButton = createProButton('tariff-rename-pro-nav-btn', 'Переименовать', 'btn-pro-rename', () => this.showRenameSidebar());
            this.updateButton = createProButton('tariff-import-pro-nav-btn', 'Импорт', 'btn-pro-import', () => this.showUpdateSidebar());
            this.navButton = createProButton('tariff-export-pro-nav-btn', this.isExporting ? 'Экспорт (активен)' : 'Экспорт', this.isExporting ? 'btn-pro-export-active' : 'btn-pro-export', () => this.showSidebar());

            console.log('[TariffExportPro] Кнопки собраны (строгий дизайн)');
        }

        addButtonsToContainer() {
            const flexDivs = document.querySelectorAll('div[style*="display: flex"][style*="gap"]');
            
            for (const div of flexDivs) {
                const buttons = div.querySelectorAll('button');
                const buttonTexts = Array.from(buttons).map(btn => btn.textContent.trim());
                
                if (buttonTexts.some(text => text.includes('Отключить все')) ||
                    buttonTexts.some(text => text.includes('Изменить цены')) ||
                    buttonTexts.some(text => text.includes('Создать'))) {
                    
                    const standardClasses = this.getStandardButtonClasses();
                    
                    const createProButton = (id, text, colorClass, onClickAction) => {
                        const btn = document.createElement('button');
                        btn.id = id;
                        btn.className = `${standardClasses.classes} ${colorClass}`;
                        
                        const innerDiv = document.createElement('div');
                        const span = document.createElement('span');
                        span.textContent = text;
                        innerDiv.appendChild(span);
                        btn.appendChild(innerDiv);
                        
                        btn.onclick = onClickAction;
                        return btn;
                    };

                    // ИЗМЕНЕНО: Вызываем showPvzSidebar вместо input.click()
                    this.pvzCreateButton = createProButton('tariff-pvz-create-pro-nav-btn', 'Массовое ПВЗ', 'btn-pro-pvz', () => this.showPvzSidebar());
                    this.importButton = createProButton('tariff-create-pro-nav-btn', 'Массовое Доставка', 'btn-pro-create', () => this.showImportSidebar());
                    this.renameButton = createProButton('tariff-rename-pro-nav-btn', 'Переименование', 'btn-pro-rename', () => this.showRenameSidebar());
                    this.updateButton = createProButton('tariff-import-pro-nav-btn', 'Импорт', 'btn-pro-import', () => this.showUpdateSidebar());
                    this.navButton = createProButton('tariff-export-pro-nav-btn', this.isExporting ? 'Экспорт (активен)' : 'Экспорт', this.isExporting ? 'btn-pro-export-active' : 'btn-pro-export', () => this.showSidebar());

                    div.insertBefore(this.navButton, div.firstChild);
                    div.insertBefore(this.updateButton, div.firstChild);
                    div.insertBefore(this.renameButton, div.firstChild);
                    div.insertBefore(this.importButton, div.firstChild);
                    div.insertBefore(this.pvzCreateButton, div.firstChild);
                    return;
                }
            }
        }
        
        removeNavigationButtons() {
            if (this.navButton && this.navButton.parentNode) {
                this.navButton.remove();
                this.navButton = null;
            }
            if (this.importButton && this.importButton.parentNode) {
                this.importButton.remove();
                this.importButton = null;
            }
            if (this.updateButton && this.updateButton.parentNode) {
                this.updateButton.remove();
            }
            if (this.renameButton && this.renameButton.parentNode) {
                this.renameButton.remove();
                this.renameButton = null;
            }
            this.updateButton = null;
            const existingExportBtn = document.querySelector('#tariff-export-pro-nav-btn');
            if (existingExportBtn) existingExportBtn.remove();
            const existingCreateBtn = document.querySelector('#tariff-create-pro-nav-btn');
            if (existingCreateBtn) existingCreateBtn.remove();
            const existingImportBtn = document.querySelector('#tariff-import-pro-nav-btn');
            if (existingImportBtn) existingImportBtn.remove();
            const existingRenameBtn = document.querySelector('#tariff-rename-pro-nav-btn');
            if (existingRenameBtn) existingRenameBtn.remove();
            const existingPvzBtn = document.querySelector('#tariff-pvz-create-pro-nav-btn');
            if (existingPvzBtn) existingPvzBtn.remove();
        }

        // ДОБАВЛЕНО: Новый метод для запуска ПВЗ-сайдбара
        showPvzSidebar() {
            const tryShowSidebar = () => {
                if (typeof window.openPVZTariffCreator === 'function') {
                    window.openPVZTariffCreator();
                    return true;
                }
                return false;
            };

            if (tryShowSidebar()) {
                return;
            }

            this.addSidebarLog('⏳ Ожидание инициализации модуля ПВЗ...', 'info');

            let attempts = 0;
            const maxAttempts = 20;
            const waitInterval = setInterval(() => {
                attempts++;

                if (tryShowSidebar()) {
                    clearInterval(waitInterval);
                    return;
                }

                if (attempts >= maxAttempts) {
                    clearInterval(waitInterval);
                    console.error('[TariffExportPro] openPVZTariffCreator не инициализирован');
                    alert('Модуль массового создания ПВЗ не найден. Проверьте, загрузился ли pvz-tariff-creator.js');
                }
            }, 250);
        }
        
        showImportSidebar() {
            const tryEnsureCreator = () => {
                try {
                    if ((!window.tariffCreatorPro || typeof window.tariffCreatorPro.showConfigSidebar !== 'function') &&
                        typeof window.ensureTariffCreatorPro === 'function') {
                        window.ensureTariffCreatorPro();
                    }
                } catch (error) {
                    console.error('[TariffExportPro] Ошибка запуска ensureTariffCreatorPro:', error);
                }
            };

            const tryShowSidebar = () => {
                tryEnsureCreator();
                if (window.tariffCreatorPro && typeof window.tariffCreatorPro.showConfigSidebar === 'function') {
                    window.tariffCreatorPro.showConfigSidebar();
                    return true;
                }
                return false;
            };
            
            if (tryShowSidebar()) {
                return;
            }
            
            this.addSidebarLog('⏳ Ожидание инициализации модуля массового создания...', 'info');
            
            let attempts = 0;
            const maxAttempts = 20;
            const waitInterval = setInterval(() => {
                attempts++;
                
                if (tryShowSidebar()) {
                    clearInterval(waitInterval);
                    return;
                }
                
                if (attempts >= maxAttempts) {
                    clearInterval(waitInterval);
                    console.error('[TariffExportPro] tariffCreatorPro не инициализирован');
                    this.addSidebarLog('❌ Ошибка: модуль массового создания не инициализировался', 'error');
                }
            }, 250);
        }

        showUpdateSidebar() {
            const tryShowSidebar = () => {
                if (window.tariffUpdaterPro && typeof window.tariffUpdaterPro.showConfigSidebar === 'function') {
                    window.tariffUpdaterPro.showConfigSidebar();
                    return true;
                }
                return false;
            };

            if (tryShowSidebar()) {
                return;
            }

            this.addSidebarLog('⏳ Ожидание инициализации модуля импорта...', 'info');

            let attempts = 0;
            const maxAttempts = 20;
            const waitInterval = setInterval(() => {
                attempts++;

                if (tryShowSidebar()) {
                    clearInterval(waitInterval);
                    return;
                }

                if (attempts >= maxAttempts) {
                    clearInterval(waitInterval);
                    console.error('[TariffExportPro] tariffUpdaterPro не инициализирован');
                    this.addSidebarLog('❌ Ошибка: модуль импорта не инициализировался', 'error');
                }
            }, 250);
        }

        showRenameSidebar() {
            const tryShowSidebar = () => {
                if (window.tariffRenamerPro && typeof window.tariffRenamerPro.showConfigSidebar === 'function') {
                    window.tariffRenamerPro.showConfigSidebar();
                    return true;
                }
                return false;
            };

            if (tryShowSidebar()) {
                return;
            }

            this.addSidebarLog('⏳ Ожидание инициализации модуля переименования...', 'info');

            let attempts = 0;
            const maxAttempts = 20;
            const waitInterval = setInterval(() => {
                attempts++;

                if (tryShowSidebar()) {
                    clearInterval(waitInterval);
                    return;
                }

                if (attempts >= maxAttempts) {
                    clearInterval(waitInterval);
                    console.error('[TariffExportPro] tariffRenamerPro не инициализирован');
                    this.addSidebarLog('❌ Ошибка: модуль переименования не инициализировался', 'error');
                }
            }, 250);
        }

        createBaseSidebar() {
            if (this.sidebar) this.sidebar.remove();
            this.sidebar = document.createElement('div');
            this.sidebar.id = 'tariff-export-sidebar';
            this.sidebar.style.cssText = `
                position: fixed;
                top: 0;
                right: 0;
                width: 450px;
                height: 100vh;
                background: #1e293b;
                box-shadow: -2px 0 20px rgba(0,0,0,0.3);
                z-index: 1000001;
                display: flex;
                flex-direction: column;
                font-family: 'Segoe UI', Arial, sans-serif;
                border-left: 1px solid #334155;
            `;
            this.sidebar.innerHTML = `
                <div style="padding: 16px 20px; background: #0f172a; border-bottom: 1px solid #334155; display: flex; justify-content: space-between; align-items: center;">
                    <div>
                        <h3 style="color: #60a5fa; margin: 0; font-size: 18px;">📤 Экспорт тарифов</h3>
                        <div style="color: #94a3b8; font-size: 11px; margin-top: 4px;">Сбор тарифов доставки и сохранение в Excel</div>
                    </div>
                    <div style="display: flex; gap: 8px;">
                        <button id="sidebar-export-minimize" style="background: none; border: none; color: #94a3b8; font-size: 18px; cursor: pointer; padding: 4px 8px;">−</button>
                        <button id="sidebar-export-close" style="background: none; border: none; color: #94a3b8; font-size: 20px; cursor: pointer; padding: 4px 8px;">×</button>
                    </div>
                </div>
            `;
            document.body.appendChild(this.sidebar);
            document.getElementById('sidebar-export-close').onclick = () => this.hideSidebar();
            document.getElementById('sidebar-export-minimize').onclick = () => this.minimizeSidebar();
        }

        createSidebar() {
            this.createBaseSidebar();

            const content = document.createElement('div');
            content.style.cssText = 'display:flex; flex-direction:column; flex:1 1 auto; min-height:0; overflow:hidden;';
            content.innerHTML = `
                <div id="sidebar-status" style="background: #0f172a; margin: 16px; padding: 12px; border-radius: 8px; border-left: 3px solid #60a5fa;">
                    <div style="color: #60a5fa; font-size: 13px; font-weight: 500;" id="sidebar-status-title">🔄 Ожидание</div>
                    <div style="color: #94a3b8; font-size: 11px; margin-top: 6px;" id="sidebar-status-detail">Нажмите «Старт экспорта» для начала сбора тарифов</div>
                </div>

                <div id="sidebar-progress" style="margin: 0 16px 16px 16px;">
                    <div style="height: 8px; background: #334155; border-radius: 4px; overflow: hidden;">
                        <div id="sidebar-progress-fill" style="width: 0%; height: 100%; background: linear-gradient(90deg, #60a5fa, #3b82f6);"></div>
                    </div>
                    <div id="sidebar-progress-text" style="text-align: center; font-size: 12px; color: #94a3b8; margin-top:4px;">0%</div>
                    <div id="sidebar-time-estimate" style="text-align: center; font-size: 11px; color: #60a5fa; margin-top: 6px;"></div>
                </div>

                <div style="margin: 0 16px 16px 16px;">
                    <div style="display: flex; gap: 8px; justify-content: space-between;">
                        <div style="flex: 1; background: #0f172a; border-radius: 6px; padding: 8px; text-align: center;">
                            <div style="font-size: 20px; font-weight: bold; color: #60a5fa;" id="sidebar-tariff-uuid">0</div>
                            <div style="font-size: 10px; color: #94a3b8;">UUID собрано</div>
                        </div>
                        <div style="flex: 1; background: #0f172a; border-radius: 6px; padding: 8px; text-align: center;">
                            <div style="font-size: 20px; font-weight: bold; color: #60a5fa;" id="sidebar-tariff-total">0</div>
                            <div style="font-size: 10px; color: #94a3b8;">Всего тарифов</div>
                        </div>
                        <div style="flex: 1; background: #0f172a; border-radius: 6px; padding: 8px; text-align: center;">
                            <div style="font-size: 20px; font-weight: bold; color: #10b981;" id="sidebar-tariff-collected">0</div>
                            <div style="font-size: 10px; color: #94a3b8;">Данных собрано</div>
                        </div>
                    </div>
                </div>

                <div id="sidebar-log" style="flex: 1 1 auto; min-height: 0; background: #0f172a; margin: 0 16px 16px 16px; padding: 12px; border-radius: 8px; overflow-y: auto; overflow-x: hidden; font-size: 11px; line-height: 1.4; font-family: monospace; white-space: pre-wrap; word-break: break-word;"></div>

                <div style="padding: 16px; border-top: 1px solid #334155; display:flex; gap:8px;">
                    <button id="sidebar-start" style="flex:1; padding: 10px; background: linear-gradient(135deg, #60a5fa, #3b82f6); color:white; border:none; border-radius:6px; cursor:pointer;">🚀 Старт экспорта</button>
                    <button id="sidebar-stop" style="flex:1; padding: 10px; background: #dc2626; color:white; border:none; border-radius:6px; cursor:pointer; display:none;">⏹️ Остановить</button>
                    <button id="sidebar-save" style="flex:1; padding: 10px; background: #10b981; color:white; border:none; border-radius:6px; cursor:pointer; display:none;">💾 Сохранить Excel</button>
                </div>
            `;
            this.sidebar.appendChild(content);

            document.getElementById('sidebar-start').onclick = () => this.startExport();
            document.getElementById('sidebar-stop').onclick = () => this.stopExport();
            document.getElementById('sidebar-save').onclick = () => this.saveExcelFile();

            this.updateSidebarDisplay();
            this.restoreLogFromStorage();
        }

        updateButtonsForExportState() {
            if (!this.sidebar) return;
            
            const startBtn = document.getElementById('sidebar-start');
            const stopBtn = document.getElementById('sidebar-stop');
            const saveBtn = document.getElementById('sidebar-save');
            
            if (this.isExporting) {
                if (startBtn) startBtn.style.display = 'none';
                if (stopBtn) stopBtn.style.display = 'block';
                if (saveBtn) saveBtn.style.display = 'none';
            } else if (this.tariffsData.length > 0) {
                if (startBtn) startBtn.style.display = 'none';
                if (stopBtn) stopBtn.style.display = 'none';
                if (saveBtn) saveBtn.style.display = 'block';
            } else {
                if (startBtn) startBtn.style.display = 'block';
                if (stopBtn) stopBtn.style.display = 'none';
                if (saveBtn) saveBtn.style.display = 'none';
            }
        }
        
        minimizeSidebar() {
            this.hideSidebar();
        }
        
        restoreSidebar() {
            if (this.sidebar) {
                this.sidebar.style.display = 'flex';
            }
        }
        
        showSidebar() {
            if (this.sidebar) {
                this.sidebar.style.display = 'flex';
                this.restoreSidebar();
                this.updateButtonsForExportState();
                this.restoreLogFromStorage();
            } else {
                this.createSidebar();
            }
        }
        
        hideSidebar() {
            if (this.sidebar) {
                this.sidebar.style.display = 'none';
            }
        }
        
        updateSidebarDisplay() {
            if (!this.sidebar) return;

            const statusDetail = document.getElementById('sidebar-status-detail');
            const fill = document.getElementById('sidebar-progress-fill');
            const text = document.getElementById('sidebar-progress-text');
            const uuidSpan = document.getElementById('sidebar-tariff-uuid');
            const totalSpan = document.getElementById('sidebar-tariff-total');
            const collectedSpan = document.getElementById('sidebar-tariff-collected');

            const total = this.totalTariffs || 0;
            let progressPercent = 0;
            let progressLabel = '0%';

            if (total > 0) {
                if (this.exportPhase === 'uuid' && this.currentUuidIndex > 0) {
                    progressPercent = (this.currentUuidIndex / total) * 100;
                    progressLabel = `${Math.round(progressPercent)}% (UUID ${this.currentUuidIndex}/${total})`;
                    if (statusDetail) statusDetail.textContent = `Получение идентификаторов: ${this.currentUuidIndex}/${total}`;
                } else if (this.exportPhase === 'data' && this.currentDataIndex > 0) {
                    progressPercent = (this.currentDataIndex / total) * 100;
                    progressLabel = `${Math.round(progressPercent)}% (Данные ${this.currentDataIndex}/${total})`;
                    if (statusDetail) statusDetail.textContent = `Сбор данных тарифов: ${this.currentDataIndex}/${total}`;
                } else if (this.tariffsData.length > 0) {
                    progressPercent = (this.tariffsData.length / total) * 100;
                    progressLabel = `${Math.round(progressPercent)}% (${this.tariffsData.length}/${total})`;
                } else if (this.tariffsList.length > 0) {
                    progressPercent = (this.tariffsList.length / total) * 100;
                    progressLabel = `${Math.round(progressPercent)}% (UUID ${this.tariffsList.length}/${total})`;
                }
            }

            if (fill) fill.style.width = `${progressPercent}%`;
            if (text) text.textContent = progressLabel;
            if (uuidSpan) uuidSpan.textContent = String(this.tariffsList.length);
            if (totalSpan) totalSpan.textContent = String(this.totalTariffs);
            if (collectedSpan) collectedSpan.textContent = String(this.tariffsData.length);

            this.updateEstimatedTimeDisplay();
            this.updateButtonsForExportState();
        }

        updateEstimatedTimeDisplay() {
            if (!this.startTime || this.tariffsData.length === 0 || !this.isExporting) return;
            
            const elapsedSeconds = (Date.now() - this.startTime) / 1000;
            const itemsProcessed = this.tariffsData.length;
            const itemsRemaining = this.totalTariffs - itemsProcessed;
            
            if (itemsProcessed === 0 || itemsRemaining === 0) return;
            
            const secondsPerItem = elapsedSeconds / itemsProcessed;
            const remainingSeconds = Math.ceil(secondsPerItem * itemsRemaining);
            
            const timeEstimateDiv = document.getElementById('sidebar-time-estimate');
            if (timeEstimateDiv && remainingSeconds > 0) {
                const minutes = Math.floor(remainingSeconds / 60);
                const seconds = remainingSeconds % 60;
                const timeText = minutes > 0 ? `${minutes} мин ${seconds} сек` : `${seconds} сек`;
                timeEstimateDiv.innerHTML = `⏱️ Осталось примерно: ${timeText}`;
            } else if (timeEstimateDiv) {
                timeEstimateDiv.innerHTML = '⏱️ Завершается...';
            }
        }
        
        addSidebarLog(message, type = 'info') {
            const entry = {
                time: new Date().toLocaleTimeString(),
                message: message,
                type: type
            };
            this.logEntries.push(entry);
            
            while (this.logEntries.length > 200) {
                this.logEntries.shift();
            }
            
            this.saveLogToStorage();
            this.renderLog();
        }
        
        updateSidebarStatus(title, detail) {
            const titleDiv = document.getElementById('sidebar-status-title');
            const detailDiv = document.getElementById('sidebar-status-detail');
            if (titleDiv) titleDiv.textContent = title;
            if (detailDiv) detailDiv.textContent = detail;
        }
        
        handleCollectedData(dataStr) {
            if (!dataStr) return;
            try {
                const data = JSON.parse(dataStr);
                if (data.tariffData && data.requestId) {
                    this.saveStateToStorage();
                    this.updateSidebarDisplay();
                }
            } catch(e) {}
        }
        
        handleStopSignal() {
            this.shouldStop = true;
            this.isExporting = false;
            this.addSidebarLog('⏹️ Экспорт остановлен из другой вкладки', 'warning');
            this.updateSidebarStatus('⏹️ Остановлен', 'Экспорт прерван');
            this.saveStateToStorage();
            this.updateSidebarDisplay();
            this.updateButtonsForExportState();
            
            if (this.navButton) {
                const span = this.navButton.querySelector('span');
                if (span) span.textContent = 'Экспорт';
                this.navButton.className = `${this.getStandardButtonClasses().classes} btn-pro-export`;
            }
        }
        
        async startExport() {
            if (this.isExporting) return;
            
            this.isExporting = true;
            this.shouldStop = false;
            this.tariffsData = [];
            this.tariffsList = [];
            this.logEntries = [];
            this.baseUrl = window.location.href;
            this.startTime = Date.now();
            this.currentUuidIndex = 0;
            this.currentDataIndex = 0;
            this.exportPhase = 'idle';
            
            localStorage.removeItem('tariff_export_data');
            
            this.createSidebar();
            this.showSidebar();
            this.updateButtonsForExportState();
            this.saveLogToStorage();
            
            this.addSidebarLog('🚀 Начало сбора данных', 'info');
            this.updateSidebarStatus('🔄 Сбор данных', 'Подготовка к экспорту...');
            
            try {
                await this.waitForCards();
                
                if (this.shouldStop) throw new Error('Экспорт остановлен пользователем');
                
                let cards = this.getCurrentCards();
                this.totalTariffs = cards.length;
                
                if (this.totalTariffs === 0) throw new Error('Тарифы не найдены');
                
                this.addSidebarLog(`📊 Найдено тарифов: ${this.totalTariffs}`, 'success');
                this.updateSidebarDisplay();
                
                this.exportPhase = 'uuid';
                this.addSidebarLog('📋 Сбор UUID...', 'info');
                this.updateSidebarStatus('📋 Сбор UUID', 'Получение идентификаторов тарифов...');
                
                for (let i = 0; i < this.totalTariffs; i++) {
                    if (this.shouldStop) {
                        this.addSidebarLog('⏹️ Экспорт остановлен пользователем', 'warning');
                        throw new Error('Экспорт остановлен');
                    }
                    
                    const freshCards = this.getCurrentCards();
                    if (i >= freshCards.length) continue;
                    
                    const card = freshCards[i];
                    const name = this.getTariffName(card);
                    const titleElement = card.querySelector('.css-17i8ct5');
                    
                    this.updateSidebarDisplay();
                    this.addSidebarLog(`🔍 Получение UUID: ${name.substring(0, 35)}...`, 'info');
                    
                    const uuid = await this.getUuidFromCard(titleElement, name);
                    
                    if (this.shouldStop) throw new Error('Экспорт остановлен');
                    
                    if (uuid) {
                        this.tariffsList.push({ name, uuid });
                        this.currentUuidIndex = i + 1;
                        this.addSidebarLog(`✅ UUID получен: ${name.substring(0, 35)}`, 'success');
                    } else {
                        this.addSidebarLog(`❌ Ошибка получения UUID: ${name.substring(0, 35)}`, 'error');
                    }
                    
                    this.saveStateToStorage();
                    this.updateSidebarDisplay();
                }
                
                if (this.shouldStop) throw new Error('Экспорт остановлен');
                
                const validTariffs = this.tariffsList.filter(t => t.uuid);
                this.addSidebarLog(`📦 Собрано UUID: ${validTariffs.length}/${this.totalTariffs}`, 'success');
                
                if (validTariffs.length === 0) throw new Error('Не удалось получить UUID');
                
                this.exportPhase = 'data';
                this.addSidebarLog('📝 Сбор данных тарифов...', 'info');
                this.updateSidebarStatus('📝 Сбор данных', 'Открытие вкладок для сбора информации...');
                
                this.startTime = Date.now();
                
                for (let i = 0; i < validTariffs.length; i++) {
                    if (this.shouldStop) {
                        this.addSidebarLog('⏹️ Экспорт остановлен пользователем', 'warning');
                        throw new Error('Экспорт остановлен');
                    }
                    
                    const tariff = validTariffs[i];
                    this.updateSidebarDisplay();
                    this.addSidebarLog(`📥 Сбор данных: ${tariff.name.substring(0, 35)}...`, 'info');
                    
                    const tariffUrl = `${this.baseUrl}/${tariff.uuid}`;
                    const collectedData = await this.openAndCollect(tariffUrl, tariff.name);
                    
                    if (this.shouldStop) throw new Error('Экспорт остановлен');
                    
                    if (collectedData) {
                        this.tariffsData.push(collectedData);
                        this.currentDataIndex = i + 1;
                        this.addSidebarLog(`✅ Данные собраны: ${tariff.name.substring(0, 35)}`, 'success');
                    } else {
                        this.addSidebarLog(`❌ Ошибка сбора: ${tariff.name.substring(0, 35)}`, 'error');
                    }
                    
                    this.saveStateToStorage();
                    this.updateSidebarDisplay();
                    await this.delay(1000);
                }
                
                if (this.shouldStop) throw new Error('Экспорт остановлен');
                
                localStorage.setItem('tariff_export_data', JSON.stringify(this.tariffsData));
                
                this.exportPhase = 'done';
                this.addSidebarLog(`✨ Собрано ${this.tariffsData.length} тарифов!`, 'success');
                this.updateSidebarStatus('✅ Завершено', `Собрано ${this.tariffsData.length} тарифов. Нажмите "Сохранить Excel"`);
                this.updateSidebarDisplay();
                
            } catch (error) {
                if (error.message === 'Экспорт остановлен' || error.message === 'Экспорт остановлен пользователем') {
                    this.addSidebarLog('⏹️ Экспорт остановлен', 'warning');
                    this.updateSidebarStatus('⏹️ Остановлен', 'Экспорт прерван пользователем');
                    
                    if (this.tariffsData.length > 0) {
                        localStorage.setItem('tariff_export_data', JSON.stringify(this.tariffsData));
                        this.addSidebarLog(`💾 Сохранено ${this.tariffsData.length} частично собранных тарифов`, 'info');
                        this.updateSidebarStatus('⚠️ Частичный сбор', `Собрано ${this.tariffsData.length} тарифов. Можно сохранить`);
                    }
                } else {
                    this.addSidebarLog(`❌ Ошибка: ${error.message}`, 'error');
                    this.updateSidebarStatus('❌ Ошибка', error.message);
                }
            } finally {
                this.isExporting = false;
                this.saveStateToStorage();
                
                this.updateSidebarDisplay();
                this.updateButtonsForExportState();
                
                setTimeout(() => {
                    if (this.tariffsData.length > 0 && !this.isExporting) {
                        this.updateButtonsForExportState();
                        if (this.sidebar) {
                            const saveBtn = document.getElementById('sidebar-save');
                            if (saveBtn && saveBtn.style.display !== 'block') {
                                saveBtn.style.display = 'block';
                                const startBtn = document.getElementById('sidebar-start');
                                if (startBtn) startBtn.style.display = 'none';
                            }
                        }
                    }
                }, 500);
                
                if (this.navButton) {
                    const span = this.navButton.querySelector('span');
                    if (span) span.textContent = 'Экспорт';
                    this.navButton.className = `${this.getStandardButtonClasses().classes} btn-pro-export`;
                }
            }
        }
        
        stopExport() {
            this.shouldStop = true;
            this.isExporting = false;
            this.addSidebarLog('⏹️ Экспорт остановлен пользователем', 'warning');
            this.updateSidebarStatus('⏹️ Остановлен', 'Экспорт прерван пользователем');
            this.saveStateToStorage();
            this.updateSidebarDisplay();
            this.updateButtonsForExportState();
            
            localStorage.setItem('tariff_export_stop', Date.now().toString());
            setTimeout(() => {
                localStorage.removeItem('tariff_export_stop');
            }, 1000);
            
            if (this.navButton) {
                const span = this.navButton.querySelector('span');
                if (span) span.textContent = 'Экспорт';
                this.navButton.className = `${this.getStandardButtonClasses().classes} btn-pro-export`;
            }
        }
        
        saveExcelFile() {
            let tariffsData = [];
            const savedData = localStorage.getItem('tariff_export_data');
            if (savedData) {
                tariffsData = JSON.parse(savedData);
            }
            
            if (this.tariffsData.length > 0) {
                tariffsData = this.tariffsData;
            }
            
            if (!tariffsData || tariffsData.length === 0) {
                this.addSidebarLog('Нет данных для сохранения', 'error');
                return;
            }
            
            this.addSidebarLog(`📊 Создание Excel файла (${tariffsData.length} тарифов)...`, 'info');
            const saved = this.createFinalExcel(tariffsData);
            if (!saved) {
                return;
            }

            this.resetExportStateAfterSave();
        }
        
        resetExportStateAfterSave() {
            localStorage.removeItem('tariff_export_state');
            localStorage.removeItem('tariff_export_data');
            localStorage.removeItem('tariff_export_log');
            localStorage.removeItem('tariff_to_collect');
            localStorage.removeItem('collected_tariff_data');

            this.isExporting = false;
            this.shouldStop = false;
            this.tariffsData = [];
            this.tariffsList = [];
            this.logEntries = [];
            this.totalTariffs = 0;
            this.currentUuidIndex = 0;
            this.currentDataIndex = 0;
            this.startTime = null;

            this.updateSidebarDisplay();
            this.updateButtonsForExportState();
            this.addSidebarLog('🗑️ Данные очищены после сохранения. Можно начать новый экспорт', 'info');
        }

        getCurrentCards() {
            let cards = Array.from(document.querySelectorAll('.css-nr5n4g'));
            if (cards.length === 0) {
                const mainColumn = document.querySelector('.main-column');
                if (mainColumn) cards = Array.from(mainColumn.querySelectorAll('.css-nr5n4g'));
            }
            return cards;
        }
        
        getTariffName(card) {
            const title = card.querySelector('.css-17i8ct5');
            return title ? title.textContent.trim() : 'Неизвестный тариф';
        }
        
        async openAndCollect(tariffUrl, tariffName) {
            return new Promise(async (resolve) => {
                const requestId = Date.now() + '_' + Math.random();
                
                localStorage.setItem('tariff_to_collect', JSON.stringify({
                    name: tariffName,
                    url: tariffUrl,
                    requestId: requestId
                }));
                
                window.open(tariffUrl, '_blank');
                
                const startedAt = Date.now();
                const timeoutMs = 60000;
                const checkInterval = setInterval(() => {
                    if (this.shouldStop) {
                        clearInterval(checkInterval);
                        resolve(null);
                        return;
                    }

                    const response = localStorage.getItem('collected_tariff_data');
                    if (response) {
                        try {
                            const data = JSON.parse(response);
                            if (data.requestId === requestId) {
                                clearInterval(checkInterval);
                                localStorage.removeItem('collected_tariff_data');
                                resolve(data.tariffData);
                                return;
                            }
                        } catch (error) {
                            console.warn('[TariffExportPro] Ошибка чтения collected_tariff_data:', error);
                        }
                    }

                    if (Date.now() - startedAt >= timeoutMs) {
                        clearInterval(checkInterval);
                        resolve(null);
                    }
                }, 100);
            });
        }

        waitForUrlChange(previousUrl, { timeout = 5000, interval = 50 } = {}) {
            return new Promise((resolve) => {
                const startedAt = Date.now();
                const timer = setInterval(() => {
                    if (this.shouldStop) {
                        clearInterval(timer);
                        resolve(null);
                        return;
                    }

                    if (window.location.href !== previousUrl) {
                        clearInterval(timer);
                        resolve(window.location.href);
                        return;
                    }

                    if (Date.now() - startedAt >= timeout) {
                        clearInterval(timer);
                        resolve(null);
                    }
                }, interval);
            });
        }

        waitForUrl(targetUrl, { timeout = 5000, interval = 50 } = {}) {
            return new Promise((resolve) => {
                const startedAt = Date.now();
                const timer = setInterval(() => {
                    if (this.shouldStop) {
                        clearInterval(timer);
                        resolve(false);
                        return;
                    }

                    if (window.location.href === targetUrl) {
                        clearInterval(timer);
                        resolve(true);
                        return;
                    }

                    if (Date.now() - startedAt >= timeout) {
                        clearInterval(timer);
                        resolve(false);
                    }
                }, interval);
            });
        }
        
        async getUuidFromCard(titleElement, tariffName) {
            if (!titleElement) return null;
            
            const beforeUrl = window.location.href;
            titleElement.click();

            const newUrl = await this.waitForUrlChange(beforeUrl, { timeout: 5000, interval: 50 });
            
            if (newUrl && newUrl !== beforeUrl) {
                const uuidMatch = newUrl.match(/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i);
                if (uuidMatch) {
                    const uuid = uuidMatch[1];
                    window.history.back();
                    await this.waitForUrl(beforeUrl, { timeout: 4000, interval: 50 });
                    await this.waitForCards({ timeout: 2500, interval: 100 });
                    return uuid;
                }
            }
            return null;
        }
        
        waitForCards({ timeout = 3000, interval = 100, minCount = 1 } = {}) {
            return new Promise((resolve) => {
                const startedAt = Date.now();
                const check = () => {
                    if (this.shouldStop) {
                        resolve();
                        return;
                    }

                    if (this.getCurrentCards().length >= minCount) {
                        resolve();
                        return;
                    }

                    if (Date.now() - startedAt >= timeout) {
                        resolve();
                        return;
                    }

                    setTimeout(check, interval);
                };
                check();
            });
        }
        
        formatIntervalTime(value) {
            const text = String(value == null ? '' : value).trim();
            if (!text || text === '-' || text === '—') return '-';
            const match = text.match(/^(\d{2}:\d{2})(?::\d{2})?$/);
            return match ? match[1] : text;
        }

        formatIntervalsForExcel(intervals) {
            if (!Array.isArray(intervals) || intervals.length === 0) return '-';
            return intervals
                .map(interval => {
                    if (!interval) return '';
                    const orderBefore = this.formatIntervalTime(interval.orderBefore);
                    const startTime = this.formatIntervalTime(interval.startTime);
                    const endTime = this.formatIntervalTime(interval.endTime);
                    const internalAdjustment = interval.internalPriceAdjustment || '-';
                    const priceAdjustment = interval.priceAdjustment || '-';
                    return `${startTime}-${endTime} (до ${orderBefore}, вн:${internalAdjustment}, кл:${priceAdjustment})`;
                })
                .filter(Boolean)
                .join('; ');
        }

        parseNumericValue(value) {
            if (typeof value === 'number' && Number.isFinite(value)) return value;
            const raw = String(value == null ? '' : value).trim();
            if (!raw || raw === '-' || raw === '—') return null;
            const normalized = raw.replace(/\s+/g, '').replace(',', '.');
            if (!/^-?\d+(?:\.\d+)?$/.test(normalized)) return null;
            const num = Number(normalized);
            return Number.isFinite(num) ? num : null;
        }

        createFinalExcel(tariffsData) {
            const rows = [];

            for (const tariff of tariffsData) {
                const mgxRows = (tariff.mgxRows && tariff.mgxRows.length) ? tariff.mgxRows : [{}];
                const floorRows = (tariff.floorRows && tariff.floorRows.length) ? tariff.floorRows : [{}];
                const maxRows = Math.max(mgxRows.length, floorRows.length, 1);
                const elevator = tariff.elevatorPrice || tariff.elevatorPrices || {};
                const tariffName = tariff.name || tariff.tariffName || '-';

                for (let i = 0; i < maxRows; i++) {
                    const mgx = mgxRows[i] || {};
                    const floor = floorRows[i] || {};

                    const row = {};
                    row['Название тарифа'] = tariffName || '-';
                    row['Зоны доставки'] = (tariff.zones || []).join('; ') || '-';
                    row['Филиалы'] = (tariff.branches || []).join('; ') || '-';
                    row['Интервалы доставки'] = this.formatIntervalsForExcel(tariff.intervals);
                    row['Подъем на лифте внутренняя, руб'] = elevator.internalPrice || '-';
                    row['Подъем на лифте клиент, руб'] = elevator.customerPrice || '-';

                    row['Макс. вес (МГХ), кг'] = mgx.weight || '-';
                    row['Цена внутренняя, руб'] = mgx.internal || '-';
                    row['Цена покупателя, руб'] = mgx.customer || '-';
                    row['Цена возврата, руб'] = mgx.return || '-';

                    row['Макс. вес (подъем), кг'] = floor.weight || '-';
                    row['Стоимость внутренняя за 1 этаж, руб'] = floor.internalPrice || '-';
                    row['Начиная с этажа (внутр.)'] = floor.internalThreshold || '-';
                    row['Стоимость для клиента за 1 этаж, руб'] = floor.customerPrice || '-';
                    row['Начиная с этажа (клиент)'] = floor.customerThreshold || '-';

                    row['Оплата картой'] = tariff.payment?.card ? 'да' : 'нет';
                    row['Оплата наличными'] = tariff.payment?.cash ? 'да' : 'нет';
                    row['В день оформления'] = tariff.acceptance?.sameDay ? 'да' : 'нет';
                    row['На следующий день'] = tariff.acceptance?.nextDay ? 'да' : 'нет';
                    row['Исправный товар'] = tariff.saleTypes?.product ? 'да' : 'нет';
                    row['Уцененный товар'] = tariff.saleTypes?.markdown ? 'да' : 'нет';
                    row['Юридические лица'] = tariff.saleTypes?.legal ? 'да' : 'нет';
                    row['Сервисный центр'] = tariff.saleTypes?.service ? 'да' : 'нет';

                    row['Количество дней доставки'] = tariff.deliveryDays || tariff.params?.deliveryDays || tariff.delivery?.days || '0';
                    row['Отсечка оформления заказа'] = tariff.cutoffTime || tariff.params?.cutoffTime || tariff.delivery?.cutoff || '00:00';
                    row['Лимит стоимости заказа, руб'] = tariff.costLimit || tariff.params?.costLimit || tariff.limit?.cost || '';
                    rows.push(row);
                }
            }

            if (rows.length === 0) {
                this.addSidebarLog('Нет данных для сохранения', 'error');
                return false;
            }

            const headers = Object.keys(rows[0]);
            const numericHeaders = new Set([
                'Подъем на лифте внутренняя, руб',
                'Подъем на лифте клиент, руб',
                'Макс. вес (МГХ), кг',
                'Цена внутренняя, руб',
                'Цена покупателя, руб',
                'Цена возврата, руб',
                'Макс. вес (подъем), кг',
                'Стоимость внутренняя за 1 этаж, руб',
                'Начиная с этажа (внутр.)',
                'Стоимость для клиента за 1 этаж, руб',
                'Начиная с этажа (клиент)'
            ]);

            const sheetData = [headers];
            for (const row of rows) {
                const sheetRow = [];
                for (const header of headers) {
                    const rawValue = row[header] ?? '-';
                    if (numericHeaders.has(header)) {
                        const num = this.parseNumericValue(rawValue);
                        sheetRow.push(num == null ? '-' : num);
                    } else {
                        sheetRow.push(rawValue);
                    }
                }
                sheetData.push(sheetRow);
            }

            if (typeof XLSX === 'undefined') {
                this.addSidebarLog('❌ Библиотека Excel не загружена', 'error');
                return false;
            }

            return this.createExcelFile(sheetData, numericHeaders);
        }

        buildSheetOld(data, numericHeaders = new Set()) {
            const ws = {};
            const range = { s: { c: 0, r: 0 }, e: { c: 0, r: 0 } };
            const headers = data[0] || [];

            for (let R = 0; R < data.length; ++R) {
                for (let C = 0; C < data[R].length; ++C) {
                    if (range.e.r < R) range.e.r = R;
                    if (range.e.c < C) range.e.c = C;

                    let value = data[R][C];
                    const header = headers[C];
                    if (R > 0 && numericHeaders.has(header)) {
                        const num = this.parseNumericValue(value);
                        value = num == null ? '' : num;
                    }

                    const cell = { v: value == null ? '' : value };
                    if (typeof cell.v === 'number') cell.t = 'n';
                    else if (typeof cell.v === 'boolean') cell.t = 'b';
                    else cell.t = 's';

                    const cellRef = XLSX.utils.encode_cell({ c: C, r: R });
                    ws[cellRef] = cell;
                }
            }

            ws['!ref'] = XLSX.utils.encode_range(range);
            return ws;
        }

        createExcelFile(sheetData, numericHeaders = new Set()) {
            try {
                if (typeof XLSX === 'undefined') {
                    this.addSidebarLog('❌ XLSX не найден', 'error');
                    return false;
                }

                const wb = {
                    SheetNames: [],
                    Sheets: {}
                };

                const ws = this.buildSheetOld(sheetData, numericHeaders);

                const colWidths = [];
                for (let i = 0; i < sheetData[0].length; i++) {
                    let maxLen = 0;
                    for (let j = 0; j < Math.min(sheetData.length, 100); j++) {
                        const cellValue = sheetData[j][i];
                        const len = String(cellValue || '').length;
                        if (len > maxLen) maxLen = len;
                    }
                    colWidths.push({ wch: Math.min(Math.max(maxLen + 2, 10), 50) });
                }
                ws['!cols'] = colWidths;

                const sheetName = 'Тарифы';
                wb.SheetNames.push(sheetName);
                wb.Sheets[sheetName] = ws;

                const wbout = XLSX.write(wb, {
                    bookType: 'xlsx',
                    type: 'binary'
                });

                const s2ab = (s) => {
                    const buf = new ArrayBuffer(s.length);
                    const view = new Uint8Array(buf);
                    for (let i = 0; i < s.length; i++) {
                        view[i] = s.charCodeAt(i) & 0xFF;
                    }
                    return buf;
                };

                const blob = new Blob([s2ab(wbout)], {
                    type: 'application/octet-stream'
                });

                const timestamp = new Date().toISOString().slice(0, 19).replace(/:/g, '-');
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = `тарифы_${timestamp}.xlsx`;
                document.body.appendChild(a);
                a.click();

                setTimeout(() => {
                    if (a.parentNode) {
                        a.parentNode.removeChild(a);
                    }
                    URL.revokeObjectURL(url);
                }, 100);

                this.addSidebarLog('✅ Файл XLSX сохранен!', 'success');
                return true;
            } catch (error) {
                this.addSidebarLog(`❌ Ошибка создания файла: ${error.message}`, 'error');
                return false;
            }
        }
        
        observeForTariffs() {
            const observer = new MutationObserver(() => {
                if (this.shouldShowNavigationButtons()) {
                    if (!document.querySelector('#tariff-export-pro-nav-btn') || 
                        !document.querySelector('#tariff-create-pro-nav-btn') || 
                        !document.querySelector('#tariff-import-pro-nav-btn') ||
                        !document.querySelector('#tariff-rename-pro-nav-btn')) {
                        this.addNavigationButtons();
                    }
                } else {
                    this.removeNavigationButtons();
                }
            });
            
            observer.observe(document.body, {
                childList: true,
                subtree: true
            });
        }
        
        delay(ms) {
            return new Promise(resolve => setTimeout(resolve, ms));
        }
    }
    
    if (!window.tariffExportPro) {
        window.tariffExportPro = new TariffExporter();
    }
})();

// Добавляем обработчик сообщений для связи с popup (если нужно)
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'getStatus' && window.tariffExportPro) {
        const hasData = window.tariffExportPro.tariffsData.length > 0;
        sendResponse({
            success: true,
            hasData: hasData,
            tariffCount: window.tariffExportPro.tariffsData.length
        });
        return true;
    }
    
    if (request.action === 'showExportSidebar' && window.tariffExportPro) {
        window.tariffExportPro.showSidebar();
        sendResponse({success: true});
        return true;
    }
    
    if (request.action === 'showImportSidebar') {
        if (window.tariffExportPro) {
            window.tariffExportPro.showImportSidebar();
        }
        sendResponse({success: true});
        return true;
    }

    if (request.action === 'showRenameSidebar') {
        if (window.tariffExportPro) {
            window.tariffExportPro.showRenameSidebar();
        }
        sendResponse({success: true});
        return true;
    }

    // ДОБАВЛЕНО: Обработка сообщения для вызова ПВЗ из popup
    if (request.action === 'showPvzSidebar') {
        if (window.tariffExportPro) {
            window.tariffExportPro.showPvzSidebar();
        }
        sendResponse({success: true});
        return true;
    }
});

// Для совместимости с popup.js
window.addEventListener('message', (event) => {
    if (event.data && event.data.action === 'showImportSidebar') {
        if (window.tariffExportPro) {
            window.tariffExportPro.showImportSidebar();
        }
    }

    if (event.data && event.data.action === 'showUpdateSidebar') {
        if (window.tariffExportPro) {
            window.tariffExportPro.showUpdateSidebar();
        }
    }

    if (event.data && event.data.action === 'showRenameSidebar') {
        if (window.tariffExportPro) {
            window.tariffExportPro.showRenameSidebar();
        }
    }
    
    if (event.data && event.data.action === 'showExportSidebar') {
        if (window.tariffExportPro) {
            window.tariffExportPro.showSidebar();
        }
    }

    // ДОБАВЛЕНО: Обработка сообщения для вызова ПВЗ из сторонних скриптов/страницы
    if (event.data && event.data.action === 'showPvzSidebar') {
        if (window.tariffExportPro) {
            window.tariffExportPro.showPvzSidebar();
        }
    }
});