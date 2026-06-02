/**
 * global.init.js
 * Runs on every page (loaded by Layout.astro). Sets the copyright year and registers the Service Worker.
 */

import { getBasePath, initUtils } from './utils.js';

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
}
