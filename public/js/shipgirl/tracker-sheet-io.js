/**
 * tracker-sheet-io.js
 * Google Sheet → tracker import modal. Owns only the modal's DOM and its
 * lifecycle; all parsing/mapping lives in the pure tracker-sheet-codec.js, and
 * applying goes back through the page's own whole-store-replaced path.
 *
 * Kept out of shipgirl-tracker.js, which is already ~2,300 lines.
 *
 * SECURITY: everything shown in the preview comes from a pasted file — ship
 * names, memos, error text quoting the offending cell. It is rendered with
 * textContent only, never innerHTML (the fleet-sim equip-code-ui precedent).
 */

import { openModal, closeModal, setupModal, fetchJSONWithCache, debounce } from '../utils.js';
import { parseSheet, applyToStores } from './tracker-sheet-codec.js';

const PREVIEW_PROBLEM_LIMIT = 50;

/**
 * @param {object} ctx
 * @param {() => {progress: object, investment: object}} ctx.getStores - current state
 * @param {(next: {progress: object, investment: object}) => void} ctx.onApply
 *   Receives fresh store objects; the page persists + re-renders from these.
 */
export function setupSheetImport(ctx) {
    const els = {
        openBtn: document.getElementById('sheet-import-btn'),
        modal: document.getElementById('sheet-modal'),
        file: document.getElementById('sheet-file'),
        paste: document.getElementById('sheet-paste'),
        status: document.getElementById('sheet-status'),
        preview: document.getElementById('sheet-preview'),
        applyBtn: document.getElementById('sheet-apply-btn'),
    };
    // The modal is markup opt-in: a page without it simply has no import.
    if (!els.openBtn || !els.modal) return;
    // But a PARTIAL adoption is a markup bug, not an opt-out — say so instead of
    // throwing on the first click.
    const missing = Object.entries(els).filter(([, el]) => !el).map(([key]) => key);
    if (missing.length) {
        console.error(`[tracker-sheet-io] 시트 모달 마크업 누락: ${missing.join(', ')}`);
        return;
    }

    setupModal('sheet-modal');

    let ships = null;        // ship_info_lite.json, fetched on first open
    let shipsError = false;
    let parsed = null;       // last parseSheet() result

    /** Status line — one message, plain text, optional tone class. */
    function setStatus(message, tone = '') {
        els.status.textContent = message;
        els.status.className = `sheet-status${tone ? ` is-${tone}` : ''}`;
    }

    function resetPreview() {
        parsed = null;
        els.preview.textContent = '';
        els.applyBtn.disabled = true;
        els.applyBtn.textContent = '적용';
    }

    /** Append one problem row. All values are untrusted — textContent only. */
    function problemRow(list, label, detail) {
        const li = document.createElement('li');
        const strong = document.createElement('span');
        strong.className = 'sheet-problem-label';
        strong.textContent = label;
        li.appendChild(strong);
        const span = document.createElement('span');
        span.textContent = detail;
        li.appendChild(span);
        list.appendChild(li);
    }

    function section(title) {
        const wrap = document.createElement('div');
        wrap.className = 'sheet-problem-group';
        const h = document.createElement('h4');
        h.textContent = title;
        wrap.appendChild(h);
        const ul = document.createElement('ul');
        wrap.appendChild(ul);
        els.preview.appendChild(wrap);
        return ul;
    }

    function renderPreview(result) {
        els.preview.textContent = '';

        const summary = document.createElement('p');
        summary.className = 'sheet-summary';
        summary.textContent = `${result.matched.length}척 인식`
            + (result.rejected.length ? ` · ${result.rejected.length}행 건너뜀` : '')
            + (result.duplicates.length ? ` · 중복 ${result.duplicates.length}행` : '');
        els.preview.appendChild(summary);

        const mismatches = result.matched.filter((m) => m.nameMismatch);
        if (mismatches.length) {
            const ul = section(`이름이 다른 행 ${mismatches.length}개 (ID 기준으로 가져옵니다)`);
            for (const m of mismatches.slice(0, PREVIEW_PROBLEM_LIMIT)) {
                problemRow(ul, m.sheetId, `시트 "${m.sheetName}" → 사이트 "${m.siteName}"`);
            }
        }

        if (result.rejected.length) {
            const ul = section(`건너뛴 행 ${result.rejected.length}개`);
            for (const r of result.rejected.slice(0, PREVIEW_PROBLEM_LIMIT)) {
                problemRow(ul, `${r.line}행`, r.reason);
            }
        }

        if (result.matched.length) {
            els.applyBtn.disabled = false;
            els.applyBtn.textContent = `${result.matched.length}척 적용`;
        } else {
            els.applyBtn.disabled = true;
            els.applyBtn.textContent = '적용';
        }
    }

    function preview(text) {
        if (!text.trim()) { resetPreview(); setStatus(''); return; }
        if (!ships) {
            setStatus(shipsError
                ? '함순이 목록을 불러오지 못했습니다. 모달을 닫았다 다시 열어 주세요.'
                : '함순이 목록을 불러오는 중입니다…', shipsError ? 'error' : '');
            return;
        }
        const result = parseSheet(text, { ships });
        if (!result.ok) { resetPreview(); setStatus(result.error, 'error'); return; }
        parsed = result;
        setStatus(result.delimiter === '\t' ? '시트에서 복사한 형식(TSV)으로 읽었습니다.' : 'CSV 형식으로 읽었습니다.');
        renderPreview(result);
    }

    const previewDebounced = debounce(() => preview(els.paste.value), 300);

    async function ensureShips() {
        if (ships || shipsError) return;
        setStatus('함순이 목록을 불러오는 중입니다…');
        try {
            const lite = await fetchJSONWithCache('data/ship_info_lite.json');
            ships = Array.isArray(lite) ? lite : Object.values(lite);
            setStatus('');
            // A file may have been dropped in while the roster was loading.
            if (els.paste.value.trim()) preview(els.paste.value);
        } catch (err) {
            shipsError = true;
            setStatus('함순이 목록을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.', 'error');
            console.error('[tracker-sheet-io] ship_info_lite.json 로드 실패', err);
        }
    }

    els.openBtn.addEventListener('click', () => {
        openModal('sheet-modal');
        ensureShips();
    });

    els.paste.addEventListener('input', previewDebounced);

    els.file.addEventListener('change', async () => {
        const file = els.file.files?.[0];
        if (!file) return;
        try {
            const text = await file.text();
            els.paste.value = text;
            // Setting .value leaves the box scrolled to the caret at the end;
            // the header row is what the user wants to eyeball.
            els.paste.scrollTop = 0;
            els.paste.scrollLeft = 0;
            preview(text);
        } catch (err) {
            setStatus('파일을 읽지 못했습니다.', 'error');
            console.error('[tracker-sheet-io] 파일 읽기 실패', err);
        } finally {
            // Allow re-picking the same file after a failed or corrected run.
            els.file.value = '';
        }
    });

    els.applyBtn.addEventListener('click', () => {
        if (!parsed?.matched.length) return;
        const next = applyToStores(parsed.matched, ctx.getStores());
        ctx.onApply(next);
        closeModal('sheet-modal');
        resetPreview();
        els.paste.value = '';
        setStatus('');
    });

    resetPreview();
}
