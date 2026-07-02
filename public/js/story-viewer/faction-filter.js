/**
 * faction-filter.js
 * Shared 진영 필터 dropdown (filter button + checkbox panel) for story index
 * pages (main-storyline / main-story / event-story). Owns panel rendering,
 * open/close + outside-click dismissal, the 전체-vs-factions exclusivity
 * rules, and the selected-count badge; callers supply the option list and
 * react to selection via onChange. Styles:
 * src/styles/story-viewer/story-viewer.faction-filter.css.
 */
import { hideElement, showElement } from '../utils.js';

/** Nation id → KR faction name (mirrors the game's nation table). */
export const FACTION_NAMES = {
    1: '이글 유니온',
    2: '로열 네이비',
    3: '사쿠라 엠파이어',
    4: '메탈 블러드',
    5: '이스트 글림',
    6: '사르데냐 엠파이어',
    7: '노스 유니온',
    8: '아이리스 리브레',
    9: '비시아 성좌',
    10: '아이리스 연합',
    96: '템페스타',
    97: 'META',
};

/**
 * Render and wire a faction filter dropdown.
 * @param {object} cfg
 * @param {HTMLElement} cfg.button  toggle button (gets aria-expanded)
 * @param {HTMLElement} cfg.panel   dropdown container; checkboxes rendered here
 * @param {HTMLElement} [cfg.badge] selected-count badge (hidden at 0)
 * @param {Array<{value: string, label: string}>} cfg.options one checkbox each
 * @param {(selected: string[]) => void} cfg.onChange  [] = 전체 (no filtering)
 * @param {(open: boolean) => void} [cfg.onToggle] fires on panel show/hide
 * @returns {{ getSelected: () => string[], close: () => void }}
 */
export function setupFactionFilter({ button, panel, badge = null, options, onChange, onToggle = null }) {
    panel.textContent = '';

    const makeOption = (id, value, labelText, checked) => {
        const option = document.createElement('div');
        option.className = 'filter-option';
        const input = document.createElement('input');
        input.type = 'checkbox';
        input.id = id;
        input.value = value;
        input.checked = checked;
        const label = document.createElement('label');
        label.htmlFor = id;
        label.textContent = labelText;
        option.append(input, label);
        panel.appendChild(option);
        return input;
    };

    // Option values can be arbitrary strings (KR faction names on event-story),
    // so checkbox ids are index-derived, never value-derived.
    const allBox = makeOption('faction-opt-all', 'all', '전체', true);
    const optionBoxes = options.map((o, i) => makeOption(`faction-opt-${i}`, o.value, o.label, false));

    const getSelected = () => optionBoxes.filter((cb) => cb.checked).map((cb) => cb.value);

    const setOpen = (open) => {
        if (open) showElement(panel); else hideElement(panel);
        button.setAttribute('aria-expanded', String(open));
        if (onToggle) onToggle(open);
    };

    button.setAttribute('aria-expanded', 'false');
    button.addEventListener('click', (e) => {
        e.stopPropagation();
        setOpen(panel.classList.contains('hidden'));
    });

    document.addEventListener('click', (e) => {
        if (panel.classList.contains('hidden')) return;
        if (!panel.contains(e.target) && !button.contains(e.target)) setOpen(false);
    });

    panel.addEventListener('change', (e) => {
        if (e.target === allBox) {
            if (allBox.checked) optionBoxes.forEach((cb) => { cb.checked = false; });
        } else if (optionBoxes.some((cb) => cb.checked)) {
            allBox.checked = false;
        }
        // Nothing checked at all → fall back to 전체.
        if (!allBox.checked && optionBoxes.every((cb) => !cb.checked)) allBox.checked = true;

        const selected = getSelected();
        if (badge) {
            if (selected.length > 0) {
                badge.textContent = selected.length;
                showElement(badge);
            } else {
                hideElement(badge);
            }
        }
        onChange(selected);
    });

    return { getSelected, close: () => setOpen(false) };
}
