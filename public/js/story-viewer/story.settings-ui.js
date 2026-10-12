/**
 * story.settings-ui.js
 * Binds the static #reader-settings panel (StoryPlayer.astro) to the reader
 * settings model. One scrolling field set, two shells: a right drawer on
 * desktop, a bottom sheet on phones (CSS-switched). Sliders and readouts are
 * bound across the whole player, so the toolbar's BGM volume pop-up and the
 * panel's 배경음 볼륨 are one setting.
 */
import { normalizeSettings, saveSettings, ensureFontLoaded } from './story.settings.js';

const FORMAT = { size: (v) => (v == null ? '기본' : `${v}px`), boxOpacity: (v) => `${v}%`, boxWidth: (v) => `${v}px`, cps: (v) => `${v}자/초`, volume: (v) => `${v}%` };

/**
 * @param {object} viewer - the StoryViewer engine (uses settings, applyReaderSettings, elements)
 * @returns {{open:Function, close:Function, isOpen:Function}}
 */
export function setupReaderSettings(viewer) {
    const panel = viewer.elements.readerSettings;
    const openBtn = viewer.elements.settingsBtn;
    if (!panel || !openBtn) return { open() {}, close() {}, isOpen: () => false };

    const root = viewer.elements.storyViewerView ?? panel;
    const sync = () => {
        const s = viewer.settings;
        panel.querySelectorAll('button[data-setting][data-value]').forEach((b) => {
            b.setAttribute('aria-pressed', String(String(s[b.dataset.setting]) === b.dataset.value));
        });
        root.querySelectorAll('input[data-setting]').forEach((i) => {
            i.value = s[i.dataset.setting];
            i.disabled = i.dataset.setting === 'cps' && s.reveal === 'instant';
        });
        root.querySelectorAll('output[data-out]').forEach((o) => { o.textContent = FORMAT[o.dataset.out](s[o.dataset.out]); });
        const preview = panel.querySelector('.rs-preview-line');
        if (preview) preview.textContent = viewer.elements.dialogueText.textContent || '바다가 노을빛으로 물들었다.';
    };
    const update = (patch) => {
        const next = normalizeSettings({ ...viewer.settings, ...patch });
        ensureFontLoaded(next.font);
        saveSettings(next);
        viewer.applyReaderSettings(next);
        sync();
    };

    panel.addEventListener('click', (e) => {
        e.stopPropagation();
        if (e.target.closest('[data-rs-close]')) { api.close(); return; }
        const b = e.target.closest('button[data-setting]');
        if (!b) return;
        const key = b.dataset.setting;
        if (b.dataset.step) {
            const base = viewer.settings.size ?? parseFloat(getComputedStyle(viewer.elements.dialogueText).fontSize);
            update({ size: Math.round(base) + Number(b.dataset.step) });
        } else {
            const raw = b.dataset.value;
            update({ [key]: key === 'lineHeight' ? Number(raw) : raw });
        }
    });
    root.addEventListener('input', (e) => {
        const i = e.target.closest('input[data-setting]');
        if (i) update({ [i.dataset.setting]: Number(i.value) });
    });

    const api = {
        open() { sync(); panel.inert = false; panel.classList.add('open'); openBtn.setAttribute('aria-expanded', 'true'); viewer.cancelAutoAdvance(); },
        close() { panel.classList.remove('open'); panel.inert = true; openBtn.setAttribute('aria-expanded', 'false'); viewer.scheduleAutoAdvance(); },
        isOpen: () => panel.classList.contains('open'),
    };
    openBtn.addEventListener('click', (e) => { e.stopPropagation(); api.isOpen() ? api.close() : api.open(); });
    sync();             // the toolbar's volume slider is visible before the panel ever opens
    panel.inert = true; // off-screen while closed: keep it out of the Tab order
    return api;
}
