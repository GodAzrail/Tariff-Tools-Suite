// resize-branches-dialog.js - fixed for /configurator/del-orgs
(function() {
    'use strict';
    console.log('📏 resize-branches-dialog.js loaded (del-orgs fixed)');

    function isPageOk() {
        if (window.location.pathname.includes('/tariffs')) return false;
        return window.location.pathname.includes('/configurator/');
    }

    const DIALOG_ID = 'select-branches-dlg';
    const TITLE_MATCHES = ['филиал обслуживания', 'филиалы обслуживания', 'филиал', 'обслуживания'];

    function getResponsiveHeight() {
        const screenHeight = window.innerHeight || 900;
        let h = Math.round(screenHeight * 0.8);
        h = Math.max(400, Math.min(h, 900));
        return h;
    }

    function isVisible(el) {
        if (!el) return false;
        const style = window.getComputedStyle(el);
        return style.display !== 'none' && style.visibility !== 'hidden';
    }

    function textOf(el) {
        return (el?.innerText || el?.textContent || '').toLowerCase();
    }

    function hasMatchingTitle(dialog) {
        const text = textOf(dialog).slice(0, 1200);
        return TITLE_MATCHES.some(t => text.includes(t));
    }

    function findDialog() {
        const byId = document.getElementById(DIALOG_ID);
        if (isVisible(byId)) return byId;

        const candidates = Array.from(document.querySelectorAll(
            'dialog[open], [role="dialog"], [aria-modal="true"], [class*="modal"], [class*="dialog"]'
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

    function findRowsContainer(dialog) {
        return dialog.querySelector('.css-1b687zk.e1jot28b0')
            || dialog.querySelector('table')?.closest('div')
            || Array.from(dialog.querySelectorAll('div')).find(el => {
                const txt = textOf(el);
                return (txt.includes('филиал') || txt.includes('мин')) && (el.querySelector('input') || el.querySelector('[class*="select"]'));
            })
            || dialog;
    }

    function getRowCount(dialog) {
        return dialog.querySelectorAll('tbody tr').length
            || dialog.querySelectorAll('tr').length
            || dialog.querySelectorAll('input').length
            || 0;
    }

    function applyResize(dialog) {
        if (!isPageOk()) return false;
        if (!dialog || !isVisible(dialog)) return false;

        const mainContainer = findMainContainer(dialog);
        const rowsContainer = findRowsContainer(dialog);
        const responsiveHeight = getResponsiveHeight();
        const currentWidth = dialog.style.minWidth || dialog.style.width || '1056px';

        dialog.style.height = responsiveHeight + 'px';
        dialog.style.minHeight = responsiveHeight + 'px';
        dialog.style.maxHeight = responsiveHeight + 'px';
        dialog.style.width = currentWidth;
        dialog.style.minWidth = currentWidth;
        dialog.style.maxWidth = currentWidth;

        if (dialog.tagName.toLowerCase() !== 'dialog') {
            dialog.style.top = Math.max(0, (window.innerHeight - responsiveHeight) / 2) + 'px';
        }

        dialog.style.setProperty('overflow', 'hidden', 'important');

        if (mainContainer) {
            mainContainer.style.maxHeight = (responsiveHeight - 110) + 'px';
            mainContainer.style.height = (responsiveHeight - 110) + 'px';
            mainContainer.style.overflowY = 'auto';
            mainContainer.style.overflowX = 'hidden';
        }

        if (rowsContainer && rowsContainer !== dialog) {
            rowsContainer.style.maxHeight = (responsiveHeight - 180) + 'px';
            rowsContainer.style.overflowY = 'auto';
            rowsContainer.style.overflowX = 'auto';
        }

        console.log('✅ Диалог филиалов увеличен', { rows: getRowCount(dialog), responsiveHeight });
        return true;
    }

    function process() {
        if (window.__disableResizeObservers) return;
        if (!isPageOk()) return;
        const dialog = findDialog();
        if (!dialog) return;
        if (dialog.hasAttribute('data-branches-resized')) return;

        setTimeout(() => {
            if (applyResize(dialog)) {
                dialog.setAttribute('data-branches-resized', 'true');
                dialog.setAttribute('data-branches-row-count', String(getRowCount(dialog)));
            }
        }, 300);
    }

    const observer = new MutationObserver(process);
    if (document.body) observer.observe(document.body, { childList: true, subtree: true });
    
    window.addEventListener('spa-route-changed', () => {
        setTimeout(process, 400);
    });

    setTimeout(process, 800);
    setTimeout(process, 1500);
})();
