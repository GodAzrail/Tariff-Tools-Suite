(function() {
    'use strict';

    class TariffCustomizer {
        constructor() {
            this.pinnedTariffs = new Set();
            this.favoriteTariffs = new Set();
            this.vipTariffs = new Set();
            this.superTariffs = new Set();
            this.tariffPositions = {};
            this.draggedItem = null;
            
            this.storageKey = 'tariff_customizer_v3';
            this.isUpdating = false;
            this.initialized = false;
            this.resizeTimeout = null;
            this.assemblyTimeout = null;
            
            this.categoryMenu = null;
            this.currentCardForMenu = null;
            this.currentTariffIdForMenu = null;
            
            console.log('[TariffCustomizer] ========== ИНИЦИАЛИЗАЦИЯ ==========');
            
            this.loadSettings();
            this.injectGlobalStyles();
            this.injectForceStyles();
            this.createGlobalMenu();
            
            this.setupInterceptors(); 
            this.setupSmartObserver(); 
            
            // Запускаем агрессивную проверку для первой загрузки страницы
            this.startInitialization(); 
            
            window.addEventListener('resize', () => {
                clearTimeout(this.resizeTimeout);
                this.resizeTimeout = setTimeout(() => this.forceResizeText(), 100);
            });
        }

        // Агрессивный ловец первой загрузки страницы
        startInitialization() {
            let attempts = 0;
            const check = () => {
                if (this.initialized || !window.location.href.includes('/tariffs/')) return;
                
                const container = document.querySelector('.css-1fttcpj');
                const hasCards = container && container.querySelectorAll('.e1wi2kqa9, .css-nr5n4g, .css-15ttl8p').length > 0;

                if (hasCards) {
                    this.assembleCustomization();
                } else if (attempts < 50) { 
                    attempts++;
                    setTimeout(check, 200);
                }
            };
            check();
        }

        setupInterceptors() {
            if (window.__tariffInterceptorsSetup) return;
            window.__tariffInterceptorsSetup = true;

            document.addEventListener('mousedown', (e) => {
                const isTabBtn = e.target.closest('.css-1h3gid1 button, ._transientButton_o6g7k_1, .css-uko6ox button');
                if (isTabBtn && this.initialized) {
                    this.restoreOriginalDOM();
                }
            }, true);

            window.addEventListener('popstate', () => {
                if (this.initialized) this.restoreOriginalDOM();
            }, true);

            const self = this;
            if (!window.originalPushState) window.originalPushState = history.pushState;
            history.pushState = function() {
                if (self.initialized) self.restoreOriginalDOM();
                return window.originalPushState.apply(this, arguments); 
            };
            
            if (!window.originalReplaceState) window.originalReplaceState = history.replaceState;
            history.replaceState = function() {
                if (self.initialized) self.restoreOriginalDOM();
                return window.originalReplaceState.apply(this, arguments); 
            };
        }

        restoreOriginalDOM() {
            this.isUpdating = true;
            const layouts = document.querySelectorAll('.tariff-layout');
            
            layouts.forEach(layout => {
                const parent = layout.parentElement;
                if (!parent) return;
                
                const cards = Array.from(layout.querySelectorAll('.css-nr5n4g, .e1wi2kqa9, .css-15ttl8p'));
                cards.forEach(card => {
                    const pin = card.querySelector('.tariff-pin-btn'); if (pin) pin.remove();
                    const drag = card.querySelector('.tariff-drag-handle'); if (drag) drag.remove();

                    const titleContainer = card.querySelector('.css-qv45v3');
                    if (titleContainer) {
                        const wrapper = titleContainer.querySelector('.tariff-header-wrapper');
                        if (wrapper) wrapper.remove();
                        const hiddenTitle = titleContainer.querySelector('.css-17i8ct5');
                        if (hiddenTitle) hiddenTitle.style.display = '';
                        const hiddenDate = titleContainer.querySelector('.original-date-hidden');
                        if (hiddenDate) hiddenDate.classList.remove('original-date-hidden');
                    }
                    card.removeAttribute('draggable');
                    card.classList.remove('dragging');

                    try { parent.appendChild(card); } catch(e) {}
                });
                layout.remove();
            });
            this.initialized = false;
            this.isUpdating = false;
        }

        isExportPauseActive() {
            return window.__tariffExportPauseCustomizer === true || localStorage.getItem('tariff_export_pause_customizer') === '1';
        }

        // УМНЫЙ СКАНЕР 
        setupSmartObserver() {
            const observer = new MutationObserver((mutations) => {
                if (this.isUpdating || this.isExportPauseActive() || !window.location.href.includes('/tariffs/')) return;
                
                let hasNewCards = false;
                for (const m of mutations) {
                    if (m.addedNodes.length > 0) {
                        for (const node of m.addedNodes) {
                            if (node.nodeType === 1) {
                                // Ищем карточки и на поверхности узла, и глубоко внутри него (для обновления страницы)
                                if (node.classList?.contains('e1wi2kqa9') || 
                                    node.classList?.contains('css-nr5n4g') || 
                                    node.classList?.contains('css-15ttl8p') || 
                                    node.classList?.contains('css-1fttcpj') ||
                                    (node.querySelector && node.querySelector('.css-1fttcpj, .e1wi2kqa9, .css-nr5n4g, .css-15ttl8p'))) {
                                    hasNewCards = true; 
                                    break;
                                }
                            }
                        }
                    }
                    if (hasNewCards) break;
                }
                
                if (hasNewCards) {
                    clearTimeout(this.assemblyTimeout);
                    this.assemblyTimeout = setTimeout(() => {
                        this.assembleCustomization();
                    }, 120); 
                }
            });
            observer.observe(document.body, { childList: true, subtree: true });
        }

        assembleCustomization() {
            if (this.isExportPauseActive() || this.isUpdating || !window.location.href.includes('/tariffs/')) return;
            
            const container = document.querySelector('.css-1fttcpj');
            if (!container) return;

            const rawCards = Array.from(container.querySelectorAll('.e1wi2kqa9, .css-nr5n4g, .css-15ttl8p')).filter(el => !el.closest('.tariff-layout'));
            if (rawCards.length === 0) return;

            this.isUpdating = true;

            let layout = container.querySelector('.tariff-layout');
            if (!layout) layout = this.createColumnsLayout(container);

            rawCards.forEach(card => {
                this.enhanceCard(card);
                this.placeCard(card, layout);
            });
            
            this.sortAllColumns(layout);
            this.updateColumnsEmptyState(layout);
            this.updateAllPinButtons(layout); 
            
            this.initialized = true;
            this.isUpdating = false;
            this.forceResizeText();
            
            if (rawCards.length > 10) {
                this.showNotification('✨ Кастомизация собрана', 'success');
            }
        }

        createColumnsLayout(container) {
            const layout = document.createElement('div'); layout.className = 'tariff-layout';
            
            const topColumns = document.createElement('div'); topColumns.className = 'tariff-top-columns';
            const favCol = document.createElement('div'); favCol.className = 'tariff-column favorite-column'; favCol.id = 'favorite-column';
            const vipCol = document.createElement('div'); vipCol.className = 'tariff-column vip-column'; vipCol.id = 'vip-column';
            const supCol = document.createElement('div'); supCol.className = 'tariff-column super-column'; supCol.id = 'super-column';
            topColumns.append(favCol, vipCol, supCol);
            
            const bottomColumns = document.createElement('div'); bottomColumns.className = 'tariff-bottom-columns';
            const mainCol = document.createElement('div'); mainCol.className = 'tariff-column main-column'; mainCol.id = 'main-column';
            bottomColumns.appendChild(mainCol);
            
            layout.append(topColumns, bottomColumns);
            container.insertBefore(layout, container.firstChild);
            
            this.setupColumnsDragDrop(layout);
            return layout;
        }

        placeCard(card, layout) {
            const cardId = this.getCardId(card);
            let targetColumn;
            
            if (this.favoriteTariffs.has(cardId)) targetColumn = layout.querySelector('.favorite-column');
            else if (this.vipTariffs.has(cardId)) targetColumn = layout.querySelector('.vip-column');
            else if (this.superTariffs.has(cardId)) targetColumn = layout.querySelector('.super-column');
            else targetColumn = layout.querySelector('.main-column');
            
            if (targetColumn) targetColumn.appendChild(card);
        }

        enhanceCard(card) {
            const id = this.getCardId(card);
            
            const titleContainer = card.querySelector('.css-qv45v3');
            if (titleContainer && !titleContainer.querySelector('.tariff-header-wrapper')) {
                const dateElement = titleContainer.querySelector('.css-knzesm');
                const titleElement = titleContainer.querySelector('.css-17i8ct5');
                if (dateElement && titleElement) {
                    const wrapper = document.createElement('div'); wrapper.className = 'tariff-header-wrapper';
                    const titleClone = titleElement.cloneNode(true); const dateClone = dateElement.cloneNode(true);
                    dateClone.classList.add('tariff-date-moved');
                    titleElement.style.display = 'none';
                    dateElement.classList.add('original-date-hidden');
                    wrapper.append(titleClone, dateClone);
                    titleContainer.appendChild(wrapper);
                }
            }

            if (!card.querySelector('.tariff-pin-btn')) this.createPinButton(card, id);
            if (!card.querySelector('.tariff-drag-handle')) this.createDragHandle(card, id);
        }

        sortAllColumns(layout) {
            layout.querySelectorAll('.tariff-column').forEach(column => {
                const cards = Array.from(column.querySelectorAll('.css-nr5n4g, .e1wi2kqa9, .css-15ttl8p'));
                if (cards.length > 1) {
                    cards.sort((a, b) => (this.tariffPositions[this.getCardId(a)] ?? 999999) - (this.tariffPositions[this.getCardId(b)] ?? 999999))
                         .forEach(card => column.appendChild(card));
                }
            });
        }

        setupColumnsDragDrop(layout) {
            layout.querySelectorAll('.tariff-column').forEach(column => {
                column.addEventListener('dragover', (e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; if (this.draggedItem) column.classList.add('drag-over-column'); });
                column.addEventListener('dragleave', (e) => { if (e.currentTarget.contains(e.relatedTarget)) return; column.classList.remove('drag-over-column'); });
                column.addEventListener('drop', (e) => {
                    e.preventDefault(); column.classList.remove('drag-over-column');
                    if (this.draggedItem) {
                        const targetCard = e.target.closest('.css-nr5n4g, .e1wi2kqa9, .css-15ttl8p');
                        if (targetCard && targetCard !== this.draggedItem && targetCard.parentNode === column) {
                            this.moveCard(this.draggedItem, column, targetCard);
                        } else {
                            this.moveCard(this.draggedItem, column, null);
                        }
                    }
                });
            });
        }

        moveCard(sourceCard, targetColumn, targetCard = null) {
            this.isUpdating = true;
            const cardId = this.getCardId(sourceCard);
            const currentColumnId = sourceCard.parentElement ? sourceCard.parentElement.id : null;
            const targetColumnId = targetColumn.id;

            if (currentColumnId !== targetColumnId) {
                this.favoriteTariffs.delete(cardId);
                this.vipTariffs.delete(cardId);
                this.superTariffs.delete(cardId);
                
                let category = 'main';
                if (targetColumnId === 'favorite-column') { category = 'favorite'; this.favoriteTariffs.add(cardId); }
                else if (targetColumnId === 'vip-column') { category = 'vip'; this.vipTariffs.add(cardId); }
                else if (targetColumnId === 'super-column') { category = 'super'; this.superTariffs.add(cardId); }
            }

            if (targetCard && targetCard !== sourceCard) {
                const sourceIndex = Array.from(targetColumn.children).indexOf(sourceCard);
                const targetIndex = Array.from(targetColumn.children).indexOf(targetCard);
                
                if (currentColumnId === targetColumnId && sourceIndex < targetIndex && sourceIndex !== -1) {
                    targetColumn.insertBefore(sourceCard, targetCard.nextSibling);
                } else {
                    targetColumn.insertBefore(sourceCard, targetCard);
                }
            } else {
                targetColumn.appendChild(sourceCard); 
            }

            this.saveCurrentPositions();
            
            const layout = targetColumn.closest('.tariff-layout');
            if (layout) {
                this.updateColumnsEmptyState(layout);
                this.updateAllPinButtons(layout);
            }
            
            this.isUpdating = false;
        }

        updateAllPinButtons(layout) {
            layout.querySelectorAll('.css-nr5n4g, .e1wi2kqa9, .css-15ttl8p').forEach(card => {
                const cardId = this.getCardId(card);
                const pinBtn = card.querySelector('.tariff-pin-btn');
                if (pinBtn) {
                    let category = 'main';
                    if (this.favoriteTariffs.has(cardId)) category = 'favorite';
                    else if (this.vipTariffs.has(cardId)) category = 'vip';
                    else if (this.superTariffs.has(cardId)) category = 'super';
                    
                    pinBtn.className = `tariff-pin-btn ${category !== 'main' ? `pinned-${category}` : ''}`;
                    pinBtn.title = category !== 'main' ? `В категории: ${category}` : 'Выберите категорию';
                    const icons = { favorite: '⭐', vip: '💎', super: '🌟', main: '📋' };
                    pinBtn.innerHTML = `<span>${icons[category]}</span>`;
                }
            });
        }

        updateColumnsEmptyState(layout) {
            layout.querySelectorAll('.tariff-column').forEach(col => {
                if (col.children.length > 0) col.classList.remove('empty'); else col.classList.add('empty');
            });
        }

        getCardId(card) {
            if (card.dataset.tariffId) return card.dataset.tariffId;
            const titleElement = card.querySelector('.css-17i8ct5');
            if (titleElement) {
                let tariffName = titleElement.textContent.trim().replace(/[^\wа-яё]/gi, '_').replace(/_+/g, '_').toLowerCase();
                card.dataset.tariffId = tariffName; return tariffName;
            }
            const fallbackId = 'tariff_' + Date.now() + '_' + Math.random();
            card.dataset.tariffId = fallbackId; return fallbackId;
        }

        saveCurrentPositions() {
            const allCardsOrdered = [];
            const cols = ['favorite-column', 'vip-column', 'super-column', 'main-column'];
            
            cols.forEach(colId => {
                const col = document.getElementById(colId);
                if (col) {
                    allCardsOrdered.push(...Array.from(col.querySelectorAll('.css-nr5n4g, .e1wi2kqa9, .css-15ttl8p')));
                }
            });
            
            const newPositions = {};
            allCardsOrdered.forEach((card, index) => { newPositions[this.getCardId(card)] = index; });
            this.tariffPositions = newPositions; 
            this.saveSettings();
        }

        saveSettings() {
            localStorage.setItem(this.storageKey, JSON.stringify({ favoriteTariffs: Array.from(this.favoriteTariffs), vipTariffs: Array.from(this.vipTariffs), superTariffs: Array.from(this.superTariffs), tariffPositions: this.tariffPositions, version: '3.6', timestamp: Date.now() }));
        }

        loadSettings() {
            const saved = localStorage.getItem(this.storageKey);
            if (saved) {
                try {
                    const s = JSON.parse(saved);
                    this.favoriteTariffs = new Set(s.favoriteTariffs || []); this.vipTariffs = new Set(s.vipTariffs || []);
                    this.superTariffs = new Set(s.superTariffs || []); this.tariffPositions = s.tariffPositions || {};
                } catch (e) { console.error('Ошибка загрузки:', e); }
            }
        }

        createPinButton(card, tariffId) {
            const buttonContainer = card.querySelector('.css-1yydxi7');
            if (!buttonContainer || buttonContainer.querySelector('.tariff-pin-btn')) return null;
            
            const pinButton = document.createElement('button');
            pinButton.className = 'tariff-pin-btn';
            
            pinButton.addEventListener('click', (e) => {
                e.stopPropagation(); if (!this.categoryMenu) return;
                this.currentCardForMenu = card; this.currentTariffIdForMenu = tariffId;
                const rect = pinButton.getBoundingClientRect();
                this.categoryMenu.style.display = 'flex'; this.categoryMenu.style.top = `${rect.bottom + 4}px`; this.categoryMenu.style.left = `${rect.left}px`;
            });
            
            buttonContainer.insertBefore(pinButton, buttonContainer.firstChild); return pinButton;
        }
        
        createDragHandle(card, tariffId) {
            const buttonContainer = card.querySelector('.css-1yydxi7');
            if (!buttonContainer || buttonContainer.querySelector('.tariff-drag-handle')) return null;
            
            const dragHandle = document.createElement('button');
            dragHandle.className = 'tariff-drag-handle'; dragHandle.title = 'Зажмите для перетаскивания карточки'; dragHandle.innerHTML = '<span>⋮⋮</span>';
            
            dragHandle.addEventListener('mouseenter', () => card.setAttribute('draggable', 'true'));
            dragHandle.addEventListener('mouseleave', () => card.removeAttribute('draggable'));
            
            card.addEventListener('dragstart', (e) => {
                this.draggedItem = card; e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', tariffId);
                setTimeout(() => card.classList.add('dragging'), 0);
            });
            
            card.addEventListener('dragend', () => { card.classList.remove('dragging'); this.draggedItem = null; document.querySelectorAll('.tariff-column').forEach(col => col.classList.remove('drag-over-column')); });
            
            const pinBtn = buttonContainer.querySelector('.tariff-pin-btn');
            if (pinBtn) pinBtn.insertAdjacentElement('afterend', dragHandle); else buttonContainer.insertBefore(dragHandle, buttonContainer.firstChild);
            return dragHandle;
        }
        
        createGlobalMenu() {
            if (this.categoryMenu || document.getElementById('tariff-global-menu')) return;
            this.categoryMenu = document.createElement('div');
            this.categoryMenu.id = 'tariff-global-menu';
            this.categoryMenu.style.cssText = `position: fixed; display: none; flex-direction: column; gap: 4px; background: white; border: 1px solid #cbd5e1; border-radius: 8px; padding: 4px; z-index: 10000; box-shadow: 0 4px 12px rgba(0,0,0,0.15);`;
            
            const categories = [ { id: 'main', name: '📋 Основные', color: '#64748b' }, { id: 'favorite', name: '⭐ Избранные 1', color: '#f59e0b' }, { id: 'vip', name: '💎 Избранные 2', color: '#8b5cf6' }, { id: 'super', name: '🌟 Избранные 3', color: '#ec489a' } ];
            
            categories.forEach(cat => {
                const option = document.createElement('button');
                option.textContent = cat.name;
                option.style.cssText = `padding: 6px 12px; border: none; border-radius: 6px; cursor: pointer; font-size: 12px; background: white; color: ${cat.color}; text-align: left;`;
                option.onmouseenter = () => option.style.background = '#f1f5f9';
                option.onmouseleave = () => option.style.background = 'white';
                option.onclick = (e) => {
                    e.stopPropagation();
                    if (this.currentCardForMenu && this.currentTariffIdForMenu) {
                        const layout = this.currentCardForMenu.closest('.tariff-layout');
                        if (layout) {
                            let targetColId = 'main-column';
                            if (cat.id === 'favorite') targetColId = 'favorite-column';
                            if (cat.id === 'vip') targetColId = 'vip-column';
                            if (cat.id === 'super') targetColId = 'super-column';
                            const targetCol = layout.querySelector('#' + targetColId);
                            if (targetCol) this.moveCard(this.currentCardForMenu, targetCol, null);
                        }
                    }
                    this.categoryMenu.style.display = 'none';
                };
                this.categoryMenu.appendChild(option);
            });
            document.body.appendChild(this.categoryMenu);
            document.addEventListener('click', (e) => { if (this.categoryMenu && this.categoryMenu.style.display === 'flex' && !this.categoryMenu.contains(e.target)) this.categoryMenu.style.display = 'none'; });
        }

        forceResizeText() {
            this.isUpdating = true;
            const width = window.innerWidth;
            let titleSize, descSize, priceSize, dateSize;
            
            if (width <= 2163 && width > 1920) { titleSize = '15px'; descSize = '13px'; priceSize = '17px'; dateSize = '10px'; }
            else if (width <= 1920 && width > 1600) { titleSize = '14px'; descSize = '12px'; priceSize = '16px'; dateSize = '9px'; }
            else if (width <= 1600 && width > 1200) { titleSize = '13px'; descSize = '11px'; priceSize = '15px'; dateSize = '8px'; }
            else if (width <= 1200 && width > 900) { titleSize = '12px'; descSize = '10px'; priceSize = '14px'; dateSize = '7px'; }
            else if (width <= 900) { titleSize = '11px'; descSize = '9px'; priceSize = '13px'; dateSize = '6px'; }
            
            const applySize = (elements, size) => {
                if (size) elements.forEach(el => { el.style.setProperty('font-size', size, 'important'); el.style.fontSize = size; });
                else elements.forEach(el => el.style.removeProperty('font-size'));
            };

            applySize(document.querySelectorAll('.css-17i8ct5'), titleSize);
            applySize(document.querySelectorAll('.css-1qatje8'), descSize);
            applySize(document.querySelectorAll('.css-1kn2u3p'), priceSize);
            applySize(document.querySelectorAll('.tariff-date-moved'), dateSize);
            
            setTimeout(() => { this.isUpdating = false; }, 50);
        }

        injectForceStyles() {
            if (document.querySelector('#tariff-force-styles')) return;
            const style = document.createElement('style');
            style.id = 'tariff-force-styles';
            style.textContent = `
                @media (min-width: 2164px) { .tariff-top-columns, .tariff-bottom-columns { display: flex !important; flex-direction: row !important; flex-wrap: nowrap !important; align-items: stretch !important; gap: 24px !important; } .tariff-top-columns .tariff-column, .tariff-bottom-columns .tariff-column { min-width: 0 !important; box-sizing: border-box !important; } }
                @media (max-width: 2163px) and (min-width: 1601px) { .tariff-top-columns, .tariff-bottom-columns { display: flex !important; flex-direction: row !important; flex-wrap: nowrap !important; align-items: stretch !important; gap: 20px !important; } .tariff-top-columns .tariff-column, .tariff-bottom-columns .tariff-column { min-width: 0 !important; box-sizing: border-box !important; } .tariff-column { padding-left: 18px !important; padding-right: 18px !important; } }
                @media (max-width: 1600px) and (min-width: 1281px) { .tariff-top-columns, .tariff-bottom-columns { display: flex !important; flex-direction: row !important; flex-wrap: nowrap !important; align-items: stretch !important; gap: 16px !important; } .tariff-top-columns .tariff-column, .tariff-bottom-columns .tariff-column { min-width: 0 !important; box-sizing: border-box !important; } .tariff-column { padding-left: 16px !important; padding-right: 16px !important; } }
                @media (max-width: 1280px) { .tariff-top-columns, .tariff-bottom-columns { display: flex !important; flex-direction: row !important; flex-wrap: nowrap !important; align-items: stretch !important; gap: 12px !important; } .tariff-top-columns .tariff-column, .tariff-bottom-columns .tariff-column { min-width: 0 !important; box-sizing: border-box !important; } .tariff-column { padding-left: 14px !important; padding-right: 14px !important; } }
                @media (max-width: 2163px) and (min-width: 1921px) { .css-17i8ct5 { font-size: 15px !important; line-height: 1.2 !important; } .css-1qatje8 { font-size: 13px !important; } .css-1kn2u3p { font-size: 17px !important; } .tariff-date-moved { font-size: 10px !important; } }
                @media (max-width: 1920px) and (min-width: 1601px) { .css-17i8ct5 { font-size: 14px !important; line-height: 1.2 !important; } .css-1qatje8 { font-size: 12px !important; } .css-1kn2u3p { font-size: 16px !important; } .tariff-date-moved { font-size: 9px !important; } }
                @media (max-width: 1600px) and (min-width: 1201px) { .css-17i8ct5 { font-size: 13px !important; line-height: 1.2 !important; } .css-1qatje8 { font-size: 11px !important; } .css-1kn2u3p { font-size: 15px !important; } .tariff-date-moved { font-size: 8px !important; } }
                @media (max-width: 1200px) and (min-width: 901px) { .css-17i8ct5 { font-size: 12px !important; line-height: 1.2 !important; } .css-1qatje8 { font-size: 10px !important; } .css-1kn2u3p { font-size: 14px !important; } .tariff-date-moved { font-size: 7px !important; } }
                @media (max-width: 900px) { .css-17i8ct5 { font-size: 11px !important; line-height: 1.2 !important; } .css-1qatje8 { font-size: 9px !important; } .css-1kn2u3p { font-size: 13px !important; } .tariff-date-moved { font-size: 6px !important; } }
            `;
            document.head.appendChild(style);
        }

        injectGlobalStyles() {
            if (document.querySelector('#tariff-customizer-styles')) return;
            const style = document.createElement('style');
            style.id = 'tariff-customizer-styles';
            style.textContent = `
                @keyframes tariffFadeIn { from { opacity: 0; transform: translateX(100%); } to { opacity: 1; transform: translateX(0); } }
                .tariff-layout { display: flex; flex-direction: column; gap: 24px; width: 100%; margin-top: 20px; }
                .tariff-top-columns, .tariff-bottom-columns { display: flex; gap: 24px; width: 100%; flex-wrap: nowrap; align-items: stretch; }
                .tariff-column { flex: 1 1 0; min-width: 0; box-sizing: border-box; background: linear-gradient(135deg, #f8fafc, #f1f5f9); border-radius: 20px; padding: 20px; border: 2px dashed #cbd5e1; transition: all 0.3s ease; position: relative; min-height: 200px; }
                .tariff-column.drag-over-column { border-color: #3b82f6; background: linear-gradient(135deg, #eff6ff, #dbeafe); transform: scale(1.01); }
                .tariff-column::before { position: absolute; top: -12px; left: 20px; color: white; padding: 4px 12px; border-radius: 20px; font-size: 12px; font-weight: 600; box-shadow: 0 2px 4px rgba(0,0,0,0.1); z-index: 1; }
                .tariff-column.empty::after { position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); color: #94a3b8; font-size: 14px; text-align: center; pointer-events: none; white-space: nowrap; z-index: 0; }
                .tariff-column:not(.empty)::after { display: none !important; }
                .favorite-column::before { content: '⭐ Избранные тарифы 1'; background: linear-gradient(135deg, #f59e0b, #d97706); }
                .vip-column::before { content: '💎 Избранные тарифы 2'; background: linear-gradient(135deg, #8b5cf6, #7c3aed); }
                .super-column::before { content: '🌟 Избранные тарифы 3'; background: linear-gradient(135deg, #ec489a, #db2777); }
                .main-column::before { content: '📋 Все тарифы'; background: linear-gradient(135deg, #64748b, #475569); }
                .favorite-column.empty::after { content: 'Перетащите сюда тарифы в Избранные тарифы 1'; }
                .vip-column.empty::after { content: 'Перетащите сюда тарифы в Избранные тарифы 2'; }
                .super-column.empty::after { content: 'Перетащите сюда тарифы в Избранные тарифы 3'; }
                .main-column.empty::after { content: 'Нет доступных тарифов'; }
                
                .css-nr5n4g.e1wi2kqa9, .e1wi2kqa9, .css-15ttl8p { width: 100% !important; min-width: 100% !important; max-width: 100% !important; flex: 0 0 100% !important; box-sizing: border-box !important; margin-bottom: 16px; transition: all 0.3s ease; position: relative; z-index: 1; }
                .e1wi2kqa9:last-child, .css-15ttl8p:last-child { margin-bottom: 0; }
                .dragging { opacity: 0.4; transform: scale(0.98); }
                
                .tariff-header-wrapper { display: flex; flex-direction: column; gap: -2px !important; width: 100%; }
                .tariff-date-moved { font-size: 12px; color: #64748b; margin-top: -7px !important; line-height: 1.3; transition: font-size 0.2s ease; }
                .original-date-hidden { display: none !important; }
                
                .tariff-pin-btn, .tariff-drag-handle { position: relative; overflow: hidden; transition: all 0.25s cubic-bezier(0.4, 0, 0.2, 1) !important; background: #f1f5f9 !important; border: 1px solid #cbd5e1 !important; color: #475569 !important; width: 28px !important; height: 28px !important; min-width: 28px !important; min-height: 28px !important; border-radius: 6px !important; padding: 0 !important; margin-left: 6px !important; cursor: pointer; display: inline-flex; align-items: center; justify-content: center; }
                .tariff-pin-btn span, .tariff-drag-handle span { font-size: 14px !important; }
                .tariff-pin-btn:hover, .tariff-drag-handle:hover { transform: scale(1.05); background: #e2e8f0 !important; border-color: #94a3b8 !important; color: #1e293b !important; }
                .tariff-drag-handle { cursor: grab; }
                .tariff-drag-handle:active { cursor: grabbing; }
                .tariff-pin-btn.pinned-favorite { background: linear-gradient(135deg, #f59e0b, #d97706) !important; border-color: transparent !important; color: white !important; }
                .tariff-pin-btn.pinned-vip { background: linear-gradient(135deg, #8b5cf6, #7c3aed) !important; border-color: transparent !important; color: white !important; }
                .tariff-pin-btn.pinned-super { background: linear-gradient(135deg, #ec489a, #db2777) !important; border-color: transparent !important; color: white !important; }
                .tariff-pin-btn.pinned-favorite:hover, .tariff-pin-btn.pinned-vip:hover, .tariff-pin-btn.pinned-super:hover { transform: scale(1.05); filter: brightness(1.1); }
                .css-1yydxi7 { display: flex !important; align-items: center !important; justify-content: flex-end !important; width: 100% !important; }
            `;
            document.head.appendChild(style);
        }

        showNotification(msg, type = 'info') {
            const notification = document.createElement('div');
            notification.className = 'tariff-notification'; notification.textContent = msg;
            notification.style.cssText = `animation: tariffFadeIn 0.3s cubic-bezier(0.4, 0, 0.2, 1); backdrop-filter: blur(10px); border: 1px solid rgba(255, 255, 255, 0.2); position: fixed; bottom: 24px; right: 24px; padding: 12px 20px; border-radius: 10px; z-index: 10001; font-size: 14px; font-weight: 500; cursor: pointer; transition: all 0.25s ease; box-shadow: 0 4px 12px rgba(0,0,0,0.15); background: ${type === 'success' ? '#10b981' : '#3b82f6'}; color: white;`;
            document.body.appendChild(notification); setTimeout(() => notification.remove(), 2000);
        }
    }

    if (!window.tariffCustomizerInstance) {
        if (document.readyState === 'loading') { document.addEventListener('DOMContentLoaded', () => { window.tariffCustomizerInstance = new TariffCustomizer(); }); } 
        else { window.tariffCustomizerInstance = new TariffCustomizer(); }
    }
})();
