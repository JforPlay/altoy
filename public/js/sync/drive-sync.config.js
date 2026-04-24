/**
 * drive-sync.config.js
 * Configuration constants for Google Drive sync: OAuth client, scope,
 * Drive API endpoints, sync file metadata, cooldown, and localStorage keys.
 *
 * The Client ID is a PUBLIC value — safe to commit. Authorization is
 * pinned via Authorized JavaScript Origins in Google Cloud Console.
 */

export const OAUTH_CLIENT_ID = '876344276905-vjahr2hjf5nmon4km7fmsid7fpuv2kvt.apps.googleusercontent.com';

export const OAUTH_SCOPE = 'https://www.googleapis.com/auth/drive.appdata';

export const DRIVE_API_BASE = 'https://www.googleapis.com/drive/v3';
export const DRIVE_UPLOAD_BASE = 'https://www.googleapis.com/upload/drive/v3';

export const SYNC_FILENAME = 'altoy-sync.json';
export const SCHEMA_VERSION = 1;

export const COOLDOWN_MS = 60_000;

export const STORAGE_KEYS = {
    localDirty: 'altoy:sync:localDirty',
    lastCloudModified: 'altoy:sync:lastCloudModified',
    lastSyncedAt: 'altoy:sync:lastSyncedAt',
    beta: 'altoy:sync:beta',
    everSignedIn: 'altoy:sync:everSignedIn',
};
