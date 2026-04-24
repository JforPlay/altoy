/**
 * drive-sync.engine.js
 * Four-case sync algorithm. Compares local dirty flag vs remote
 * modified time, dispatches to upload / download / in-sync / conflict.
 * Caller (UI module) handles conflict by showing a modal and calling
 * resolveConflict() with the user's choice.
 */

import { SYNCED_KEYS, getStorageItem } from '../utils.js';
import { STORAGE_KEYS, SCHEMA_VERSION } from './drive-sync.config.js';
import { hasToken, requestToken } from './drive-sync.auth.js';
import { findSyncFile, getContent, createFile, updateFile } from './drive-sync.api.js';

export const SYNC_OUTCOMES = {
    IN_SYNC: 'in-sync',
    UPLOADED: 'uploaded',
    DOWNLOADED: 'downloaded',
    CONFLICT: 'conflict',
};

/**
 * Collect current values of all synced keys from localStorage.
 * Missing keys are omitted (not stored as null).
 */
function collectLocalData() {
    const data = {};
    for (const key of SYNCED_KEYS) {
        const raw = localStorage.getItem(key);
        if (raw !== null) data[key] = raw;
    }
    return data;
}

/**
 * Apply a remote data map to localStorage and fire storage events
 * so open tabs (shipgirl-tracker, research-tracker) refresh.
 *
 * Removes any currently-set synced keys that are NOT in the remote
 * payload — required for "delete propagation" to work correctly.
 *
 * Writes only keys in SYNCED_KEYS with string values. Entries outside
 * the allowlist or with non-string values are dropped, so a malformed
 * import file can't overwrite unrelated localStorage keys.
 */
function applyRemoteData(data) {
    // Browsers only fire 'storage' events in OTHER tabs, not the one making
    // the change. Dispatch manually so listeners in THIS tab (tracker pages)
    // also react when we pull from Drive.
    for (const key of SYNCED_KEYS) {
        if (!(key in data) && localStorage.getItem(key) !== null) {
            const oldValue = localStorage.getItem(key);
            localStorage.removeItem(key);
            window.dispatchEvent(new StorageEvent('storage', {
                key, oldValue, newValue: null, storageArea: localStorage,
            }));
        }
    }
    for (const [key, value] of Object.entries(data)) {
        if (!SYNCED_KEYS.has(key)) continue;
        if (typeof value !== 'string') continue;
        const oldValue = localStorage.getItem(key);
        if (oldValue !== value) {
            localStorage.setItem(key, value);
            window.dispatchEvent(new StorageEvent('storage', {
                key, oldValue, newValue: value, storageArea: localStorage,
            }));
        }
    }
}

function buildPayload(localData) {
    return {
        schemaVersion: SCHEMA_VERSION,
        updatedAt: Date.now(),
        source: 'altoy-web',
        data: localData,
    };
}

function markSynced(cloudModified) {
    if (cloudModified) {
        localStorage.setItem(STORAGE_KEYS.lastCloudModified, cloudModified);
    }
    localStorage.setItem(STORAGE_KEYS.lastSyncedAt, String(Date.now()));
    localStorage.removeItem(STORAGE_KEYS.localDirty);
    localStorage.removeItem(STORAGE_KEYS.localDirtyAt);
}

async function doUpload(existingFileId) {
    const payload = buildPayload(collectLocalData());
    const result = existingFileId
        ? await updateFile(existingFileId, payload)
        : await createFile(payload);
    markSynced(result.modifiedTime);
    return SYNC_OUTCOMES.UPLOADED;
}

async function doDownload(fileId, modifiedTime) {
    const content = await getContent(fileId);
    applyRemoteData(content.data || {});
    markSynced(modifiedTime);
    return SYNC_OUTCOMES.DOWNLOADED;
}

/**
 * Main entry. Acquires token if needed, evaluates the four cases,
 * and either executes the action or returns a CONFLICT state that
 * the UI resolves by calling resolveConflict().
 */
