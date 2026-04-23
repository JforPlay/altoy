/**
 * drive-sync.ui.js
 * Nav icon, popover panel, conflict modal, and cooldown timer for Drive sync.
 * Mount by calling mountSyncUI() — typically gated on a feature flag.
 */

import { openModal, closeModal, setupModal, showToast, getStorageItem } from '../utils.js';
import { STORAGE_KEYS, COOLDOWN_MS } from './drive-sync.config.js';
import { hasToken, requestToken, unlink } from './drive-sync.auth.js';
import { runSync, resolveConflict, SYNC_OUTCOMES } from './drive-sync.engine.js';
import { summarize } from './drive-sync.summary.js';

let cooldownUntil = 0;
let cooldownTimerId = null;
let currentConflict = null;

function formatRelative(ms) {
    if (!ms) return 'never';
    const diff = Date.now() - ms;
    if (diff < 60_000) return 'just now';
    if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} min ago`;
    if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} hr ago`;
    return `${Math.floor(diff / 86_400_000)} days ago`;
}

function renderPopoverBody() {
    const popover = document.getElementById('sync-popover');
    if (!popover) return;
    const signedIn = hasToken();
    const lastAt = Number(getStorageItem(STORAGE_KEYS.lastSyncedAt, '0'));
    const cooldownLeft = Math.max(0, cooldownUntil - Date.now());
    const btnLabel = !signedIn
        ? '☁ Sign in with Google'
        : cooldownLeft > 0
            ? `☁ Sync now (${Math.ceil(cooldownLeft / 1000)}s)`
            : '☁ Sync now';
    const btnDisabled = cooldownLeft > 0 ? 'disabled' : '';
    popover.innerHTML = `
        <h3>Google Drive sync</h3>
        ${signedIn ? '' : `<p>Sync your progress across devices using your own Google Drive. We only store a small file in a hidden app folder.</p>`}
        <button class="sync-action" ${btnDisabled}>${btnLabel}</button>
        ${signedIn ? `
            <div class="sync-meta">
                Last synced: ${formatRelative(lastAt)}
            </div>
            <button class="sync-unlink">Unlink Google account</button>
        ` : ''}
    `;
    popover.querySelector('.sync-action')?.addEventListener('click', onSyncClick);
    popover.querySelector('.sync-unlink')?.addEventListener('click', onUnlinkClick);
}

