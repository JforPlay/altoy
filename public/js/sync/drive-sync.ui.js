/**
 * drive-sync.ui.js
 * Nav icon, popover panel, conflict modal, and cooldown timer for Drive sync.
 * Mount by calling mountSyncUI() — typically gated on a feature flag.
 *
 * The popover is appended to <body> (not the navbar) so the navbar's
 * backdrop-filter can't bleed through the popover's background. Position is
 * computed on open via getBoundingClientRect().
 */

import { openModal, closeModal, setupModal, showToast, getStorageItem, escapeHtml } from '../utils.js';
import { STORAGE_KEYS, COOLDOWN_MS } from './drive-sync.config.js';
import { hasToken, requestToken, unlink } from './drive-sync.auth.js';
import { runSync, resolveConflict, exportPayload, importPayload, hasLocalData, SYNC_OUTCOMES } from './drive-sync.engine.js';
import { summarize } from './drive-sync.summary.js';

// Cooldown persists across page navigations via sessionStorage so the
// 60s guard actually works across a multi-page site.
const SESSION_COOLDOWN_KEY = 'altoy:sync:cooldownUntil';

function loadCooldownFromSession() {
    try {
        const stored = Number(sessionStorage.getItem(SESSION_COOLDOWN_KEY) || 0);
        if (stored > Date.now()) return stored;
        if (stored) sessionStorage.removeItem(SESSION_COOLDOWN_KEY);
    } catch { /* sessionStorage unavailable */ }
    return 0;
}

let cooldownUntil = loadCooldownFromSession();
let cooldownTimerId = null;
let currentConflict = null;

/**
 * "Signed in" means either we have a live token OR the user has signed in
 * before on this device (flag in localStorage). We show the signed-in UI
 * optimistically because actual token acquisition must happen on a user
 * gesture (click) — not on page load, where browsers block popups.
 */
function isSignedIn() {
    return hasToken() || localStorage.getItem(STORAGE_KEYS.everSignedIn) === '1';
}

function formatRelative(ms) {
    if (!ms) return '없음';
    const diff = Date.now() - ms;
    if (diff < 60_000) return '방금';
    if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}분 전`;
    if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}시간 전`;
    return `${Math.floor(diff / 86_400_000)}일 전`;
}

function renderPopoverBody() {
    const popover = document.getElementById('sync-popover');
    if (!popover) return;
    const signedIn = isSignedIn();
    const lastAt = Number(getStorageItem(STORAGE_KEYS.lastSyncedAt, '0'));
    const cooldownLeft = Math.max(0, cooldownUntil - Date.now());
    const btnLabel = !signedIn
        ? '☁ Google로 로그인'
        : cooldownLeft > 0
            ? `☁ 동기화 (${Math.ceil(cooldownLeft / 1000)}초)`
            : '☁ 지금 동기화';
    const btnDisabled = cooldownLeft > 0 ? 'disabled' : '';
    popover.innerHTML = `
        <h3>Google Drive 동기화</h3>
        ${signedIn ? '' : `<p>내 Google Drive를 이용해 기기 간 진행도를 동기화합니다. 숨겨진 앱 폴더에 작은 파일 하나만 저장됩니다.</p>`}
        <button class="btn btn-primary btn-block sync-action" ${btnDisabled}>${btnLabel}</button>
        ${signedIn ? `
            <div class="sync-meta">
                마지막 동기화: ${formatRelative(lastAt)}
            </div>
            <button class="btn btn-danger btn-sm sync-unlink">Google 계정 연결 해제</button>
        ` : ''}
        <div class="sync-divider"></div>
        <div class="sync-section-label">수동 백업</div>
        <div class="sync-manual-buttons">
            <button class="btn btn-secondary sync-secondary sync-export">📥 내보내기</button>
            <button class="btn btn-secondary sync-secondary sync-import">📤 불러오기</button>
        </div>
    `;
    popover.querySelector('.sync-action')?.addEventListener('click', onSyncClick);
    popover.querySelector('.sync-unlink')?.addEventListener('click', onUnlinkClick);
    popover.querySelector('.sync-export')?.addEventListener('click', onExportClick);
    popover.querySelector('.sync-import')?.addEventListener('click', onImportClick);
}

function setIconState(state) {
    const icon = document.getElementById('sync-nav-icon');
    if (!icon) return;
    icon.classList.remove('syncing');
    const dirty = localStorage.getItem(STORAGE_KEYS.localDirty) === '1';
    const signedIn = isSignedIn();
    const glyph = icon.querySelector('.material-symbols-outlined');
    const countdownSpan = icon.querySelector('.sync-cooldown-num');
    countdownSpan.textContent = '';
    if (state === 'syncing') {
        glyph.textContent = 'sync';
        icon.classList.add('syncing');
    } else if (state === 'cooldown') {
        glyph.textContent = 'cloud';
        const left = Math.ceil((cooldownUntil - Date.now()) / 1000);
        countdownSpan.textContent = left > 0 ? `${left}초` : '';
    } else if (state === 'error') {
        glyph.textContent = 'cloud_off';
    } else if (!signedIn) {
        glyph.textContent = 'cloud';
    } else if (dirty) {
        glyph.textContent = 'cloud_upload';
    } else {
        glyph.textContent = 'cloud_done';
    }
}

