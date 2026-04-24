/**
 * global.init.js
 * Runs on every page (loaded by Layout.astro). Sets the copyright year and registers the Service Worker.
 */

import { getBasePath } from './utils.js';

document.getElementById('copyright-year').textContent = new Date().getFullYear();

if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register(`${getBasePath()}/sw.js`)
            .catch(err => console.warn('SW registration failed:', err));
    });
}
