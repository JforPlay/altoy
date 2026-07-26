/**
 * Routes covered by the route-boot baseline.
 *
 * A ready signal must prove that the default route initialized successfully.
 * Keep selectors tied to durable page structure rather than transient text.
 *
 * Ready kinds:
 *   count       - N matching elements exist (a list/grid rendered)
 *   hidden      - the named element became hidden (a loading overlay cleared)
 *   event-count - repeatedly dispatch an event until N matching elements exist;
 *                 use only when successful initialization otherwise leaves the
 *                 document unchanged.
 *
 * The optional cutoff controls measurement independently:
 *   ready       - stop at the semantic ready signal (default)
 *   networkidle - keep collecting after ready until the network settles
 */
export const ROUTE_BOOT_TARGETS = Object.freeze([
    {
        key: 'FLEET_SIM',
        path: 'simulators/fleet-sim/',
        ready: {
            kind: 'hidden',
            selector: '#loading-overlay',
            description: 'initial loading overlay hidden',
        },
    },
    {
        key: 'SHIPGIRL_INFO',
        path: 'shipgirl/shipgirl-info/',
        ready: {
            kind: 'count',
            selector: '#shipgirls .shipgirl-card',
            minimum: 1,
            description: 'first ship card rendered',
        },
        // R11's 5.28 MB ship_info_data.json is started fire-and-forget during
        // loadData(), so it lands on either side of the first card render. A
        // `ready` cutoff makes this route's byte total a coin flip.
        cutoff: 'networkidle',
    },
    {
        key: 'ISLAND',
        path: 'island/',
        ready: {
            kind: 'count',
            selector: '#character-list .character-card',
            minimum: 1,
            description: 'default character list rendered',
        },
    },
    {
        key: 'EVENT_STORY',
        path: 'story-viewer/event-story/',
        ready: {
            kind: 'count',
            selector: '#event-grid .event-year-section',
            minimum: 1,
            description: 'event archive sections rendered',
        },
    },
    {
        key: 'SKIN_LIST',
        path: 'skin/skin-list-viewer/',
        ready: {
            kind: 'count',
            selector: '.skin-list-container .skin-box-link',
            minimum: 1,
            description: 'first skin-list chunk appended',
        },
    },
    {
        key: 'RESEARCH_TRACKER',
        path: 'shipgirl/research-tracker/',
        ready: {
            kind: 'count',
            selector: '#sidebar-content .rt-research-panel',
            minimum: 1,
            description: 'first faction panel rendered',
        },
    },
    // Package B routes (R1, R7, R13), added before their deferral work so the
    // before/after request sets stay comparable. Same cutoff rationale as R11
    // above.
    //
    // All three keep a semantic ready signal, then collect until network idle.
    // R1 is complete; retaining the network-idle cutoff proves the removed
    // equip-skin warmup was not merely delayed past readiness. R7 still targets
    // full map data that races the map_data_lite.json sidebar, and R13 still
    // targets expression data that initializes before a skin is selected.
    {
        key: 'EQUIP_SKIN',
        path: 'skin/equip-skin-viewer/',
        ready: {
            kind: 'count',
            selector: '#theme-list .esv-theme-item',
            minimum: 1,
            description: 'first equipment-skin theme rendered',
        },
        cutoff: 'networkidle',
    },
    {
        key: 'MAP_VIEWER',
        path: 'map/map-viewer/',
        ready: {
            kind: 'count',
            selector: '#mapSidebar .sidebar-item',
            minimum: 1,
            description: 'default map sidebar rendered',
        },
        cutoff: 'networkidle',
    },
    {
        key: 'SKIN_DETAIL',
        path: 'skin/skin-detail-viewer/',
        ready: {
            kind: 'event-count',
            trigger: '#character-search-input',
            event: 'focus',
            selector: '#character-dropdown-content [role="option"]',
            minimum: 1,
            description: 'initialized character search renders options',
        },
        cutoff: 'networkidle',
    },
]);

export const GLOBAL_DOCUMENT_MODULES = Object.freeze(new Set([
    '/altoy/js/utils.js',
    '/altoy/js/global.script.js',
    '/altoy/js/global-search.js',
    '/altoy/js/global.init.js',
]));