function startCooldownInterval() {
    if (cooldownTimerId) clearInterval(cooldownTimerId);
    cooldownTimerId = setInterval(() => {
        const popoverOpen = document.getElementById('sync-popover')?.classList.contains('open');
        if (Date.now() >= cooldownUntil) {
            clearInterval(cooldownTimerId);
            cooldownTimerId = null;
            try { sessionStorage.removeItem(SESSION_COOLDOWN_KEY); } catch { /* ignore */ }
            setIconState('idle');
            if (popoverOpen) renderPopoverBody();
        } else {
            // Fast path: while the popover is closed, just tick the icon
            // countdown. Skip re-rendering the popover's inner HTML (and the
            // four event listeners it binds) every second.
            setIconState('cooldown');
            if (popoverOpen) renderPopoverBody();
        }
    }, 1000);
}

function startCooldown() {
    cooldownUntil = Date.now() + COOLDOWN_MS;
    try { sessionStorage.setItem(SESSION_COOLDOWN_KEY, String(cooldownUntil)); } catch { /* ignore */ }
    startCooldownInterval();
    setIconState('cooldown');
    renderPopoverBody();
}

function renderConflictModal(localData, cloudData, cloudModifiedTime) {
    const modal = document.getElementById('sync-conflict-modal');
    if (!modal) return;
    const localLabels = summarize(localData);
    const cloudLabels = summarize(cloudData);
    const localDirtyAt = Number(getStorageItem(STORAGE_KEYS.localDirtyAt, '0')) || Date.now();
    const localEdited = formatRelative(localDirtyAt);
    const cloudEdited = formatRelative(new Date(cloudModifiedTime).getTime());
    modal.querySelector('.modal-body').innerHTML = `
        <p>두 기기 모두 저장되지 않은 변경사항이 있습니다. 유지할 쪽을 선택하세요.</p>
        <div class="sync-conflict-grid">
            <div class="sync-conflict-side">
                <h4>이 기기</h4>
                <div class="sync-conflict-time">${localEdited} 수정됨</div>
                <ul>${localLabels.length ? localLabels.map(l => `<li>${escapeHtml(l)}</li>`).join('') : '<li>(요약 가능한 데이터 없음)</li>'}</ul>
            </div>
            <div class="sync-conflict-side">
                <h4>Google Drive</h4>
                <div class="sync-conflict-time">${cloudEdited} 수정됨</div>
                <ul>${cloudLabels.length ? cloudLabels.map(l => `<li>${escapeHtml(l)}</li>`).join('') : '<li>(요약 가능한 데이터 없음)</li>'}</ul>
            </div>
        </div>
        <div class="sync-conflict-actions">
            <button class="btn btn-secondary" data-choice="cancel">취소</button>
            <button class="btn btn-secondary" data-choice="keep-cloud">클라우드 유지 (다운로드)</button>
            <button class="btn btn-primary" data-choice="keep-local">로컬 유지 (업로드)</button>
        </div>
    `;
    modal.querySelectorAll('[data-choice]').forEach(btn => {
        btn.addEventListener('click', () => onConflictChoice(btn.dataset.choice));
    });
    openModal('sync-conflict-modal');
}

async function onSyncClick() {
    if (Date.now() < cooldownUntil) return;
    setIconState('syncing');
    try {
        const result = await runSync();
        handleOutcome(result);
    } catch (e) {
        console.error('Sync error:', e);
        showToast(`동기화 실패: ${e.message}`, 'error');
        setIconState('error');
        startCooldown();
    }
}

function handleOutcome(result) {
    switch (result.outcome) {
        case SYNC_OUTCOMES.IN_SYNC:
            showToast('이미 동기화됨', 'info');
            break;
        case SYNC_OUTCOMES.UPLOADED:
            showToast('Google Drive에 업로드됨', 'success');
            break;
        case SYNC_OUTCOMES.DOWNLOADED:
            showToast('Google Drive에서 다운로드됨', 'success');
            break;
        case SYNC_OUTCOMES.CONFLICT:
            currentConflict = result;
            renderConflictModal(result.localData, result.cloudData, result.cloudModifiedTime);
            setIconState('idle');
            return;
    }
    startCooldown();
}

async function onConflictChoice(choice) {
    closeModal('sync-conflict-modal');
    if (!currentConflict) return;
    if (choice === 'cancel') {
        currentConflict = null;
        startCooldown();
        return;
    }
    setIconState('syncing');
    try {
        const result = await resolveConflict(choice, currentConflict);
        currentConflict = null;
        handleOutcome(result);
    } catch (e) {
        console.error('Conflict resolution error:', e);
        showToast(`동기화 실패: ${e.message}`, 'error');
        setIconState('error');
        startCooldown();
    }
}

