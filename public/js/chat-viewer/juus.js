/**
 * juus.js
 * Page init for the Juustagram (Instagram-style) chat viewer.
 * Provides faction group chat icon mappings and wires ChatViewerEngine
 * with the external ship group ID source for @username display.
 */
import { ChatViewerEngine } from './chat-viewer.engine.js';
import { resolveUrl } from '../utils.js';

document.addEventListener('DOMContentLoaded', () => {
    // Faction group chats use their nation icons instead of a character portrait.
    const GROUP_CHAT_ICONS = {
        "이글 유니온 채팅방": resolveUrl('assets/icon/uss.webp'),
        "공용 채팅방": resolveUrl('assets/icon/common.webp'),
        "템페스타 채팅방": resolveUrl('assets/icon/mot.webp'),
        "노스 유니온 채팅방": resolveUrl('assets/icon/sn.webp'),
        "이스트 글림 채팅방": resolveUrl('assets/icon/roc.webp'),
        "사르데냐 엠파이어 채팅방": resolveUrl('assets/icon/rn.webp'),
        "메탈 블러드 채팅방": resolveUrl('assets/icon/kms.webp'),
        "아이리스 채팅방": resolveUrl('assets/icon/ff.webp'),
        "사쿠라 엠파이어 채팅방": resolveUrl('assets/icon/ijn.webp'),
        "로열 네이비 채팅방": resolveUrl('assets/icon/hms.webp')
    };

    new ChatViewerEngine({
        dataUrl: 'data/chat-viewer/juus_chat_data.json',
        // @username handles beside character names. Local KR map built by
        // juustagram_process from activity_ins_ship_group_template (covers all
        // chat speakers) — replaces the old live CN AzurLaneData repo fetch.
        shipGroupIdUrl: 'data/juustagram_usernames.json',
        groupChatIcons: GROUP_CHAT_ICONS,
        defaultDelay: 1300,
        initialDelay: 100
    });
});