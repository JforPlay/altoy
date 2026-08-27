/**
 * global.init.js
 * Runs on every page (loaded by Layout.astro). Sets the copyright year, registers the
 * Service Worker, and offers a reload when a new build takes over mid-visit.
 */

import { getBasePath, initUtils, showToast } from './utils.js';

// Register utils.js's runtime side effects (image-error fallback handler + periodic
// IndexedDB cache purge). Done here — not at utils.js import time — so importing
// utils.js is side-effect-free (e.g. safe in non-DOM test environments).
initUtils();

document.getElementById('copyright-year').textContent = new Date().getFullYear();

if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register(`${getBasePath()}/sw.js`)
            .catch(err => console.warn('SW registration failed:', err));
    });

    // JS/CSS are stale-while-revalidate (sw.js), so the page on screen right after a
    // deploy came from the PREVIOUS build's cache. When the new SW claims this page
    // (`controllerchange`), offer a reload instead of forcing one under the user.
    // A page with no controller at boot is a first install (or a hard reload) — the
    // build on screen is already current, so no toast.
    const hadController = !!navigator.serviceWorker.controller;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (!hadController) return;
        // Explicit break: with the button beside it the text wraps mid-word otherwise.
        const toast = showToast('장난감이 업데이트 되었습니다\n- 새로고침 필요', 'info', 0);
        const btn = document.createElement('button');
        btn.className = 'btn btn-primary btn-sm';
        btn.textContent = '새로고침';
        btn.addEventListener('click', () => location.reload());
        toast.append(btn);
    }, { once: true });
}
