/**
 * shipgirl-tracker.status-menu.js
 * One shared anchored status menu for the tracker's 호감작/스작 chips: direct
 * state selection instead of click-to-cycle. Single DOM shell reused across
 * all rows (event delegation scale); ≤480px the same shell renders as a
 * bottom sheet via CSS. Keyboard: Arrows/Home/End roam, Enter/Space select,
 * Escape/outside click/Tab close (Tab lets focus move on naturally, per the
 * ARIA APG menu pattern). Focus return is the CALLER's job — selection
 * re-renders the trigger's cell, so the caller re-queries and refocuses.
 */

/** Pure roving index for menu keyboard nav (node-tested). */
export function menuNav(current, key, length) {
    if (key === 'ArrowDown') return (current + 1) % length;
    if (key === 'ArrowUp') return (current - 1 + length) % length;
    if (key === 'Home') return 0;
    if (key === 'End') return length - 1;
    return current;
}

export function createStatusMenu() {
    let shell = null;
    let items = [];
    let activeIndex = 0;
    let selectCb = null;
    let anchorTrigger = null;

    function ensureShell() {
        if (shell) return shell;
        shell = document.createElement('div');
        shell.className = 'st-status-menu';
        shell.setAttribute('role', 'menu');
        shell.hidden = true;
        shell.addEventListener('keydown', onKeydown);
        shell.addEventListener('click', (e) => {
            const btn = e.target.closest('[data-value]');
            if (btn) select(Number(btn.dataset.value));
        });
        document.body.appendChild(shell);
        return shell;
    }

    function onKeydown(e) {
        if (e.key === 'Escape') { e.stopPropagation(); close({ refocus: true }); return; }
        // ARIA APG menu pattern: Tab closes the menu and lets focus move to the
        // next element in the page's natural tab sequence — no preventDefault,
        // no trapping.
        if (e.key === 'Tab') { close(); return; }
        if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            select(Number(items[activeIndex].dataset.value));
            return;
        }
        const next = menuNav(activeIndex, e.key, items.length);
        if (next !== activeIndex) {
            e.preventDefault();
            setActive(next);
        }
    }

    function setActive(index) {
        activeIndex = index;
        items.forEach((el, i) => { el.tabIndex = i === index ? 0 : -1; });
        items[index].focus();
    }

    function onOutside(e) {
        if (!shell.contains(e.target) && e.target !== anchorTrigger) close();
    }

    function select(value) {
        const cb = selectCb;
        close();
        if (cb) cb(value);
    }

    function open({ trigger, options, current, kind, onSelect }) {
        ensureShell();
        if (!shell.hidden) close();
        selectCb = onSelect;
        anchorTrigger = trigger;
        shell.setAttribute('aria-label', kind);
        shell.innerHTML = options.map(({ value, label }) =>
            `<button type="button" role="menuitemradio" data-value="${value}"`
            + ` aria-checked="${value === current}" tabindex="-1">`
            + `<span class="material-symbols-outlined" aria-hidden="true">check</span>${label}</button>`
        ).join('');
        items = Array.from(shell.querySelectorAll('[data-value]'));
        shell.hidden = false;
        trigger.setAttribute('aria-expanded', 'true');

        // Anchor below the trigger, clamped to the viewport (CSS turns the
        // shell into a bottom sheet ≤480px and overrides these).
        const r = trigger.getBoundingClientRect();
        const w = shell.offsetWidth, h = shell.offsetHeight;
        shell.style.left = `${Math.max(8, Math.min(r.left, window.innerWidth - w - 8))}px`;
        shell.style.top = r.bottom + h + 8 > window.innerHeight
            ? `${Math.max(8, r.top - h - 4)}px`
            : `${r.bottom + 4}px`;

        setActive(Math.max(0, options.findIndex(o => o.value === current)));
        document.addEventListener('pointerdown', onOutside, true);
    }

    function close({ refocus = false } = {}) {
        if (!shell || shell.hidden) return;
        shell.hidden = true;
        document.removeEventListener('pointerdown', onOutside, true);
        anchorTrigger?.setAttribute('aria-expanded', 'false');
        if (refocus) anchorTrigger?.focus({ preventScroll: true });
        selectCb = null;
        anchorTrigger = null;
    }

    return { open, close, isOpen: () => !!shell && !shell.hidden };
}
