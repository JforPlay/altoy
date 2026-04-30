/**
 * drive-sync.auth.js
 * Google Identity Services (GIS) token acquisition for Drive sync.
 * Access token is cached in sessionStorage for the tab's lifetime so
 * page navigations don't trigger the Google account chooser popup every
 * time. Tokens expire naturally after ~1 hour; sessionStorage evaporates
 * on tab close.
 */

import { OAUTH_CLIENT_ID, OAUTH_SCOPE, STORAGE_KEYS } from './drive-sync.config.js';

// Separate sessionStorage keys (not in STORAGE_KEYS which is localStorage)
const SESSION_TOKEN_KEY = 'altoy:sync:token';
const SESSION_EXPIRY_KEY = 'altoy:sync:tokenExpiry';
const EXPIRY_SAFETY_MS = 60_000;  // Treat tokens as expired 1 min early

let accessToken = loadTokenFromSession();
let tokenClient = null;

function loadTokenFromSession() {
    try {
        const stored = sessionStorage.getItem(SESSION_TOKEN_KEY);
        const expiry = Number(sessionStorage.getItem(SESSION_EXPIRY_KEY) || 0);
        if (stored && Date.now() < expiry - EXPIRY_SAFETY_MS) return stored;
        // Expired or missing — clean up if needed
        if (stored) {
            sessionStorage.removeItem(SESSION_TOKEN_KEY);
            sessionStorage.removeItem(SESSION_EXPIRY_KEY);
        }
    } catch { /* sessionStorage unavailable */ }
    return null;
}

function persistToken(token, expiresInSec) {
    try {
        sessionStorage.setItem(SESSION_TOKEN_KEY, token);
        if (expiresInSec) {
            sessionStorage.setItem(SESSION_EXPIRY_KEY, String(Date.now() + expiresInSec * 1000));
        }
    } catch { /* sessionStorage unavailable — token stays in memory only */ }
}

function clearPersistedToken() {
    try {
        sessionStorage.removeItem(SESSION_TOKEN_KEY);
        sessionStorage.removeItem(SESSION_EXPIRY_KEY);
    } catch { /* ignore */ }
}

// GIS is ~30KB and only needed when the user actually signs in. Layout.astro no
// longer ships it eagerly — we load it on demand here so other pages don't pay
// the cost. The promise is cached so repeat calls during a session share one load.
let gisLoadPromise = null;

function loadGisIfNeeded() {
    if (typeof google !== 'undefined' && google.accounts?.oauth2) {
        return Promise.resolve();
    }
    if (gisLoadPromise) return gisLoadPromise;
    gisLoadPromise = new Promise((resolve, reject) => {
        const existing = document.querySelector('script[src="https://accounts.google.com/gsi/client"]');
        if (existing) {
            existing.addEventListener('load', () => resolve(), { once: true });
            existing.addEventListener('error', () => reject(new Error('GIS load failed')), { once: true });
            return;
        }
        const script = document.createElement('script');
        script.src = 'https://accounts.google.com/gsi/client';
        script.async = true;
        script.defer = true;
        script.addEventListener('load', () => resolve(), { once: true });
        script.addEventListener('error', () => reject(new Error('GIS load failed')), { once: true });
        document.head.appendChild(script);
    });
    return gisLoadPromise;
}

function initTokenClient() {
    if (tokenClient) return tokenClient;
    if (typeof google === 'undefined' || !google.accounts?.oauth2) {
        throw new Error('GIS library not loaded yet');
    }
    tokenClient = google.accounts.oauth2.initTokenClient({
        client_id: OAUTH_CLIENT_ID,
        scope: OAUTH_SCOPE,
        callback: () => { /* overwritten per-request */ },
    });
    return tokenClient;
}

export function hasToken() {
    return accessToken !== null;
}

export function getToken() {
    return accessToken;
}

export async function requestToken({ silent = false } = {}) {
    await loadGisIfNeeded();
    return new Promise((resolve, reject) => {
        try {
            const client = initTokenClient();
            client.callback = (response) => {
                if (response.error) {
                    reject(new Error(response.error));
                    return;
                }
                accessToken = response.access_token;
                persistToken(accessToken, response.expires_in);
                localStorage.setItem(STORAGE_KEYS.everSignedIn, '1');
                resolve(accessToken);
            };
            client.requestAccessToken({ prompt: silent ? '' : 'consent' });
        } catch (e) {
            reject(e);
        }
    });
}

export function unlink() {
    accessToken = null;
    clearPersistedToken();
    localStorage.removeItem(STORAGE_KEYS.lastCloudModified);
    localStorage.removeItem(STORAGE_KEYS.lastSyncedAt);
    localStorage.removeItem(STORAGE_KEYS.everSignedIn);
}
