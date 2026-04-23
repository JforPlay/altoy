/**
 * drive-sync.api.js
 * Google Drive API v3 wrappers for the sync file in appDataFolder.
 * All calls use the Bearer access token from drive-sync.auth.js.
 */

import { DRIVE_API_BASE, DRIVE_UPLOAD_BASE, SYNC_FILENAME } from './drive-sync.config.js';
import { getToken } from './drive-sync.auth.js';

function authHeader() {
    const token = getToken();
    if (!token) throw new Error('No access token');
    return { Authorization: `Bearer ${token}` };
}

async function handle(res, label) {
    if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`Drive API ${label} failed: ${res.status} ${text}`);
    }
    return res;
}

/**
 * Find altoy-sync.json in appDataFolder. Returns the file's metadata
 * ({ id, modifiedTime }) if present, or null if the file does not exist.
 */
export async function findSyncFile() {
    const url = new URL(`${DRIVE_API_BASE}/files`);
    url.searchParams.set('spaces', 'appDataFolder');
    url.searchParams.set('q', `name='${SYNC_FILENAME}' and trashed=false`);
    url.searchParams.set('fields', 'files(id, modifiedTime)');
    const res = await fetch(url, { headers: authHeader() });
    await handle(res, 'list');
    const data = await res.json();
    return data.files?.[0] ?? null;
}

/**
 * Get file metadata (id, modifiedTime) by file id.
 */
export async function getMetadata(fileId) {
    const url = `${DRIVE_API_BASE}/files/${fileId}?fields=id,modifiedTime`;
    const res = await fetch(url, { headers: authHeader() });
    await handle(res, 'metadata');
    return res.json();
}

/**
 * Download file content as parsed JSON.
 */
export async function getContent(fileId) {
    const url = `${DRIVE_API_BASE}/files/${fileId}?alt=media`;
    const res = await fetch(url, { headers: authHeader() });
    await handle(res, 'download');
    return res.json();
}

/**
 * Create a new sync file in appDataFolder. Returns the new file's
 * metadata ({ id, modifiedTime }).
 */
export async function createFile(content) {
    const boundary = '-------altoy-sync-' + Math.random().toString(36).slice(2);
    const metadata = { name: SYNC_FILENAME, parents: ['appDataFolder'] };
    const body =
        `--${boundary}\r\n` +
        'Content-Type: application/json; charset=UTF-8\r\n\r\n' +
        JSON.stringify(metadata) + '\r\n' +
        `--${boundary}\r\n` +
        'Content-Type: application/json; charset=UTF-8\r\n\r\n' +
        JSON.stringify(content) + '\r\n' +
        `--${boundary}--`;
    const url = `${DRIVE_UPLOAD_BASE}/files?uploadType=multipart&fields=id,modifiedTime`;
    const res = await fetch(url, {
        method: 'POST',
        headers: {
            ...authHeader(),
            'Content-Type': `multipart/related; boundary=${boundary}`,
        },
        body,
    });
    await handle(res, 'create');
    return res.json();
}

/**
 * Overwrite an existing file's content. Returns updated metadata.
 */
export async function updateFile(fileId, content) {
    const url = `${DRIVE_UPLOAD_BASE}/files/${fileId}?uploadType=media&fields=id,modifiedTime`;
    const res = await fetch(url, {
        method: 'PATCH',
        headers: {
            ...authHeader(),
            'Content-Type': 'application/json',
        },
        body: JSON.stringify(content),
    });
    await handle(res, 'update');
    return res.json();
}
