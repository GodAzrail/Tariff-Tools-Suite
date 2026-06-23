

(function() {
    'use strict';

    class TariffCreatorPro {

        constructor() {
            this.storageKeys = {
                data: 'tariff_create_data',
                state: 'tariff_create_state',
                log: 'tariff_create_log',
                config: 'tariff_create_config'
            };

            this.isImporting = false;
            this.shouldStop = false;
            this.importStarted = false;
            this.continueImportTriggered = false;
            this.tariffsToCreate = [];
            this.currentIndex = 0;
            this.sidebar = null;
            this.baseTariffsUrl = '';
            this.logEntries = [];
            this.lastCreateFailure = null;

            this.config = {
                paymentCard: false,
                paymentCash: false,
                acceptanceSameDay: false,
                acceptanceNextDay: false,
                saleProduct: true,
                saleMarkdown: false,
                saleLegal: false,
                saleService: false
            };

            console.log('[TariffCreatorPro] ========== ЗАГРУЗКА ========== ');
            console.log('[TariffCreatorPro] URL:', window.location.href);

            this.restoreFromStorage();
            this.restoreConfigFromStorage();
            this.registerStorageListener();
            this.registerPageWatchers();

            setTimeout(() => this.checkForContinueImport(), 600);
            setTimeout(() => this.checkForContinueImport(), 2000);
        }

        // ==================== ВСПОМОГАТЕЛЬНЫЕ МЕТОДЫ ====================

        registerStorageListener() {
            window.addEventListener('storage', (e) => {
                if (e.key === this.storageKeys.state || e.key === this.storageKeys.data) {
                    this.restoreFromStorage();
                    if (this.sidebar) {
                        this.updateSidebarDisplay();
                        this.restoreLogFromStorage();
                    }
                }
            });
        }

        registerPageWatchers() {
            if (this.formCheckInterval) clearInterval(this.formCheckInterval);
            this.formCheckInterval = setInterval(() => {
                if (!this.isImporting || this.importStarted) return;
                if (this.isCreatePage()) {
                    console.log('[TariffCreatorPro] 🎉 Обнаружена форма создания тарифа');
                    this.importStarted = true;
                    setTimeout(() => this.startImportOnCreatePage(), 1200);
                }
            }, 500);
        }

        isCreatePage() {
            return !!this.findNameInput();
        }

        isTariffsListPage() {
            return /\/configurator\/tariffs(?:\/[0-9a-f-]+)?\/?(?:\?|#)?$/i.test(window.location.href);
        }

        findNameInput() {
            return document.querySelector('input[placeholder*="Введите название тарифа"]');
        }

        restoreConfigFromStorage() {
            const raw = localStorage.getItem(this.storageKeys.config);
            if (!raw) return;
            try {
                this.config = { ...this.config, ...JSON.parse(raw) };
            } catch (error) {
                console.error('[TariffCreatorPro] Ошибка чтения конфига:', error);
            }
        }

        restoreFromStorage() {
            const stateRaw = localStorage.getItem(this.storageKeys.state);
            if (!stateRaw) return;
            try {
                const state = JSON.parse(stateRaw);
                this.isImporting = !!state.isImporting;
                this.currentIndex = Number(state.currentIndex || 0);
                this.tariffsToCreate = Array.isArray(state.tariffs) ? state.tariffs : [];
                this.baseTariffsUrl = state.baseTariffsUrl || this.baseTariffsUrl || window.location.href;
            } catch (error) {
                console.error('[TariffCreatorPro] Ошибка чтения состояния:', error);
            }
        }

        saveStateToStorage() {
            localStorage.setItem(this.storageKeys.state, JSON.stringify({
                isImporting: this.isImporting,
                currentIndex: this.currentIndex,
                tariffs: this.tariffsToCreate,
                baseTariffsUrl: this.baseTariffsUrl
            }));
        }

        saveDataToStorage() {
            localStorage.setItem(this.storageKeys.data, JSON.stringify({
                tariffs: this.tariffsToCreate,
                config: this.config,
                currentIndex: this.currentIndex,
                shouldStart: this.isImporting,
                baseTariffsUrl: this.baseTariffsUrl
            }));
        }

        clearStorage() {
            localStorage.removeItem(this.storageKeys.data);
            localStorage.removeItem(this.storageKeys.state);
            localStorage.removeItem(this.storageKeys.log);
        }

        saveLogToStorage() {
            localStorage.setItem(this.storageKeys.log, JSON.stringify(this.logEntries));
        }

        restoreLogFromStorage() {
            const raw = localStorage.getItem(this.storageKeys.log);
            if (!raw || !this.sidebar) return;
            try {
                this.logEntries = JSON.parse(raw);
                this.renderLog();
            } catch (error) {
                console.error('[TariffCreatorPro] Ошибка чтения лога:', error);
            }
        }

        addSidebarLog(message, type = 'info') {
            const time = new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
            this.logEntries.push({ time, message, type });
            if (this.logEntries.length > 200) this.logEntries.shift();
            this.saveLogToStorage();
            this.renderLog();
        }

        renderLog() {
            const logDiv = document.getElementById('tariff-create-log');
            if (!logDiv) return;
            logDiv.innerHTML = '';
            const colors = { success: '#4ade80', error: '#f87171', info: '#60a5fa', warning: '#fbbf24' };
            if (this.logEntries.length === 0) {
                const empty = document.createElement('div');
                empty.style.color = '#60a5fa';
                empty.textContent = '💡 Готов к массовому созданию';
                logDiv.appendChild(empty);
                return;
            }
            for (const entry of this.logEntries) {
                const div = document.createElement('div');
                div.style.cssText = 'margin-bottom: 6px; padding: 4px 0; border-bottom: 1px solid #334155; font-size: 11px;';
                div.style.color = colors[entry.type] || '#94a3b8';
                div.textContent = `[${entry.time}] ${entry.message}`;
                logDiv.appendChild(div);
            }
            requestAnimationFrame(() => { logDiv.scrollTop = logDiv.scrollHeight; });
        }

        closeOtherSidebars() {
            const sidebarIds = ['tariff-export-sidebar', 'tariff-create-config-sidebar', 'tariff-create-progress-sidebar', 'tariff-update-config-sidebar', 'tariff-update-sidebar'];
            sidebarIds.forEach(id => {
                if (!this.sidebar || id !== this.sidebar.id) {
                    const el = document.getElementById(id);
                    if (el) el.style.display = 'none';
                }
            });
        }

        showConfigSidebar() {
            if (this.isImporting && this.tariffsToCreate.length > 0) {
                this.createProgressSidebar();
                this.showSidebar();
                this.updateSidebarDisplay();
                this.restoreLogFromStorage();
                return;
            }
            this.createConfigSidebar();
            this.showSidebar();
            this.restoreLogFromStorage();
        }

        showSidebar() {
            this.closeOtherSidebars();
            if (this.sidebar) this.sidebar.style.display = 'flex';
        }

        hideSidebar() {
            if (this.sidebar) this.sidebar.style.display = 'none';
        }

        minimizeSidebar() {
            this.hideSidebar();
        }

        createBaseSidebar(id, title, subtitle, accent) {
            if (this.sidebar) this.sidebar.remove();
            this.sidebar = document.createElement('div');
            this.sidebar.id = id;
            this.sidebar.style.cssText = `
                position: fixed; top: 0; right: 0; width: 450px; height: 100vh;
                background: #1e293b; box-shadow: -2px 0 20px rgba(0,0,0,0.3); z-index: 1000002;
                display: flex; flex-direction: column; font-family: 'Segoe UI', Arial, sans-serif;
                border-left: 1px solid #334155;
            `;
            this.sidebar.innerHTML = `
                <div style="padding: 16px 20px; background: #0f172a; border-bottom: 1px solid #334155; display: flex; justify-content: space-between; align-items: center;">
                    <div>
                        <h3 style="color: ${accent}; margin: 0; font-size: 18px;">${title}</h3>
                        <div style="color: #94a3b8; font-size: 11px; margin-top: 4px;">${subtitle}</div>
                    </div>
                    <div style="display: flex; gap: 8px;">
                        <button id="tariff-create-minimize" style="background: none; border: none; color: #94a3b8; font-size: 18px; cursor: pointer; padding: 4px 8px;">−</button>
                        <button id="tariff-create-close" style="background: none; border: none; color: #94a3b8; font-size: 20px; cursor: pointer; padding: 4px 8px;">×</button>
                    </div>
                </div>
            `;
            document.body.appendChild(this.sidebar);
            document.getElementById('tariff-create-close').onclick = () => this.hideSidebar();
            document.getElementById('tariff-create-minimize').onclick = () => this.minimizeSidebar();
        }

        createConfigSidebar() {
            this.createBaseSidebar('tariff-create-config-sidebar', '➕ Массовое создание тарифов', 'Создание новых тарифов из Excel', '#10b981');

            const content = document.createElement('div');
            content.style.cssText = 'display:flex; flex-direction:column; flex:1 1 auto; min-height:0; overflow:hidden;';
            content.innerHTML = `
                <div style="padding: 16px; background: #0f172a; margin: 16px; border-radius: 8px;">
                    <div style="margin-bottom: 12px;">
                        <label style="color: #94a3b8; font-size: 12px; display: block; margin-bottom: 6px;">📁 Excel файл</label>
                        <input type="file" id="tariff-create-file-input" accept=".xls,.xlsx,.xlsm" style="background: #334155; color: white; border: none; padding: 8px; border-radius: 6px; width: 100%; cursor: pointer;">
                    </div>
                    <div style="color:#94a3b8; font-size:11px; line-height:1.5;">
                        Формат колонок такой же, как в импорте/обновлении: название, зоны, филиалы, интервалы, цены, способы оплаты и виды продажи.
                    </div>
                </div>

                <div id="tariff-create-status-box" style="background: #0f172a; margin: 0 16px 16px 16ms; padding: 12px; border-radius: 8px; border-left: 3px solid #10b981;">
                    <div style="color: #10b981; font-size: 13px; font-weight: 500;" id="tariff-create-status-title">📋 Выберите файл</div>
                    <div style="color: #94a3b8; font-size: 11px; margin-top: 6px;" id="tariff-create-status-detail">После выбора файла нажмите «Начать создание»</div>
                </div>

                <div style="margin: 0 16ms 16ms 16ms;">
                    <div style="height: 8px; background: #334155; border-radius: 4px; overflow: hidden;">
                        <div id="tariff-create-progress-fill" style="width: 0%; height: 100%; background: linear-gradient(90deg, #10b981, #059669);"></div>
                    </div>
                    <div id="tariff-create-progress-text" style="text-align: center; font-size: 12px; color: #94a3b8; margin-top:4px;">0%</div>
                </div>

                <div style="display: flex; justify-content: space-between; margin: 0 16ms 4px 16ms; align-items: center;">
                    <div style="color: #94a3b8; font-size: 11px;">Логи:</div>
                    <button id="tariff-create-clear-log" style="background: none; border: none; color: #ef4444; font-size: 11px; cursor: pointer; padding: 0;">🗑️ Очистить</button>
                </div>
                <div id="tariff-create-log" style="flex: 1 1 auto; min-height: 0; background: #0f172a; margin: 0 16ms 16ms 16ms; padding: 12px; border-radius: 8px; overflow-y: auto; overflow-x: hidden; font-size: 11px; line-height: 1.4; font-family: monospace; white-space: pre-wrap; word-break: break-word;"></div>

                <div style="padding: 16px; border-top: 1px solid #334155; display:flex; gap:8px;">
                    <button id="tariff-create-start" style="flex:1; padding: 10px; background: linear-gradient(135deg, #10b981, #059669); color:white; border:none; border-radius:6px; cursor:pointer;">🚀 Начать создание</button>
                    <button id="tariff-create-stop" style="flex:1; padding: 10px; background: #dc2626; color:white; border:none; border-radius:6px; cursor:pointer; display:none;">⏹️ Остановить</button>
                </div>
            `;
            this.sidebar.appendChild(content);

            document.getElementById('tariff-create-file-input').onchange = (e) => this.loadExcelFile(e.target.files[0]);
            document.getElementById('tariff-create-start').onclick = () => this.startImport();
            document.getElementById('tariff-create-stop').onclick = () => this.stopImport();
            document.getElementById('tariff-create-clear-log').onclick = () => {
                this.logEntries = [];
                this.saveLogToStorage();
                this.renderLog();
            };

            this.renderLog();
            this.updateSidebarDisplay();
        }

        createProgressSidebar() {
            this.createBaseSidebar('tariff-create-progress-sidebar', '➕ Массовое создание тарифов', 'Создание новых тарифов из Excel', '#10b981');

            const content = document.createElement('div');
            content.style.cssText = 'display:flex; flex-direction:column; flex:1 1 auto; min-height:0; overflow:hidden;';
            content.innerHTML = `
                <div id="tariff-create-status-box" style="background: #0f172a; margin: 16px; padding: 12px; border-radius: 8px; border-left: 3px solid #10b981;">
                    <div style="color: #10b981; font-size: 13px; font-weight: 500;" id="tariff-create-status-title">⏳ Подготовка</div>
                    <div style="color: #94a3b8; font-size: 11px; margin-top: 6px;" id="tariff-create-status-detail">Ожидание перехода на форму создания</div>
                </div>
                <div style="margin: 0 16ms 16ms 16ms;">
                    <div style="height: 8px; background: #334155; border-radius: 4px; overflow: hidden;">
                        <div id="tariff-create-progress-fill" style="width: 0%; height: 100%; background: linear-gradient(90deg, #10b981, #059669);"></div>
                    </div>
                    <div id="tariff-create-progress-text" style="text-align: center; font-size: 12px; color: #94a3b8; margin-top:4px;">0%</div>
                </div>
                
                <div style="display: flex; justify-content: space-between; margin: 0 16ms 4px 16ms; align-items: center;">
                    <div style="color: #94a3b8; font-size: 11px;">Логи:</div>
                    <button id="tariff-create-clear-log" style="background: none; border: none; color: #ef4444; font-size: 11px; cursor: pointer; padding: 0;">🗑️ Очистить</button>
                </div>
                <div id="tariff-create-log" style="flex: 1 1 auto; min-height: 0; background: #0f172a; margin: 0 16ms 16ms 16ms; padding: 12px; border-radius: 8px; overflow-y: auto; overflow-x: hidden; font-size: 11px; line-height: 1.4; font-family: monospace; white-space: pre-wrap; word-break: break-word;"></div>
                
                <div style="padding: 16px; border-top: 1px solid #334155; display:flex; gap:8px;">
                    <button id="tariff-create-start" style="flex:1; padding: 10px; background: #334155; color:#cbd5e1; border:none; border-radius:6px; cursor:default;" disabled>▶️ В процессе</button>
                    <button id="tariff-create-stop" style="flex:1; padding: 10px; background: #dc2626; color:white; border:none; border-radius:6px; cursor:pointer;">⏹️ Остановить</button>
                </div>
            `;
            this.sidebar.appendChild(content);
            document.getElementById('tariff-create-stop').onclick = () => this.stopImport();
            document.getElementById('tariff-create-clear-log').onclick = () => {
                this.logEntries = [];
                this.saveLogToStorage();
                this.renderLog();
            };

            this.renderLog();
            this.updateSidebarDisplay();
        }

        updateSidebarDisplay() {
            const total = this.tariffsToCreate.length;
            const completed = Math.min(this.currentIndex, total);
            const percent = total > 0 ? Math.round((completed / total) * 100) : 0;

            const fill = document.getElementById('tariff-create-progress-fill');
            const text = document.getElementById('tariff-create-progress-text');
            const title = document.getElementById('tariff-create-status-title');
            const detail = document.getElementById('tariff-create-status-detail');
            const startBtn = document.getElementById('tariff-create-start');
            const stopBtn = document.getElementById('tariff-create-stop');

            if (fill) fill.style.width = `${percent}%`;
            if (text) text.textContent = `${percent}% (${completed}/${total})`;

            if (title) {
                if (!total) title.textContent = '📋 Выберите файл';
                else if (this.isImporting && this.currentIndex < total) title.textContent = `🚀 Создание тарифа ${this.currentIndex + 1} из ${total}`;
                else if (total && this.currentIndex >= total) title.textContent = '✅ Создание завершено';
                else title.textContent = `📦 Загружено тарифов: ${total}`;
            }

            if (detail) {
                if (!total) detail.textContent = 'После выбора файла нажмите «Начать создание»';
                else if (this.isImporting && this.currentIndex < total) detail.textContent = this.isCreatePage() ? 'Заполняем форму создания на текущей странице' : 'Переходим к форме создания тарифа';
                else detail.textContent = `Всего загружено ${total} тарифов`;
            }

            if (startBtn && !startBtn.disabled) startBtn.style.display = this.isImporting ? 'none' : 'block';
            if (stopBtn) stopBtn.style.display = this.isImporting ? 'block' : 'none';
        }

        saveConfig() {
            localStorage.setItem(this.storageKeys.config, JSON.stringify(this.config));
        }

        async loadExcelFile(file) {
            if (!file) return;
            this.logEntries = [];
            this.currentIndex = 0;
            this.clearStorage();
            this.renderLog();

            if (typeof XLSX === 'undefined') {
                this.addSidebarLog('❌ Библиотека XLSX не загружена', 'error');
                return;
            }
            this.addSidebarLog(`📁 Загрузка файла: ${file.name}`, 'info');
            const reader = new FileReader();
            reader.onload = (e) => {
                try {
                    const data = new Uint8Array(e.target.result);
                    const workbook = XLSX.read(data, { type: 'array' });
                    const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
                    const rows = XLSX.utils.sheet_to_json(firstSheet, { header: 1, defval: '' });
                    this.parseTariffs(rows);
                    this.saveConfig();
                    this.saveStateToStorage();
                    this.saveDataToStorage();
                    this.addSidebarLog(`✅ Загружено ${this.tariffsToCreate.length} тарифов`, 'success');
                    this.updateSidebarDisplay();
                } catch (error) {
                    console.error(error);
                    this.addSidebarLog(`❌ Ошибка чтения Excel: ${error.message}`, 'error');
                }
            };
            reader.readAsArrayBuffer(file);
        }

        parseTariffs(rows) {
            this.tariffsToCreate = [];
            this.currentIndex = 0;
            if (!Array.isArray(rows) || rows.length === 0) return;

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
                const raw = String(value ?? '').replace(/ /g, ' ').trim();
                if (!raw || raw === '-' || raw === '—') return [];
                return raw.split(';').map(item => item.trim()).filter(Boolean).map(item => {
                    const match = item.match(/^(\d{2}:\d{2})(?::\d{2})?-(\d{2}:\d{2})(?::\d{2})?\s*\(до\s*(\d{2}:\d{2})(?::\d{2})?,\s*вн:\s*([^,]+),\s*кл:\s*([^\)]+)\)$/i);
                    if (!match) return null;
                    return {
                        startTime: match[1],
                        endTime: match[2],
                        orderBefore: match[3],
                        internalPriceAdjustment: normalizeCell(match[4]),
                        priceAdjustment: normalizeCell(match[5])
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

                const parseBoolOrConfig = (val, configVal) => {
                    const text = String(val ?? '').replace(/ /g, ' ').trim().toLowerCase();
                    if (!text) return configVal;
                    return text === 'да' || text === 'true' || text === '1' || text === 'yes';
                };

                const paymentCard = parseBoolOrConfig(getCell(row, 'Оплата картой', 15), this.config.paymentCard);
                const paymentCash = parseBoolOrConfig(getCell(row, 'Оплата наличными', 16), this.config.paymentCash);
                const acceptanceSameDay = parseBoolOrConfig(getCell(row, 'В день оформления', 17), this.config.acceptanceSameDay);
                const acceptanceNextDay = parseBoolOrConfig(getCell(row, 'На следующий день', 18), this.config.acceptanceNextDay);
                const saleProduct = parseBoolOrConfig(getCell(row, 'Исправный товар', 19), this.config.saleProduct);
                const saleMarkdown = parseBoolOrConfig(getCell(row, 'Уцененный товар', 20), this.config.saleMarkdown);
                const saleLegal = parseBoolOrConfig(getCell(row, 'Юридические лица', 21), this.config.saleLegal);
                const saleService = parseBoolOrConfig(getCell(row, 'Сервисный центр', 22), this.config.saleService);

                let tariff = this.tariffsToCreate.find(t => t.name === tariffName);
                if (!tariff) {
                    tariff = {
                        name: tariffName,
                        zones, branches, intervals, elevatorPrice,
                        mgxRows: [], floorRows: [],
                        payment: { card: paymentCard, cash: paymentCash },
                        acceptance: { sameDay: acceptanceSameDay, nextDay: acceptanceNextDay },
                        saleTypes: { product: saleProduct, markdown: saleMarkdown, legal: saleLegal, service: saleService },
                        sale: { product: saleProduct, markdown: saleMarkdown, legal: saleLegal, service: saleService }
                    };
                    this.tariffsToCreate.push(tariff);
                } else {
                    tariff.payment.card = tariff.payment.card || paymentCard;
                    tariff.payment.cash = tariff.payment.cash || paymentCash;
                    tariff.acceptance.sameDay = tariff.acceptance.sameDay || acceptanceSameDay;
                    tariff.acceptance.nextDay = tariff.acceptance.nextDay || acceptanceNextDay;
                    if (saleProduct) { tariff.saleTypes.product = true; tariff.sale.product = true; }
                    if (saleMarkdown) { tariff.saleTypes.markdown = true; tariff.sale.markdown = true; }
                    if (saleLegal) { tariff.saleTypes.legal = true; tariff.sale.legal = true; }
                    if (saleService) { tariff.saleTypes.service = true; tariff.sale.service = true; }
                }

                if ((!tariff.intervals || tariff.intervals.length === 0) && intervals.length > 0) tariff.intervals = intervals;
                if ((!tariff.elevatorPrice?.internalPrice && !tariff.elevatorPrice?.customerPrice) && (elevatorPrice.internalPrice || elevatorPrice.customerPrice)) {
                    tariff.elevatorPrice = elevatorPrice;
                }
                if (mgxRow.weight || mgxRow.internal || mgxRow.customer || mgxRow.return) tariff.mgxRows.push(mgxRow);
                if (floorRow.weight || floorRow.internalPrice || floorRow.customerPrice) tariff.floorRows.push(floorRow);
            }
        }

        async startImport() {
            if (!this.tariffsToCreate.length) {
                this.addSidebarLog('⚠️ Сначала загрузите Excel файл', 'warning');
                return;
            }
            this.isImporting = true;
            this.shouldStop = false;
            this.importStarted = false;
            this.baseTariffsUrl = window.location.href;

            this.saveStateToStorage();
            this.saveDataToStorage();
            this.createProgressSidebar();
            this.showSidebar();
            this.updateSidebarDisplay();
            this.addSidebarLog(`🚀 Запускаем создание ${this.tariffsToCreate.length} тарифов`, 'info');

            await this.routeToNextStep();
        }

        async routeToNextStep() {
            if (this.shouldStop) return;
            if (this.currentIndex >= this.tariffsToCreate.length) {
                this.finishImport();
                return;
            }
            if (this.isCreatePage() && this.findNameInput()) {
                this.importStarted = true;
                await this.startImportOnCreatePage();
                return;
            }
            if (this.isTariffsListPage()) {
                this.addSidebarLog('📄 Открываем форму создания тарифа', 'info');
                await this.openCreatePageFromList();
                return;
            }
            this.addSidebarLog('↪️ Переход к списку тарифов', 'info');
            window.location.href = `${window.location.origin}/configurator/tariffs/`;
        }

        checkForContinueImport() {
            if (this.continueImportTriggered) return;
            const raw = localStorage.getItem(this.storageKeys.data);
            if (!raw) return;
            try {
                const data = JSON.parse(raw);
                if (!Array.isArray(data.tariffs) || data.tariffs.length === 0) return;
                this.tariffsToCreate = data.tariffs;
                this.config = { ...this.config, ...(data.config || {}) };
                this.currentIndex = Number(data.currentIndex || 0);
                this.baseTariffsUrl = data.baseTariffsUrl || this.baseTariffsUrl || window.location.href;
                this.isImporting = !!data.shouldStart && this.currentIndex < this.tariffsToCreate.length;
                this.saveStateToStorage();

                if (!this.isImporting) return;
                this.continueImportTriggered = true;

                this.createProgressSidebar();
                this.showSidebar();
                this.updateSidebarDisplay();
                this.restoreLogFromStorage();

                if (this.isCreatePage() && this.findNameInput() && !this.importStarted) {
                    this.importStarted = true;
                    setTimeout(() => this.startImportOnCreatePage(), 1200);
                } else if (this.isTariffsListPage()) {
                    setTimeout(() => this.openCreatePageFromList(), 1200);
                }
            } catch (error) {
                console.error('[TariffCreatorPro] Ошибка восстановления данных:', error);
            }
        }

        async openCreatePageFromList() {
            // Делаем несколько попыток с интервалом (до 5 секунд ожидания), так как SPA рендерит интерфейс с задержкой
            for (let attempts = 0; attempts < 10; attempts++) {
                if (this.shouldStop) return;

                // 1. Вдруг форма создания УЖЕ открылась (система запомнила состояние или медленный рендер)
                if (this.isCreatePage() && this.findNameInput()) {
                    this.addSidebarLog('💡 Обнаружена форма создания, продолжаем заполнение', 'info');
                    this.importStarted = true;
                    this.startImportOnCreatePage();
                    return;
                }

                // 2. Ищем кнопку "Создать"
                const buttons = Array.from(document.querySelectorAll('button'));
                const createBtn = buttons.find(btn => {
                    const text = (btn.textContent || '').trim();
                    return text === 'Создать' || text.includes('Создать');
                });

                if (createBtn) {
                    createBtn.click();
                    this.addSidebarLog('🖱️ Нажата кнопка «Создать» на текущей странице тарифов', 'info');
                    return; // Выходим из функции, дальше сработает registerPageWatchers, когда форма откроется
                }

                // Ждем 500мс перед следующей проверкой
                await this.delay(500);
            }

            // Если за 5 секунд ничего не нашлось
            this.addSidebarLog('❌ Кнопка «Создать» или форма создания тарифа не найдены', 'error');
            this.stopImport();
        }

        async startImportOnCreatePage() {
            if (!this.isImporting || this.shouldStop) return;
            if (this.currentIndex >= this.tariffsToCreate.length) {
                this.finishImport();
                return;
            }

            const tariff = this.tariffsToCreate[this.currentIndex];
            this.addSidebarLog(`📝 Создаем тариф: ${tariff.name} (${this.currentIndex + 1}/${this.tariffsToCreate.length})`, 'info');
            this.updateSidebarDisplay();

            try {
                const success = await this.createTariff(tariff);

                if (this.shouldStop) {
                    this.addSidebarLog(`🛑 Работа прервана. Тариф "${tariff.name}" мог быть создан.`, 'error');
                    return;
                }

                if (!success) {
                    const failure = this.getLastCreateFailure();
                    if (failure?.step) {
                        const detailSuffix = failure.details?.block ? ` (блок: ${failure.details.block})` : '';
                        this.addSidebarLog(`❌ Ошибка создания тарифа: ${tariff.name}; шаг: ${failure.step}${detailSuffix}`, 'error');
                    } else {
                        this.addSidebarLog(`❌ Ошибка создания тарифа: ${tariff.name}`, 'error');
                    }
                    this.stopImport();
                    return;
                }

                this.addSidebarLog(`✅ Создан тариф: ${tariff.name}`, 'success');
                this.currentIndex += 1;
                this.importStarted = false;
                this.saveStateToStorage();
                this.saveDataToStorage();
                this.updateSidebarDisplay();

                if (this.currentIndex >= this.tariffsToCreate.length) {
                    this.finishImport();
                    return;
                }

                // Ускоренный возврат к списку для следующего тарифа
                this.addSidebarLog('↩️ Переходим к стартовой странице...', 'info');
                setTimeout(() => {
                    window.location.href = this.baseTariffsUrl || `${window.location.origin}/configurator/tariffs/`;
                }, 600);
            } catch (error) {
                console.error(error);
                this.addSidebarLog(`❌ Ошибка создания: ${error.message}`, 'error');
                this.stopImport();
            }
        }

        stopImport() {
            this.shouldStop = true;
            this.isImporting = false;
            this.importStarted = false;
            this.continueImportTriggered = false;
            this.tariffsToCreate = [];
            this.currentIndex = 0;
            this.clearStorage();
            this.addSidebarLog('⏹️ Массовое создание полностью отменено', 'error');
            this.updateSidebarDisplay();
        }

        /**
         * Завершает импорт и ВОЗВРАЩАЕТ на стартовую страницу.
         */
        finishImport() {
            this.isImporting = false;
            this.importStarted = false;
            this.addSidebarLog('✨ Массовое создание завершено', 'success');
            this.updateSidebarDisplay();
            this.clearStorage();

            // === НОВОЕ: Возврат на стартовую страницу после завершения всех тарифов ===
            if (this.baseTariffsUrl) {
                this.addSidebarLog('↩️ Возвращаемся на стартовую страницу...', 'info');
                setTimeout(() => {
                    window.location.href = this.baseTariffsUrl;
                }, 1200);
            } else {
                // fallback если URL почему-то не сохранён
                this.addSidebarLog('ℹ️ Стартовый URL не найден, остаёмся на текущей странице', 'warning');
            }
        }

        // ==================== SELF-CONTAINED createTariff ====================

        prepareForCreatorRun() {
            this.shouldStop = false;
            this.lastCreateFailure = null;
            return true;
        }

        setCreateFailure(step, details = {}) {
            this.lastCreateFailure = { step, details, url: window.location.href, timestamp: new Date().toISOString() };
            this.addSidebarLog(`❌ createTariff: ${step}`, 'error');
            return false;
        }

        getLastCreateFailure() {
            return this.lastCreateFailure || null;
        }

        stopRequested() {
            return !!this.shouldStop;
        }

        ensureCanContinue(contextMessage) {
            if (this.stopRequested()) {
                this.addSidebarLog(`🛑 Остановлено: ${contextMessage || ''}`, 'warning');
                return false;
            }
            return true;
        }

        async createTariff(tariff) {
            this.lastCreateFailure = null;
            window.currentTariff = tariff;
            this.prepareForCreatorRun();
            if (!this.ensureCanContinue(`перед стартом тарифа ${tariff.name}`)) return false;

            const readyState = await this.waitForCreateFormReady(tariff.name);
            if (!readyState.nameInput) return this.setCreateFailure('name_input_not_found_before_blocks', { tariffName: tariff.name });

            const blockHandlers = [
                { key: 'zones', label: 'Зоны доставки', run: async () => { this.addSidebarLog(`🧩 Зоны доставки`, 'info'); await this.openAndSelectZones(tariff.zones); }},
                { key: 'branches', label: 'Филиалы обслуживания', run: async () => { this.addSidebarLog(`🧩 Филиалы обслуживания`, 'info'); await this.openAndSelectBranches(tariff.branches); }},
                { key: 'mgx', label: 'МГХ сетка', run: async () => { this.addSidebarLog(`🧩 МГХ сетка`, 'info'); await this.fillMgxGridWithValues(tariff.mgxRows); }},
                { key: 'intervals', label: 'Интервалы доставки', run: async () => { this.addSidebarLog(`🧩 Интервалы доставки`, 'info'); await this.openAndSetupIntervals(tariff.intervals); }},
                { key: 'floor', label: 'Подъем на этаж', run: async () => { this.addSidebarLog(`🧩 Подъем на этаж`, 'info'); await this.openAndSetupFloorLifting(tariff); }},
                { key: 'payment', label: 'Способ оплаты', run: async () => { this.addSidebarLog(`🧩 Способ оплаты`, 'info'); await this.setupPayment(tariff); }},
                { key: 'acceptance', label: 'Прием заявок', run: async () => { this.addSidebarLog(`🧩 Прием заявок`, 'info'); await this.setupAcceptance(tariff); }},
                { key: 'saleTypes', label: 'Вид продажи', run: async () => { this.addSidebarLog(`🧩 Вид продажи`, 'info'); await this.setupSaleTypes(tariff); }}
            ];

            for (const block of blockHandlers) {
                if (!this.ensureCanContinue(`перед блоком ${block.label}`)) return false;
                await block.run();
                if (!this.ensureCanContinue(`после блока ${block.label}`)) return false;
                await this.delay(300); // ускорено с 400
            }

            if (!this.ensureCanContinue(`перед названием тарифа`)) return false;

            let nameInput = null;
            let attempts = 0;
            while (!nameInput && attempts < 20) {
                nameInput = document.querySelector('input[placeholder*="Введите название тарифа"]');
                if (!nameInput) await this.delay(250); // ускорено
                attempts++;
            }
            if (!nameInput) return this.setCreateFailure('name_input_not_found');

            this.setInputValue(nameInput, tariff.name);
            nameInput.blur();
            await this.delay(200); // ускорено

            let saveButton = null;
            attempts = 0;
            while (!saveButton && attempts < 30) {
                const allButtons = document.querySelectorAll('button');
                for (const btn of allButtons) {
                    if (btn.textContent.trim() === 'Сохранить' && !btn.closest('dialog[open]') && !btn.disabled) {
                        saveButton = btn;
                        break;
                    }
                }
                if (!saveButton) await this.delay(400); // ускорено
                attempts++;
            }
            if (!saveButton) return this.setCreateFailure('save_button_not_found');

            saveButton.click();
            await this.delay(1800); // ускорено с 2500
            return true;
        }

        async waitForCreateFormReady() {
            for (let attempt = 1; attempt <= 40; attempt++) {
                const nameInput = document.querySelector('input[placeholder*="Введите название тарифа"]');
                const saveButton = Array.from(document.querySelectorAll('button')).find(btn =>
                    btn.textContent.trim() === 'Сохранить' && !btn.closest('dialog[open]') && !btn.disabled
                );
                if (nameInput && saveButton) return { nameInput, saveButton };
                await this.delay(200); // ускорено
            }
            return { nameInput: document.querySelector('input[placeholder*="Введите название тарифа"]'), saveButton: null };
        }

        async delay(ms) {
            return new Promise(resolve => {
                const target = Number(ms) || 0;
                if (target <= 0) return resolve();
                const step = Math.min(60, target); // чуть быстрее polling
                let elapsed = 0;
                const timer = setInterval(() => {
                    elapsed += step;
                    if (this.stopRequested() || elapsed >= target) {
                        clearInterval(timer);
                        resolve();
                    }
                }, step);
            });
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

        normalizeText(value) {
            return String(value ?? '').replace(/ /g, ' ').replace(/\s+/g, ' ').trim();
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
                const row = element.closest('[class*="row"], div, li');
                if (row) {
                    const inRow = row.querySelector('input[type="checkbox"], [role="checkbox"]');
                    if (inRow) return inRow;
                }
            }
            return null;
        }

        findSaleTypeCheckbox(labelText, idPart) {
            const roots = [document.querySelector('form'), document.body].filter(Boolean);
            for (const root of roots) {
                const cb = this.findCheckboxByText(root, labelText);
                if (cb) return cb;
            }
            return document.querySelector(`input[type="checkbox"][id*="${idPart}"], [role="checkbox"][id*="${idPart}"]`);
        }

        isSaleTypeChecked(target) {
            if (!target) return false;
            if (target.type === 'checkbox') return !!target.checked;
            if (target.getAttribute) {
                const aria = target.getAttribute('aria-checked');
                if (aria === 'true') return true;
            }
            return !!target.querySelector?.('input[type="checkbox"]')?.checked;
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
                if (!target) { await this.delay(150); continue; } // ускорено
                const before = this.isSaleTypeChecked(target);
                if (before === expectedState) return true;
                this.triggerSaleTypeClick(target);
                await this.delay(200); // ускорено
                const refreshed = this.findSaleTypeCheckbox(labelText, idPart) || target;
                if (this.isSaleTypeChecked(refreshed) === expectedState) return true;
            }
            return false;
        }

        async openAndSelectZones(zones) {
            if (!zones || zones.length === 0) return true;
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
            await this.delay(1000); // ускорено с 1400

            let dialog = null;
            let attempts = 0;
            while (!dialog && attempts < 20) {
                dialog = document.querySelector('dialog[open]');
                if (!dialog) await this.delay(300); // ускорено
                attempts++;
            }
            if (!dialog) return false;

            for (const zoneName of zones) {
                const zoneCheckbox = this.findCheckboxByText(dialog, zoneName);
                if (zoneCheckbox && !zoneCheckbox.checked) {
                    zoneCheckbox.click();
                    await this.delay(150); // ускорено
                }
            }
            const saveBtn = Array.from(dialog.querySelectorAll('button')).find(b => b.textContent.trim() === 'Сохранить');
            if (saveBtn) {
                saveBtn.click();
                await this.delay(800); // ускорено с 1200
            }
            return true;
        }

        async openAndSelectBranches(branches) {
            if (!branches || branches.length === 0) return true;
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
            await this.delay(1000); // ускорено

            let dialog = null;
            let attempts = 0;
            while (!dialog && attempts < 20) {
                dialog = document.querySelector('dialog[open]');
                if (!dialog) await this.delay(300);
                attempts++;
            }
            if (!dialog) return false;

            for (const branchName of branches) {
                const branchCheckbox = this.findCheckboxByText(dialog, branchName);
                if (branchCheckbox && !branchCheckbox.checked) {
                    branchCheckbox.click();
                    await this.delay(150);
                }
            }
            const saveBtn = Array.from(dialog.querySelectorAll('button')).find(b => b.textContent.trim() === 'Сохранить');
            if (saveBtn) {
                saveBtn.click();
                await this.delay(800);
            }
            return true;
        }

        async fillMgxGridWithValues(mgxRows) {
            if (!mgxRows || mgxRows.length === 0) return true;
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
            await this.delay(1000); // ускорено

            let dialog = null;
            let attempts = 0;
            while (!dialog && attempts < 25) {
                dialog = document.querySelector('dialog[open]');
                if (!dialog) await this.delay(300);
                attempts++;
            }
            if (!dialog) return false;

            const bulkInternal = dialog.querySelector('#af-bulk0');
            const bulkCustomer = dialog.querySelector('#af-bulk1');
            const bulkReturn = dialog.querySelector('#af-bulk2');

            if (bulkInternal && bulkCustomer) {
                const internalValues = mgxRows.map(r => r.internal).filter(v => v);
                const customerValues = mgxRows.map(r => r.customer).filter(v => v);
                const returnValues = mgxRows.map(r => r.return).filter(v => v);

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
                    await this.delay(1200); // ускорено с 1800
                }

                let saveButton = null;
                let waitAttempts = 0;
                while (!saveButton && waitAttempts < 25) {
                    const buttons = dialog.querySelectorAll('button');
                    for (const btn of buttons) {
                        if (btn.textContent.trim() === 'Сохранить' && !btn.disabled) {
                            saveButton = btn;
                            break;
                        }
                    }
                    if (!saveButton) await this.delay(300);
                    waitAttempts++;
                }
                if (saveButton) {
                    saveButton.click();
                    await this.delay(800);
                    return true;
                }
            }
            return false;
        }

        async openAndSetupIntervals(intervalsData) {
            if (!intervalsData || !intervalsData.length) {
                intervalsData = window.currentTariff?.intervals || [];
            }
            if (!intervalsData || !intervalsData.length) return true;

            const titleSpan = Array.from(document.querySelectorAll('span')).find(el => el.textContent.trim() === 'Интервалы доставки');
            const pencilIcon = titleSpan?.parentElement?.querySelector('span[class*="pencil"], .icomoon-icon__pencil');
            if (!pencilIcon) return false;
            pencilIcon.click();
            await this.delay(700); // ускорено с 900

            let dialog = null;
            for (let attempts = 0; attempts < 18; attempts++) {
                dialog = Array.from(document.querySelectorAll('dialog[open]')).find(d => (d.textContent || '').includes('Интервалы доставки'));
                if (dialog) break;
                await this.delay(220);
            }
            if (!dialog) return false;

            const normalizeTime = (value) => String(value || '').trim().slice(0, 5);
            const rows = dialog.querySelectorAll('tbody tr');
            rows.forEach(row => {
                const start = normalizeTime(row.querySelector('[test-id="startTime"] span')?.textContent);
                const end = normalizeTime(row.querySelector('[test-id="endTime"] span')?.textContent);
                const orderBefore = normalizeTime(row.querySelector('[test-id="orderBefore"] span')?.textContent);
                const match = intervalsData.find(i =>
                    normalizeTime(i.startTime) === start &&
                    normalizeTime(i.endTime) === end &&
                    normalizeTime(i.orderBefore) === orderBefore
                );
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
            for (let attempts = 0; attempts < 25; attempts++) {
                saveBtn = Array.from(dialog.querySelectorAll('button')).find(btn => btn.textContent.trim() === 'Сохранить');
                if (saveBtn && !saveBtn.disabled) break;
                await this.delay(220);
            }
            if (!saveBtn || saveBtn.disabled) return false;
            saveBtn.click();
            await this.delay(700);
            return true;
        }

        async openAndSetupFloorLifting(tariff) {
            const titleSpan = Array.from(document.querySelectorAll('span')).find(el => el.textContent.trim() === 'Подъем на этаж');
            const pencilIcon = titleSpan?.parentElement?.querySelector('span[class*="pencil"], .icomoon-icon__pencil');
            if (!pencilIcon) return false;
            pencilIcon.click();
            await this.delay(700);

            let dialog = null;
            for (let attempts = 0; attempts < 18; attempts++) {
                dialog = Array.from(document.querySelectorAll('dialog[open]')).find(d => (d.textContent || '').includes('Подъем на этаж'));
                if (dialog) break;
                await this.delay(220);
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
            for (let attempts = 0; attempts < 25; attempts++) {
                saveBtn = Array.from(dialog.querySelectorAll('button')).find(btn => btn.textContent.trim() === 'Сохранить');
                if (saveBtn && !saveBtn.disabled) break;
                await this.delay(220);
            }
            if (!saveBtn || saveBtn.disabled) return false;
            saveBtn.click();
            await this.delay(700);
            return true;
        }

        async setupPayment(tariff) {
            const paymentCard = tariff.payment?.card !== undefined ? tariff.payment.card : this.config.paymentCard;
            const paymentCash = tariff.payment?.cash !== undefined ? tariff.payment.cash : this.config.paymentCash;

            const cardCheckbox = document.querySelector('input[id*="cashless"]');
            const cashCheckbox = document.querySelector('input[id*="cash"]');

            if (cardCheckbox && paymentCard !== undefined && cardCheckbox.checked !== paymentCard) cardCheckbox.click();
            if (cashCheckbox && paymentCash !== undefined && cashCheckbox.checked !== paymentCash) cashCheckbox.click();
            await this.delay(120);
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
            await this.delay(120);
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

            const anyChecked = this.isSaleTypeChecked(this.findSaleTypeCheckbox('Исправный товар', 'product')) ||
                               this.isSaleTypeChecked(this.findSaleTypeCheckbox('Уцененный товар', 'markdown')) ||
                               this.isSaleTypeChecked(this.findSaleTypeCheckbox('Юридические лица', 'legal')) ||
                               this.isSaleTypeChecked(this.findSaleTypeCheckbox('Сервисный центр', 'service'));

            if (!anyChecked) await this.setSaleTypeCheckbox('Исправный товар', 'product', true);
            await this.delay(120);
            return true;
        }
    }

    window.TariffCreatorPro = TariffCreatorPro;

    window.ensureTariffCreatorPro = function ensureTariffCreatorPro() {
        try {
            if (!window.tariffCreatorPro || typeof window.tariffCreatorPro.showConfigSidebar !== 'function') {
                window.tariffCreatorPro = new TariffCreatorPro();
            }
            return window.tariffCreatorPro;
        } catch (error) {
            console.error('[TariffCreatorPro] Ошибка инициализации:', error);
            return null;
        }
    };

    window.ensureTariffCreatorPro();
})();
