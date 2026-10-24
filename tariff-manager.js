// ============================================================================
// Tariff Tools Suite - In-App Tariff Manager Pro (tariff-manager.js)
// Интерактивное управление тарифами внутри интерфейса (Precision Logistics Dark)
// Спецификация: DESIGN (1).md
// ============================================================================
(function () {
  'use strict';

  if (window.tariffManager) return;

  class TariffManager {
    constructor() {
      this.isOpen = false;
      this.isScanning = false;
      this.isWriting = false;
      this.shouldStop = false;
      this.tariffs = [];
      this.selectedTariffs = new Set();
      this.activeTariffUuid = null;
      this.activeMode = 'mgx'; // 'mgx' | 'bulk' | 'lifting' | 'intervals'
      this.searchTerm = '';
      this.cachedMeta = null;
      this.modalEl = null;
      this.vatCompensationRate = 22; // По умолчанию 22% НДС для компенсации затрат
      this.filters = {
        modifiedOnly: false,
        unmodifiedOnly: false,
        paymentCard: false,
        paymentCash: false,
        acceptanceSameDay: false,
        acceptanceNextDay: false,
        saleProduct: false,
        saleMarkdown: false,
        saleLegal: false,
        saleService: false,
        hasIntervals: false,
        hasElevator: false,
        hasStairs: false
      };

      const today = new Date();
      this.defaultDate = today.toISOString().split('T')[0];
      this.startDate = this.defaultDate;
      this.startTime = '00:00';

      this.injectStyles();
      this.initListeners();

      // Автоматическое повторное открытие менеджера тарифов и сканирование измененных тарифов после перезагрузки
      const getStoredItem = (key) => {
        let val = null;
        try {
          val = sessionStorage.getItem(key);
          if (val) sessionStorage.removeItem(key);
        } catch (_) {}
        if (!val) {
          try {
            val = localStorage.getItem(key);
            if (val) localStorage.removeItem(key);
          } catch (_) {}
        }
        return val;
      };

      const rescanRaw = getStoredItem('tm_auto_rescan_modified') || getStoredItem('tm_just_modified_tariffs');
      const shouldAutoOpen = getStoredItem('tm_auto_open_after_refresh') === '1' || !!rescanRaw;

      if (shouldAutoOpen) {
        let modifiedNames = null;
        if (rescanRaw) {
          try { modifiedNames = JSON.parse(rescanRaw); } catch (_) {}
        }

        console.log('[TariffManager] Запланировано авто-открытие и повторное сканирование измененных тарифов после перезагрузки:', modifiedNames);
        const checkReady = setInterval(() => {
          if (document.readyState === 'complete') {
            clearInterval(checkReady);
            setTimeout(async () => {
              if (!this.isOpen) {
                console.log('[TariffManager] Запуск менеджера тарифов после перезагрузки страницы...');
                await this.waitForCards({ timeout: 6000, interval: 100, minCount: 1 });
                await this.open(modifiedNames);
              }
            }, 400);
          }
        }, 150);
      }
    }

    initListeners() {
      window.addEventListener('storage', (e) => {
        if (e.key === 'tariff_update_state' && this.isWriting) {
          this.handleWriteStateUpdate(e.newValue);
        }
      });

      window.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && this.isOpen && !this.isScanning && !this.isWriting) {
          this.close();
        }
      });

      window.addEventListener('spa-route-changed', () => {
        if (this.isScanning || this.isWriting) return;
        const currentOrgId = this.getOrgId();
        const match = window.location.pathname.match(/\/configurator\/tariffs\/([0-9a-f-]+)/i);
        if (match && match[1] === currentOrgId) {
          return;
        }
        if (this.isOpen) {
          this.close();
        }
      });
    }

    getOrgId() {
      const match = window.location.pathname.match(/\/tariffs\/([0-9a-f-]+)/i);
      return match ? match[1] : 'default_org';
    }

    getCacheKey() {
      return `tariff_manager_cache_${this.getOrgId()}`;
    }

    loadFromCache() {
      try {
        const raw = localStorage.getItem(this.getCacheKey());
        if (!raw) return false;
        const parsed = JSON.parse(raw);
        if (parsed && Array.isArray(parsed.tariffs) && parsed.tariffs.length > 0) {
          // Отбрасываем старый битый кэш с синтетическими 'tariff_' ID или дубликатами
          const hasFakeUuid = parsed.tariffs.some(t => !t.uuid || t.uuid.startsWith('tariff_'));
          if (hasFakeUuid) {
            console.log('[TariffManager] Обнаружен старый кэш с фиктивными ID, очищаем.');
            localStorage.removeItem(this.getCacheKey());
            return false;
          }

          // Отбрасываем кэш с пустыми параметрами (когда предыдущее сканирование не извлекло данные)
          const allEmptyParams = parsed.tariffs.every(t =>
            (!t.payment || (!t.payment.card && !t.payment.cash)) &&
            (!t.acceptance || (!t.acceptance.sameDay && !t.acceptance.nextDay)) &&
            (!t.mgxRows || t.mgxRows.length === 0 || t.mgxRows.every(r => !r.internal && !r.customer))
          );
          if (allEmptyParams) {
            console.log('[TariffManager] Обнаружен кэш с несобранными параметрами тарифов, очищаем.');
            localStorage.removeItem(this.getCacheKey());
            return false;
          }
          this.tariffs = parsed.tariffs.map((t) => this.normalizeTariffObject(t));
          this.cachedMeta = {
            scannedAt: parsed.scannedAt,
            totalTariffs: parsed.totalTariffs || this.tariffs.length
          };
          if (this.tariffs.length > 0) {
            this.selectedTariffs = new Set(this.tariffs.map(t => t.uuid));
            this.activeTariffUuid = this.tariffs[0].uuid;
          }
          return true;
        }
      } catch (err) {
        console.warn('[TariffManager] Ошибка чтения кэша:', err);
      }
      return false;
    }

    saveToCache() {
      try {
        const payload = {
          pageUrl: window.location.href,
          orgId: this.getOrgId(),
          scannedAt: new Date().toISOString(),
          totalTariffs: this.tariffs.length,
          tariffs: this.tariffs.map((t) => {
            const clean = { ...t };
            delete clean._modified;
            delete clean._original;
            return clean;
          })
        };
        localStorage.setItem(this.getCacheKey(), JSON.stringify(payload));
        this.cachedMeta = {
          scannedAt: payload.scannedAt,
          totalTariffs: payload.totalTariffs
        };
      } catch (err) {
        console.warn('[TariffManager] Ошибка сохранения кэша:', err);
      }
    }

    normalizeTariffObject(t) {
      const rawMgx = Array.isArray(t.mgxRows) ? t.mgxRows : [];
      let normalizedMgx = [];

      if (rawMgx.length > 0) {
        // Берем реальные строки МГХ из тарифа, нормализуя значения веса
        normalizedMgx = rawMgx.map((r) => {
          const wStr = String(r?.weight || '').trim();
          const numMatch = wStr.match(/\d+(?:[.,]\d+)?/);
          const cleanWeight = numMatch ? numMatch[0].replace(',', '.') : wStr;

          return {
            weight: cleanWeight || wStr,
            rawWeight: r?.rawWeight || wStr,
            internal: String(r?.internal || ''),
            customer: String(r?.customer || ''),
            return: String(r?.return || '')
          };
        });
      } else {
        // Fallback-сетка только если у тарифа еще нет строк МГХ
        const fallbackWeights = ['15', '70', '120', '240', '360'];
        normalizedMgx = fallbackWeights.map((w) => ({
          weight: w,
          internal: '',
          customer: '',
          return: ''
        }));
      }

      const normalized = {
        uuid: t.uuid,
        name: t.name || 'Без названия',
        url: t.url || `${window.location.origin}/configurator/tariffs/${this.getOrgId()}/${t.uuid}`,
        payment: {
          card: t.payment?.card !== undefined ? !!t.payment.card : true,
          cash: t.payment?.cash !== undefined ? !!t.payment.cash : false
        },
        acceptance: {
          sameDay: t.acceptance?.sameDay !== undefined ? !!t.acceptance.sameDay : true,
          nextDay: t.acceptance?.nextDay !== undefined ? !!t.acceptance.nextDay : false
        },
        saleTypes: {
          product: t.saleTypes?.product !== undefined ? !!t.saleTypes.product : true,
          markdown: t.saleTypes?.markdown !== undefined ? !!t.saleTypes.markdown : false,
          legal: t.saleTypes?.legal !== undefined ? !!t.saleTypes.legal : false,
          service: t.saleTypes?.service !== undefined ? !!t.saleTypes.service : false
        },
        mgxRows: normalizedMgx,
        intervals: Array.isArray(t.intervals) ? t.intervals.map(inv => ({
          enabled: inv.enabled !== false,
          startTime: String(inv.startTime || '').trim().slice(0, 5),
          endTime: String(inv.endTime || '').trim().slice(0, 5),
          orderBefore: String(inv.orderBefore || '').trim().slice(0, 5),
          internalPriceAdjustment: String(inv.internalPriceAdjustment !== undefined && inv.internalPriceAdjustment !== null ? inv.internalPriceAdjustment : '0').trim(),
          priceAdjustment: String(inv.priceAdjustment !== undefined && inv.priceAdjustment !== null ? inv.priceAdjustment : '0').trim()
        })) : [],
        elevatorPrice: {
          internal: t.elevatorPrice?.internal || '0',
          customer: t.elevatorPrice?.customer || '0'
        },
        floorPrice: {
          internalPrice: t.floorPrice?.internalPrice || '0',
          internalThreshold: t.floorPrice?.internalThreshold || '1',
          customerPrice: t.floorPrice?.customerPrice || '0',
          customerThreshold: t.floorPrice?.customerThreshold || '1'
        },
        floorRows: Array.isArray(t.floorRows) ? t.floorRows : [],
        deliveryDays: String(t.deliveryDays || '0'),
        cutoffTime: String(t.cutoffTime || '00:00'),
        costLimit: String(t.costLimit || ''),
        zones: Array.isArray(t.zones) ? t.zones : [],
        branches: Array.isArray(t.branches) ? t.branches : [],
        startDate: t.startDate || this.defaultDate,
        startTime: t.startTime || '00:00',
        _modified: false
      };

      normalized._original = JSON.parse(JSON.stringify(normalized));
      return normalized;
    }

    injectStyles() {
      if (document.getElementById('tariff-manager-styles')) return;
      const style = document.createElement('style');
      style.id = 'tariff-manager-styles';
      style.setAttribute('data-tts-inspector-ignore', 'true');
      style.textContent = `
        #tariff-manager-modal {
          position: fixed;
          inset: 0;
          background: rgba(0, 0, 0, 0.75);
          backdrop-filter: blur(4px);
          z-index: 999999;
          display: flex;
          align-items: center;
          justify-content: center;
          font-family: 'Geist', -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
          color: #cbd5e1;
          box-sizing: border-box;
          animation: tmFadeIn 0.15s ease-out;
          padding: 24px;
        }
        @keyframes tmFadeIn {
          from { opacity: 0; transform: scale(0.99); }
          to { opacity: 1; transform: scale(1); }
        }
        #tariff-manager-modal * {
          box-sizing: border-box;
        }
        #tariff-manager-modal ::-webkit-scrollbar {
          width: 4px;
          height: 4px;
        }
        #tariff-manager-modal ::-webkit-scrollbar-track {
          background: transparent;
        }
        #tariff-manager-modal ::-webkit-scrollbar-thumb {
          background: rgba(255, 255, 255, 0.12);
          border-radius: 9999px;
        }
        #tariff-manager-modal ::-webkit-scrollbar-thumb:hover {
          background: rgba(255, 255, 255, 0.2);
        }
        .tm-window {
          position: relative;
          width: 100%;
          max-width: 1380px;
          height: 100%;
          max-height: 900px;
          background: #090d16;
          border: 1px solid rgba(255, 255, 255, 0.08);
          border-radius: 12px;
          box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.75);
          display: flex;
          flex-direction: column;
          overflow: hidden;
        }
        /* Шапка */
        .tm-header {
          height: 56px;
          padding: 0 20px;
          border-bottom: 1px solid rgba(255, 255, 255, 0.07);
          display: flex;
          align-items: center;
          justify-content: space-between;
          flex-shrink: 0;
          user-select: none;
          background: #090d16;
        }
        .tm-header-left {
          display: flex;
          align-items: center;
          gap: 12px;
        }
        .tm-header-title {
          font-size: 14px;
          font-weight: 500;
          color: #f1f5f9;
          letter-spacing: -0.01em;
          margin: 0;
        }
        .tm-tag-prod {
          font-size: 11px;
          font-family: 'JetBrains Mono', monospace;
          color: #94a3b8;
          background: rgba(255, 255, 255, 0.04);
          border: 1px solid rgba(255, 255, 255, 0.06);
          padding: 2px 8px;
          border-radius: 4px;
        }
        .tm-header-bullet {
          color: #475569;
          font-size: 12px;
        }
        .tm-cache-text {
          font-size: 12px;
          color: #94a3b8;
          font-family: 'JetBrains Mono', monospace;
        }
        .tm-header-right {
          display: flex;
          align-items: center;
          gap: 8px;
        }
        .tm-btn-rescan {
          display: flex;
          align-items: center;
          gap: 6px;
          padding: 6px 10px;
          border-radius: 6px;
          border: 1px solid rgba(255, 255, 255, 0.08);
          background: rgba(255, 255, 255, 0.02);
          color: #cbd5e1;
          font-size: 12px;
          font-weight: 400;
          cursor: pointer;
          transition: all 0.15s ease;
        }
        .tm-btn-rescan:hover {
          background: rgba(255, 255, 255, 0.06);
          color: #ffffff;
        }
        .tm-btn-close {
          width: 28px;
          height: 28px;
          border-radius: 6px;
          display: flex;
          align-items: center;
          justify-content: center;
          background: transparent;
          border: none;
          color: #94a3b8;
          cursor: pointer;
          font-size: 14px;
          transition: all 0.15s ease;
        }
        .tm-btn-close:hover {
          background: rgba(255, 255, 255, 0.08);
          color: #e2e8f0;
        }
        /* Тело */
        .tm-body {
          flex: 1;
          display: flex;
          overflow: hidden;
          background: #090d16;
        }
        /* Левый сайдбар списка тарифов */
        .tm-sidebar {
          width: 370px;
          border-right: 1px solid rgba(255, 255, 255, 0.07);
          display: flex;
          flex-direction: column;
          flex-shrink: 0;
          user-select: none;
          background: #070b12;
        }
        .tm-sidebar-controls {
          padding: 12px;
          border-bottom: 1px solid rgba(255, 255, 255, 0.06);
          display: flex;
          flex-direction: column;
          gap: 10px;
        }
        .tm-search-box {
          position: relative;
          display: flex;
          align-items: center;
        }
        .tm-search-box svg {
          position: absolute;
          left: 10px;
          color: #94a3b8;
          pointer-events: none;
        }
        .tm-search-input {
          width: 100%;
          height: 28px;
          padding: 0 24px 0 30px;
          background: rgba(255, 255, 255, 0.03);
          border: 1px solid rgba(255, 255, 255, 0.08);
          border-radius: 4px;
          font-size: 12px;
          color: #e2e8f0;
          outline: none;
          transition: border-color 0.15s ease;
        }
        .tm-search-input:focus {
          border-color: rgba(255, 255, 255, 0.2);
        }
        .tm-search-input::placeholder {
          color: #64748b;
        }
        .tm-sidebar-filter-row {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 0 2px;
          font-size: 11px;
          color: #94a3b8;
        }
        .tm-select-all-label {
          display: flex;
          align-items: center;
          gap: 8px;
          cursor: pointer;
          transition: color 0.15s ease;
        }
        .tm-select-all-label:hover {
          color: #cbd5e1;
        }
        .tm-card-list {
          flex: 1;
          overflow-y: auto;
          padding: 8px;
          display: flex;
          flex-direction: column;
          gap: 6px;
        }
        /* Карточка тарифа в сайдбаре */
        .tm-tariff-card {
          border-radius: 8px;
          padding: 10px 12px;
          transition: all 0.15s ease;
          border: 1px solid rgba(255, 255, 255, 0.08);
          background: rgba(255, 255, 255, 0.02);
          cursor: pointer;
        }
        .tm-tariff-card:hover {
          border-color: rgba(255, 255, 255, 0.16);
          background: rgba(255, 255, 255, 0.04);
        }
        .tm-tariff-card.selected {
          border-color: rgba(59, 130, 246, 0.3);
          background: rgba(59, 130, 246, 0.04);
        }
        .tm-tariff-card.active {
          border-color: rgba(59, 130, 246, 0.55);
          background: rgba(59, 130, 246, 0.08);
          box-shadow: 0 0 0 1px rgba(59, 130, 246, 0.2);
        }
        .tm-card-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
        }
        .tm-card-name-label {
          display: flex;
          align-items: center;
          gap: 8px;
          cursor: pointer;
          flex: 1;
          overflow: hidden;
        }
        .tm-card-title {
          font-size: 13px;
          font-weight: 500;
          color: #f1f5f9;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .tm-card-badge-modified {
          font-size: 10px;
          font-family: 'JetBrains Mono', monospace;
          color: rgba(252, 211, 77, 0.9);
          background: rgba(251, 191, 36, 0.1);
          padding: 2px 6px;
          border-radius: 4px;
          border: 1px solid rgba(251, 191, 36, 0.2);
          white-space: nowrap;
        }
        .tm-card-badge-id {
          font-size: 10px;
          font-family: 'JetBrains Mono', monospace;
          color: #64748b;
          white-space: nowrap;
        }
        .tm-card-subgrid {
          margin-top: 10px;
          padding-top: 8px;
          border-top: 1px solid rgba(255, 255, 255, 0.04);
          display: flex;
          flex-direction: column;
          gap: 6px;
          font-size: 11px;
          font-family: 'JetBrains Mono', monospace;
          user-select: none;
        }
        .tm-subgrid-row {
          display: flex;
          align-items: center;
          gap: 12px;
        }
        .tm-subgrid-col-label {
          color: #64748b;
          font-size: 10px;
          text-transform: uppercase;
          letter-spacing: 0.05em;
          width: 56px;
          flex-shrink: 0;
        }
        .tm-subgrid-col-items {
          display: flex;
          align-items: center;
          gap: 12px;
        }
        .tm-micro-label {
          display: flex;
          align-items: center;
          gap: 5px;
          cursor: pointer;
          color: #cbd5e1;
          transition: color 0.15s ease;
        }
        .tm-micro-label:hover {
          color: #ffffff;
        }
        .tm-micro-chk {
          width: 12px;
          height: 12px;
          accent-color: #3b82f6;
          cursor: pointer;
          margin: 0;
        }
        .tm-sidebar-footer {
          padding: 8px 12px;
          border-top: 1px solid rgba(255, 255, 255, 0.06);
          font-size: 11px;
          color: #94a3b8;
          display: flex;
          align-items: center;
          justify-content: space-between;
          font-family: 'JetBrains Mono', monospace;
        }
        .tm-legend-item {
          display: flex;
          align-items: center;
          gap: 6px;
        }
        .tm-legend-dot {
          width: 6px;
          height: 6px;
          border-radius: 50%;
        }
        /* Правая основная панель (All-in-One единый скролл) */
        .tm-main-pane {
          flex: 1;
          background: #090d16;
          display: flex;
          flex-direction: column;
          overflow-y: auto;
          padding: 24px;
          gap: 20px;
        }
        .tm-section-box {
          border-radius: 8px;
          border: 1px solid rgba(255, 255, 255, 0.07);
          background: rgba(255, 255, 255, 0.015);
          padding: 16px;
          display: flex;
          flex-direction: column;
          gap: 16px;
        }
        .tm-section-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
        }
        .tm-section-title-wrap {
          display: flex;
          align-items: center;
          gap: 8px;
        }
        .tm-section-title {
          font-size: 13px;
          font-weight: 500;
          color: #f1f5f9;
          letter-spacing: -0.01em;
          margin: 0;
        }
        .tm-section-badge {
          font-size: 10px;
          font-family: 'JetBrains Mono', monospace;
          color: #94a3b8;
          background: rgba(255, 255, 255, 0.04);
          padding: 2px 6px;
          border-radius: 4px;
          border: 1px solid rgba(255, 255, 255, 0.06);
        }
        .tm-section-subtext {
          font-size: 12px;
          color: #64748b;
        }
        /* Таблицы */
        .tm-table-frame {
          border: 1px solid rgba(255, 255, 255, 0.07);
          border-radius: 8px;
          overflow: hidden;
          background: rgba(255, 255, 255, 0.01);
        }
        .tm-table {
          width: 100%;
          text-align: left;
          border-collapse: collapse;
        }
        .tm-table th {
          border-bottom: 1px solid rgba(255, 255, 255, 0.06);
          color: #94a3b8;
          font-size: 10px;
          text-transform: uppercase;
          letter-spacing: 0.05em;
          font-weight: 500;
          user-select: none;
          height: 32px;
          padding: 0 12px;
        }
        .tm-table td {
          border-bottom: 1px solid rgba(255, 255, 255, 0.04);
          font-family: 'JetBrains Mono', monospace;
          font-size: 12px;
          padding: 6px 12px;
          vertical-align: middle;
        }
        .tm-table tr:hover {
          background: rgba(255, 255, 255, 0.02);
        }
        /* Numeric inputs */
        .tm-num-input {
          width: 140px;
          height: 32px;
          padding: 0 10px;
          background: rgba(255, 255, 255, 0.02);
          border: 1px solid rgba(255, 255, 255, 0.08);
          border-radius: 4px;
          text-align: right;
          color: #f1f5f9;
          font-family: 'JetBrains Mono', monospace;
          font-size: 12px;
          outline: none;
          transition: all 0.15s ease;
        }
        .tm-num-input:focus {
          border-color: rgba(255, 255, 255, 0.2);
        }
        .tm-num-input.highlight-focus {
          border-color: rgba(59, 130, 246, 0.4);
        }
        .tm-num-input.highlight-focus:focus {
          border-color: #60a5fa;
        }
        .tm-delta-positive {
          color: rgba(52, 211, 153, 0.9);
          font-size: 11px;
          font-family: 'JetBrains Mono', monospace;
        }
        .tm-delta-negative {
          color: rgba(248, 113, 113, 0.9);
          font-size: 11px;
          font-family: 'JetBrains Mono', monospace;
        }
        .tm-delta-zero {
          color: #64748b;
          font-size: 11px;
          font-family: 'JetBrains Mono', monospace;
        }
        /* Блок НДС компенсации в шапке */
        .tm-vat-control {
          display: flex;
          align-items: center;
          gap: 8px;
          background: rgba(255, 255, 255, 0.03);
          border: 1px solid rgba(255, 255, 255, 0.08);
          border-radius: 6px;
          padding: 4px 10px;
        }
        .tm-vat-label {
          font-size: 11px;
          color: #94a3b8;
          font-weight: 500;
          white-space: nowrap;
        }
        .tm-vat-input-wrap {
          display: flex;
          align-items: center;
          gap: 3px;
        }
        .tm-vat-input {
          width: 44px;
          height: 24px;
          background: rgba(0, 0, 0, 0.35);
          border: 1px solid rgba(255, 255, 255, 0.12);
          border-radius: 4px;
          color: #38bdf8;
          font-family: 'JetBrains Mono', monospace;
          font-size: 12px;
          font-weight: 600;
          text-align: right;
          padding: 0 4px;
          outline: none;
          transition: all 0.15s ease;
        }
        .tm-vat-input:focus {
          border-color: #38bdf8;
          box-shadow: 0 0 0 2px rgba(56, 189, 248, 0.2);
        }
        .tm-vat-suffix {
          font-size: 11px;
          color: #64748b;
          font-family: 'JetBrains Mono', monospace;
        }
        /* Бейджи компенсации */
        .tm-comp-below {
          color: #f87171 !important;
          background: rgba(239, 68, 68, 0.12);
          border: 1px solid rgba(239, 68, 68, 0.3);
          border-radius: 4px;
          padding: 2px 6px;
          font-weight: 600;
          font-family: 'JetBrains Mono', monospace;
          font-size: 11px;
          display: inline-block;
          white-space: nowrap;
        }
        .tm-comp-above {
          color: #34d399 !important;
          background: rgba(16, 185, 129, 0.12);
          border: 1px solid rgba(16, 185, 129, 0.28);
          border-radius: 4px;
          padding: 2px 6px;
          font-weight: 600;
          font-family: 'JetBrains Mono', monospace;
          font-size: 11px;
          display: inline-block;
          white-space: nowrap;
        }
        .tm-comp-neutral {
          color: #64748b !important;
          font-family: 'JetBrains Mono', monospace;
          font-size: 11px;
          display: inline-block;
          padding: 2px 6px;
          white-space: nowrap;
        }
        /* Floating label wrapper for elevator */
        .tm-floating-field {
          position: relative;
          width: 160px;
        }
        .tm-floating-label {
          position: absolute;
          top: -8px;
          left: 10px;
          padding: 0 4px;
          background: #090d16;
          font-size: 10px;
          font-weight: 500;
          color: #94a3b8;
          z-index: 10;
        }
        .tm-floating-input {
          width: 100%;
          height: 32px;
          padding: 0 12px;
          background: rgba(255, 255, 255, 0.02);
          border: 1px solid rgba(255, 255, 255, 0.08);
          border-radius: 4px;
          text-align: left;
          color: #f1f5f9;
          font-family: 'JetBrains Mono', monospace;
          font-size: 12px;
          outline: none;
          transition: all 0.15s ease;
          box-sizing: border-box;
        }
        .tm-floating-display {
          display: flex;
          align-items: center;
          justify-content: flex-end;
          pointer-events: none;
          box-sizing: border-box;
        }
        /* Кнопка фильтров в сайдбаре */
        .tm-btn-filter-trigger {
          display: flex;
          align-items: center;
          gap: 6px;
          height: 28px;
          padding: 0 10px;
          background: rgba(255, 255, 255, 0.04);
          border: 1px solid rgba(255, 255, 255, 0.1);
          border-radius: 4px;
          color: #cbd5e1;
          font-size: 11px;
          font-weight: 500;
          cursor: pointer;
          transition: all 0.15s ease;
          white-space: nowrap;
          flex-shrink: 0;
        }
        .tm-btn-filter-trigger:hover {
          background: rgba(255, 255, 255, 0.08);
          border-color: rgba(255, 255, 255, 0.2);
          color: #ffffff;
        }
        .tm-btn-filter-trigger.has-active {
          background: rgba(59, 130, 246, 0.15);
          border-color: rgba(59, 130, 246, 0.4);
          color: #60a5fa;
        }
        .tm-filter-active-count {
          background: #3b82f6;
          color: #ffffff;
          font-size: 10px;
          font-weight: 700;
          padding: 1px 5px;
          border-radius: 8px;
          font-family: 'JetBrains Mono', monospace;
        }
        /* Модальное окно фильтров тарифов */
        .tm-filter-modal-overlay {
          position: absolute;
          top: 0;
          left: 0;
          right: 0;
          bottom: 0;
          background: rgba(0, 0, 0, 0.65);
          backdrop-filter: blur(4px);
          display: flex;
          align-items: center;
          justify-content: center;
          z-index: 1000;
          animation: tmFilterFadeIn 0.15s ease;
        }
        @keyframes tmFilterFadeIn {
          from { opacity: 0; transform: scale(0.98); }
          to { opacity: 1; transform: scale(1); }
        }
        .tm-filter-dialog {
          width: 520px;
          max-width: 95%;
          max-height: 85vh;
          display: flex;
          flex-direction: column;
          background: #090e18;
          border: 1px solid rgba(255, 255, 255, 0.12);
          border-radius: 12px;
          box-shadow: 0 24px 48px rgba(0, 0, 0, 0.7), 0 0 0 1px rgba(255, 255, 255, 0.05);
          overflow: hidden;
        }
        .tm-filter-dialog-header {
          padding: 14px 20px;
          border-bottom: 1px solid rgba(255, 255, 255, 0.08);
          display: flex;
          align-items: center;
          justify-content: space-between;
          background: #070b13;
        }
        .tm-filter-dialog-title {
          margin: 0;
          font-size: 14px;
          font-weight: 600;
          color: #f1f5f9;
        }
        .tm-filter-dialog-body {
          padding: 18px 20px;
          overflow-y: auto;
          display: flex;
          flex-direction: column;
          gap: 16px;
        }
        .tm-filter-group {
          display: flex;
          flex-direction: column;
          gap: 8px;
        }
        .tm-filter-group-title {
          font-size: 11px;
          font-weight: 600;
          text-transform: uppercase;
          letter-spacing: 0.05em;
          color: #94a3b8;
        }
        .tm-filter-options-grid {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 8px;
        }
        .tm-filter-checkbox-label {
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 8px 12px;
          background: rgba(255, 255, 255, 0.02);
          border: 1px solid rgba(255, 255, 255, 0.06);
          border-radius: 6px;
          cursor: pointer;
          transition: all 0.15s ease;
          font-size: 12px;
          color: #cbd5e1;
          user-select: none;
        }
        .tm-filter-checkbox-label:hover {
          background: rgba(255, 255, 255, 0.05);
          border-color: rgba(255, 255, 255, 0.14);
          color: #ffffff;
        }
        .tm-filter-checkbox-label input[type="checkbox"] {
          accent-color: #3b82f6;
          width: 15px;
          height: 15px;
          cursor: pointer;
          margin: 0;
        }
        .tm-filter-dialog-footer {
          padding: 12px 20px;
          border-top: 1px solid rgba(255, 255, 255, 0.08);
          display: flex;
          align-items: center;
          justify-content: space-between;
          background: #070b13;
        }
        .tm-floating-input:focus {
          border-color: rgba(255, 255, 255, 0.2);
        }
        .tm-floating-input.highlight-focus {
          border-color: rgba(59, 130, 246, 0.4);
        }
        .tm-floating-input.highlight-focus:focus {
          border-color: #60a5fa;
        }
        /* Stairs table inputs */
        .tm-stairs-input {
          width: 90px;
          height: 28px;
          padding: 0 8px;
          background: rgba(255, 255, 255, 0.02);
          border: 1px solid rgba(255, 255, 255, 0.08);
          border-radius: 4px;
          text-align: center;
          color: #f1f5f9;
          font-family: 'JetBrains Mono', monospace;
          font-size: 11px;
          outline: none;
          transition: all 0.15s ease;
        }
        .tm-stairs-input:focus {
          border-color: rgba(255, 255, 255, 0.2);
        }
        .tm-stairs-input.highlight-focus {
          border-color: rgba(59, 130, 246, 0.4);
        }
        .tm-stairs-input.highlight-focus:focus {
          border-color: #60a5fa;
        }
        .tm-stairs-input-short {
          width: 60px;
        }
        /* Подвал */
        .tm-footer {
          height: 56px;
          padding: 0 20px;
          border-top: 1px solid rgba(255, 255, 255, 0.07);
          display: flex;
          align-items: center;
          justify-content: space-between;
          flex-shrink: 0;
          user-select: none;
          background: #090d16;
        }
        .tm-footer-stats {
          font-size: 12px;
          color: #94a3b8;
          font-family: 'JetBrains Mono', monospace;
        }
        .tm-dot-sep {
          margin: 0 8px;
          color: rgba(255, 255, 255, 0.1);
        }
        .tm-modified-text {
          color: rgba(252, 211, 77, 0.9);
        }
        .tm-footer-actions {
          display: flex;
          align-items: center;
          gap: 10px;
        }
        .tm-btn-cancel {
          padding: 6px 14px;
          border-radius: 6px;
          font-size: 12px;
          color: #94a3b8;
          background: transparent;
          border: none;
          cursor: pointer;
          transition: color 0.15s ease;
        }
        .tm-btn-cancel:hover {
          color: #ffffff;
        }
        .tm-btn-save {
          padding: 6px 16px;
          border-radius: 6px;
          background: #2563eb;
          color: #ffffff;
          font-size: 12px;
          font-weight: 500;
          border: none;
          cursor: pointer;
          transition: background 0.15s ease;
        }
        .tm-btn-save:hover:not(:disabled) {
          background: #1d4ed8;
        }
        .tm-btn-save:disabled {
          background: rgba(255, 255, 255, 0.05);
          color: #64748b;
          cursor: not-allowed;
        }
        /* Прогресс-бар сканирования / записи */
        .tm-progress-center {
          flex: 1;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          padding: 40px;
          text-align: center;
        }
        .tm-progress-bar-track {
          width: 500px;
          max-width: 90%;
          height: 8px;
          background: rgba(255, 255, 255, 0.05);
          border-radius: 9999px;
          overflow: hidden;
          border: 1px solid rgba(255, 255, 255, 0.08);
          margin: 16px 0 10px;
        }
        .tm-progress-bar-fill {
          height: 100%;
          background: linear-gradient(90deg, #3b82f6, #10b981);
          width: 0%;
          transition: width 0.3s ease;
        }
        /* ==================== ОКНО СКАНИРОВАНИЯ (1:1 ПО СКРИНШОТУ) ==================== */
        .tm-window.tm-window-scanning {
          /* Точно такой же размер (1380x900px) и скругления, как у основного модала тарифов */
          padding: 0;
          overflow: hidden;
          display: flex;
          flex-direction: column;
        }
        .tm-window.tm-window-scanning > .tm-header,
        .tm-window.tm-window-scanning > .tm-footer {
          display: none !important;
        }
        .tm-window.tm-window-scanning > .tm-body {
          flex: 1;
          height: 100%;
          background: transparent;
          display: flex;
          flex-direction: column;
          overflow: hidden;
          padding: 0;
        }

        .tm-scan-container {
          flex: 1;
          height: 100%;
          padding: 28px 36px 24px 36px;
          display: flex;
          flex-direction: column;
          width: 100%;
          box-sizing: border-box;
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
          color: #e2e8f0;
          overflow: hidden;
        }

        .tm-scan-header {
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          gap: 16px;
          margin-bottom: 20px;
        }
        .tm-scan-header-left {
          display: flex;
          align-items: center;
          gap: 14px;
        }
        .tm-scan-icon-box {
          width: 40px;
          height: 40px;
          border-radius: 10px;
          background: rgba(30, 58, 138, 0.3);
          border: 1px solid rgba(59, 130, 246, 0.35);
          display: flex;
          align-items: center;
          justify-content: center;
          color: #38bdf8;
          flex-shrink: 0;
          box-shadow: 0 0 15px rgba(56, 189, 248, 0.12);
        }
        .tm-scan-sync-icon {
          animation: tmScanSpin 3.5s linear infinite;
        }
        @keyframes tmScanSpin {
          0% { transform: rotate(0deg); }
          100% { transform: rotate(360deg); }
        }
        .tm-scan-title {
          font-size: 17px;
          font-weight: 700;
          color: #ffffff;
          margin: 0;
          letter-spacing: -0.01em;
        }
        .tm-scan-subtitle {
          font-size: 12.5px;
          color: #64748b;
          margin-top: 4px;
          line-height: 1.4;
        }
        .tm-scan-header-badge {
          background: rgba(30, 58, 138, 0.35);
          border: 1px solid rgba(59, 130, 246, 0.35);
          color: #60a5fa;
          border-radius: 8px;
          padding: 4px 12px;
          font-size: 13px;
          font-weight: 600;
          font-family: monospace, sans-serif;
          white-space: nowrap;
          letter-spacing: 0.02em;
        }

        /* Прогресс-бар */
        .tm-scan-progress-section {
          margin-bottom: 22px;
        }
        .tm-scan-progress-labels {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 8px;
          font-size: 13px;
        }
        .tm-scan-op-name {
          display: flex;
          align-items: center;
          gap: 8px;
          color: #cbd5e1;
          font-weight: 500;
        }
        .tm-scan-op-dot {
          color: #38bdf8;
          font-size: 10px;
          filter: drop-shadow(0 0 4px #38bdf8);
        }
        .tm-scan-op-percent {
          color: #38bdf8;
          font-size: 14px;
          font-weight: 700;
          font-family: monospace, sans-serif;
        }
        .tm-scan-track {
          width: 100%;
          height: 5px;
          background: rgba(255, 255, 255, 0.06);
          border-radius: 9999px;
          overflow: hidden;
          position: relative;
        }
        .tm-scan-bar {
          height: 100%;
          background: linear-gradient(90deg, #2563eb, #06b6d4);
          box-shadow: 0 0 10px rgba(6, 182, 212, 0.7);
          border-radius: 9999px;
          transition: width 0.3s ease;
        }

        /* Статус тарифов */
        .tm-scan-status-row {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 12px;
        }
        .tm-scan-status-title {
          color: #64748b;
          font-size: 11px;
          font-weight: 700;
          letter-spacing: 0.08em;
          text-transform: uppercase;
        }
        .tm-scan-status-counts {
          display: flex;
          align-items: center;
          gap: 14px;
          font-size: 12px;
        }
        .tm-scan-stat {
          display: flex;
          align-items: center;
          gap: 4px;
          font-weight: 500;
        }
        .tm-stat-done { color: #cbd5e1; }
        .tm-stat-done .tm-stat-dot { color: #10b981; }
        .tm-stat-prog { color: #cbd5e1; }
        .tm-stat-prog .tm-stat-dot { color: #3b82f6; }
        .tm-stat-queue { color: #64748b; }
        .tm-stat-queue .tm-stat-dot { color: #475569; }

        /* Список тарифов */
        .tm-scan-list {
          flex: 1;
          min-height: 0;
          border: 1px solid rgba(255, 255, 255, 0.05);
          background: rgba(0, 0, 0, 0.25);
          border-radius: 10px;
          overflow-y: auto;
          overflow-x: hidden;
        }
        .tm-scan-item {
          display: flex;
          align-items: center;
          padding: 10px 16px;
          border-bottom: 1px solid rgba(255, 255, 255, 0.04);
          transition: background 0.15s ease;
          min-height: 44px;
        }
        .tm-scan-item:last-child {
          border-bottom: none;
        }
        .tm-scan-item:hover {
          background: rgba(255, 255, 255, 0.02);
        }
        .tm-scan-item.tm-scan-item-active {
          background: rgba(59, 130, 246, 0.05);
        }
        .tm-scan-item-icon {
          width: 20px;
          height: 20px;
          display: flex;
          align-items: center;
          justify-content: center;
          flex-shrink: 0;
        }
        .tm-scan-item-spinner {
          animation: tmSpinFast 1s linear infinite;
        }
        @keyframes tmSpinFast {
          0% { transform: rotate(0deg); }
          100% { transform: rotate(360deg); }
        }
        .tm-scan-item-name {
          font-weight: 600;
          font-size: 14px;
          color: #f1f5f9;
          margin-left: 14px;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
          max-width: 700px;
        }
        .tm-scan-item-id {
          font-size: 12px;
          color: #475569;
          margin-left: 6px;
          font-family: monospace;
          flex-shrink: 0;
        }
        .tm-scan-item-right {
          margin-left: auto;
          display: flex;
          align-items: center;
          gap: 12px;
          flex-shrink: 0;
        }
        .tm-badge-amber {
          background: rgba(234, 179, 8, 0.12);
          border: 1px solid rgba(234, 179, 8, 0.28);
          color: #eab308;
          border-radius: 4px;
          padding: 3px 8px;
          font-size: 11px;
          font-weight: 600;
          white-space: nowrap;
        }
        .tm-badge-gray {
          background: rgba(255, 255, 255, 0.04);
          border: 1px solid rgba(255, 255, 255, 0.08);
          color: #94a3b8;
          border-radius: 4px;
          padding: 3px 8px;
          font-size: 11px;
          font-weight: 500;
          white-space: nowrap;
        }
        .tm-badge-blue {
          background: rgba(59, 130, 246, 0.12);
          border: 1px solid rgba(59, 130, 246, 0.28);
          color: #60a5fa;
          border-radius: 4px;
          padding: 3px 8px;
          font-size: 11px;
          font-weight: 500;
          white-space: nowrap;
        }
        .tm-scan-item-status {
          font-size: 12px;
          min-width: 65px;
          text-align: right;
          font-weight: 500;
        }
        .tm-status-done { color: #10b981; }
        .tm-status-prog { color: #38bdf8; }
        .tm-status-queue { color: #64748b; font-weight: 400; }
        .tm-status-error { color: #ef4444; }

        /* Подвал окна сканирования */
        .tm-scan-footer {
          display: flex;
          justify-content: flex-end;
          align-items: center;
          margin-top: 20px;
          padding-top: 4px;
        }
        .tm-scan-footer-info {
          display: flex;
          align-items: center;
          gap: 8px;
          color: #64748b;
          font-size: 12px;
        }
        .tm-scan-footer-buttons {
          display: flex;
          align-items: center;
          gap: 10px;
        }
        .tm-scan-btn-minimize {
          background: #111827;
          border: 1px solid rgba(255, 255, 255, 0.1);
          color: #e2e8f0;
          border-radius: 8px;
          padding: 9px 18px;
          font-size: 13px;
          font-weight: 600;
          cursor: pointer;
          transition: all 0.15s ease;
        }
        .tm-scan-btn-minimize:hover {
          background: #1e293b;
          border-color: rgba(255, 255, 255, 0.2);
          color: #ffffff;
        }
        .tm-scan-btn-cancel {
          background: rgba(239, 68, 68, 0.1);
          border: 1px solid rgba(239, 68, 68, 0.25);
          color: #f87171;
          border-radius: 8px;
          padding: 9px 18px;
          font-size: 13px;
          font-weight: 600;
          cursor: pointer;
          transition: all 0.15s ease;
        }
        .tm-scan-btn-cancel:hover {
          background: rgba(239, 68, 68, 0.18);
          border-color: rgba(239, 68, 68, 0.4);
          color: #fca5a5;
        }

        /* Плавающий мини-бар при сворачивании */
        .tm-scan-minibar {
          position: fixed;
          bottom: 24px;
          right: 24px;
          z-index: 9999999;
          background: #0b111e;
          border: 1px solid rgba(59, 130, 246, 0.35);
          border-radius: 12px;
          padding: 12px 16px;
          box-shadow: 0 12px 30px rgba(0, 0, 0, 0.8), 0 0 20px rgba(37, 99, 235, 0.2);
          display: flex;
          align-items: center;
          gap: 12px;
          color: #f1f5f9;
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
          animation: tmToastIn 0.25s cubic-bezier(0.16, 1, 0.3, 1);
        }
        .tm-scan-minibar-icon {
          width: 24px;
          height: 24px;
          color: #38bdf8;
          display: flex;
          align-items: center;
          justify-content: center;
        }
        .tm-scan-minibar-icon svg {
          animation: tmScanSpin 2.5s linear infinite;
        }
        .tm-scan-minibar-text {
          display: flex;
          flex-direction: column;
        }
        .tm-scan-minibar-restore {
          background: rgba(59, 130, 246, 0.2);
          border: 1px solid rgba(59, 130, 246, 0.4);
          color: #93c5fd;
          border-radius: 6px;
          padding: 6px 12px;
          font-size: 12px;
          font-weight: 600;
          cursor: pointer;
          transition: background 0.15s;
        }
        .tm-scan-minibar-restore:hover {
          background: rgba(59, 130, 246, 0.35);
          color: #ffffff;
        }
        /* Уведомления (Toast) */
        .tm-toast-container {
          position: absolute;
          top: 64px;
          right: 24px;
          z-index: 10000;
          display: flex;
          flex-direction: column;
          gap: 10px;
          pointer-events: none;
        }
        .tm-toast {
          pointer-events: auto;
          display: flex;
          align-items: center;
          gap: 10px;
          padding: 12px 18px;
          border-radius: 8px;
          font-size: 13px;
          font-weight: 500;
          box-shadow: 0 12px 30px rgba(0,0,0,0.6);
          animation: tmToastIn 0.25s cubic-bezier(0.16, 1, 0.3, 1);
          transition: opacity 0.3s, transform 0.3s;
          max-width: 450px;
        }
        .tm-toast-success {
          background: #06281e;
          border: 1px solid #10b981;
          color: #a7f3d0;
        }
        .tm-toast-warning {
          background: #2d1f05;
          border: 1px solid #f59e0b;
          color: #fde68a;
        }
        .tm-toast-error {
          background: #300c0c;
          border: 1px solid #ef4444;
          color: #fecaca;
        }
        .tm-toast-info {
          background: #0f1c3f;
          border: 1px solid #3b82f6;
          color: #bfdbfe;
        }
        @keyframes tmToastIn {
          from { opacity: 0; transform: translateY(-10px) scale(0.95); }
          to { opacity: 1; transform: translateY(0) scale(1); }
        }
      `;
      document.head.appendChild(style);
    }

    showToast(message, type = 'success', duration = 4500) {
      if (!this.modalEl) return;
      let container = this.modalEl.querySelector('.tm-toast-container');
      if (!container) {
        container = document.createElement('div');
        container.className = 'tm-toast-container';
        const win = this.modalEl.querySelector('.tm-window') || this.modalEl;
        win.appendChild(container);
      }

      const toast = document.createElement('div');
      toast.className = `tm-toast tm-toast-${type}`;
      const icon = type === 'success' ? '✅' : (type === 'warning' ? '⚠️' : (type === 'error' ? '❌' : 'ℹ️'));
      toast.innerHTML = `
        <span style="font-size: 16px;">${icon}</span>
        <span style="flex: 1; line-height: 1.4;">${message}</span>
        <span style="cursor: pointer; opacity: 0.7; margin-left: 8px; font-size: 16px;" onclick="this.parentElement.remove()">✕</span>
      `;
      container.appendChild(toast);

      setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transform = 'translateY(-10px) scale(0.95)';
        setTimeout(() => toast.remove(), 350);
      }, duration);
    }

    async syncUuidsWithPageCards(filterNames = null) {
      try {
        window.__tariffCleanDOMMode = true;
        window.__tariffExportPauseCustomizer = true;
        localStorage.setItem('tariff_export_pause_customizer', '1');
        if (window.tariffCustomizerInstance && typeof window.tariffCustomizerInstance.restoreOriginalDOM === 'function') {
          window.tariffCustomizerInstance.restoreOriginalDOM();
        }

        const cards = this.getCurrentCards();
        if (!cards || cards.length === 0 || !this.tariffs || this.tariffs.length === 0) return;

        let updated = false;
        for (let i = 0; i < cards.length; i++) {
          const freshCards = this.getCurrentCards();
          const card = freshCards[i] || cards[i];
          if (!card) continue;
          const name = this.getTariffName(card);
          if (filterNames && Array.isArray(filterNames) && filterNames.length > 0 && !filterNames.includes(name)) {
            continue;
          }

          const titleElement = card.querySelector('.css-17i8ct5');
          let freshUuid = await this.getUuidFromCard(card, titleElement, name);

          if (name && freshUuid && !freshUuid.startsWith('tariff_')) {
            const t = this.tariffs.find(item => item.name === name);
            if (t) {
              if (t.uuid !== freshUuid) {
                console.log(`[TariffManager] Актуализирован UUID для "${name}": ${t.uuid} -> ${freshUuid}`);
                t.uuid = freshUuid;
                t.url = this.getTariffUrl(freshUuid);
                if (t._original) {
                  t._original.uuid = freshUuid;
                  t._original.url = t.url;
                }
                t._modified = false;
                updated = true;
              }
            }
          }
        }
        if (updated) {
          this.saveToCache();
          console.log('[TariffManager] Кэш успешно обновлен с новыми UUID из карточек страницы');
        }
      } catch (err) {
        console.warn('[TariffManager] Ошибка синхронизации UUID с карточками страницы:', err);
      } finally {
        this.restoreCustomization();
      }
    }

    async open(filterNames = null) {
      if (this.isOpen) return;
      this.isOpen = true;
      this.shouldStop = false;

      this.createModal();
      document.body.appendChild(this.modalEl);

      const hasCache = this.loadFromCache();
      if (hasCache && filterNames && Array.isArray(filterNames) && filterNames.length > 0) {
        // Мы только что сохранили измененные тарифы и перезагрузили страницу.
        // Данные тарифов уже сохранены в кэше, нужно только быстро актуализировать их UUID с карточек страницы!
        console.log('[TariffManager] Быстрая актуализация UUID для измененных тарифов после перезагрузки:', filterNames);
        await this.syncUuidsWithPageCards(filterNames);
        this.renderSplitView();
      } else if (hasCache) {
        this.renderSplitView();
      } else {
        this.startScan();
      }
    }

    close() {
      if (!this.isOpen) return;
      this.shouldStop = true;
      this.isScanning = false;
      this.isOpen = false;
      this.removeScanMinibar();
      if (this.modalEl && this.modalEl.parentNode) {
        this.modalEl.parentNode.removeChild(this.modalEl);
      }
      this.modalEl = null;

      this.restoreCustomization();
    }

    restoreCustomization() {
      try {
        window.__tariffCleanDOMMode = false;
        window.__disableResizeObservers = false;
        window.__tariffExportPauseCustomizer = false;
        localStorage.removeItem('tariff_export_pause_customizer');

        const reapply = () => {
          if (window.TariffToolsCore && typeof window.TariffToolsCore.exitCleanDOMMode === 'function') {
            window.TariffToolsCore.exitCleanDOMMode();
          }

          if (window.tariffExportPro && typeof window.tariffExportPro.checkAndAddButtons === 'function') {
            window.tariffExportPro.checkAndAddButtons();
          }

          if (window.tariffCustomizerInstance) {
            window.tariffCustomizerInstance.initialized = false;
            window.tariffCustomizerInstance.isUpdating = false;
            if (typeof window.tariffCustomizerInstance.assembleCustomization === 'function') {
              window.tariffCustomizerInstance.assembleCustomization();
            }
            if (typeof window.tariffCustomizerInstance.startInitialization === 'function') {
              window.tariffCustomizerInstance.startInitialization();
            }
          }
        };

        reapply();
        setTimeout(reapply, 150);
      } catch (e) {
        console.warn('[TariffManager] Ошибка восстановления кастомизации:', e);
      }
    }

    createModal() {
      this.modalEl = document.createElement('div');
      this.modalEl.id = 'tariff-manager-modal';
      this.modalEl.setAttribute('data-tts-inspector-ignore', 'true');

      this.modalEl.innerHTML = `
        <div class="tm-window">
          <!-- Шапка (Linear / Vercel Ultra-Clean Dark) -->
          <header class="tm-header">
            <div class="tm-header-left">
              <h1 class="tm-header-title">Изменение цен в тарифах</h1>
              <span class="tm-header-bullet">•</span>
              <span id="tm-cache-text" class="tm-cache-text">Загрузка кэша...</span>
            </div>

            <div class="tm-header-right">
              <div class="tm-vat-control" title="Процент НДС для 100% компенсации затрат (по умолчанию 22%)">
                <span class="tm-vat-label">НДС компенсация:</span>
                <div class="tm-vat-input-wrap">
                  <input type="number" id="tm-vat-rate" class="tm-vat-input" value="${this.vatCompensationRate || 22}" min="0" max="100" step="1">
                  <span class="tm-vat-suffix">%</span>
                </div>
              </div>

              <button type="button" id="tm-btn-rescan" class="tm-btn-rescan" title="Просканировать тарифы заново">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21.5 2v6h-6M2.5 22v-6h6M2 11.5a10 10 0 0 1 18.8-4.3M22 12.5a10 10 0 0 1-18.8 4.2"/></svg>
                <span>Сканировать заново</span>
              </button>
              <button type="button" id="tm-btn-close" class="tm-btn-close" title="Закрыть">✕</button>
            </div>
          </header>

          <!-- Тело -->
          <div class="tm-body" id="tm-modal-body"></div>

          <!-- Подвал -->
          <footer class="tm-footer" id="tm-modal-footer">
            <div class="tm-footer-stats" id="tm-footer-stats">
              <span>0 тарифов выбрано</span>
              <span class="tm-dot-sep">•</span>
              <span class="tm-modified-text">0 изменено</span>
            </div>
            <div class="tm-footer-actions">
              <button type="button" id="tm-btn-cancel" class="tm-btn-cancel">Отмена</button>
              <button type="button" id="tm-btn-save" class="tm-btn-save" disabled>Сохранить изменения</button>
            </div>
          </footer>
        </div>
      `;

      this.modalEl.querySelector('#tm-btn-close')?.addEventListener('click', () => this.close());
      this.modalEl.querySelector('#tm-btn-cancel')?.addEventListener('click', () => this.close());



      this.modalEl.querySelector('#tm-btn-rescan')?.addEventListener('click', () => {
        if (this.hasUnsavedChanges()) {
          if (!confirm('Имеются несохраненные правки. Повторное сканирование сотрет их. Продолжить?')) {
            return;
          }
        }
        this.startScan();
      });

      this.modalEl.querySelector('#tm-btn-save')?.addEventListener('click', () => {
        this.confirmAndWriteChanges();
      });

      this.modalEl.querySelector('#tm-vat-rate')?.addEventListener('input', (e) => {
        const val = parseFloat(e.target.value);
        this.vatCompensationRate = isNaN(val) ? 0 : val;
        this.updateAllCompensations();
      });
    }

    updateCacheBadge() {
      const textEl = this.modalEl?.querySelector('#tm-cache-text');
      if (!textEl) return;
      if (this.cachedMeta && this.cachedMeta.scannedAt) {
        const d = new Date(this.cachedMeta.scannedAt);
        const timeStr = d.toLocaleDateString() + ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        textEl.textContent = `Кэш от ${timeStr} (${this.tariffs.length} тарифов)`;
      } else {
        textEl.textContent = 'Кэш пуст';
      }
    }

    // ==================== СБОР КАРТОЧЕК И ПАРАМЕТРОВ (ПО АНАЛОГИИ С ЭКСПОРТОМ) ====================

    delay(ms) {
      return new Promise((resolve) => setTimeout(resolve, ms));
    }

    getCurrentCards() {
      let rawCards = Array.from(document.querySelectorAll('.css-nr5n4g, .e1wi2kqa9, .css-15ttl8p'));
      if (rawCards.length === 0) {
        const mainColumn = document.querySelector('.main-column, .tariff-layout, .css-1fttcpj');
        if (mainColumn) rawCards = Array.from(mainColumn.querySelectorAll('.css-nr5n4g, .e1wi2kqa9, .css-15ttl8p'));
      }
      if (rawCards.length === 0) {
        const titles = Array.from(document.querySelectorAll('.css-17i8ct5'));
        rawCards = titles.map((t) => t.closest('.css-nr5n4g, .e1wi2kqa9, .css-15ttl8p, [class*="e1wi2kqa"]') || t.parentElement?.parentElement).filter(Boolean);
      }
      const unique = [];
      const seen = new Set();
      for (const card of rawCards) {
        if (!card || seen.has(card)) continue;
        if (card.closest('#tariff-export-pro-sidebar, #tariff-manager-modal, .tariff-pro-rows-group')) continue;
        seen.add(card);
        unique.push(card);
      }
      return unique;
    }

    getCardsFromPage() {
      return this.getCurrentCards();
    }

    waitForCards({ timeout = 8000, interval = 100, minCount = 1 } = {}) {
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

    findUuidInObject(obj, currentOrgId, depth = 0) {
      if (!obj || typeof obj !== 'object' || depth > 5) return null;
      if (Array.isArray(obj) && obj.length > 1) return null;
      if (obj.tariffs && Array.isArray(obj.tariffs) && obj.tariffs.length > 1) return null;
      const uuidRegex = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
      try {
        const str = JSON.stringify(obj);
        const matches = str.match(uuidRegex);
        if (matches) {
          for (const m of matches) {
            if (!currentOrgId || m.toLowerCase() !== currentOrgId.toLowerCase()) return m;
          }
        }
      } catch (e) {
        for (const k of Object.keys(obj)) {
          if (k === 'return' || k === 'child' || k === 'sibling' || k === 'stateNode') continue;
          const val = obj[k];
          if (typeof val === 'string') {
            const matches = val.match(uuidRegex);
            if (matches) {
              for (const m of matches) {
                if (!currentOrgId || m.toLowerCase() !== currentOrgId.toLowerCase()) return m;
              }
            }
          } else if (val && typeof val === 'object') {
            const sub = this.findUuidInObject(val, currentOrgId, depth + 1);
            if (sub) return sub;
          }
        }
      }
      return null;
    }

    extractUuidFast(card) {
      if (!card) return null;
      const orgMatch = window.location.pathname.match(/\/tariffs\/([0-9a-f-]+)/i);
      const orgId = orgMatch ? orgMatch[1].toLowerCase() : '';
      const uuidRegex = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;

      // 1. Прямая ссылка в карточке (берем с конца, так как первый UUID может быть orgId)
      const link = card.querySelector('a[href*="/tariffs/"]');
      if (link && link.href) {
        const matches = link.href.match(uuidRegex);
        if (matches && matches.length > 0) {
          for (let i = matches.length - 1; i >= 0; i--) {
            const m = matches[i];
            if (!orgId || m.toLowerCase() !== orgId) return m;
          }
        }
      }

      // 2. Атрибуты карточки и дочерних элементов
      const allElements = [card, ...card.querySelectorAll('*')];
      for (const el of allElements) {
        if (el.getAttributeNames) {
          for (const attr of el.getAttributeNames()) {
            if (attr.startsWith('data-') || attr === 'id') {
              const val = el.getAttribute(attr);
              if (val) {
                const matches = val.match(uuidRegex);
                if (matches) {
                  for (const m of matches) {
                    if (!orgId || m.toLowerCase() !== orgId) return m;
                  }
                }
              }
            }
          }
        }

        // 3. React Fiber и memoizedProps / reactProps
        const fiberKey = Object.keys(el).find(k => k.startsWith('__reactFiber') || k.startsWith('__reactProps'));
        if (fiberKey && el[fiberKey]) {
          const obj = el[fiberKey];
          if (fiberKey.startsWith('__reactProps')) {
            const found = this.findUuidInObject(obj, orgId, 0);
            if (found) return found;
          }
          let fiber = obj;
          for (let d = 0; fiber && d < 4; d++) {
            if (fiber.memoizedProps && fiber.memoizedProps.tariffs && Array.isArray(fiber.memoizedProps.tariffs) && fiber.memoizedProps.tariffs.length > 1) {
              break;
            }
            if (fiber.key && typeof fiber.key === 'string') {
              const m = fiber.key.match(uuidRegex);
              if (m) {
                for (const id of m) {
                  if (!orgId || id.toLowerCase() !== orgId) return id;
                }
              }
            }
            if (fiber.memoizedProps) {
              const found = this.findUuidInObject(fiber.memoizedProps, orgId, 0);
              if (found) return found;
            }
            fiber = fiber.return;
          }
        }
      }

      return null;
    }

    extractTariffUuidDeep(card, tariffName = null) {
      return this.extractUuidFast(card);
    }

    getCachedTariffByName(name) {
      if (!name) return null;
      try {
        const raw = localStorage.getItem(this.getCacheKey());
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        if (parsed && Array.isArray(parsed.tariffs)) {
          return parsed.tariffs.find(t => t.name === name) || null;
        }
      } catch (_) {}
      return null;
    }

    getTariffName(card) {
      if (!card) return 'Без названия';
      const title = card.querySelector('.css-17i8ct5');
      if (title && title.textContent.trim()) {
        return title.textContent.trim();
      }
      const headerClone = card.querySelector('.tariff-header-wrapper .css-17i8ct5');
      if (headerClone && headerClone.textContent.trim()) {
        return headerClone.textContent.trim();
      }
      return 'Без названия';
    }

    extractTariffName(card) {
      return this.getTariffName(card);
    }

    getTariffUrl(tariffUuid) {
      const orgId = this.getOrgId();
      if (orgId && orgId !== 'default_org') {
        return `${window.location.origin}/configurator/tariffs/${orgId}/${tariffUuid}`;
      }
      const cleanBase = window.location.href.split('?')[0].split('#')[0].replace(/\/+$/, '');
      return `${cleanBase}/${tariffUuid}`;
    }

    async getUuidFromCard(card, titleElement, tariffName) {
      // Быстрое бескликовое извлечение (0мс, не меняет URL, не дергает историю назад и не сбрасывает авторизацию)
      const fastUuid = this.extractUuidFast(card);
      if (fastUuid) {
        return fastUuid;
      }

      // Запасной вариант через клик (если в Fiber/DOM UUID не найден)
      const targetElement = titleElement || card.querySelector('.css-17i8ct5') || card.querySelector('.css-qv45v3') || card;
      if (!targetElement) return null;

      const beforeUrl = window.location.href;
      try {
        targetElement.click();
      } catch (_) {
        try {
          targetElement.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
        } catch (_) {}
      }

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

    findEditButtonInTariffCard(card) {
      if (!card) return null;
      // 1. Кнопка с иконкой карандаша или редактирования
      const buttons = Array.from(card.querySelectorAll('button, a, div[role="button"]'));
      for (const btn of buttons) {
        if (btn.querySelector('.icomoon-icon__pencil, span[class*="pencil"], [class*="pencil"], [class*="edit"]')) {
          return btn;
        }
        const cls = btn.getAttribute('class') || '';
        if (cls.includes('pencil') || cls.includes('edit')) {
          return btn;
        }
      }

      const pencil = card.querySelector('.icomoon-icon__pencil, span[class*="pencil"], [class*="pencil"]');
      if (pencil) return pencil.closest('button, a') || pencil;

      // 2. Исходный элемент названия или его обертка
      const title = card.querySelector('.css-17i8ct5');
      if (title) return title;

      const clone = card.querySelector('.tariff-header-wrapper .css-17i8ct5, .tariff-header-wrapper');
      if (clone) return clone;

      return card;
    }

    async getUuidByClick(card, titleElement, tariffName) {
      return this.getUuidFromCard(card, titleElement, tariffName);
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

    async openBackgroundTab(url) {
      return new Promise((resolve) => {
        let settled = false;
        const finish = (res) => {
          if (!settled) {
            settled = true;
            resolve(res);
          }
        };

        if (typeof chrome !== 'undefined' && chrome.runtime && typeof chrome.runtime.sendMessage === 'function') {
          try {
            chrome.runtime.sendMessage({ action: 'open_background_tab', url }, (res) => {
              if (chrome.runtime.lastError || !res || !res.success || !res.tabId) {
                const win = window.open(url, '_blank');
                finish({ type: 'window', win });
              } else {
                finish({ type: 'tab', tabId: res.tabId });
              }
            });
            setTimeout(() => {
              if (!settled) {
                const win = window.open(url, '_blank');
                finish({ type: 'window', win });
              }
            }, 1200);
            return;
          } catch (e) {
            console.warn('[TariffManager] Ошибка вызова background service worker:', e);
          }
        }
        const win = window.open(url, '_blank');
        finish({ type: 'window', win });
      });
    }

    async openActiveTab(url) {
      return new Promise((resolve) => {
        let settled = false;
        const finish = (res) => {
          if (!settled) {
            settled = true;
            resolve(res);
          }
        };

        if (typeof chrome !== 'undefined' && chrome.runtime && typeof chrome.runtime.sendMessage === 'function') {
          try {
            chrome.runtime.sendMessage({ action: 'open_active_tab', url }, (res) => {
              if (chrome.runtime.lastError || !res || !res.success || !res.tabId) {
                const win = window.open(url, '_blank');
                finish({ type: 'window', win });
              } else {
                finish({ type: 'tab', tabId: res.tabId });
              }
            });
            setTimeout(() => {
              if (!settled) {
                const win = window.open(url, '_blank');
                finish({ type: 'window', win });
              }
            }, 1200);
            return;
          } catch (e) {
            console.warn('[TariffManager] Ошибка вызова background service worker:', e);
          }
        }
        const win = window.open(url, '_blank');
        finish({ type: 'window', win });
      });
    }

    closeBackgroundTab(handle) {
      if (!handle) return;
      if (handle.type === 'tab' && handle.tabId) {
        if (typeof chrome !== 'undefined' && chrome.runtime && typeof chrome.runtime.sendMessage === 'function') {
          try {
            chrome.runtime.sendMessage({ action: 'close_tab', tabId: handle.tabId });
          } catch (_) {}
        }
      } else if (handle.type === 'window' && handle.win) {
        try {
          if (!handle.win.closed) handle.win.close();
        } catch (_) {}
      }
    }

    async openAndCollect(tariffUrl, tariffName) {
      return new Promise(async (resolve) => {
        const requestId = Date.now() + '_' + Math.random().toString(36).slice(2);

        const reqData = {
          name: tariffName,
          url: tariffUrl,
          requestId,
          timestamp: Date.now()
        };

        try {
          const queue = JSON.parse(localStorage.getItem('tariff_collect_queue') || '{}');
          queue[requestId] = reqData;
          localStorage.setItem('tariff_collect_queue', JSON.stringify(queue));
        } catch (_) {}

        localStorage.setItem('tariff_to_collect', JSON.stringify(reqData));

        // Открываем вкладку строго в фоне (active: false), чтобы браузер оставался на окне панели управления
        const tabHandle = await this.openBackgroundTab(tariffUrl);

        const cleanUp = () => {
          try {
            const queue = JSON.parse(localStorage.getItem('tariff_collect_queue') || '{}');
            delete queue[requestId];
            localStorage.setItem('tariff_collect_queue', JSON.stringify(queue));
          } catch (_) {}
          localStorage.removeItem(`collected_tariff_${requestId}`);
          localStorage.removeItem('tariff_to_collect');
          this.closeBackgroundTab(tabHandle);
        };

        const started = Date.now();
        const timeoutMs = 18000;
        const interval = setInterval(() => {
          if (this.shouldStop) {
            clearInterval(interval);
            cleanUp();
            resolve(null);
            return;
          }

          const raw = localStorage.getItem(`collected_tariff_${requestId}`) || localStorage.getItem('collected_tariff_data');
          if (raw) {
            try {
              const parsed = JSON.parse(raw);
              if (parsed.requestId === requestId && parsed.tariffData) {
                clearInterval(interval);
                cleanUp();
                resolve(parsed.tariffData);
                return;
              }
            } catch (e) {
              console.warn('[TariffManager] Ошибка парсинга collected_tariff_data:', e);
            }
          }

          // Если вкладка была закрыта (для fallback window)
          if (Date.now() - started > 1500 && tabHandle?.type === 'window' && tabHandle.win?.closed) {
            const finalCheck = localStorage.getItem(`collected_tariff_${requestId}`) || localStorage.getItem('collected_tariff_data');
            if (finalCheck) {
              try {
                const parsed = JSON.parse(finalCheck);
                if (parsed.requestId === requestId && parsed.tariffData) {
                  clearInterval(interval);
                  cleanUp();
                  resolve(parsed.tariffData);
                  return;
                }
              } catch (_) {}
            }
            clearInterval(interval);
            cleanUp();
            console.warn(`[TariffManager] Вкладка для "${tariffName}" закрылась`);
            resolve(null);
            return;
          }

          if (Date.now() - started >= timeoutMs) {
            clearInterval(interval);
            console.warn('[TariffManager] Таймаут ожидания данных для ' + tariffName);
            cleanUp();
            resolve(null);
          }
        }, 80);
      });
    }

    pluralizePrices(n) {
      const mod10 = n % 10;
      const mod100 = n % 100;
      if (mod100 >= 11 && mod100 <= 19) return `${n} цен`;
      if (mod10 === 1) return `${n} цена`;
      if (mod10 >= 2 && mod10 <= 4) return `${n} цены`;
      return `${n} цен`;
    }

    getDeterministicId(name, index) {
      if (!name) return String(100 + index + 1);
      const match = name.match(/#?(\d{2,})/);
      if (match) return match[1];
      let h = 0;
      for (let j = 0; j < name.length; j++) {
        h = ((h << 5) - h) + name.charCodeAt(j);
        h |= 0;
      }
      return String(Math.abs(h % 890) + 101);
    }

    computeScanBadge(current, previous) {
      if (previous) {
        let diffPrices = 0;
        const currMgx = current.mgxRows || [];
        const prevMgx = previous.mgxRows || [];
        const maxLen = Math.max(currMgx.length, prevMgx.length);
        for (let j = 0; j < maxLen; j++) {
          const c = currMgx[j];
          const p = prevMgx[j];
          if (!c || !p || c.customerPrice !== p.customerPrice || c.internalPrice !== p.internalPrice) {
            diffPrices++;
          }
        }

        const elevatorChanged =
          (current.elevatorPrice?.customer || '0') !== (previous.elevatorPrice?.customer || '0') ||
          (current.elevatorPrice?.internal || '0') !== (previous.elevatorPrice?.internal || '0');

        const floorChanged =
          JSON.stringify(current.floorRows || []) !== JSON.stringify(previous.floorRows || []);

        const intervalsChanged =
          JSON.stringify(current.intervals || []) !== JSON.stringify(previous.intervals || []);

        if (diffPrices > 0) {
          return { badge: `Обновлено ${this.pluralizePrices(diffPrices)}`, badgeType: 'amber' };
        }
        if (elevatorChanged || floorChanged) {
          return { badge: 'Обновлен подъем', badgeType: 'amber' };
        }
        if (intervalsChanged) {
          return { badge: 'Обновлены интервалы', badgeType: 'amber' };
        }
        return { badge: 'Без изменений', badgeType: 'gray' };
      }

      // Если предыдущего снимка нет (первое сканирование с сайта)
      const currMgx = current.mgxRows || [];
      const customPrices = currMgx.filter(r => r.customerPrice && r.customerPrice !== '0' && r.customerPrice !== r.internalPrice).length;
      if (customPrices > 0) {
        return { badge: `Обновлено ${this.pluralizePrices(customPrices)}`, badgeType: 'amber' };
      }
      if (current.elevatorPrice && current.elevatorPrice.customer && current.elevatorPrice.customer !== '0' && current.elevatorPrice.customer !== current.elevatorPrice.internal) {
        return { badge: 'Обновлен подъем', badgeType: 'amber' };
      }
      return { badge: 'Без изменений', badgeType: 'gray' };
    }

    initScanItems(cards) {
      this.scanItems = (cards || []).map((card, i) => {
        const name = this.getTariffName(card);
        const code = this.getDeterministicId(name, i);
        return {
          name,
          code,
          status: 'queued',
          badge: '',
          badgeType: 'gray',
          statusText: 'В очереди'
        };
      });

      const total = this.scanItems.length;
      const badge = this.modalEl?.querySelector('#tm-scan-header-badge');
      if (badge) {
        badge.textContent = `0 / ${total} тарифов`;
      }
      const queueEl = this.modalEl?.querySelector('#tm-stat-queue');
      if (queueEl) {
        queueEl.textContent = total;
      }

      this.renderScanListItems();
    }

    renderScanView() {
      const win = this.modalEl?.querySelector('.tm-window');
      if (win) {
        win.classList.add('tm-window-scanning');
      }
      const body = this.modalEl?.querySelector('#tm-modal-body');
      const footer = this.modalEl?.querySelector('#tm-modal-footer');
      if (!body) return;
      if (footer) footer.style.display = 'none';

      const total = this.scanItems?.length || 0;

      body.innerHTML = `
        <div class="tm-scan-container">
          <!-- Шапка окна сканирования -->
          <div class="tm-scan-header">
            <div class="tm-scan-header-left">
              <div class="tm-scan-icon-box">
                <svg class="tm-scan-sync-icon" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M21.5 2v6h-6M2.5 22v-6h6M2 11.5a10 10 0 0 1 18.8-4.3M22 12.5a10 10 0 0 1-18.8 4.2"/>
                </svg>
              </div>
              <div>
                <h2 class="tm-scan-title">Сканирование и синхронизация тарифов</h2>
              </div>
            </div>
            <div class="tm-scan-header-badge" id="tm-scan-header-badge">
              0 / ${total} тарифов
            </div>
          </div>

          <!-- Секция прогресс-бара -->
          <div class="tm-scan-progress-section">
            <div class="tm-scan-progress-labels">
              <div class="tm-scan-op-name">
                <span class="tm-scan-op-dot">●</span>
                <span id="tm-scan-op-text">Синхронизация тарифов доставки</span>
              </div>
              <div class="tm-scan-op-percent" id="tm-scan-op-percent">0%</div>
            </div>
            <div class="tm-scan-track">
              <div class="tm-scan-bar" id="tm-scan-bar" style="width: 0%;"></div>
            </div>
          </div>

          <!-- Строка статусов -->
          <div class="tm-scan-status-row">
            <div class="tm-scan-status-title">СТАТУС ТАРИФОВ</div>
            <div class="tm-scan-status-counts">
              <span class="tm-scan-stat tm-stat-done"><span class="tm-stat-dot">●</span> <b id="tm-stat-done">0</b> готово</span>
              <span class="tm-scan-stat tm-stat-prog"><span class="tm-stat-dot">●</span> <b id="tm-stat-prog">0</b> в процессе</span>
              <span class="tm-scan-stat tm-stat-queue"><span class="tm-stat-dot">●</span> <b id="tm-stat-queue">${total}</b> в очереди</span>
            </div>
          </div>

          <!-- Список строк тарифов -->
          <div class="tm-scan-list" id="tm-scan-list"></div>

          <!-- Подвал окна -->
          <div class="tm-scan-footer">
            <div class="tm-scan-footer-buttons">
              <button type="button" class="tm-scan-btn-cancel" id="tm-btn-scan-cancel">
                Отменить сканирование
              </button>
            </div>
          </div>
        </div>
      `;

      body.querySelector('#tm-btn-scan-cancel')?.addEventListener('click', () => {
        this.shouldStop = true;
        this.isScanning = false;
        this.removeScanMinibar();
        if (this.tariffs && this.tariffs.length > 0) {
          win?.classList.remove('tm-window-scanning');
          this.renderSplitView();
        } else {
          this.close();
        }
      });

      this.renderScanListItems();
    }

    renderScanListItems() {
      const container = this.modalEl?.querySelector('#tm-scan-list');
      if (!container) return;

      if (!this.scanItems || this.scanItems.length === 0) {
        container.innerHTML = `
          <div style="padding: 24px; text-align: center; color: #64748b; font-size: 13px;">
            Поиск тарифов на странице...
          </div>
        `;
        return;
      }

      container.innerHTML = this.scanItems.map((item, i) => this.getScanItemRowHtml(item, i)).join('');
    }

    getScanItemRowHtml(item, i) {
      let iconHtml = '';
      let statusClass = 'tm-status-queue';
      let badgeHtml = '';

      if (item.status === 'done') {
        iconHtml = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#10b981" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="m9 12 2 2 4-4"/></svg>`;
        statusClass = 'tm-status-done';
      } else if (item.status === 'in_progress') {
        iconHtml = `<svg class="tm-scan-item-spinner" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#38bdf8" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10" stroke-opacity="0.25"/><path d="M12 2a10 10 0 0 1 10 10"/></svg>`;
        statusClass = 'tm-status-prog';
      } else if (item.status === 'error') {
        iconHtml = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#ef4444" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>`;
        statusClass = 'tm-status-error';
      } else {
        iconHtml = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#334155" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/></svg>`;
        statusClass = 'tm-status-queue';
      }

      if (item.badge) {
        const badgeClass = item.badgeType === 'amber' ? 'tm-badge-amber' : (item.badgeType === 'blue' ? 'tm-badge-blue' : 'tm-badge-gray');
        badgeHtml = `<div class="tm-scan-item-badge ${badgeClass}">${this.escapeHtml(item.badge)}</div>`;
      }

      const activeRowClass = item.status === 'in_progress' ? 'tm-scan-item-active' : '';

      return `
        <div class="tm-scan-item ${activeRowClass}" id="tm-scan-row-${i}">
          <div class="tm-scan-item-icon">${iconHtml}</div>
          <div class="tm-scan-item-name" title="${this.escapeHtml(item.name)}">${this.escapeHtml(item.name)}</div>
          <div class="tm-scan-item-id">#${this.escapeHtml(String(item.code))}</div>
          <div class="tm-scan-item-right">
            ${badgeHtml}
            <div class="tm-scan-item-status ${statusClass}">${this.escapeHtml(item.statusText || 'В очереди')}</div>
          </div>
        </div>
      `;
    }

    updateScanItem(index, updates) {
      if (!this.scanItems || !this.scanItems[index]) return;
      Object.assign(this.scanItems[index], updates);

      const row = this.modalEl?.querySelector(`#tm-scan-row-${index}`);
      if (row) {
        const item = this.scanItems[index];
        row.outerHTML = this.getScanItemRowHtml(item, index);
        const updatedRow = this.modalEl?.querySelector(`#tm-scan-row-${index}`);
        if (updatedRow && item.status === 'in_progress') {
          updatedRow.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }
      }
    }

    updateScanCounts() {
      if (!this.scanItems) return;
      const done = this.scanItems.filter(x => x.status === 'done').length;
      const prog = this.scanItems.filter(x => x.status === 'in_progress').length;
      const total = this.scanItems.length;
      const queue = Math.max(0, total - done - prog);

      const doneEl = this.modalEl?.querySelector('#tm-stat-done');
      const progEl = this.modalEl?.querySelector('#tm-stat-prog');
      const queueEl = this.modalEl?.querySelector('#tm-stat-queue');
      const badgeEl = this.modalEl?.querySelector('#tm-scan-header-badge');

      if (doneEl) doneEl.textContent = done;
      if (progEl) progEl.textContent = prog;
      if (queueEl) queueEl.textContent = queue;
      if (badgeEl) badgeEl.textContent = `${done} / ${total} тарифов`;

      const miniBadge = document.getElementById('tm-mini-badge');
      if (miniBadge) miniBadge.textContent = `${done} / ${total}`;
    }

    updateScanProgress(percentRatio, totalCount, statusText) {
      const percent = Math.min(100, Math.round(percentRatio * 100));
      const fill = this.modalEl?.querySelector('#tm-scan-bar');
      const percentEl = this.modalEl?.querySelector('#tm-scan-op-percent');
      const opTextEl = this.modalEl?.querySelector('#tm-scan-op-text');

      if (fill) fill.style.width = percent + '%';
      if (percentEl) percentEl.textContent = percent + '%';
      if (opTextEl && statusText) opTextEl.textContent = statusText;

      const miniPercent = document.getElementById('tm-mini-percent');
      if (miniPercent) miniPercent.textContent = percent + '%';
    }

    setScanStatus(txt, type = 'info') {
      const opTextEl = this.modalEl?.querySelector('#tm-scan-op-text');
      if (opTextEl) {
        opTextEl.textContent = txt;
        if (type === 'error') opTextEl.style.color = '#f87171';
        else if (type === 'warning') opTextEl.style.color = '#fef08a';
        else opTextEl.style.color = '#cbd5e1';
      }
    }

    minimizeScanView() {
      if (!this.modalEl) return;
      this.modalEl.style.display = 'none';
      this.showScanMinibar();
    }

    showScanMinibar() {
      this.removeScanMinibar();
      const done = (this.scanItems || []).filter(x => x.status === 'done').length;
      const total = this.scanItems?.length || 0;
      const fill = this.modalEl?.querySelector('#tm-scan-bar');
      const currentPercent = fill ? fill.style.width : '0%';

      const bar = document.createElement('div');
      bar.id = 'tm-scan-minibar';
      bar.className = 'tm-scan-minibar';
      bar.innerHTML = `
        <div class="tm-scan-minibar-icon">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M21.5 2v6h-6M2.5 22v-6h6M2 11.5a10 10 0 0 1 18.8-4.3M22 12.5a10 10 0 0 1-18.8 4.2"/>
          </svg>
        </div>
        <div class="tm-scan-minibar-text">
          <div style="font-weight: 600; font-size: 13px; color: #f1f5f9;">Синхронизация тарифов</div>
          <div style="font-size: 11px; color: #94a3b8;"><span id="tm-mini-badge">${done} / ${total}</span> (<span id="tm-mini-percent">${currentPercent}</span>)</div>
        </div>
        <button type="button" id="tm-btn-minibar-restore" class="tm-scan-minibar-restore">Развернуть</button>
      `;
      document.body.appendChild(bar);
      bar.querySelector('#tm-btn-minibar-restore')?.addEventListener('click', () => {
        this.restoreScanView();
      });
    }

    restoreScanView() {
      this.removeScanMinibar();
      if (this.modalEl) {
        this.modalEl.style.display = 'flex';
      }
    }

    removeScanMinibar() {
      document.getElementById('tm-scan-minibar')?.remove();
    }

    async startScan(targetNames = null) {
      if (this.isScanning) return;
      this.isScanning = true;
      this.shouldStop = false;

      const isSelectiveScan = Array.isArray(targetNames) && targetNames.length > 0;
      
      // Загружаем кэш для сохранения ранее известных UUID перед инициализацией
      if (!this.tariffs || this.tariffs.length === 0) {
        this.loadFromCache();
      }
      const previousTariffsMap = new Map((this.tariffs || []).map(t => [t.name, t]));

      if (!isSelectiveScan) {
        this.tariffs = [];
      }
      this.selectedTariffs.clear();
      this.scanItems = [];

      window.__tariffCleanDOMMode = true;
      window.__tariffExportPauseCustomizer = true;
      localStorage.setItem('tariff_export_pause_customizer', '1');
      if (window.tariffCustomizerInstance && typeof window.tariffCustomizerInstance.restoreOriginalDOM === 'function') {
        window.tariffCustomizerInstance.restoreOriginalDOM();
      }

      try {
        this.renderScanView();
        if (isSelectiveScan) {
          const scanTitle = this.modalEl?.querySelector('.tm-scan-title');
          if (scanTitle) scanTitle.textContent = 'Синхронизация измененных тарифов';
          const opText = this.modalEl?.querySelector('#tm-scan-op-text');
          if (opText) opText.textContent = 'Синхронизация измененных тарифов';
        }
        this.updateScanProgress(0, 1, isSelectiveScan ? 'Поиск измененных тарифов на странице...' : 'Поиск тарифов на странице...');
        await this.waitForCards({ timeout: 6000, interval: 100, minCount: 1 });

        const allCards = this.getCurrentCards();
        let targetCards = allCards;
        if (isSelectiveScan) {
          const filtered = allCards.filter(c => targetNames.includes(this.getTariffName(c)));
          if (filtered.length > 0) {
            targetCards = filtered;
          }
        }

        const totalTariffs = targetCards.length;
        console.log(`[TariffManager] Обнаружено карточек для сканирования: ${totalTariffs} (из ${allCards.length} всего, selective: ${isSelectiveScan})`);

        if (totalTariffs === 0) {
          this.setScanStatus('Тарифы не обнаружены на странице. Убедитесь, что список тарифов полностью загрузился.', 'error');
          return;
        }

        this.initScanItems(targetCards);

        // ================= ФАЗА 1: Сбор UUID тарифов (как в экспорте) =================
        const tariffList = [];
        const seenUuids = new Set();
        this.updateScanProgress(0, totalTariffs, isSelectiveScan ? 'Синхронизация измененных тарифов' : 'Синхронизация тарифов доставки');

        for (let i = 0; i < totalTariffs; i++) {
          if (this.shouldStop) break;

          const freshCards = this.getCurrentCards();
          let card = null;
          let name = '';

          if (isSelectiveScan) {
            const targetName = targetNames[i];
            card = freshCards.find(c => this.getTariffName(c) === targetName) || targetCards[i];
            name = targetName;
          } else {
            card = freshCards[i] || targetCards[i];
            name = card ? this.getTariffName(card) : '';
          }

          if (!card) continue;
          const titleElement = card.querySelector('.css-17i8ct5');

          this.updateScanItem(i, {
            status: 'in_progress',
            badge: 'Поиск UUID...',
            badgeType: 'blue',
            statusText: 'В процессе'
          });
          this.updateScanCounts();

          const progressFraction = (i + 1) * 0.25 / totalTariffs;
          this.updateScanProgress(progressFraction, totalTariffs, isSelectiveScan ? 'Синхронизация измененных тарифов' : 'Синхронизация тарифов доставки');

          let uuid = await this.getUuidFromCard(card, titleElement, name);

          // Если в DOM не найден или возникла коллизия, проверяем кэш для тарифа с этим именем
          if (!uuid || seenUuids.has(uuid)) {
            const prev = previousTariffsMap.get(name) || this.getCachedTariffByName(name);
            if (prev && prev.uuid && !seenUuids.has(prev.uuid) && !prev.uuid.startsWith('tariff_')) {
              uuid = prev.uuid;
              console.log(`[TariffManager] Использован проверенный UUID из кэша для "${name}": ${uuid}`);
            }
          }

          if (uuid && !seenUuids.has(uuid) && !uuid.startsWith('tariff_')) {
            seenUuids.add(uuid);
            tariffList.push({
              name,
              uuid,
              url: this.getTariffUrl(uuid),
              itemIndex: i
            });
            this.updateScanItem(i, {
              status: 'queued',
              badge: 'Ожидание',
              badgeType: 'gray',
              statusText: 'В очереди'
            });
            console.log(`[TariffManager] Успешно зарегистрирован тариф ${tariffList.length}/${totalTariffs}: "${name}" (${uuid})`);
          } else {
            console.warn(`[TariffManager] Не удалось получить уникальный UUID для тарифа "${name}":`, uuid);
            this.updateScanItem(i, {
              status: 'error',
              badge: 'Ошибка UUID',
              badgeType: 'gray',
              statusText: 'Ошибка'
            });
          }
          this.updateScanCounts();
        }

        if (this.shouldStop) return;

        if (tariffList.length === 0) {
          this.setScanStatus('Не удалось получить валидные идентификаторы тарифов.', 'error');
          return;
        }

        console.log(`[TariffManager] Фаза 1 завершена: получено ${tariffList.length} UUID из ${totalTariffs} тарифов`);

        // ================= ФАЗА 2: Конвейерный сбор параметров в фоне (2 параллельных тарифа) =================
        this.updateScanProgress(0.25, tariffList.length, isSelectiveScan ? 'Синхронизация измененных тарифов' : 'Синхронизация тарифов доставки');

        let nextTariffIndex = 0;
        let completedScanCount = 0;
        const totalScanTariffs = tariffList.length;

        const processTariffInPipeline = async (idx) => {
          if (this.shouldStop) return;
          const t = tariffList[idx];
          const itemIdx = t.itemIndex !== undefined ? t.itemIndex : idx;

          this.updateScanItem(itemIdx, {
            status: 'in_progress',
            badge: 'Сбор данных...',
            badgeType: 'blue',
            statusText: 'В процессе'
          });
          this.updateScanCounts();

          console.log(`[TariffManager] Конвейер: сбор данных для "${t.name}" -> ${t.url}`);
          const detailed = await this.openAndCollect(t.url, t.name);
          console.log(`[TariffManager] Собраны параметры для "${t.name}":`, detailed);

          if (this.shouldStop) return;

          const merged = {
            uuid: t.uuid,
            url: t.url,
            name: t.name,
            zones: detailed?.zones || [],
            branches: detailed?.branches || [],
            elevatorPrice: {
              internal: detailed?.elevatorPrices?.internalPrice || '0',
              customer: detailed?.elevatorPrices?.customerPrice || '0'
            },
            floorPrice: {
              internalPrice: detailed?.floorRows?.[0]?.internalPrice || '0',
              internalThreshold: detailed?.floorRows?.[0]?.internalThreshold || '1',
              customerPrice: detailed?.floorRows?.[0]?.customerPrice || '0',
              customerThreshold: detailed?.floorRows?.[0]?.customerThreshold || '1'
            },
            floorRows: detailed?.floorRows || [],
            mgxRows: detailed?.mgxRows || [],
            payment: (detailed?.payment && (detailed.payment.card || detailed.payment.cash))
              ? detailed.payment
              : (detailed?.payment || { card: true, cash: false }),
            acceptance: (detailed?.acceptance && (detailed.acceptance.sameDay || detailed.acceptance.nextDay))
              ? detailed.acceptance
              : (detailed?.acceptance || { sameDay: true, nextDay: false }),
            saleTypes: detailed?.saleTypes || { product: true, markdown: false, legal: false, service: false },
            deliveryDays: detailed?.deliveryDays || '0',
            cutoffTime: detailed?.cutoffTime || '00:00',
            costLimit: detailed?.costLimit || '',
            startDate: this.startDate,
            startTime: this.startTime,
            intervals: detailed?.intervals || []
          };

          const normTariff = this.normalizeTariffObject(merged);
          if (isSelectiveScan) {
            const existingIdx = this.tariffs.findIndex(item => item.name === normTariff.name);
            if (existingIdx >= 0) {
              this.tariffs[existingIdx] = normTariff;
            } else {
              this.tariffs.push(normTariff);
            }
          } else {
            this.tariffs[itemIdx] = normTariff;
          }

          const prev = previousTariffsMap.get(t.name);
          const badgeInfo = this.computeScanBadge(normTariff, prev);

          this.updateScanItem(itemIdx, {
            status: 'done',
            badge: badgeInfo.badge,
            badgeType: badgeInfo.badgeType,
            statusText: 'Готово'
          });
          completedScanCount++;
          this.updateScanCounts();

          const progress = 0.25 + (completedScanCount / totalScanTariffs) * 0.75;
          this.updateScanProgress(progress, totalScanTariffs, isSelectiveScan ? 'Синхронизация измененных тарифов' : 'Синхронизация тарифов доставки');
        };

        const pipelineWorker = async () => {
          while (nextTariffIndex < totalScanTariffs && !this.shouldStop) {
            const currentIdx = nextTariffIndex++;
            await processTariffInPipeline(currentIdx);
          }
        };

        const poolSize = Math.min(2, totalScanTariffs);
        const pipelineWorkers = [];
        for (let p = 0; p < poolSize; p++) {
          pipelineWorkers.push(pipelineWorker());
          if (p < poolSize - 1) await this.delay(350);
        }

        await Promise.all(pipelineWorkers);
        this.tariffs = this.tariffs.filter(Boolean);

        if (this.tariffs.length > 0) {
          this.selectedTariffs = new Set(this.tariffs.map(t => t.uuid));
          if (isSelectiveScan) {
            const firstTarget = this.tariffs.find(t => targetNames.includes(t.name));
            this.activeTariffUuid = firstTarget ? firstTarget.uuid : this.tariffs[0].uuid;
          } else {
            this.activeTariffUuid = this.tariffs[0].uuid;
          }
          this.saveToCache();
          this.updateScanProgress(1, tariffList.length, 'Синхронизация тарифов завершена');
          this.updateScanCounts();

          await this.delay(700);

          const win = this.modalEl?.querySelector('.tm-window');
          if (win) win.classList.remove('tm-window-scanning');
          this.removeScanMinibar();
          this.renderSplitView();
          this.showToast(isSelectiveScan ? `Успешно обновлено ${tariffList.length} измененных тарифов` : `Успешно синхронизировано ${this.tariffs.length} тарифов`, 'success');
        } else {
          this.setScanStatus('Не удалось собрать параметры тарифов.', 'error');
        }
      } finally {
        this.isScanning = false;
        this.removeScanMinibar();
        this.restoreCustomization();
      }
    }

    // ==================== РЕНДЕР ОСНОВНОГО SPLIT VIEW (DARK THEME) ====================

    // ==================== ALL-IN-ONE SINGLE-PANE VIEW (PRECISION DARK) ====================

    renderSplitView() {
      const win = this.modalEl?.querySelector('.tm-window');
      if (win) {
        win.classList.remove('tm-window-scanning');
      }
      this.removeScanMinibar();

      const body = this.modalEl?.querySelector('#tm-modal-body');
      const footer = this.modalEl?.querySelector('#tm-modal-footer');
      if (!body) return;

      if (footer) footer.style.display = 'flex';
      this.updateCacheBadge();

      body.innerHTML = `
        <!-- Левый сайдбар списка тарифов -->
        <aside class="tm-sidebar">
          <div class="tm-sidebar-controls">
            <div style="display: flex; align-items: center; gap: 8px;">
              <div class="tm-search-box" style="flex: 1;">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>
                <input type="text" id="tm-search-tariffs" class="tm-search-input" placeholder="Поиск по тарифам..." value="${this.escapeHtml(this.searchTerm)}">
              </div>
              <button type="button" id="tm-btn-open-filters" class="tm-btn-filter-trigger ${this.getActiveFiltersCount() > 0 ? 'has-active' : ''}" title="Фильтры по параметрам тарифов">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/></svg>
                <span>Фильтры</span>
                ${this.getActiveFiltersCount() > 0 ? `<span class="tm-filter-active-count">${this.getActiveFiltersCount()}</span>` : ''}
              </button>
            </div>

            <div class="tm-sidebar-filter-row" style="padding: 2px 4px; display: flex; justify-content: space-between; align-items: center; color: #64748b; font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.04em;">
              <span>Тарифы</span>
              <span id="tm-active-count-badge" style="font-family: 'JetBrains Mono', monospace; font-size: 11px; color: #94a3b8;">${this.tariffs.length} из ${this.tariffs.length}</span>
            </div>
          </div>

          <div class="tm-card-list" id="tm-card-list"></div>

          <div class="tm-sidebar-footer">
            <span class="tm-legend-item"><span class="tm-legend-dot" style="background: rgba(251, 191, 36, 0.8);"></span> изменен</span>
            <span class="tm-legend-item"><span class="tm-legend-dot" style="background: #3b82f6;"></span> выбран</span>
            <span class="tm-legend-item"><span class="tm-legend-dot" style="background: rgba(255, 255, 255, 0.2);"></span> стандарт</span>
          </div>
        </aside>

        <!-- Правая основная панель (All-in-One единый скролл всех 4 блоков) -->
        <section class="tm-main-pane" id="tm-main-pane">
          <div id="tm-sections-container" style="display: flex; flex-direction: column; gap: 20px;"></div>
        </section>
      `;



      const searchInput = body.querySelector('#tm-search-tariffs');
      searchInput?.addEventListener('input', (e) => {
        this.searchTerm = e.target.value.toLowerCase().trim();
        this.renderCardList();
      });

      const filterBtn = body.querySelector('#tm-btn-open-filters');
      filterBtn?.addEventListener('click', () => {
        this.openFilterModal();
      });

      this.renderCardList();
      this.renderAllSectionsView();
      this.updateFooterStats();
    }

    getActiveFiltersCount(customFilters = this.filters) {
      if (!customFilters) return 0;
      return Object.values(customFilters).filter(Boolean).length;
    }

    getFilteredTariffs(customFilters = this.filters) {
      const f = customFilters || {};
      return this.tariffs.filter((t) => {
        if (this.searchTerm && !t.name.toLowerCase().includes(this.searchTerm)) {
          return false;
        }

        if (f.modifiedOnly && !t._modified) return false;
        if (f.unmodifiedOnly && t._modified) return false;

        if (f.paymentCard && !t.payment?.card) return false;
        if (f.paymentCash && !t.payment?.cash) return false;

        if (f.acceptanceSameDay && !t.acceptance?.sameDay) return false;
        if (f.acceptanceNextDay && !t.acceptance?.nextDay) return false;

        if (f.saleProduct && !t.saleTypes?.product) return false;
        if (f.saleMarkdown && !t.saleTypes?.markdown) return false;
        if (f.saleLegal && !t.saleTypes?.legal) return false;
        if (f.saleService && !t.saleTypes?.service) return false;

        if (f.hasIntervals && (!t.intervals || t.intervals.length === 0 || !t.intervals.some((i) => i.enabled !== false))) return false;
        if (f.hasElevator && (!t.elevatorPrice || (parseFloat(t.elevatorPrice.customer) <= 0 && parseFloat(t.elevatorPrice.internal) <= 0))) return false;
        if (f.hasStairs && (!t.floorRows || t.floorRows.length === 0 || !t.floorRows.some((r) => parseFloat(r.customerPrice) > 0 || parseFloat(r.internalPrice) > 0))) return false;

        return true;
      });
    }

    resetFilters() {
      if (this.filters) {
        Object.keys(this.filters).forEach((k) => (this.filters[k] = false));
      }
      this.searchTerm = '';
      const searchInput = this.modalEl?.querySelector('#tm-search-tariffs');
      if (searchInput) searchInput.value = '';
      this.renderCardList();
      const filtered = this.getFilteredTariffs();
      if (filtered.length > 0 && !filtered.some((t) => t.uuid === this.activeTariffUuid)) {
        this.activeTariffUuid = filtered[0].uuid;
        this.renderAllSectionsView();
      }
    }

    openFilterModal() {
      const win = this.modalEl?.querySelector('.tm-window') || this.modalEl;
      if (!win) return;

      win.querySelector('#tm-filter-modal-overlay')?.remove();

      const tempFilters = { ...(this.filters || {}) };

      const getMatchCount = () => {
        return this.getFilteredTariffs(tempFilters).length;
      };

      const overlay = document.createElement('div');
      overlay.id = 'tm-filter-modal-overlay';
      overlay.className = 'tm-filter-modal-overlay';

      overlay.innerHTML = `
        <div class="tm-filter-dialog">
          <div class="tm-filter-dialog-header">
            <div style="display: flex; align-items: center; gap: 8px;">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#60a5fa" stroke-width="2"><polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/></svg>
              <h3 class="tm-filter-dialog-title">Фильтры тарифов</h3>
            </div>
            <button type="button" id="tm-filter-dialog-close" class="tm-btn-close" title="Закрыть">✕</button>
          </div>

          <div class="tm-filter-dialog-body">
            <!-- Статус изменений -->
            <div class="tm-filter-group">
              <div class="tm-filter-group-title">Статус изменений</div>
              <div class="tm-filter-options-grid">
                <label class="tm-filter-checkbox-label">
                  <input type="checkbox" class="tm-filter-cb" data-key="modifiedOnly" ${tempFilters.modifiedOnly ? 'checked' : ''}>
                  <span>Только измененные</span>
                </label>
                <label class="tm-filter-checkbox-label">
                  <input type="checkbox" class="tm-filter-cb" data-key="unmodifiedOnly" ${tempFilters.unmodifiedOnly ? 'checked' : ''}>
                  <span>Только без изменений</span>
                </label>
              </div>
            </div>

            <!-- Способы оплаты -->
            <div class="tm-filter-group">
              <div class="tm-filter-group-title">Способы оплаты</div>
              <div class="tm-filter-options-grid">
                <label class="tm-filter-checkbox-label">
                  <input type="checkbox" class="tm-filter-cb" data-key="paymentCard" ${tempFilters.paymentCard ? 'checked' : ''}>
                  <span>Оплата картой</span>
                </label>
                <label class="tm-filter-checkbox-label">
                  <input type="checkbox" class="tm-filter-cb" data-key="paymentCash" ${tempFilters.paymentCash ? 'checked' : ''}>
                  <span>Оплата наличными</span>
                </label>
              </div>
            </div>

            <!-- Прием заявок -->
            <div class="tm-filter-group">
              <div class="tm-filter-group-title">Прием заявок</div>
              <div class="tm-filter-options-grid">
                <label class="tm-filter-checkbox-label">
                  <input type="checkbox" class="tm-filter-cb" data-key="acceptanceSameDay" ${tempFilters.acceptanceSameDay ? 'checked' : ''}>
                  <span>В день заказа (День в день)</span>
                </label>
                <label class="tm-filter-checkbox-label">
                  <input type="checkbox" class="tm-filter-cb" data-key="acceptanceNextDay" ${tempFilters.acceptanceNextDay ? 'checked' : ''}>
                  <span>На следующий день</span>
                </label>
              </div>
            </div>

            <!-- Типы продаж -->
            <div class="tm-filter-group">
              <div class="tm-filter-group-title">Типы продаж</div>
              <div class="tm-filter-options-grid">
                <label class="tm-filter-checkbox-label">
                  <input type="checkbox" class="tm-filter-cb" data-key="saleProduct" ${tempFilters.saleProduct ? 'checked' : ''}>
                  <span>Исправный товар (Испр.)</span>
                </label>
                <label class="tm-filter-checkbox-label">
                  <input type="checkbox" class="tm-filter-cb" data-key="saleMarkdown" ${tempFilters.saleMarkdown ? 'checked' : ''}>
                  <span>Уцененный товар (Уцен.)</span>
                </label>
                <label class="tm-filter-checkbox-label">
                  <input type="checkbox" class="tm-filter-cb" data-key="saleLegal" ${tempFilters.saleLegal ? 'checked' : ''}>
                  <span>Юридические лица (Юр. лица)</span>
                </label>
                <label class="tm-filter-checkbox-label">
                  <input type="checkbox" class="tm-filter-cb" data-key="saleService" ${tempFilters.saleService ? 'checked' : ''}>
                  <span>Сервисный товар (Сервис)</span>
                </label>
              </div>
            </div>

            <!-- Дополнительные опции -->
            <div class="tm-filter-group">
              <div class="tm-filter-group-title">Дополнительные опции</div>
              <div class="tm-filter-options-grid">
                <label class="tm-filter-checkbox-label">
                  <input type="checkbox" class="tm-filter-cb" data-key="hasIntervals" ${tempFilters.hasIntervals ? 'checked' : ''}>
                  <span>С интервалами доставки</span>
                </label>
                <label class="tm-filter-checkbox-label">
                  <input type="checkbox" class="tm-filter-cb" data-key="hasElevator" ${tempFilters.hasElevator ? 'checked' : ''}>
                  <span>С подъемом на лифте</span>
                </label>
                <label class="tm-filter-checkbox-label" style="grid-column: span 2;">
                  <input type="checkbox" class="tm-filter-cb" data-key="hasStairs" ${tempFilters.hasStairs ? 'checked' : ''}>
                  <span>С ручным подъемом по лестнице</span>
                </label>
              </div>
            </div>
          </div>

          <div class="tm-filter-dialog-footer">
            <button type="button" id="tm-filter-dialog-reset" class="tm-btn-cancel" style="padding: 6px 14px; font-size: 12px;">Сбросить все</button>
            <button type="button" id="tm-filter-dialog-apply" class="tm-btn-save" style="padding: 6px 18px; font-size: 12px;">
              Применить (найдено: ${getMatchCount()})
            </button>
          </div>
        </div>
      `;

      win.appendChild(overlay);

      const applyBtn = overlay.querySelector('#tm-filter-dialog-apply');
      const updateMatchButton = () => {
        if (applyBtn) {
          applyBtn.textContent = `Применить (найдено: ${getMatchCount()})`;
        }
      };

      overlay.querySelectorAll('.tm-filter-cb').forEach((cb) => {
        cb.addEventListener('change', (e) => {
          const key = cb.getAttribute('data-key');
          if (key) {
            tempFilters[key] = e.target.checked;
            if (key === 'modifiedOnly' && e.target.checked) {
              tempFilters.unmodifiedOnly = false;
              const other = overlay.querySelector('.tm-filter-cb[data-key="unmodifiedOnly"]');
              if (other) other.checked = false;
            } else if (key === 'unmodifiedOnly' && e.target.checked) {
              tempFilters.modifiedOnly = false;
              const other = overlay.querySelector('.tm-filter-cb[data-key="modifiedOnly"]');
              if (other) other.checked = false;
            }
            updateMatchButton();
          }
        });
      });

      overlay.querySelector('#tm-filter-dialog-reset')?.addEventListener('click', () => {
        Object.keys(tempFilters).forEach((k) => (tempFilters[k] = false));
        overlay.querySelectorAll('.tm-filter-cb').forEach((cb) => (cb.checked = false));
        updateMatchButton();
      });

      const closeDialog = () => {
        overlay.remove();
      };

      overlay.querySelector('#tm-filter-dialog-close')?.addEventListener('click', closeDialog);
      overlay.addEventListener('click', (e) => {
        if (e.target === overlay) closeDialog();
      });

      applyBtn?.addEventListener('click', () => {
        this.filters = { ...tempFilters };
        closeDialog();
        this.renderCardList();
        const filtered = this.getFilteredTariffs();
        if (filtered.length > 0 && !filtered.some((t) => t.uuid === this.activeTariffUuid)) {
          this.activeTariffUuid = filtered[0].uuid;
          this.renderAllSectionsView();
        }
      });
    }

    renderCardList() {
      const container = this.modalEl?.querySelector('#tm-card-list');
      if (!container) return;

      const filtered = this.getFilteredTariffs();

      const countBadge = this.modalEl?.querySelector('#tm-active-count-badge');
      if (countBadge) {
        countBadge.textContent = `${filtered.length} из ${this.tariffs.length}`;
      }

      const filterBtn = this.modalEl?.querySelector('#tm-btn-open-filters');
      if (filterBtn) {
        const activeCount = this.getActiveFiltersCount();
        if (activeCount > 0) {
          filterBtn.classList.add('has-active');
          let badge = filterBtn.querySelector('.tm-filter-active-count');
          if (!badge) {
            badge = document.createElement('span');
            badge.className = 'tm-filter-active-count';
            filterBtn.appendChild(badge);
          }
          badge.textContent = activeCount;
          badge.style.display = 'inline-block';
        } else {
          filterBtn.classList.remove('has-active');
          const badge = filterBtn.querySelector('.tm-filter-active-count');
          if (badge) badge.style.display = 'none';
        }
      }

      if (filtered.length === 0) {
        container.innerHTML = `
          <div style="font-size: 12px; color: #64748b; text-align: center; padding: 28px 16px; font-family: 'JetBrains Mono', monospace; display: flex; flex-direction: column; align-items: center; gap: 12px;">
            <span>Тарифы не найдены</span>
            <button type="button" id="tm-btn-reset-filters-empty" class="tm-btn-filter-trigger" style="font-size: 11px;">
              Сбросить фильтры
            </button>
          </div>
        `;
        container.querySelector('#tm-btn-reset-filters-empty')?.addEventListener('click', () => {
          this.resetFilters();
        });
        return;
      }

      container.innerHTML = filtered.map((t, idx) => {
        const isSelected = this.selectedTariffs.has(t.uuid);
        const isActive = this.activeTariffUuid === t.uuid;
        const isModified = t._modified;

        return `
          <div class="tm-tariff-card ${isActive ? 'active' : ''}" data-uuid="${t.uuid}">
            <div class="tm-card-header">
              <span class="tm-card-title" title="${this.escapeHtml(t.name)}">${this.escapeHtml(t.name)}</span>
              ${isModified
                ? '<span class="tm-card-badge-modified">изменен</span>'
                : `<span class="tm-card-badge-id">#${idx + 101}</span>`
              }
            </div>

            <div class="tm-card-subgrid">
              <!-- Оплата -->
              <div class="tm-subgrid-row">
                <span class="tm-subgrid-col-label">Оплата:</span>
                <div class="tm-subgrid-col-items">
                  <label class="tm-micro-label">
                    <input type="checkbox" class="tm-micro-chk tm-chk-card" ${t.payment?.card ? 'checked' : ''}>
                    <span>Карта</span>
                  </label>
                  <label class="tm-micro-label">
                    <input type="checkbox" class="tm-micro-chk tm-chk-cash" ${t.payment?.cash ? 'checked' : ''}>
                    <span>Нал</span>
                  </label>
                </div>
              </div>

              <!-- Заявки -->
              <div class="tm-subgrid-row">
                <span class="tm-subgrid-col-label">Заявки:</span>
                <div class="tm-subgrid-col-items">
                  <label class="tm-micro-label">
                    <input type="radio" class="tm-micro-chk tm-radio-sameday" name="orders_${t.uuid}" value="sameDay" ${t.acceptance?.sameDay ? 'checked' : ''}>
                    <span>В день</span>
                  </label>
                  <label class="tm-micro-label">
                    <input type="radio" class="tm-micro-chk tm-radio-nextday" name="orders_${t.uuid}" value="nextDay" ${t.acceptance?.nextDay ? 'checked' : ''}>
                    <span>След.</span>
                  </label>
                </div>
              </div>

              <!-- Продажи -->
              <div class="tm-subgrid-row">
                <span class="tm-subgrid-col-label">Продажи:</span>
                <div class="tm-subgrid-col-items" style="gap: 8px;">
                  <label class="tm-micro-label" title="Исправный товар">
                    <input type="checkbox" class="tm-micro-chk tm-chk-sale-prod" ${t.saleTypes?.product ? 'checked' : ''}>
                    <span>Испр.</span>
                  </label>
                  <label class="tm-micro-label" title="Уцененный товар">
                    <input type="checkbox" class="tm-micro-chk tm-chk-sale-mark" ${t.saleTypes?.markdown ? 'checked' : ''}>
                    <span>Уцен.</span>
                  </label>
                  <label class="tm-micro-label" title="Юридические лица">
                    <input type="checkbox" class="tm-micro-chk tm-chk-sale-legal" ${t.saleTypes?.legal ? 'checked' : ''}>
                    <span>Юр. лица</span>
                  </label>
                  <label class="tm-micro-label" title="Сервисный товар">
                    <input type="checkbox" class="tm-micro-chk tm-chk-sale-serv" ${t.saleTypes?.service ? 'checked' : ''}>
                    <span>Сервис</span>
                  </label>
                </div>
              </div>
            </div>
          </div>
        `;
      }).join('');

      const activeBadge = this.modalEl?.querySelector('#tm-active-count-badge');
      if (activeBadge) {
        activeBadge.textContent = `Всего: ${filtered.length}`;
      }

      // Навешиваем слушатели на карточки
      container.querySelectorAll('.tm-tariff-card').forEach((card) => {
        const uuid = card.getAttribute('data-uuid');
        const tariff = this.tariffs.find((t) => t.uuid === uuid);
        if (!tariff) return;

        // Клик по карточке для выбора тарифа
        card.addEventListener('click', (e) => {
          if (e.target.tagName === 'INPUT' || e.target.closest('label')) return;
          this.activeTariffUuid = uuid;
          this.renderCardList();
          this.renderAllSectionsView();
        });

        // Оплата: Карта
        card.querySelector('.tm-chk-card')?.addEventListener('change', (e) => {
          tariff.payment.card = e.target.checked;
          this.checkTariffModified(tariff);
          this.updateFooterStats();
          this.updateCardBadge(card, tariff);
        });

        // Оплата: Нал
        card.querySelector('.tm-chk-cash')?.addEventListener('change', (e) => {
          tariff.payment.cash = e.target.checked;
          this.checkTariffModified(tariff);
          this.updateFooterStats();
          this.updateCardBadge(card, tariff);
        });

        // Заявки: В день / След.
        card.querySelector('.tm-radio-sameday')?.addEventListener('change', (e) => {
          if (e.target.checked) {
            tariff.acceptance.sameDay = true;
            tariff.acceptance.nextDay = false;
            this.checkTariffModified(tariff);
            this.updateFooterStats();
            this.updateCardBadge(card, tariff);
          }
        });
        card.querySelector('.tm-radio-nextday')?.addEventListener('change', (e) => {
          if (e.target.checked) {
            tariff.acceptance.sameDay = false;
            tariff.acceptance.nextDay = true;
            this.checkTariffModified(tariff);
            this.updateFooterStats();
            this.updateCardBadge(card, tariff);
          }
        });

        // Продажи: Испр, Уцен, Юр. лица, Сервис
        card.querySelector('.tm-chk-sale-prod')?.addEventListener('change', (e) => {
          tariff.saleTypes.product = e.target.checked;
          this.checkTariffModified(tariff);
          this.updateFooterStats();
          this.updateCardBadge(card, tariff);
        });
        card.querySelector('.tm-chk-sale-mark')?.addEventListener('change', (e) => {
          tariff.saleTypes.markdown = e.target.checked;
          this.checkTariffModified(tariff);
          this.updateFooterStats();
          this.updateCardBadge(card, tariff);
        });
        card.querySelector('.tm-chk-sale-legal')?.addEventListener('change', (e) => {
          tariff.saleTypes.legal = e.target.checked;
          this.checkTariffModified(tariff);
          this.updateFooterStats();
          this.updateCardBadge(card, tariff);
        });
        card.querySelector('.tm-chk-sale-serv')?.addEventListener('change', (e) => {
          tariff.saleTypes.service = e.target.checked;
          this.checkTariffModified(tariff);
          this.updateFooterStats();
          this.updateCardBadge(card, tariff);
        });
      });
    }

    updateCardBadge(cardEl, tariff) {
      if (!cardEl) return;
      const headerEl = cardEl.querySelector('.tm-card-header');
      if (!headerEl) return;
      let badge = headerEl.querySelector('.tm-card-badge-modified, .tm-card-badge-id');
      if (tariff._modified) {
        if (!badge || !badge.classList.contains('tm-card-badge-modified')) {
          if (badge) badge.remove();
          const newBadge = document.createElement('span');
          newBadge.className = 'tm-card-badge-modified';
          newBadge.textContent = 'изменен';
          headerEl.appendChild(newBadge);
        }
      } else {
        if (badge && badge.classList.contains('tm-card-badge-modified')) {
          badge.className = 'tm-card-badge-id';
          badge.textContent = `#${tariff.uuid.slice(-4)}`;
        }
      }
    }

    parsePrice(val) {
      if (val === undefined || val === null) return NaN;
      const s = String(val).replace(/\s+/g, '').replace(',', '.');
      const num = parseFloat(s);
      return isNaN(num) ? NaN : num;
    }

    calculateDelta(customer, internal) {
      const c = this.parsePrice(customer);
      const i = this.parsePrice(internal);
      if (isNaN(c) && isNaN(i)) {
        return { text: '—', value: 0, className: 'tm-delta-zero' };
      }
      const numCust = isNaN(c) ? 0 : c;
      const numInt = isNaN(i) ? 0 : i;
      const delta = numCust - numInt;
      if (delta > 0) {
        return { text: `+${delta.toLocaleString('ru-RU')} ₽`, value: delta, className: 'tm-delta-positive' };
      } else if (delta < 0) {
        return { text: `${delta.toLocaleString('ru-RU')} ₽`, value: delta, className: 'tm-delta-negative' };
      } else {
        return { text: '0 ₽', value: 0, className: 'tm-delta-zero' };
      }
    }

    calculateCompensation(customer, internal, threshold = this.vatCompensationRate) {
      const c = this.parsePrice(customer);
      const i = this.parsePrice(internal);

      if (isNaN(c) && isNaN(i)) {
        return { text: '—', value: null, className: 'tm-comp-neutral' };
      }

      const numCust = isNaN(c) ? 0 : c;
      const numInt = isNaN(i) ? 0 : i;

      if (numInt === 0 && numCust === 0) {
        return { text: '—', value: 0, className: 'tm-comp-neutral' };
      }

      if (numInt === 0 && numCust > 0) {
        const isBelow = 100 < (threshold !== undefined ? threshold : 22);
        return {
          text: '+100.0%',
          value: 100,
          className: isBelow ? 'tm-comp-below' : 'tm-comp-above'
        };
      }

      if (numInt > 0 && numCust === 0) {
        return {
          text: '-100.0%',
          value: -100,
          className: 'tm-comp-below'
        };
      }

      // Формула пользователя: цена покупателя / на цену внутренняя - 1 (в процентах)
      const compVal = ((numCust / numInt) - 1) * 100;
      const sign = compVal > 0 ? '+' : '';
      const text = `${sign}${compVal.toFixed(1)}%`;
      const isBelow = compVal < (threshold !== undefined ? threshold : 22);

      return {
        text,
        value: compVal,
        className: isBelow ? 'tm-comp-below' : 'tm-comp-above'
      };
    }

    updateAllCompensations() {
      if (!this.modalEl) return;

      // 1. МГХ сетка
      this.modalEl.querySelectorAll('#tm-mgx-tbody tr').forEach((tr) => {
        const inpCust = tr.querySelector('.tm-inp-mgx-customer');
        const inpInt = tr.querySelector('.tm-inp-mgx-internal');
        const compEl = tr.querySelector('.tm-mgx-compensation');
        if (compEl) {
          const compRes = this.calculateCompensation(inpCust?.value, inpInt?.value);
          compEl.textContent = compRes.text;
          compEl.className = `${compRes.className} tm-mgx-compensation`;
        }
      });

      // 2. Интервалы доставки
      this.modalEl.querySelectorAll('#tm-intervals-tbody tr').forEach((tr) => {
        const inpCust = tr.querySelector('.tm-inp-inv-cust');
        const inpInt = tr.querySelector('.tm-inp-inv-int');
        const compEl = tr.querySelector('.tm-inv-compensation');
        if (compEl) {
          const compRes = this.calculateCompensation(inpCust?.value, inpInt?.value);
          compEl.textContent = compRes.text;
          compEl.className = `${compRes.className} tm-inv-compensation`;
        }
      });

      // 3. Подъем: Лифт
      const liftCust = this.modalEl.querySelector('#tm-lift-customer');
      const liftInt = this.modalEl.querySelector('#tm-lift-internal');
      const liftCompEl = this.modalEl.querySelector('#tm-lift-compensation');
      if (liftCompEl) {
        const compRes = this.calculateCompensation(liftCust?.value, liftInt?.value);
        liftCompEl.textContent = compRes.text;
        liftCompEl.className = `${compRes.className}`;
      }

      // 4. Подъем: Лестница
      this.modalEl.querySelectorAll('#tm-floor-tbody tr').forEach((tr) => {
        const inpCust = tr.querySelector('.tm-stairs-cust');
        const inpInt = tr.querySelector('.tm-stairs-int');
        const compEl = tr.querySelector('.tm-floor-compensation');
        if (compEl) {
          const compRes = this.calculateCompensation(inpCust?.value, inpInt?.value);
          compEl.textContent = compRes.text;
          compEl.className = `${compRes.className} tm-floor-compensation`;
        }
      });
    }

    getActiveTariff() {
      if (this.activeTariffUuid) {
        const found = this.tariffs.find((t) => t.uuid === this.activeTariffUuid);
        if (found) return found;
      }
      if (this.selectedTariffs.size > 0) {
        const firstUuid = Array.from(this.selectedTariffs)[0];
        return this.tariffs.find((t) => t.uuid === firstUuid);
      }
      return this.tariffs[0] || null;
    }

    formatWeightLabel(w) {
      if (!w) return '—';
      const str = String(w).trim();
      const numMatch = str.match(/\d+(?:[.,]\d+)?/);
      if (numMatch) {
        return `до ${numMatch[0]} кг`;
      }
      let res = str;
      if (!/^до/i.test(res)) res = `до ${res}`;
      if (!/кг$/i.test(res)) res = `${res} кг`;
      return res;
    }

    // ==================== РЕНДЕР ВСЕХ 4 БЛОКОВ В ЕДИНОМ ОКНЕ ====================

    renderAllSectionsView() {
      const container = this.modalEl?.querySelector('#tm-sections-container');
      if (!container) return;

      const activeTariff = this.getActiveTariff();
      if (!activeTariff) {
        container.innerHTML = `<div style="font-size: 13px; color: #64748b; padding: 40px; text-align: center;">Выберите тариф в списке слева для просмотра и редактирования</div>`;
        return;
      }

      const selectedCount = this.selectedTariffs.size || 1;

      // 1. Строки МГХ сетки
      const mgxSource = (activeTariff.mgxRows && activeTariff.mgxRows.length > 0)
        ? activeTariff.mgxRows
        : ['15', '70', '120', '240', '360'].map((w) => ({ weight: w, internal: '', customer: '', return: '' }));

      // 2. Интервалы доставки
      const intervalsSource = (activeTariff.intervals && activeTariff.intervals.length > 0)
        ? activeTariff.intervals
        : [
            { enabled: true, startTime: '10:00', endTime: '14:00', orderBefore: 'до 09:00', internalPriceAdjustment: '0', priceAdjustment: '0' },
            { enabled: true, startTime: '14:00', endTime: '18:00', orderBefore: 'до 12:00', internalPriceAdjustment: '150', priceAdjustment: '200' },
            { enabled: true, startTime: '18:00', endTime: '22:00', orderBefore: 'до 16:00', internalPriceAdjustment: '250', priceAdjustment: '350' }
          ];

      // 3. Строки подъема по лестнице
      const floorSource = (activeTariff.floorRows && activeTariff.floorRows.length > 0)
        ? activeTariff.floorRows
        : [
            { weight: '15', volume: '0.2', internalPrice: '', internalThreshold: '', customerPrice: '', customerThreshold: '' },
            { weight: '70', volume: '0.8', internalPrice: '80', internalThreshold: '2', customerPrice: '120', customerThreshold: '2' },
            { weight: '120', volume: '1.5', internalPrice: '150', internalThreshold: '2', customerPrice: '220', customerThreshold: '2' },
            { weight: '240', volume: '3.0', internalPrice: '250', internalThreshold: '1', customerPrice: '350', customerThreshold: '1' },
            { weight: '360', volume: '5.0', internalPrice: '400', internalThreshold: '1', customerPrice: '550', customerThreshold: '1' }
          ];

      container.innerHTML = `
        <!-- БЛОК 1: Установка цен по МГХ сетке -->
        <div style="display: flex; flex-direction: column; gap: 12px;">
          <div class="tm-section-header">
            <div class="tm-section-title-wrap">
              <h2 class="tm-section-title">Установка цен по МГХ сетке</h2>
              <span class="tm-section-badge" style="color: #60a5fa; background: rgba(59, 130, 246, 0.1); border-color: rgba(59, 130, 246, 0.2); font-size: 11px; padding: 3px 8px; border-radius: 4px;">${this.escapeHtml(activeTariff.name)}</span>
            </div>
          </div>

          <div class="tm-table-frame">
            <table class="tm-table">
              <thead>
                <tr>
                  <th style="width: 140px;">Макс. вес</th>
                  <th style="text-align: right;">Внутренняя цена, ₽</th>
                  <th style="text-align: right;">Цена покупателя, ₽</th>
                  <th style="text-align: right;">Возврат, ₽</th>
                  <th style="width: 95px; text-align: right;">Дельта</th>
                  <th style="width: 110px; text-align: right;">Компенсация</th>
                </tr>
              </thead>
              <tbody id="tm-mgx-tbody">
                ${mgxSource.map((r, idx) => {
                  const deltaRes = this.calculateDelta(r.customer, r.internal);
                  const compRes = this.calculateCompensation(r.customer, r.internal);

                  return `
                    <tr data-weight="${this.escapeHtml(r.weight)}" data-idx="${idx}">
                      <td style="font-weight: 500; color: #cbd5e1; font-family: 'Geist', sans-serif;">
                        ${this.escapeHtml(this.formatWeightLabel(r.weight))}
                      </td>
                      <td style="text-align: right;">
                        <input type="text" class="tm-num-input tm-inp-mgx-internal" value="${this.escapeHtml(r.internal)}" placeholder="0">
                      </td>
                      <td style="text-align: right;">
                        <input type="text" class="tm-num-input highlight-focus tm-inp-mgx-customer" value="${this.escapeHtml(r.customer)}" placeholder="0">
                      </td>
                      <td style="text-align: right;">
                        <input type="text" class="tm-num-input tm-inp-mgx-return" value="${this.escapeHtml(r.return)}" placeholder="0">
                      </td>
                      <td style="text-align: right;">
                        <span class="${deltaRes.className} tm-mgx-delta">${deltaRes.text}</span>
                      </td>
                      <td style="text-align: right;">
                        <span class="${compRes.className} tm-mgx-compensation">${compRes.text}</span>
                      </td>
                    </tr>
                  `;
                }).join('')}
              </tbody>
            </table>
          </div>
        </div>

        <!-- БЛОК 2: Интервалы доставки -->
        <div class="tm-section-box" style="padding: 14px; gap: 12px;">
          <div class="tm-section-header">
            <div class="tm-section-title-wrap">
              <span class="tm-section-title">Интервалы доставки</span>
              <span class="tm-section-badge">${intervalsSource.filter(x => x.enabled !== false).length} из ${intervalsSource.length} вкл</span>
            </div>
          </div>

          <div class="tm-table-frame">
            <table class="tm-table">
              <thead>
                <tr style="height: 28px;">
                  <th style="width: 38px;">Вкл</th>
                  <th>Слот доставки</th>
                  <th>Прием заказов</th>
                  <th style="text-align: right;">Внутренняя цена, ₽</th>
                  <th style="text-align: right;">Цена покупателя, ₽</th>
                  <th style="width: 95px; text-align: right;">ДЕЛЬТА</th>
                  <th style="width: 110px; text-align: right;">КОМПЕНСАЦИЯ</th>
                </tr>
              </thead>
              <tbody id="tm-intervals-tbody">
                ${intervalsSource.map((inv, idx) => {
                  const invDelta = this.calculateDelta(inv.priceAdjustment, inv.internalPriceAdjustment);
                  const invComp = this.calculateCompensation(inv.priceAdjustment, inv.internalPriceAdjustment);

                  const isChecked = inv.enabled !== false;
                  return `
                    <tr data-idx="${idx}" class="${isChecked ? '' : 'tm-row-inactive'}" style="${isChecked ? '' : 'opacity: 0.55;'}">
                      <td style="width: 38px;">
                        <label style="cursor: pointer; display: flex; align-items: center;">
                          <input type="checkbox" class="tm-micro-chk tm-chk-interval" ${isChecked ? 'checked' : ''} style="width: 14px; height: 14px;">
                        </label>
                      </td>
                      <td style="font-weight: 500; color: #f1f5f9; font-family: 'Geist', sans-serif;">
                        ${inv.startTime || '—'} – ${inv.endTime || '—'}
                      </td>
                      <td style="color: #94a3b8; font-family: 'Geist', sans-serif;">
                        ${inv.orderBefore || '—'}
                      </td>
                      <td style="text-align: right;">
                        <input type="text" class="tm-num-input tm-inp-inv-int" style="width: 100px; height: 28px;" value="${this.escapeHtml(inv.internalPriceAdjustment || '0')}">
                      </td>
                      <td style="text-align: right;">
                        <input type="text" class="tm-num-input highlight-focus tm-inp-inv-cust" style="width: 100px; height: 28px;" value="${this.escapeHtml(inv.priceAdjustment || '0')}">
                      </td>
                      <td style="text-align: right;">
                        <span class="${invDelta.className} tm-inv-delta">${invDelta.text}</span>
                      </td>
                      <td style="text-align: right;">
                        <span class="${invComp.className} tm-inv-compensation">${invComp.text}</span>
                      </td>
                    </tr>
                  `;
                }).join('')}
              </tbody>
            </table>
          </div>
        </div>

        <!-- БЛОК 3: Подъем на этаж -->
        <div class="tm-section-box">
          <div class="tm-section-header" style="border-bottom: 1px solid rgba(255, 255, 255, 0.06); padding-bottom: 12px;">
            <div class="tm-section-title-wrap">
              <h3 class="tm-section-title">Подъем на этаж</h3>
              <span class="tm-section-badge">${floorSource.length} градаций МГХ</span>
            </div>
            <span class="tm-section-subtext">Лифт и ручной подъем</span>
          </div>

          <!-- Лифт -->
          <div style="display: flex; flex-direction: column; gap: 8px;">
            <div style="display: flex; flex-direction: column; gap: 2px;">
              <h4 style="font-size: 12px; font-weight: 500; color: #cbd5e1; margin: 0;">Стоимость подъема на лифте, руб</h4>
              <p style="font-size: 11px; color: #64748b; margin: 0;">Для категорий МГХ с бесплатным подъемом по лестнице, подъем на лифте тоже будет бесплатным</p>
            </div>

            ${(() => {
              const liftDelta = this.calculateDelta(activeTariff.elevatorPrice?.customer, activeTariff.elevatorPrice?.internal);
              const liftComp = this.calculateCompensation(activeTariff.elevatorPrice?.customer, activeTariff.elevatorPrice?.internal);
              return `
                <div style="display: flex; align-items: center; gap: 14px; padding-top: 4px;">
                  <div class="tm-floating-field">
                    <label class="tm-floating-label">Внутренняя</label>
                    <input type="text" id="tm-lift-internal" class="tm-floating-input" value="${this.escapeHtml(activeTariff.elevatorPrice?.internal || '0')}">
                  </div>

                  <div class="tm-floating-field">
                    <label class="tm-floating-label">Для клиента</label>
                    <input type="text" id="tm-lift-customer" class="tm-floating-input highlight-focus" value="${this.escapeHtml(activeTariff.elevatorPrice?.customer || '0')}">
                  </div>

                  <div class="tm-floating-field" style="width: 130px;">
                    <label class="tm-floating-label">Дельта</label>
                    <div class="tm-floating-input tm-floating-display">
                      <span id="tm-lift-delta" class="${liftDelta.className}">${liftDelta.text}</span>
                    </div>
                  </div>

                  <div class="tm-floating-field" style="width: 140px;">
                    <label class="tm-floating-label">Компенсация</label>
                    <div class="tm-floating-input tm-floating-display">
                      <span id="tm-lift-compensation" class="${liftComp.className}">${liftComp.text}</span>
                    </div>
                  </div>
                </div>
              `;
            })()}
          </div>

          <!-- Лестница -->
          <div style="display: flex; flex-direction: column; gap: 8px; padding-top: 8px;">
            <div style="display: flex; flex-direction: column; gap: 2px;">
              <h4 style="font-size: 12px; font-weight: 500; color: #cbd5e1; margin: 0;">Стоимость подъема по лестнице</h4>
              <p style="font-size: 11px; color: #64748b; margin: 0;">Оставьте поля пустыми, если подъем будет бесплатным</p>
            </div>

            <div class="tm-table-frame">
              <div style="overflow-x: auto;">
                <table class="tm-table">
                  <thead>
                    <tr style="height: 30px;">
                      <th>МАКС. ВЕС, КГ</th>
                      <th>МАКС. ОБЪЕМ, М³</th>
                      <th style="text-align: right;">ВНУТР. ЗА ЭТАЖ, ₽</th>
                      <th style="text-align: center;">С ЭТАЖА (ВНУТР.)</th>
                      <th style="text-align: right;">КЛИЕНТУ ЗА ЭТАЖ, ₽</th>
                      <th style="text-align: center;">С ЭТАЖА (КЛИЕНТ)</th>
                      <th style="width: 95px; text-align: right;">ДЕЛЬТА</th>
                      <th style="width: 110px; text-align: right;">КОМПЕНСАЦИЯ</th>
                    </tr>
                  </thead>
                  <tbody id="tm-floor-tbody">
                    ${floorSource.map((fl, idx) => {
                      const floorDelta = this.calculateDelta(fl.customerPrice, fl.internalPrice);
                      const floorComp = this.calculateCompensation(fl.customerPrice, fl.internalPrice);

                      return `
                        <tr data-idx="${idx}">
                          <td style="font-weight: 500; color: #f1f5f9; font-family: 'Geist', sans-serif;">
                            ${fl.weight || '—'}
                          </td>
                          <td style="color: #94a3b8;">
                            ${fl.volume || (idx === 0 ? '0.2' : idx === 1 ? '0.8' : idx === 2 ? '1.5' : idx === 3 ? '3.0' : '5.0')}
                          </td>
                          <td style="text-align: right;">
                            <input type="text" class="tm-stairs-input tm-stairs-int" placeholder="-" value="${this.escapeHtml(fl.internalPrice || '')}">
                          </td>
                          <td style="text-align: center;">
                            <input type="text" class="tm-stairs-input tm-stairs-input-short tm-stairs-int-th" placeholder="-" value="${this.escapeHtml(fl.internalThreshold || '')}">
                          </td>
                          <td style="text-align: right;">
                            <input type="text" class="tm-stairs-input highlight-focus tm-stairs-cust" placeholder="-" value="${this.escapeHtml(fl.customerPrice || '')}">
                          </td>
                          <td style="text-align: center;">
                            <input type="text" class="tm-stairs-input tm-stairs-input-short tm-stairs-cust-th" placeholder="-" value="${this.escapeHtml(fl.customerThreshold || '')}">
                          </td>
                          <td style="text-align: right;">
                            <span class="${floorDelta.className} tm-floor-delta">${floorDelta.text}</span>
                          </td>
                          <td style="text-align: right;">
                            <span class="${floorComp.className} tm-floor-compensation">${floorComp.text}</span>
                          </td>
                        </tr>
                      `;
                    }).join('')}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>

        <!-- БЛОК 4: Дата и время вступления в силу -->
        <div class="tm-section-box" style="padding: 14px; gap: 10px;">
          <div class="tm-section-header">
            <span class="tm-section-title">Дата и время вступления в силу</span>
            <span class="tm-section-subtext" style="font-family: 'JetBrains Mono', monospace;">Необязательно (сразу после сохранения)</span>
          </div>

          <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px;">
            <div style="position: relative; display: flex; align-items: center;">
              <input type="date" id="tm-validity-date" class="tm-floating-input" style="width: 100%; padding-right: 30px;" value="${activeTariff.startDate || this.startDate || this.defaultDate}">
            </div>
            <div style="position: relative; display: flex; align-items: center;">
              <input type="time" id="tm-validity-time" class="tm-floating-input" style="width: 100%; padding-right: 30px;" value="${activeTariff.startTime || this.startTime || '00:00'}">
            </div>
          </div>
        </div>
      `;

      // Привязываем реактивные обработчики
      this.bindAllSectionsEvents(container, activeTariff);
    }

    pluralTariffs(n) {
      if (n % 10 === 1 && n % 100 !== 11) return 'тариф';
      if ([2, 3, 4].includes(n % 10) && ![12, 13, 14].includes(n % 100)) return 'тарифа';
      return 'тарифов';
    }

    bindAllSectionsEvents(container, activeTariff) {
      const getTargets = () => {
        return [activeTariff];
      };

      // 1. Блок МГХ сетки
      container.querySelectorAll('#tm-mgx-tbody tr').forEach((tr) => {
        const weight = tr.getAttribute('data-weight');
        const inpInternal = tr.querySelector('.tm-inp-mgx-internal');
        const inpCustomer = tr.querySelector('.tm-inp-mgx-customer');
        const inpReturn = tr.querySelector('.tm-inp-mgx-return');
        const deltaEl = tr.querySelector('.tm-mgx-delta');
        const compEl = tr.querySelector('.tm-mgx-compensation');

        const updateMgxRowStats = () => {
          const deltaRes = this.calculateDelta(inpCustomer?.value, inpInternal?.value);
          const compRes = this.calculateCompensation(inpCustomer?.value, inpInternal?.value);
          if (deltaEl) {
            deltaEl.textContent = deltaRes.text;
            deltaEl.className = `${deltaRes.className} tm-mgx-delta`;
          }
          if (compEl) {
            compEl.textContent = compRes.text;
            compEl.className = `${compRes.className} tm-mgx-compensation`;
          }
        };

        const handlePriceInput = (fieldKey, inpEl) => {
          if (!inpEl) return;
          inpEl.addEventListener('input', (e) => {
            const val = e.target.value.trim();
            getTargets().forEach((t) => {
              const row = t.mgxRows.find((r) => r.weight === weight);
              if (row) row[fieldKey] = val;
              this.checkTariffModified(t);
            });
            updateMgxRowStats();
            this.updateFooterStats();
            this.updateActiveCardBadges();
          });
        };

        handlePriceInput('internal', inpInternal);
        handlePriceInput('customer', inpCustomer);
        handlePriceInput('return', inpReturn);
      });

      // 2. Блок Интервалов
      container.querySelectorAll('#tm-intervals-tbody tr').forEach((tr) => {
        const idx = parseInt(tr.getAttribute('data-idx'), 10);
        const chk = tr.querySelector('.tm-chk-interval');
        const inpInt = tr.querySelector('.tm-inp-inv-int');
        const inpCust = tr.querySelector('.tm-inp-inv-cust');
        const deltaEl = tr.querySelector('.tm-inv-delta');
        const compEl = tr.querySelector('.tm-inv-compensation');

        const updateInvRowStats = () => {
          const deltaRes = this.calculateDelta(inpCust?.value, inpInt?.value);
          const compRes = this.calculateCompensation(inpCust?.value, inpInt?.value);
          if (deltaEl) {
            deltaEl.textContent = deltaRes.text;
            deltaEl.className = `${deltaRes.className} tm-inv-delta`;
          }
          if (compEl) {
            compEl.textContent = compRes.text;
            compEl.className = `${compRes.className} tm-inv-compensation`;
          }
        };

        chk?.addEventListener('change', (e) => {
          const isEnabled = e.target.checked;
          tr.style.opacity = isEnabled ? '1' : '0.55';
          if (isEnabled) tr.classList.remove('tm-row-inactive');
          else tr.classList.add('tm-row-inactive');

          getTargets().forEach((t) => {
            if (t.intervals && t.intervals[idx]) {
              t.intervals[idx].enabled = isEnabled;
              this.checkTariffModified(t);
            }
          });
          this.updateFooterStats();
          this.updateActiveCardBadges();
        });

        inpInt?.addEventListener('input', (e) => {
          const val = e.target.value.trim();
          getTargets().forEach((t) => {
            if (t.intervals && t.intervals[idx]) {
              t.intervals[idx].internalPriceAdjustment = val;
              this.checkTariffModified(t);
            }
          });
          updateInvRowStats();
          this.updateFooterStats();
          this.updateActiveCardBadges();
        });

        inpCust?.addEventListener('input', (e) => {
          const val = e.target.value.trim();
          getTargets().forEach((t) => {
            if (t.intervals && t.intervals[idx]) {
              t.intervals[idx].priceAdjustment = val;
              this.checkTariffModified(t);
            }
          });
          updateInvRowStats();
          this.updateFooterStats();
          this.updateActiveCardBadges();
        });
      });

      // 3. Блок Подъема: Лифт
      const updateLiftStats = () => {
        const valInt = container.querySelector('#tm-lift-internal')?.value;
        const valCust = container.querySelector('#tm-lift-customer')?.value;
        const deltaRes = this.calculateDelta(valCust, valInt);
        const compRes = this.calculateCompensation(valCust, valInt);
        const deltaEl = container.querySelector('#tm-lift-delta');
        const compEl = container.querySelector('#tm-lift-compensation');
        if (deltaEl) {
          deltaEl.textContent = deltaRes.text;
          deltaEl.className = deltaRes.className;
        }
        if (compEl) {
          compEl.textContent = compRes.text;
          compEl.className = compRes.className;
        }
      };

      container.querySelector('#tm-lift-internal')?.addEventListener('input', (e) => {
        const val = e.target.value.trim();
        getTargets().forEach((t) => {
          t.elevatorPrice.internal = val;
          this.checkTariffModified(t);
        });
        updateLiftStats();
        this.updateFooterStats();
        this.updateActiveCardBadges();
      });

      container.querySelector('#tm-lift-customer')?.addEventListener('input', (e) => {
        const val = e.target.value.trim();
        getTargets().forEach((t) => {
          t.elevatorPrice.customer = val;
          this.checkTariffModified(t);
        });
        updateLiftStats();
        this.updateFooterStats();
        this.updateActiveCardBadges();
      });

      // 3. Блок Подъема: Лестница
      container.querySelectorAll('#tm-floor-tbody tr').forEach((tr) => {
        const idx = parseInt(tr.getAttribute('data-idx'), 10);
        const deltaEl = tr.querySelector('.tm-floor-delta');
        const compEl = tr.querySelector('.tm-floor-compensation');

        const updateFloorRowStats = () => {
          const valInt = tr.querySelector('.tm-stairs-int')?.value;
          const valCust = tr.querySelector('.tm-stairs-cust')?.value;
          const deltaRes = this.calculateDelta(valCust, valInt);
          const compRes = this.calculateCompensation(valCust, valInt);
          if (deltaEl) {
            deltaEl.textContent = deltaRes.text;
            deltaEl.className = `${deltaRes.className} tm-floor-delta`;
          }
          if (compEl) {
            compEl.textContent = compRes.text;
            compEl.className = `${compRes.className} tm-floor-compensation`;
          }
        };

        const bindStairsInput = (selector, fieldKey, isPriceField = false) => {
          tr.querySelector(selector)?.addEventListener('input', (e) => {
            const val = e.target.value.trim();
            getTargets().forEach((t) => {
              if (t.floorRows && t.floorRows[idx]) {
                t.floorRows[idx][fieldKey] = val;
                this.checkTariffModified(t);
              }
            });
            if (isPriceField) updateFloorRowStats();
            this.updateFooterStats();
            this.updateActiveCardBadges();
          });
        };

        bindStairsInput('.tm-stairs-int', 'internalPrice', true);
        bindStairsInput('.tm-stairs-int-th', 'internalThreshold', false);
        bindStairsInput('.tm-stairs-cust', 'customerPrice', true);
        bindStairsInput('.tm-stairs-cust-th', 'customerThreshold', false);
      });

      // 4. Блок Даты и Времени
      container.querySelector('#tm-validity-date')?.addEventListener('change', (e) => {
        this.startDate = e.target.value;
        getTargets().forEach((t) => {
          t.startDate = this.startDate;
          this.checkTariffModified(t);
        });
        this.updateFooterStats();
        this.updateActiveCardBadges();
      });

      container.querySelector('#tm-validity-time')?.addEventListener('change', (e) => {
        this.startTime = e.target.value;
        getTargets().forEach((t) => {
          t.startTime = this.startTime;
          this.checkTariffModified(t);
        });
        this.updateFooterStats();
        this.updateActiveCardBadges();
      });
    }

    updateActiveCardBadges() {
      const cardList = this.modalEl?.querySelector('#tm-card-list');
      if (!cardList) return;
      this.tariffs.forEach((t) => {
        const card = cardList.querySelector(`.tm-tariff-card[data-uuid="${t.uuid}"]`);
        if (card) this.updateCardBadge(card, t);
      });
    }

    // ==================== СЛУЖЕБНЫЕ ДЕЙСТВИЯ (SYNC / RESET) ====================

    syncInternalToCustomer() {
      const targets = this.selectedTariffs.size > 0
        ? this.tariffs.filter(t => this.selectedTariffs.has(t.uuid))
        : this.tariffs;

      let count = 0;
      targets.forEach(t => {
        t.mgxRows.forEach(r => {
          if (r.internal !== '') r.customer = r.internal;
        });
        if (t.elevatorPrice?.internal) t.elevatorPrice.customer = t.elevatorPrice.internal;
        if (t.floorPrice?.internalPrice) {
          t.floorPrice.customerPrice = t.floorPrice.internalPrice;
          t.floorPrice.customerThreshold = t.floorPrice.internalThreshold;
        }
        this.checkTariffModified(t);
        count++;
      });

      this.renderSplitView();
    }

    resetSelectedTariffs() {
      const targets = this.selectedTariffs.size > 0
        ? this.tariffs.filter(t => this.selectedTariffs.has(t.uuid))
        : this.tariffs;

      targets.forEach(t => {
        if (t._original) {
          Object.assign(t, JSON.parse(JSON.stringify(t._original)));
          t._modified = false;
        }
      });

      this.renderSplitView();
    }

    areMgxRowsEqual(a = [], b = []) {
      if (!Array.isArray(a)) a = [];
      if (!Array.isArray(b)) b = [];
      if (a.length !== b.length) return false;
      for (let i = 0; i < a.length; i++) {
        const rowA = a[i] || {};
        const rowB = b[i] || {};
        if (String(rowA.weight || '').trim() !== String(rowB.weight || '').trim()) return false;
        if (String(rowA.internal || '').trim() !== String(rowB.internal || '').trim()) return false;
        if (String(rowA.customer || '').trim() !== String(rowB.customer || '').trim()) return false;
        if (String(rowA.return || '').trim() !== String(rowB.return || '').trim()) return false;
      }
      return true;
    }

    areIntervalsEqual(a = [], b = []) {
      if (!Array.isArray(a)) a = [];
      if (!Array.isArray(b)) b = [];
      if (a.length !== b.length) return false;
      for (let i = 0; i < a.length; i++) {
        const invA = a[i] || {};
        const invB = b[i] || {};
        const enA = invA.enabled !== false;
        const enB = invB.enabled !== false;
        if (enA !== enB) return false;
        if (String(invA.startTime || '').trim() !== String(invB.startTime || '').trim()) return false;
        if (String(invA.endTime || '').trim() !== String(invB.endTime || '').trim()) return false;
        if (String(invA.orderBefore || '').trim() !== String(invB.orderBefore || '').trim()) return false;
        const intA = String(invA.internalPriceAdjustment !== undefined && invA.internalPriceAdjustment !== null ? invA.internalPriceAdjustment : '0').trim();
        const intB = String(invB.internalPriceAdjustment !== undefined && invB.internalPriceAdjustment !== null ? invB.internalPriceAdjustment : '0').trim();
        if (intA !== intB) return false;
        const custA = String(invA.priceAdjustment !== undefined && invA.priceAdjustment !== null ? invA.priceAdjustment : '0').trim();
        const custB = String(invB.priceAdjustment !== undefined && invB.priceAdjustment !== null ? invB.priceAdjustment : '0').trim();
        if (custA !== custB) return false;
      }
      return true;
    }

    areFloorEqual(curr, orig) {
      if (!curr) curr = {};
      if (!orig) orig = {};
      const currElevInt = String(curr.elevatorPrice?.internalPrice ?? curr.elevatorPrice?.internal ?? '').trim();
      const origElevInt = String(orig.elevatorPrice?.internalPrice ?? orig.elevatorPrice?.internal ?? '').trim();
      const currElevCust = String(curr.elevatorPrice?.customerPrice ?? curr.elevatorPrice?.customer ?? '').trim();
      const origElevCust = String(orig.elevatorPrice?.customerPrice ?? orig.elevatorPrice?.customer ?? '').trim();

      if (currElevInt !== origElevInt || currElevCust !== origElevCust) return false;

      const a = Array.isArray(curr.floorRows) ? curr.floorRows : [];
      const b = Array.isArray(orig.floorRows) ? orig.floorRows : [];
      if (a.length !== b.length) return false;
      for (let i = 0; i < a.length; i++) {
        const rowA = a[i] || {};
        const rowB = b[i] || {};
        if (String(rowA.weight || '').trim() !== String(rowB.weight || '').trim()) return false;
        if (String(rowA.internalPrice || '').trim() !== String(rowB.internalPrice || '').trim()) return false;
        if (String(rowA.internalThreshold || '').trim() !== String(rowB.internalThreshold || '').trim()) return false;
        if (String(rowA.customerPrice || '').trim() !== String(rowB.customerPrice || '').trim()) return false;
        if (String(rowA.customerThreshold || '').trim() !== String(rowB.customerThreshold || '').trim()) return false;
      }
      return true;
    }

    checkTariffModified(t) {
      const orig = t._original || {};

      const hasMgxChange = !this.areMgxRowsEqual(t.mgxRows, orig.mgxRows);
      const hasFloorChange = !this.areFloorEqual(t, orig);
      const hasIntervalsChange = !this.areIntervalsEqual(t.intervals, orig.intervals);
      const hasPaymentChange = (
        !!t.payment?.card !== !!orig.payment?.card ||
        !!t.payment?.cash !== !!orig.payment?.cash
      );
      const hasAcceptanceChange = (
        !!t.acceptance?.sameDay !== !!orig.acceptance?.sameDay ||
        !!t.acceptance?.nextDay !== !!orig.acceptance?.nextDay
      );
      const hasSaleTypesChange = (
        !!t.saleTypes?.product !== !!orig.saleTypes?.product ||
        !!t.saleTypes?.markdown !== !!orig.saleTypes?.markdown ||
        !!t.saleTypes?.legal !== !!orig.saleTypes?.legal ||
        !!t.saleTypes?.service !== !!orig.saleTypes?.service
      );
      const hasValidityChange = (
        (t.startDate && t.startDate !== orig.startDate) ||
        (t.startTime && t.startTime !== orig.startTime) ||
        (t.endDate && t.endDate !== orig.endDate)
      );
      const hasNameChange = !!(t.name && orig.name && t.name !== orig.name);

      const isDiff = hasMgxChange || hasFloorChange || hasIntervalsChange ||
                     hasPaymentChange || hasAcceptanceChange || hasSaleTypesChange ||
                     hasValidityChange || hasNameChange;

      t._modified = isDiff;
    }

    hasUnsavedChanges() {
      return this.tariffs.some((t) => t._modified);
    }

    updateFooterStats() {
      const statsEl = this.modalEl?.querySelector('#tm-footer-stats');
      const saveBtn = this.modalEl?.querySelector('#tm-btn-save');

      const total = this.tariffs.length;
      const modified = this.tariffs.filter((t) => t._modified).length;

      if (statsEl) {
        statsEl.innerHTML = `
          <span>Всего тарифов: ${total}</span>
          <span class="tm-dot-sep">•</span>
          <span class="${modified > 0 ? 'tm-modified-text' : ''}">${modified} ${this.pluralTariffs(modified)} изменено</span>
        `;
      }

      if (saveBtn) {
        saveBtn.disabled = modified === 0;
        saveBtn.textContent = modified > 0 ? `Сохранить изменения (${modified})` : 'Сохранить изменения';
      }
    }

    confirmAndWriteChanges() {
      const modified = this.tariffs.filter((t) => t._modified);
      if (modified.length === 0) return;

      const diffSummary = modified.map((t, idx) => `${idx + 1}. ${t.name}`).slice(0, 10).join('\n');
      const extra = modified.length > 10 ? `\n...и еще ${modified.length - 10} тарифов` : '';
      const msg = `Будет обновлено тарифов на сайте: ${modified.length}\n\n${diffSummary}${extra}\n\nНачать сохранение?`;

      if (!confirm(msg)) return;

      this.executeWriteChanges(modified);
    }

    async executeWriteChanges(modifiedTariffs) {
      this.isWriting = true;
      this.shouldStop = false;

      this.renderWriteView(modifiedTariffs.length);
      this.updateWriteProgress(0, modifiedTariffs.length, `Подготовка к сохранению (${modifiedTariffs.length} тарифов)...`);
      this.logWrite(`🚀 Запуск сохранения изменений: ${modifiedTariffs.length} тарифов.`);

      let successCount = 0;
      let failCount = 0;
      const successfullySavedTariffs = [];

      for (let i = 0; i < modifiedTariffs.length; i++) {
        if (this.shouldStop) {
          this.logWrite(`⏹ Запись остановлена пользователем.`);
          break;
        }

        const t = modifiedTariffs[i];
        const orig = t._original || {};

        const hasMgxChange = !this.areMgxRowsEqual(t.mgxRows, orig.mgxRows);
        const hasFloorChange = !this.areFloorEqual(t, orig);
        const hasIntervalsChange = !this.areIntervalsEqual(t.intervals, orig.intervals);
        const hasPaymentChange = (
          !!t.payment?.card !== !!orig.payment?.card ||
          !!t.payment?.cash !== !!orig.payment?.cash
        );
        const hasAcceptanceChange = (
          !!t.acceptance?.sameDay !== !!orig.acceptance?.sameDay ||
          !!t.acceptance?.nextDay !== !!orig.acceptance?.nextDay
        );
        const hasSaleTypesChange = (
          !!t.saleTypes?.product !== !!orig.saleTypes?.product ||
          !!t.saleTypes?.markdown !== !!orig.saleTypes?.markdown ||
          !!t.saleTypes?.legal !== !!orig.saleTypes?.legal ||
          !!t.saleTypes?.service !== !!orig.saleTypes?.service
        );
        const hasValidityChange = (
          (t.startDate && t.startDate !== orig.startDate) ||
          (t.startTime && t.startTime !== orig.startTime) ||
          (t.endDate && t.endDate !== orig.endDate)
        );
        const hasNameChange = !!(t.name && orig.name && t.name !== orig.name);

        const importBlocks = {
          zones: false,
          branches: false,
          mgx: hasMgxChange,
          intervals: hasIntervalsChange,
          floor: hasFloorChange,
          payment: hasPaymentChange,
          acceptance: hasAcceptanceChange,
          saleTypes: hasSaleTypesChange,
          validityDates: hasValidityChange,
          deliveryParams: false,
          costLimit: false
        };

        const changedLabels = [];
        if (hasMgxChange) changedLabels.push('МГХ');
        if (hasFloorChange) changedLabels.push('Подъем/Лифт');
        if (hasIntervalsChange) changedLabels.push('Интервалы');
        if (hasPaymentChange) changedLabels.push('Оплата');
        if (hasAcceptanceChange) changedLabels.push('Прием');
        if (hasSaleTypesChange) changedLabels.push('Виды продажи');
        if (hasValidityChange) changedLabels.push('Сроки');
        if (hasNameChange) changedLabels.push('Название');

        const anyBlockChange = hasMgxChange || hasFloorChange || hasIntervalsChange ||
                               hasPaymentChange || hasAcceptanceChange || hasSaleTypesChange ||
                               hasValidityChange || hasNameChange;

        if (!anyBlockChange) {
          this.logWrite(`ℹ️ Тариф "${t.name}" не имеет реальных изменений. Пропускаем.`);
          t._modified = false;
          continue;
        }

        const detailMsg = changedLabels.length > 0 ? ` (изменения: ${changedLabels.join(', ')})` : '';
        this.updateWriteProgress(i, modifiedTariffs.length, `Сохранение (${i + 1}/${modifiedTariffs.length}): ${t.name}`);
        this.logWrite(`⏳ [${i + 1}/${modifiedTariffs.length}] Обновление: ${t.name}${detailMsg}...`);

        const tariffPayload = {
          name: t.name,
          originalName: t._original?.name || t.name,
          uuid: t.uuid,
          url: t.url || `${window.location.origin}/configurator/tariffs/${this.orgId}/${t.uuid}`,
          importBlocks,
          hasNameChange,
          elevatorPrice: {
            internal: String(t.elevatorPrice?.internal || '0'),
            customer: String(t.elevatorPrice?.customer || '0'),
            internalPrice: String(t.elevatorPrice?.internal || '0'),
            customerPrice: String(t.elevatorPrice?.customer || '0')
          },
          floorRows: (t.floorRows && t.floorRows.length > 0) ? t.floorRows : [{
            weight: '15',
            internalPrice: String(t.floorPrice?.internalPrice || '0'),
            internalThreshold: String(t.floorPrice?.internalThreshold || '1'),
            customerPrice: String(t.floorPrice?.customerPrice || '0'),
            customerThreshold: String(t.floorPrice?.customerThreshold || '1')
          }],
          payment: {
            card: !!t.payment?.card,
            cash: !!t.payment?.cash
          },
          acceptance: {
            sameDay: !!t.acceptance?.sameDay,
            nextDay: !!t.acceptance?.nextDay
          },
          saleTypes: t.saleTypes || {
            product: true,
            markdown: false,
            legal: false,
            service: false
          },
          deliveryDays: String(t.deliveryDays || '0'),
          cutoffTime: String(t.cutoffTime || '00:00'),
          maxOrderCost: String(t.costLimit || ''),
          zones: t.zones || [],
          branches: t.branches || [],
          mgxRows: (t.mgxRows || []).map((r) => ({
            weight: String(r.weight || ''),
            internal: String(r.internal || ''),
            customer: String(r.customer || ''),
            return: String(r.return || '')
          })),
          startDate: t.startDate || this.startDate || '',
          startTime: t.startTime || this.startTime || '00:00',
          endDate: t.endDate || '',
          intervals: t.intervals || []
        };

        const result = await this.openAndSave(tariffPayload);

        if (result && result.success) {
          successCount++;
          t._modified = false;
          t._original = JSON.parse(JSON.stringify(t));
          successfullySavedTariffs.push(t);
          this.logWrite(`✅ Успешно сохранен: ${t.name}`);
        } else {
          failCount++;
          let reason = result?.reason || 'Неизвестная ошибка сохранения';
          if (reason === 'save_button_not_found') {
            reason = 'Кнопка «Сохранить» не найдена или заблокирована (disabled)';
          } else if (reason === 'name_input_not_found_before_blocks') {
            reason = 'Форма не готова к редактированию (поле названия не найдено)';
          } else if (reason.includes('attempts is not defined')) {
            reason = 'Внутренняя ошибка JavaScript: ' + reason;
          }
          this.logWrite(`❌ Не удалось сохранить "${t.name}": ${reason}`);
        }

        this.updateWriteProgress(i + 1, modifiedTariffs.length, `Обработано ${i + 1} из ${modifiedTariffs.length}`);
        await this.delay(500);
      }

      this.saveToCache();
      this.isWriting = false;

      const stopBtn = this.modalEl?.querySelector('#tm-btn-stop-write');
      if (stopBtn) stopBtn.style.display = 'none';
      const backBtn = this.modalEl?.querySelector('#tm-btn-back-to-tariffs');
      if (backBtn) {
        backBtn.style.display = 'inline-block';
        backBtn.onclick = () => this.renderSplitView();
      }

      if (!this.shouldStop) {
        if (successfullySavedTariffs.length > 0) {
          this.logWrite(failCount === 0
            ? `🎉 Все тарифы (${successCount}) успешно обновлены на сайте!`
            : `⚠️ Завершено сохранение: успешно ${successCount}, ошибок ${failCount}.`
          );
          this.logWrite(`🔄 Автоматическое обновление страницы и сканирование измененных тарифов (${successfullySavedTariffs.length} шт)...`);
          this.updateWriteProgress(modifiedTariffs.length, modifiedTariffs.length, `Готово! Перезагрузка страницы...`);

          const modifiedNames = successfullySavedTariffs.map(t => t.name);
          try {
            sessionStorage.setItem('tm_auto_rescan_modified', JSON.stringify(modifiedNames));
            localStorage.setItem('tm_auto_rescan_modified', JSON.stringify(modifiedNames));
          } catch (_) {}

          // Сохраняем актуализированные данные в кэш перед перезагрузкой
          this.saveToCache();

          await this.delay(1200);
          this.reloadPage();
          return;
        } else {
          this.logWrite(`❌ Ни один тариф не был обновлен (${failCount} ошибок). Перезагрузка страницы отменена.`);
          this.updateWriteProgress(modifiedTariffs.length, modifiedTariffs.length, `Ошибки при сохранении.`);
        }
      }
    }

    reloadPage() {
      console.log('[TariffManager] Выполняется перезагрузка страницы...');
      if (typeof chrome !== 'undefined' && chrome.runtime?.sendMessage) {
        try {
          chrome.runtime.sendMessage({ action: 'reload_tab' });
        } catch (_) {}
      }
      try {
        window.location.reload();
      } catch (_) {
        window.location.href = window.location.href;
      }
      setTimeout(() => {
        window.location.href = window.location.href;
      }, 500);
    }


    async openAndSave(tariff) {
      return new Promise(async (resolve) => {
        const requestId = Date.now() + '_' + Math.random().toString(36).slice(2);
        localStorage.removeItem('tariff_save_result');
        localStorage.removeItem('tariff_save_events');
        localStorage.setItem('tariff_to_save', JSON.stringify({
          tariff,
          url: tariff.url,
          requestId
        }));

        const loggedEvents = new Set();
        // Открываем вкладку активно в отдельном окне/вкладке браузера для полноценного выполнения скрипта
        const tabHandle = await this.openActiveTab(tariff.url);

        const cleanUp = () => {
          localStorage.removeItem('tariff_to_save');
          localStorage.removeItem('tariff_save_result');
          localStorage.removeItem('tariff_save_events');
          this.closeBackgroundTab(tabHandle);
        };

        const started = Date.now();
        const timeoutMs = 60000;
        const interval = setInterval(() => {
          if (this.shouldStop) {
            clearInterval(interval);
            cleanUp();
            resolve({ success: false, reason: 'Остановлено пользователем' });
            return;
          }

          // Живой вывод событий из открытой вкладки тарифа в лог
          try {
            const rawEvents = localStorage.getItem('tariff_save_events');
            if (rawEvents) {
              const events = JSON.parse(rawEvents);
              for (const evt of events) {
                const key = (evt.time || '') + '_' + (evt.message || '');
                if (!loggedEvents.has(key)) {
                  loggedEvents.add(key);
                  this.logWrite(`  ${evt.message}`);
                }
              }
            }
          } catch (_) {}

          // Проверка завершения сохранения
          const raw = localStorage.getItem('tariff_save_result');
          if (raw) {
            try {
              const parsed = JSON.parse(raw);
              if (parsed.requestId === requestId) {
                clearInterval(interval);
                cleanUp();
                resolve(parsed);
                return;
              }
            } catch (e) {
              console.warn('[TariffManager] Ошибка парсинга tariff_save_result:', e);
            }
          }

          // Если окно было закрыто (для fallback window)
          if (Date.now() - started > 3000 && tabHandle?.type === 'window' && tabHandle.win?.closed) {
            const finalCheck = localStorage.getItem('tariff_save_result');
            if (finalCheck) {
              try {
                const parsed = JSON.parse(finalCheck);
                if (parsed.requestId === requestId) {
                  clearInterval(interval);
                  cleanUp();
                  resolve(parsed);
                  return;
                }
              } catch (_) {}
            }
            clearInterval(interval);
            cleanUp();
            resolve({ success: false, reason: 'Вкладка тарифа была закрыта' });
            return;
          }

          if (Date.now() - started >= timeoutMs) {
            clearInterval(interval);
            console.warn(`[TariffManager] Таймаут сохранения тарифа ${tariff.name}`);
            cleanUp();
            resolve({ success: false, reason: 'Таймаут ожидания сохранения (60 сек)' });
          }
        }, 150);
      });
    }

    updateWriteProgress(current, total, statusText) {
      const fill = this.modalEl?.querySelector('#tm-write-fill');
      const status = this.modalEl?.querySelector('#tm-write-status');
      const percentEl = this.modalEl?.querySelector('#tm-write-percent');
      const badge = this.modalEl?.querySelector('#tm-write-badge');
      const statDone = this.modalEl?.querySelector('#tm-write-stat-done');
      const statProg = this.modalEl?.querySelector('#tm-write-stat-prog');
      const statQueue = this.modalEl?.querySelector('#tm-write-stat-queue');

      const ratio = total > 0 ? Math.min(1, current / total) : 0;
      const pct = Math.round(ratio * 100);

      if (fill) fill.style.width = `${pct}%`;
      if (status && statusText) status.textContent = statusText;
      if (percentEl) percentEl.textContent = `${pct}%`;
      if (badge) badge.textContent = `${current} / ${total} сохранено`;
      if (statDone) statDone.textContent = String(current);
      if (statProg) statProg.textContent = current < total ? '1' : '0';
      if (statQueue) statQueue.textContent = String(Math.max(0, total - current));
    }

    logWrite(msg) {
      const log = this.modalEl?.querySelector('#tm-write-log');
      if (!log) return;
      const time = new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
      const entry = document.createElement('div');
      entry.style.cssText = 'display: flex; gap: 10px; align-items: baseline;';
      
      let color = '#cbd5e1';
      if (msg.includes('❌') || msg.includes('Ошибка')) color = '#fca5a5';
      else if (msg.includes('✅') || msg.includes('Успешно')) color = '#86efac';
      else if (msg.includes('⚠️')) color = '#fde047';
      else if (msg.includes('🚀') || msg.includes('⏳')) color = '#93c5fd';

      entry.innerHTML = `
        <span style="color: #64748b; font-size: 11px; flex-shrink: 0; font-family: 'JetBrains Mono', monospace;">${time}</span>
        <span style="color: ${color};">${this.escapeHtml(msg)}</span>
      `;
      log.appendChild(entry);
      log.scrollTop = log.scrollHeight;

      const countEl = this.modalEl?.querySelector('#tm-write-log-count');
      if (countEl) countEl.textContent = `${log.children.length} записей`;
    }

    renderWriteView(totalCount) {
      const body = this.modalEl?.querySelector('#tm-modal-body');
      const footer = this.modalEl?.querySelector('#tm-modal-footer');
      if (!body) return;

      body.innerHTML = `
        <div class="tm-scan-container" style="padding: 24px 32px; display: flex; flex-direction: column; gap: 20px; height: 100%; box-sizing: border-box; font-family: 'Geist', sans-serif;">
          <!-- Шапка записи -->
          <div style="display: flex; align-items: flex-start; justify-content: space-between; border-bottom: 1px solid rgba(255, 255, 255, 0.07); padding-bottom: 16px;">
            <div>
              <div style="display: flex; align-items: center; gap: 10px;">
                <span style="font-size: 18px; color: #10b981;">⚡</span>
                <h2 style="font-size: 16px; font-weight: 600; color: #f1f5f9; margin: 0; letter-spacing: -0.01em;">Применение изменений на сайте</h2>
              </div>
              <div style="font-size: 13px; color: #94a3b8; margin-top: 4px;">Обновление тарифов доставки на сайте</div>
            </div>
            <div style="display: flex; align-items: center; gap: 12px;">
              <span id="tm-write-badge" class="tm-badge-pill tm-badge-blue" style="font-size: 12px; padding: 4px 10px;">0 / ${totalCount} сохранено</span>
              <button type="button" id="tm-btn-stop-write" class="tm-btn tm-btn-secondary" style="padding: 6px 14px; font-size: 12px; color: #f87171; border-color: rgba(248, 113, 113, 0.25); background: rgba(239, 68, 68, 0.08); cursor: pointer;">
                Остановить запись
              </button>
              <button type="button" id="tm-btn-back-to-tariffs" class="tm-btn tm-btn-primary" style="display: none; padding: 6px 16px; font-size: 12px; background: #059669; cursor: pointer;">
                ← Вернуться к тарифам
              </button>
            </div>
          </div>

          <!-- Метрики прогресса -->
          <div style="display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px;">
            <div class="tm-scan-stat-card">
              <div class="tm-scan-stat-label">Всего к записи</div>
              <div class="tm-scan-stat-val" id="tm-write-stat-total">${totalCount}</div>
            </div>
            <div class="tm-scan-stat-card">
              <div class="tm-scan-stat-label">Сохранено</div>
              <div class="tm-scan-stat-val tm-val-green" id="tm-write-stat-done">0</div>
            </div>
            <div class="tm-scan-stat-card">
              <div class="tm-scan-stat-label">В процессе</div>
              <div class="tm-scan-stat-val tm-val-blue" id="tm-write-stat-prog">1</div>
            </div>
            <div class="tm-scan-stat-card">
              <div class="tm-scan-stat-label">В очереди</div>
              <div class="tm-scan-stat-val tm-val-gray" id="tm-write-stat-queue">${totalCount}</div>
            </div>
          </div>

          <!-- Прогресс-бар -->
          <div style="display: flex; flex-direction: column; gap: 8px;">
            <div style="display: flex; justify-content: space-between; align-items: center; font-size: 12px;">
              <span id="tm-write-status" style="color: #94a3b8;">Подготовка тарифов к обновлению...</span>
              <span id="tm-write-percent" style="color: #f1f5f9; font-family: 'JetBrains Mono', monospace; font-weight: 500;">0%</span>
            </div>
            <div class="tm-scan-track">
              <div id="tm-write-fill" class="tm-scan-fill" style="width: 0%; background: linear-gradient(90deg, #10b981, #34d399);"></div>
            </div>
          </div>

          <!-- Консоль операций (Precision Dark Terminal) -->
          <div style="flex: 1; display: flex; flex-direction: column; background: #090d16; border: 1px solid rgba(255, 255, 255, 0.07); border-radius: 8px; overflow: hidden; min-height: 220px;">
            <div style="display: flex; align-items: center; justify-content: space-between; padding: 8px 14px; background: rgba(255, 255, 255, 0.02); border-bottom: 1px solid rgba(255, 255, 255, 0.05); font-size: 11px; color: #64748b; font-family: 'JetBrains Mono', monospace;">
              <div style="display: flex; align-items: center; gap: 6px;">
                <span style="display: inline-block; width: 7px; height: 7px; border-radius: 50%; background: #10b981; box-shadow: 0 0 6px rgba(16, 185, 129, 0.6);"></span>
                <span>ЖУРНАЛ ОПЕРАЦИЙ ЗАПИСИ</span>
              </div>
              <span id="tm-write-log-count" style="color: #475569;">0 записей</span>
            </div>
            <div id="tm-write-log" style="flex: 1; overflow-y: auto; padding: 12px 16px; font-family: 'JetBrains Mono', monospace; font-size: 12px; line-height: 1.6; color: #cbd5e1; display: flex; flex-direction: column; gap: 4px;">
            </div>
          </div>
        </div>
      `;

      body.querySelector('#tm-btn-stop-write')?.addEventListener('click', () => {
        this.shouldStop = true;
        localStorage.removeItem('tariff_to_save');
        this.isWriting = false;
        this.logWrite('⏹ Остановка записи пользователем...');
        const backBtn = this.modalEl?.querySelector('#tm-btn-back-to-tariffs');
        if (backBtn) backBtn.style.display = 'inline-block';
      });

      body.querySelector('#tm-btn-back-to-tariffs')?.addEventListener('click', () => {
        this.renderSplitView();
      });

      if (footer) footer.style.display = 'none';
    }

    handleWriteStateUpdate(stateStr) {
      if (!stateStr) return;
      try {
        const state = JSON.parse(stateStr);
        const fill = this.modalEl?.querySelector('#tm-write-fill');
        const status = this.modalEl?.querySelector('#tm-write-status');
        const log = this.modalEl?.querySelector('#tm-write-log');

        if (state.total && state.currentIndex !== undefined) {
          const ratio = Math.min(1, state.currentIndex / state.total);
          if (fill) fill.style.width = Math.round(ratio * 100) + '%';
          if (status) status.textContent = `Обновление тарифа ${state.currentIndex + 1} из ${state.total}`;
          if (log && state.currentName) {
            const entry = document.createElement('div');
            entry.textContent = `✅ Записан: ${state.currentName}`;
            log.appendChild(entry);
            log.scrollTop = log.scrollHeight;
          }

          if (state.currentIndex >= state.total) {
            this.isWriting = false;
            this.tariffs.forEach((t) => {
              if (t._modified) {
                t._modified = false;
                t._original = JSON.parse(JSON.stringify(t));
              }
            });
            this.saveToCache();
            alert('🎉 Все изменения успешно записаны на сайт!');
            this.renderSplitView();
          }
        }
      } catch (err) {}
    }

    escapeHtml(str) {
      return String(str || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
    }
  }

  window.tariffManager = new TariffManager();
  console.log('[TariffManager] Модуль интерактивного управления тарифами готов к работе (Precision Dark)');
})();