function onUnlinkClick() {
    unlink();
    showToast('Google Drive 연결 해제됨', 'info');
    renderPopoverBody();
    setIconState('idle');
}

function onExportClick() {
    try {
        const payload = exportPayload();
        const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        const date = new Date().toISOString().slice(0, 10);
        const filename = `altoy-sync-${date}.json`;
        a.href = url;
        a.download = filename;
        a.click();
        // Defer revoke — Safari can race the click on iOS, breaking the download.
        setTimeout(() => URL.revokeObjectURL(url), 1000);
        showToast(`백업 파일 저장됨: ${filename}`, 'success');
        closePopover();
    } catch (e) {
        console.error('Export error:', e);
        showToast(`내보내기 실패: ${e.message}`, 'error');
    }
}

function onImportClick() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json,application/json';
    input.addEventListener('change', async (e) => {
        const file = e.target.files?.[0];
        if (!file) return;
        try {
            const text = await file.text();
            const payload = JSON.parse(text);
            if (hasLocalData()) {
                if (!confirm('현재 로컬 데이터가 불러온 파일로 덮어쓰기됩니다. 계속하시겠습니까?')) {
                    return;
                }
            }
            importPayload(payload);
            showToast('파일에서 불러옴', 'success');
            renderPopoverBody();
            setIconState('idle');
            closePopover();
        } catch (err) {
            console.error('Import error:', err);
            showToast(`불러오기 실패: ${err.message}`, 'error');
        }
    });
    input.click();
}

function positionPopover() {
    const popover = document.getElementById('sync-popover');
    const icon = document.getElementById('sync-nav-icon');
    if (!popover || !icon) return;
    const rect = icon.getBoundingClientRect();
    popover.style.top = `${rect.bottom + 8}px`;
    // Align popover's left edge with the icon's left edge, but clamp so it
    // doesn't overflow the right side of the viewport.
    const popoverWidth = 280;
    const maxLeft = window.innerWidth - popoverWidth - 8;
    popover.style.left = `${Math.min(rect.left, maxLeft)}px`;
}

function togglePopover() {
    const popover = document.getElementById('sync-popover');
    if (!popover) return;
    const open = popover.classList.toggle('open');
    if (open) {
        positionPopover();
        renderPopoverBody();
    }
}

function closePopover() {
    const popover = document.getElementById('sync-popover');
    popover?.classList.remove('open');
}

function onDocumentClick(e) {
    const popover = document.getElementById('sync-popover');
    const icon = document.getElementById('sync-nav-icon');
    if (!popover || !icon) return;
    if (!popover.classList.contains('open')) return;
    if (icon.contains(e.target) || popover.contains(e.target)) return;
    closePopover();
}

/**
 * Mount the sync nav icon + popover + conflict modal into the DOM.
 * Called from global.script.js after the feature flag check passes.
 */
export function mountSyncUI() {
    const navbar = document.querySelector('.navbar .nav-container');
    if (!navbar) return;

    const themeToggle = navbar.querySelector('.theme-toggle');
    // Icon goes in the navbar. Popover goes in <body> so the navbar's
    // backdrop-filter cannot affect its background rendering.
    const iconHTML = `
        <button id="sync-nav-icon" class="sync-nav-icon" aria-label="Google Drive 동기화">
            <span class="material-symbols-outlined">cloud</span>
            <span class="sync-cooldown-num"></span>
        </button>
    `;
    if (themeToggle) {
        themeToggle.insertAdjacentHTML('beforebegin', iconHTML);
    } else {
        navbar.insertAdjacentHTML('beforeend', iconHTML);
    }

    document.body.insertAdjacentHTML('beforeend', `
        <div id="sync-popover" class="sync-popover" role="dialog" aria-label="Google Drive 동기화"></div>
        <div id="sync-conflict-modal" class="modal" style="display:none;" role="dialog" aria-label="동기화 충돌">
            <div class="modal-content">
                <div class="modal-header">
                    <h2>동기화 충돌</h2>
                    <button class="btn btn-close modal-close" aria-label="닫기">&times;</button>
                </div>
                <div class="modal-body"></div>
            </div>
        </div>
    `);
    setupModal('sync-conflict-modal', { closeOnEscape: true, closeOnBackdrop: true, restoreFocus: true });

    document.getElementById('sync-nav-icon').addEventListener('click', togglePopover);
    document.addEventListener('click', onDocumentClick);
    // Close popover on scroll/resize — the fixed position would otherwise
    // disconnect from the icon.
    window.addEventListener('scroll', closePopover, { passive: true });
    window.addEventListener('resize', closePopover);

    // Resume cooldown from a prior page if still active
    if (cooldownUntil > Date.now()) {
        startCooldownInterval();
        setIconState('cooldown');
    } else {
        setIconState('idle');
    }
}
