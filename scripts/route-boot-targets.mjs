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
 * A ready signal may include a `storage` seed for an existing persisted route
 * state that must be present before application scripts execute.
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
        // Keep network idle after R11 so the report proves the removed full-data
        // and skill warmups were deferred to first use, not moved behind a timer
        // that fires after the first card renders.
        cutoff: 'networkidle',
    },
    {
        key: 'SHIPGIRL_STATS',
        path: 'shipgirl/shipgirl-stats/',
        ready: {
            kind: 'count',
            selector: '#shipTableBody tr',
            minimum: 1,
            description: 'first ship ranking rows rendered',
        },
        // R12's before-state began skin JSON in the ship-data Promise.all() and
        // emitted the treemap plugin eagerly. Retaining network idle proves the
        // completed boundary removes both from default boot instead of merely
        // delaying them past the first rendered rows.
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
        key: 'ISLAND_RESTAURANT',
        path: 'island/',
        ready: {
            kind: 'count',
            selector: '#restaurant-tabs .restaurant-tab',
            minimum: 1,
            description: 'saved restaurant tab restored and controls rendered',
            storage: {
                key: 'island-active-tab',
                value: 'restaurant',
            },
        },
        // R21's before-state statically imports the planner with the normal
        // restaurant view. Network idle proves the later first-use boundary
        // removes it rather than merely delaying it past the rendered cards.
        cutoff: 'networkidle',
    },
    {
        key: 'PRIVACY',
        path: 'privacy/',
        ready: {
            kind: 'count',
            selector: '.privacy-page h1',
            minimum: 1,
            description: 'static privacy content rendered',
        },
        // R6's before-state imports the complete Drive Sync stack on
        // DOMContentLoaded. Network idle captures that global work even though
        // this route's static content is ready first.
        cutoff: 'networkidle',
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
    // R1, R7, and R13 are complete; retaining the network-idle cutoff proves
    // their removed warmups were not merely delayed past readiness. Skin-detail
    // expression data must remain absent until a skin is actually selected.
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