function setIconState(state) {
    const icon = document.getElementById('sync-nav-icon');
    if (!icon) return;
    icon.classList.remove('syncing');
    const dirty = localStorage.getItem(STORAGE_KEYS.localDirty) === '1';
    const signedIn = hasToken();
    const glyph = icon.querySelector('.material-symbols-outlined');
    const countdownSpan = icon.querySelector('.sync-cooldown-num');
    countdownSpan.textContent = '';
    if (state === 'syncing') {
        glyph.textContent = 'sync';
        icon.classList.add('syncing');
    } else if (state === 'cooldown') {
        glyph.textContent = 'cloud';
        const left = Math.ceil((cooldownUntil - Date.now()) / 1000);
        countdownSpan.textContent = left > 0 ? `${left}s` : '';
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

function startCooldown() {
    cooldownUntil = Date.now() + COOLDOWN_MS;
    if (cooldownTimerId) clearInterval(cooldownTimerId);
    cooldownTimerId = setInterval(() => {
        if (Date.now() >= cooldownUntil) {
            clearInterval(cooldownTimerId);
            cooldownTimerId = null;
            setIconState('idle');
            renderPopoverBody();
        } else {
            setIconState('cooldown');
            renderPopoverBody();
        }
    }, 1000);
    setIconState('cooldown');
    renderPopoverBody();
}

function renderConflictModal(localData, cloudData, cloudModifiedTime) {
    const modal = document.getElementById('sync-conflict-modal');
    if (!modal) return;
    const localLabels = summarize(localData);
    const cloudLabels = summarize(cloudData);
    const localEdited = 'just now';
    const cloudEdited = formatRelative(new Date(cloudModifiedTime).getTime());
    modal.querySelector('.modal-body').innerHTML = `
        <p>Both devices have unsynced changes. Pick which side to keep.</p>
        <div class="sync-conflict-grid">
            <div class="sync-conflict-side">
                <h4>This device</h4>
                <div class="sync-conflict-time">Edited ${localEdited}</div>
                <ul>${localLabels.length ? localLabels.map(l => `<li>${l}</li>`).join('') : '<li>(no summarizable data)</li>'}</ul>
            </div>
            <div class="sync-conflict-side">
                <h4>Google Drive</h4>
                <div class="sync-conflict-time">Edited ${cloudEdited}</div>
                <ul>${cloudLabels.length ? cloudLabels.map(l => `<li>${l}</li>`).join('') : '<li>(no summarizable data)</li>'}</ul>
            </div>
        </div>
        <div class="sync-conflict-actions">
            <button data-choice="cancel">Cancel</button>
            <button data-choice="keep-cloud">Keep cloud (download)</button>
            <button class="primary" data-choice="keep-local">Keep local (upload)</button>
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
        showToast(`Sync failed: ${e.message}`, 'error');
        setIconState('error');
        startCooldown();
    }
}

function handleOutcome(result) {
    switch (result.outcome) {
        case SYNC_OUTCOMES.IN_SYNC:
            showToast('Already in sync', 'info');
            break;
        case SYNC_OUTCOMES.UPLOADED:
            showToast('Uploaded to Google Drive', 'success');
            break;
        case SYNC_OUTCOMES.DOWNLOADED:
            showToast('Downloaded from Google Drive', 'success');
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
        showToast(`Sync failed: ${e.message}`, 'error');
        setIconState('error');
        startCooldown();
    }
}

function onUnlinkClick() {
    unlink();
    showToast('Unlinked from Google Drive', 'info');
    renderPopoverBody();
    setIconState('idle');
}

function togglePopover() {
    const popover = document.getElementById('sync-popover');
    if (!popover) return;
    const open = popover.classList.toggle('open');
    if (open) renderPopoverBody();
}

function onDocumentClick(e) {
    const popover = document.getElementById('sync-popover');
    const icon = document.getElementById('sync-nav-icon');
    if (!popover || !icon) return;
    if (!popover.classList.contains('open')) return;
    if (icon.contains(e.target) || popover.contains(e.target)) return;
    popover.classList.remove('open');
}

/**
 * Mount the sync nav icon + popover + conflict modal into the DOM.
 * Called from global.script.js after the feature flag check passes.
 */
export function mountSyncUI() {
    const navbar = document.querySelector('.navbar .nav-container');
    if (!navbar) return;

    const themeToggle = navbar.querySelector('.theme-toggle');
    const iconHTML = `
        <button id="sync-nav-icon" class="sync-nav-icon" aria-label="Sync to Google Drive">
            <span class="material-symbols-outlined">cloud</span>
            <span class="sync-cooldown-num"></span>
        </button>
        <div id="sync-popover" class="sync-popover" role="dialog" aria-label="Google Drive sync"></div>
    `;
    if (themeToggle) {
        themeToggle.insertAdjacentHTML('beforebegin', iconHTML);
    } else {
        navbar.insertAdjacentHTML('beforeend', iconHTML);
    }

    document.body.insertAdjacentHTML('beforeend', `
        <div id="sync-conflict-modal" class="modal" style="display:none;" role="dialog" aria-label="Sync conflict">
            <div class="modal-content">
                <div class="modal-header">
                    <h2>Sync conflict</h2>
                    <button class="modal-close" aria-label="Close">&times;</button>
                </div>
                <div class="modal-body"></div>
            </div>
        </div>
    `);
    setupModal('sync-conflict-modal', { closeOnEscape: true, closeOnBackdrop: true });

    document.getElementById('sync-nav-icon').addEventListener('click', togglePopover);
    document.addEventListener('click', onDocumentClick);

    setIconState('idle');
}