export async function runSync() {
    if (!hasToken()) {
        // If user has signed in before on this device, request silently —
        // GIS restores the token without a popup when Google session is
        // valid, and falls back to a popup triggered by this user click if
        // needed (user gesture means the popup isn't blocked). First-time
        // sign-in uses the default consent flow.
        const wasSignedIn = getStorageItem(STORAGE_KEYS.everSignedIn, '') === '1';
        await requestToken({ silent: wasSignedIn });
    }

    const file = await findSyncFile();
    const cloudModified = file?.modifiedTime ?? null;
    const lastSynced = localStorage.getItem(STORAGE_KEYS.lastCloudModified);

    const localChanged = localStorage.getItem(STORAGE_KEYS.localDirty) === '1';
    const remoteChanged = cloudModified !== lastSynced;
    const remoteEmpty = file === null;

    if (!localChanged && !remoteChanged) {
        // Update lastSyncedAt so the popover's "마지막 동기화" reflects
        // "last time the user clicked Sync", not "last data exchange".
        localStorage.setItem(STORAGE_KEYS.lastSyncedAt, String(Date.now()));
        return { outcome: SYNC_OUTCOMES.IN_SYNC };
    }
    if (localChanged && !remoteChanged) {
        return { outcome: await doUpload(file?.id) };
    }
    if (!localChanged && remoteChanged && !remoteEmpty) {
        return { outcome: await doDownload(file.id, cloudModified) };
    }
    if (localChanged && remoteEmpty) {
        // No conflict — local has edits, cloud file doesn't exist yet
        return { outcome: await doUpload(null) };
    }
    // Both changed and remote exists — genuine conflict
    const cloudContent = await getContent(file.id);
    return {
        outcome: SYNC_OUTCOMES.CONFLICT,
        localData: collectLocalData(),
        cloudData: cloudContent.data || {},
        cloudModifiedTime: cloudModified,
        cloudFileId: file.id,
    };
}

/**
 * Build a payload of current local data, ready to be written to a JSON file.
 * Uses the same format Drive sync stores so the resulting file is importable
 * back and interoperable with altoy-sync.json downloaded from Drive.
 */
export function exportPayload() {
    return buildPayload(collectLocalData());
}

/**
 * Apply an imported payload to localStorage. Validates schema; throws on
 * malformed or future-schema files. Marks localDirty so the next Drive sync
 * pushes the imported data up.
 */
export function importPayload(payload) {
    if (!payload || typeof payload !== 'object') {
        throw new Error('Invalid payload');
    }
    if (typeof payload.schemaVersion !== 'number') {
        throw new Error('Invalid file format (missing schemaVersion)');
    }
    if (payload.schemaVersion > SCHEMA_VERSION) {
        throw new Error(`File requires a newer ALtoy version (schema ${payload.schemaVersion})`);
    }
    if (!payload.data || typeof payload.data !== 'object') {
        throw new Error('Invalid data payload');
    }
    applyRemoteData(payload.data);
    localStorage.setItem(STORAGE_KEYS.localDirty, '1');
    localStorage.setItem(STORAGE_KEYS.localDirtyAt, String(Date.now()));
}

/**
 * Returns true if the user has any synced-key data in localStorage.
 * Used to decide whether an import will overwrite existing progress.
 */
export function hasLocalData() {
    return Object.keys(collectLocalData()).length > 0;
}

/**
 * Apply the user's conflict resolution. `choice` is one of:
 * 'keep-local' — upload local to Drive (overwrites cloud)
 * 'keep-cloud' — download cloud to localStorage (overwrites local)
 * 'cancel' — no-op, leaves both sides unchanged
 */
export async function resolveConflict(choice, conflictState) {
    if (choice === 'keep-local') {
        return { outcome: await doUpload(conflictState.cloudFileId) };
    }
    if (choice === 'keep-cloud') {
        applyRemoteData(conflictState.cloudData);
        markSynced(conflictState.cloudModifiedTime);
        return { outcome: SYNC_OUTCOMES.DOWNLOADED };
    }
    // 'cancel' — no state change. Return IN_SYNC so UI proceeds to cooldown
    // without a follow-up action. The UI knows it passed 'cancel' and can
    // show a neutral toast (or none) rather than "Already in sync".
    return { outcome: SYNC_OUTCOMES.IN_SYNC };
}
