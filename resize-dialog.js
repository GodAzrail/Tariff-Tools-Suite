(function() {
    'use strict';
    console.log('📏 resize-dialog.js loaded (del-orgs scroll fix)');

    const PAGE_OK = window.location.pathname.includes('/configurator/del-orgs');
    const DIALOG_ID = 'select-volume-weight-dlg';
    const TITLE_MATCHES = ['создание набора мгх сетки', 'мгх', 'сетки'];

    const SET_BLOCK_SELECTORS = [
        '.css-3w0yoi.e1avfrlx1',
        '.css-1wum4u4.e1avfrlx4'
    ];

    const MANAGED_ATTR = 'data-mgh-scroll-managed';
    const RESIZED_ATTR = 'data-auto-resized';
    const SIGNATURE_ATTR = 'data-layout-signature';

    let processTimer = null;
    let resizeObserver = null;
    let dialogMutationObserver = null;
    let activeDialog = null;

    function getResponsiveHeight() {
        const screenHeight = window.innerHeight || 900;
        let h = Math.round(screenHeight * 0.8);
        h = Math.max(400, Math.min(h, 900));
        return h;
    }

    function isVisible(el) {
        if (!el) return false;
        const style = window.getComputedStyle(el);
        return style.display !== 'none'
            && style.visibility !== 'hidden'
            && (el.offsetParent !== null || style.position === 'fixed' || el.open === true);
    }

    function textOf(el) {
        return (el?.innerText || el?.textContent || '').toLowerCase();
    }

    function hasMatchingTitle(dialog) {
        const text = textOf(dialog).slice(0, 1500);
        return TITLE_MATCHES.some(t => text.includes(t));
    }

    function findDialog() {
        const byId = document.getElementById(DIALOG_ID);
        if (isVisible(byId)) return byId;

        const candidates = Array.from(document.querySelectorAll(
            'dialog[open], dialog, [role="dialog"], [aria-modal="true"], [class*="modal"], [class*="dialog"]'
        )).filter(isVisible);

        return candidates.find(hasMatchingTitle) || null;
    }

    function findMainContainer(dialog) {
        return dialog.querySelector('._body_1ghey_73 > div')
            || dialog.querySelector('._body_1ghey_73')
            || dialog.querySelector('[class*="body"] > div')
            || dialog.querySelector('[class*="body"]')
            || dialog;
    }

    function getSetBlocks(dialog) {
        const selectors = SET_BLOCK_SELECTORS.join(', ');
        const blocks = Array.from(dialog.querySelectorAll(selectors)).filter(isVisible);

        if (blocks.length) return blocks;

        const fallbackBlocks = Array.from(dialog.querySelectorAll('div')).filter(el => {
            if (!isVisible(el)) return false;
            const txt = textOf(el);
            return el.querySelector('input') && (
                txt.includes('мгх')
                || txt.includes('вес')
                || txt.includes('объем')
                || txt.includes('длина')
                || txt.includes('ширина')
                || txt.includes('высота')
            );
        });

        return fallbackBlocks;
    }

    function getRowCount(dialog) {
        return dialog.querySelectorAll('tr').length
            || dialog.querySelectorAll('input').length
            || 0;
    }

    function getLayoutSignature(dialog) {
        const setBlocks = getSetBlocks(dialog).length;
        const rows = dialog.querySelectorAll('tr').length;
        const inputs = dialog.querySelectorAll('input').length;
        const tables = dialog.querySelectorAll('table').length;
        return [setBlocks, rows, inputs, tables].join('|');
    }

    function getAncestors(el, stopAt) {
        const arr = [];
        let cur = el;
        while (cur && cur !== stopAt && cur !== document.body) {
            arr.push(cur);
            cur = cur.parentElement;
        }
        if (stopAt) arr.push(stopAt);
        return arr;
    }

    function getCommonAncestor(elements, boundary) {
        if (!elements || !elements.length) return null;
        if (elements.length === 1) return elements[0].parentElement || boundary || elements[0];

        const firstPath = getAncestors(elements[0], boundary);
        for (const candidate of firstPath) {
            const ok = elements.every(el => candidate === el || candidate.contains(el));
            if (ok) return candidate;
        }
        return boundary || null;
    }

    function findUnifiedScrollContainer(dialog, mainContainer) {
        const setBlocks = getSetBlocks(dialog);

        if (setBlocks.length >= 2) {
            const common = getCommonAncestor(setBlocks, mainContainer);
            if (common && common !== dialog) return common;
        }

        if (setBlocks.length === 1) {
            const block = setBlocks[0];
            const parent = block.parentElement;
            if (parent && parent !== dialog) return parent;
            return block;
        }

        const tables = Array.from(dialog.querySelectorAll('table')).filter(isVisible);
        if (tables.length >= 2) {
            const common = getCommonAncestor(tables, mainContainer);
            if (common && common !== dialog) return common;
        }

        if (tables.length === 1) {
            return tables[0].closest('div') || mainContainer;
        }

        return mainContainer || dialog;
    }

    function clearManagedStyles(dialog) {
        const managed = dialog.querySelectorAll('[' + MANAGED_ATTR + '="1"]');
        managed.forEach(el => {
            el.style.removeProperty('overflow');
            el.style.removeProperty('overflow-y');
            el.style.removeProperty('overflow-x');
            el.style.removeProperty('max-height');
            el.style.removeProperty('height');
            el.style.removeProperty('min-height');
            el.style.removeProperty('overscroll-behavior');
            el.style.removeProperty('box-sizing');
            el.style.removeProperty('min-width');
            el.style.removeProperty('flex');
            el.removeAttribute(MANAGED_ATTR);
        });
    }

    function canKeepHorizontalScroll(el) {
        if (!el || el.tagName === 'TEXTAREA') return false;
        if (el.querySelector('table')) return true;

        const style = window.getComputedStyle(el);
        const overflowX = style.overflowX;
        if (overflowX === 'scroll') return true;

        return el.scrollWidth > el.clientWidth + 2;
    }

    function normalizeNestedVerticalScroll(scrollRoot) {
        const descendants = Array.from(scrollRoot.querySelectorAll('*'));

        descendants.forEach(el => {
            if (el === scrollRoot) return;
            if (!(el instanceof HTMLElement)) return;

            const tag = el.tagName.toLowerCase();
            if (tag === 'textarea' || tag === 'select' || tag === 'option') return;

            const style = window.getComputedStyle(el);
            const hasVerticalScroll =
                style.overflowY === 'auto'
                || style.overflowY === 'scroll'
                || (el.scrollHeight > el.clientHeight + 4 && el.clientHeight > 0);

            if (!hasVerticalScroll) return;

            el.setAttribute(MANAGED_ATTR, '1');
            el.style.overflowY = 'visible';

            if (!canKeepHorizontalScroll(el)) {
                el.style.overflowX = 'visible';
            }

            if (style.maxHeight !== 'none') {
                el.style.maxHeight = 'none';
            }

            const inlineHeight = el.style.height;
            if (inlineHeight) {
                el.style.height = 'auto';
            }

            const inlineMinHeight = el.style.minHeight;
            if (inlineMinHeight) {
                el.style.minHeight = '0';
            }
        });
    }

    function applyResize(dialog) {
        if (!PAGE_OK) return false;
        if (!dialog || !isVisible(dialog)) return false;

        clearManagedStyles(dialog);

        const mainContainer = findMainContainer(dialog);
        const scrollContainer = findUnifiedScrollContainer(dialog, mainContainer);
        const responsiveHeight = getResponsiveHeight();

        const computedDialogStyle = window.getComputedStyle(dialog);
        const currentWidth =
            dialog.style.width
            || dialog.style.minWidth
            || computedDialogStyle.width
            || '1056px';

        dialog.style.height = responsiveHeight + 'px';
        dialog.style.minHeight = responsiveHeight + 'px';
        dialog.style.maxHeight = responsiveHeight + 'px';
        dialog.style.width = currentWidth;
        dialog.style.minWidth = currentWidth;
        dialog.style.maxWidth = currentWidth;
        dialog.style.setProperty('overflow', 'hidden', 'important');
        dialog.setAttribute(MANAGED_ATTR, '1');

        if (dialog.tagName.toLowerCase() !== 'dialog') {
            dialog.style.top = Math.max(0, (window.innerHeight - responsiveHeight) / 2) + 'px';
        }

        if (mainContainer && mainContainer !== dialog) {
            mainContainer.setAttribute(MANAGED_ATTR, '1');
            mainContainer.style.boxSizing = 'border-box';
            mainContainer.style.height = (responsiveHeight - 110) + 'px';
            mainContainer.style.maxHeight = (responsiveHeight - 110) + 'px';
            mainContainer.style.minHeight = '0';
            mainContainer.style.overflowY = 'hidden';
            mainContainer.style.overflowX = 'hidden';
        }

        if (scrollContainer) {
            scrollContainer.setAttribute(MANAGED_ATTR, '1');
            scrollContainer.style.boxSizing = 'border-box';
            scrollContainer.style.minHeight = '0';
            scrollContainer.style.maxHeight = '100%';
            scrollContainer.style.height = '100%';
            scrollContainer.style.overflowY = 'auto';
            scrollContainer.style.overflowX = 'hidden';
            scrollContainer.style.overscrollBehavior = 'contain';
        }

        normalizeNestedVerticalScroll(scrollContainer || mainContainer || dialog);

        const signature = getLayoutSignature(dialog);
        dialog.setAttribute(RESIZED_ATTR, 'true');
        dialog.setAttribute(SIGNATURE_ATTR, signature);
        dialog.setAttribute('data-row-count', String(getRowCount(dialog)));

        console.log('✅ МГХ диалог увеличен и scroll исправлен', {
            sets: getSetBlocks(dialog).length,
            rows: getRowCount(dialog),
            responsiveHeight,
            scrollContainer
        });

        return true;
    }

    function attachDialogObservers(dialog) {
        if (activeDialog === dialog) return;

        activeDialog = dialog;

        if (resizeObserver) {
            resizeObserver.disconnect();
            resizeObserver = null;
        }

        if (dialogMutationObserver) {
            dialogMutationObserver.disconnect();
            dialogMutationObserver = null;
        }

        resizeObserver = new ResizeObserver(() => scheduleProcess(80));
        resizeObserver.observe(dialog);

        dialogMutationObserver = new MutationObserver(() => {
            const currentSignature = getLayoutSignature(dialog);
            const prevSignature = dialog.getAttribute(SIGNATURE_ATTR);

            if (currentSignature !== prevSignature) {
                dialog.removeAttribute(RESIZED_ATTR);
                dialog.setAttribute(SIGNATURE_ATTR, currentSignature);
            }

            scheduleProcess(80);
        });

        dialogMutationObserver.observe(dialog, {
            childList: true,
            subtree: true,
            attributes: true,
            characterData: false
        });
    }

    function process(force) {
        if (!PAGE_OK) return;

        const dialog = findDialog();
        if (!dialog) return;

        attachDialogObservers(dialog);

        const currentSignature = getLayoutSignature(dialog);
        const prevSignature = dialog.getAttribute(SIGNATURE_ATTR);
        const alreadyResized = dialog.hasAttribute(RESIZED_ATTR);

        if (!force && alreadyResized && currentSignature === prevSignature) {
            return;
        }

        setTimeout(() => {
            const freshDialog = findDialog();
            if (!freshDialog || !isVisible(freshDialog)) return;
            applyResize(freshDialog);
        }, 60);
    }

    function scheduleProcess(delay = 120, force = false) {
        window.clearTimeout(processTimer);
        processTimer = window.setTimeout(() => process(force), delay);
    }

    const bodyObserver = new MutationObserver(() => scheduleProcess(120));
    if (document.body) {
        bodyObserver.observe(document.body, {
            childList: true,
            subtree: true
        });
    }

    window.addEventListener('resize', () => scheduleProcess(80, true), { passive: true });
    window.addEventListener('load', () => scheduleProcess(100, true), { passive: true });

    setTimeout(() => scheduleProcess(0, true), 300);
    setTimeout(() => scheduleProcess(0, true), 800);
    setTimeout(() => scheduleProcess(0, true), 1500);
})();
