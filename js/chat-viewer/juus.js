document.addEventListener('DOMContentLoaded', () => {
    const GROUP_CHAT_ICONS = {
        "이글 유니온 채팅방": 'assets/icon/uss.png',
        "공용 채팅방": 'assets/icon/common.png',
        "템페스타 채팅방": 'assets/icon/mot.png',
        "노스 유니온 채팅방": 'assets/icon/sn.png',
        "이스트 글림 채팅방": 'assets/icon/roc.png',
        "사르데냐 엠파이어 채팅방": 'assets/icon/rn.png',
        "메탈 블러드 채팅방": 'assets/icon/kms.png',
        "아이리스 채팅방": 'assets/icon/ff.png',
        "사쿠라 엠파이어 채팅방": 'assets/icon/ijn.png',
        "로열 네이비 채팅방": 'assets/icon/hms.png'
    };

    new ChatViewerEngine({
        dataUrl: 'data/chat-viewer/juus_chat_data.json',
        shipGroupIdUrl: 'https://raw.githubusercontent.com/AzurLaneTools/AzurLaneData/main/CN/ShareCfg/activity_ins_ship_group_template.json',
        groupChatIcons: GROUP_CHAT_ICONS,
        defaultDelay: 1300,
        initialDelay: 100
    });
});