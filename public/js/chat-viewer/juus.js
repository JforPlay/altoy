import { ChatViewerEngine } from './chat-viewer.engine.js';
import { resolveUrl } from '../utils.js';
/**
 * Juustagram Chat Viewer Configuration
 * Initializes the chat viewer for Instagram-style group chats
 */
document.addEventListener('DOMContentLoaded', () => {
    /**
     * Icon mappings for faction group chats
     * Maps Korean group chat names to their respective faction icons
     */
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
        // Data source for Juustagram conversations
        dataUrl: 'data/chat-viewer/juus_chat_data.json',

        // External API for shipgirl usernames/handles
        shipGroupIdUrl: 'https://raw.githubusercontent.com/AzurLaneTools/AzurLaneData/main/CN/ShareCfg/activity_ins_ship_group_template.json',

        // Provide group chat icons for display
        groupChatIcons: GROUP_CHAT_ICONS,

        // Timing configuration (ms)
        defaultDelay: 1300,   // Delay between regular messages
        initialDelay: 100     // Initial delay before first message
    });
});