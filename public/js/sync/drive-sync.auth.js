/**
 * drive-sync.auth.js
 * Google Identity Services (GIS) token acquisition for Drive sync.
 * Access token lives in a module-scoped variable — never persisted.
 */

import { OAUTH_CLIENT_ID, OAUTH_SCOPE, STORAGE_KEYS } from './drive-sync.config.js';

let accessToken = null;
let tokenClient = null;

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

export function requestToken({ silent = false } = {}) {
    return new Promise((resolve, reject) => {
        try {
            const client = initTokenClient();
            client.callback = (response) => {
                if (response.error) {
                    reject(new Error(response.error));
                    return;
                }
                accessToken = response.access_token;
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
    localStorage.removeItem(STORAGE_KEYS.lastCloudModified);
    localStorage.removeItem(STORAGE_KEYS.lastSyncedAt);
}
