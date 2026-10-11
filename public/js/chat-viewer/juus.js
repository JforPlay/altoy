/**
 * juus.js
 * Page init for the Juustagram (Instagram-style) chat viewer. Wires ChatViewerEngine
 * with the external ship group ID source for @username display. Group-room avatars
 * and sticker art arrive in the data (`room_icon` / `sticker`, stamped by the pipeline).
 */
import { ChatViewerEngine } from './chat-viewer.engine.js';

document.addEventListener('DOMContentLoaded', () => {
    new ChatViewerEngine({
        dataUrl: 'data/chat-viewer/juus_chat_data.json',
        // @username handles beside character names. Local KR map built by
        // juustagram_process from activity_ins_ship_group_template (covers all
        // chat speakers) — replaces the old live CN AzurLaneData repo fetch.
        shipGroupIdUrl: 'data/juustagram_usernames.json',
        defaultDelay: 1300,
        initialDelay: 100
    });
});
