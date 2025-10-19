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
        "이글 유니온 채팅방": 'assets/icon/uss.png',        // Eagle Union
        "공용 채팅방": 'assets/icon/common.png',             // Common/Universal
        "템페스타 채팅방": 'assets/icon/mot.png',            // Tempesta
        "노스 유니온 채팅방": 'assets/icon/sn.png',          // Northern Parliament
        "이스트 글림 채팅방": 'assets/icon/roc.png',         // Dragon Empery
        "사르데냐 엠파이어 채팅방": 'assets/icon/rn.png',    // Sardegna Empire
        "메탈 블러드 채팅방": 'assets/icon/kms.png',         // Iron Blood
        "아이리스 채팅방": 'assets/icon/ff.png',             // Iris Libre
        "사쿠라 엠파이어 채팅방": 'assets/icon/ijn.png',     // Sakura Empire
        "로열 네이비 채팅방": 'assets/icon/hms.png'          // Royal Navy
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