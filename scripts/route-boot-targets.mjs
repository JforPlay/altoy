/**
 * Routes covered by the route-boot baseline.
 *
 * A ready signal must represent the first useful default view. Keep these
 * selectors tied to durable page structure rather than transient text.
 *
 * Ready kinds:
 *   count  — N matching elements exist (a list/grid rendered)
 *   hidden — the named element became hidden (a loading overlay cleared)
 *   settle — no DOM signal exists because a successful default boot renders
 *            nothing; fall back to network idle. Only use when the page's
 *            success path genuinely leaves the document unchanged, as on
 *            skin-detail-viewer, whose default view only enables a search box.
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
    // Package B routes (R1, R7, R13), measured before their deferral work so the
    // before/after request sets are comparable.
    //
    // All three use 'settle' deliberately. Each R-item targets an unconditional
    // load that races the first render instead of blocking it, so a render signal
    // measures the wrong thing: the map sidebar paints from map_data_lite.json
    // while the 9.87 MB full map is still in flight, and a theme-list signal cuts
    // off part of the equip-skin warmup. Network idle on the default route is the
    // number these fixes actually move.
    {
        key: 'EQUIP_SKIN',
        path: 'skin/equip-skin-viewer/',
        ready: {
            kind: 'settle',
            description: 'network idle on the no-selection default view',
        },
    },
    {
        key: 'MAP_VIEWER',
        path: 'map/map-viewer/',
        ready: {
            kind: 'settle',
            description: 'network idle on the no-map-selected default view',
        },
    },
    {
        key: 'SKIN_DETAIL',
        path: 'skin/skin-detail-viewer/',
        ready: {
            kind: 'settle',
            description: 'network idle on the no-selection default view',
        },
    },
]);

export const GLOBAL_DOCUMENT_MODULES = Object.freeze(new Set([
    '/altoy/js/utils.js',
    '/altoy/js/global.script.js',
    '/altoy/js/global-search.js',
    '/altoy/js/global.init.js',
]));
