/**
 * pages.catalog.js
 * Single source of truth for ALtoy's internal page metadata.
 *
 * Used by:
 *  - global.script.js  → derives the LINKS map (so {data-link} anchors and
 *                        page scripts that import LINKS keep working).
 *  - global-search.js  → drives the global search modal (Ctrl+K) results.
 *  - (future)            Layout.astro nav, homepage cards.
 *
 * Each entry:
 *  - key         SCREAMING_SNAKE_CASE identifier exposed via LINKS[key]
 *  - path        Site-relative URL (no base prefix, no leading slash)
 *  - name        Korean display name shown in nav and search
 *  - description Korean tagline (one short line) for search/cards
 *  - icon        Material Symbols glyph name (matches the layout nav)
 *  - category    High-level grouping (drives the search section)
 *
 * When adding a new page: add an entry here. LINKS auto-derives.
 * The static layout nav in Layout.astro still has to be updated by hand —
 * a future pass will data-drive the nav from this catalog too.
 */

export const PAGE_CATALOG = [
    // ===== Shipgirl =====
    { key: 'SHIPGIRL_INFO',     path: 'shipgirl/shipgirl-info/',     name: '함순이 DB',           description: '함순이 상세 정보',                     icon: 'database',     category: '함순이' },
    { key: 'SHIPGIRL_BUILD',    path: 'shipgirl/shipgirl-build-sim/', name: '함순이 건조확률 보기', description: '배너별 건조확률 상세확인',              icon: 'casino',       category: '함순이' },
    { key: 'SHIPGIRL_BIRTHDAY', path: 'shipgirl/shipgirl-birthday/', name: '함순이 생일',         description: '함순이 생일 확인하기',                  icon: 'cake',         category: '함순이' },
    { key: 'SHIPGIRL_STATS',    path: 'shipgirl/shipgirl-stats/',    name: '함순이 통계',         description: '함순이/스킨 통계 및 비교',              icon: 'bar_chart',    category: '함순이' },
    { key: 'SHIPGIRL_TRACKER',  path: 'shipgirl/shipgirl-tracker/',  name: '함순이 육성트래커',   description: '기술/진영점수 계산',                    icon: 'calculate',    category: '함순이' },
    { key: 'RESEARCH_TRACKER',  path: 'shipgirl/research-tracker/',  name: '개발함 트래커',       description: '상시 획득 가능 함순이 진영점수 트래커', icon: 'science',      category: '함순이' },

    // ===== Skin =====
    { key: 'SKIN_DETAIL',     path: 'skin/skin-detail-viewer/', name: '일러/대사',                description: '선택된 스킨의 일러스트 및 대사보기/재생',      icon: 'image',         category: '스킨' },
    { key: 'SKIN_LIST',       path: 'skin/skin-list-viewer/',   name: '스킨 모음집',              description: '여러 스킨들을 필터링/판매중 정보와 같이보기', icon: 'photo_library', category: '스킨' },
    { key: 'SKIN_POLL',       path: 'skin/skin-poll/',          name: '스킨 투표',                description: '벽챈 스킨선호도 실시간으로 보기',              icon: 'poll',          category: '스킨' },
    { key: 'SKIN_EXPRESSION', path: 'skin/expression-viewer/',  name: '기타 캐릭터 일러 뷰어',    description: '적 및 특수상황에서의 함순이들의 표정 일러스트 뷰어', icon: 'face',     category: '스킨' },
    { key: 'SKIN_SD',         path: 'skin/skin-sd-viewer/',     name: '설비스킨',                 description: '장비(설비) 스킨 뷰어',                          icon: 'construction',  category: '스킨' },
    { key: 'EQUIP_SKIN',      path: 'skin/equip-skin-viewer/',  name: '장비 스킨 뷰어',           description: '장비 스킨 테마별 미리보기',                     icon: 'palette',       category: '스킨' },

    // ===== Equipment =====
    { key: 'EQUIP_VIEWER',  path: 'equip/equip-viewer/',  name: '장비 DB',  description: '장비 검색, 상세정보, 비교', icon: 'settings', category: '장비' },
    { key: 'EQUIP_UPGRADE', path: 'equip/equip-upgrade/', name: '장비 연구', description: '기어 랩 연구 트리',         icon: 'science',  category: '장비' },

    // ===== Tools / Map / Island =====
    { key: 'MAP_VIEWER',     path: 'map/map-viewer/', name: '해역 정보',          description: '해역 맵, 적 함대, 드롭 정보',                       icon: 'map',         category: '도구' },
    { key: 'ISLAND',         path: 'island/',         name: '아일랜드 계획 관리', description: '벽타듀 캐릭터, 기술, 퀘스트 관리',                  icon: 'forest',      category: '도구' },
    { key: 'ISLAND_MISC',    path: 'island-misc/',    name: '벽뜌땨 잡동사니',    description: '아일랜드 기타 에셋 모아보기',                       icon: 'collections', category: '도구' },
    { key: 'EVENT_TIMELINE', path: 'event-timeline/', name: '룽섭 일정보기',      description: '과거 룽섭 이벤트 일정들을 검색과 함께 확인',        icon: 'event',       category: '도구' },

    // ===== Simulators =====
    { key: 'FLEET_SIM',    path: 'simulators/fleet-sim/',    name: '편성 시뮬레이터', description: '함대 편성, 스탯, 장전 시간', icon: 'groups',         category: '시뮬레이터' },
    { key: 'SIM_WEAPON',   path: 'simulators/sim-weapon/',   name: '탄막 시뮬레이터', description: '각종 스킬의 탄막 구경하기',  icon: 'rocket_launch',  category: '시뮬레이터' },
    { key: 'SIM_AIRCRAFT', path: 'simulators/sim-aircraft/', name: '함재기 시뮬레이터', description: '함재기 비행 및 무장 시뮬레이션', icon: 'flight',     category: '시뮬레이터' },

    // ===== Story =====
    { key: 'MAIN_STORY',      path: 'story-viewer/main-story/',      name: '메인스토리',          description: '메인스토리 뷰어',                       icon: 'menu_book',     category: '스토리' },
    { key: 'MAIN_STORYLINE',  path: 'story-viewer/main-storyline/',  name: '메인스토리 타임라인', description: '타임라인으로 스토리 흐름보기',          icon: 'timeline',      category: '스토리' },
    { key: 'WORLD_STORY',     path: 'story-viewer/world-story/',     name: '대작전스토리',        description: '대작전스토리 뷰어',                     icon: 'public',        category: '스토리' },
    { key: 'WORLD_FILE',      path: 'story-viewer/world-file/',      name: '대작전 파일',         description: '파일해역에서 해금되는 파일들 모아보기', icon: 'folder',        category: '스토리' },
    { key: 'TB_STORY',        path: 'story-viewer/tb-story/',        name: 'TB 키우기',           description: '통베 회상/수집/엔딩 보기',              icon: 'woman',         category: '스토리' },
    { key: 'NAVI_STORY',      path: 'story-viewer/navi-story/',      name: '네비 키우기',         description: '네비게이터 회상/수집/엔딩 보기',        icon: 'girl',          category: '스토리' },
    { key: 'LORA_STORY',      path: 'story-viewer/lora-story/',      name: '로라 키우기',         description: '스캐빈저 회상/수집/엔딩 보기',          icon: 'child_care',    category: '스토리' },
    { key: 'SECRETARY_STORY', path: 'story-viewer/secretary-story/', name: '비서함 스토리',       description: '모항 비서함 클릭시 발생하는 스토리 모음', icon: 'diagnosis',   category: '스토리' },
    { key: 'HOF',             path: 'story-viewer/hof/',             name: '명예의 전당',         description: '룽섭 명전 스토리들 모음',               icon: 'emoji_events',  category: '스토리' },

    // ===== In-game / Social =====
    { key: 'JUUSTAGRAM',          path: 'juustagram/',                name: 'JUUSTAGRAM',  description: '쥬스타그램을 글/댓작성자 검색과 같이보기', icon: 'photo_camera', category: '인게임' },
    { key: 'CHAT_JUUS',           path: 'chat-viewer/juus/',          name: 'JUUS 보기',   description: '대화형뷰어로 함순이 쥬톡보기',           icon: 'chat',         category: '인게임' },
    { key: 'CHAT_JUUS_HOT_ISSUE', path: 'chat-viewer/juus-hot-issue/', name: '쥬쥬 핫 이슈', description: '쥬스타그램 공식 계정 게시글',           icon: 'trending_up',  category: '인게임' },
    { key: 'CHAT_DORM3D',         path: 'chat-viewer/dorm3d/',        name: '3D숙소 JUUS', description: '대화형뷰어로 3D숙소 쥬톡보기',           icon: 'view_in_ar',   category: '인게임' },

    // ===== In-game illustrations =====
    { key: 'LOADINGBG',    path: 'misc/loadingbg/',    name: '로딩일러',  description: '인게임 로딩일러스트 모음', icon: 'wallpaper',    category: '인게임' },
    { key: 'COMIC_VIEWER', path: 'misc/comic-viewer/', name: '만화 보기', description: '인게임 만화모음',          icon: 'auto_stories', category: '인게임' },
    { key: 'GALLERYPIC',   path: 'misc/gallerypic/',   name: '삽화 보기', description: '인게임 삽화모음',          icon: 'collections',  category: '인게임' },

    // ===== Other in-game =====
    { key: 'BGM_PLAYER',  path: 'misc/bgm-player/',  name: 'BGM 듣기',     description: '배경음악 플레이어',                  icon: 'music_note', category: '인게임' },
    { key: 'VALENTINE',   path: 'misc/valentine/',   name: '발렌타인 편지', description: '함순이별 발렌타인 편지 모음',       icon: 'mail',        category: '인게임' },
    { key: 'DORM_VIEWER', path: 'dorm/dorm-viewer/', name: '숙소 가구',     description: '가구 뷰어 & 배치 시뮬',              icon: 'chair',       category: '인게임' },
];
