/**
 * Routes covered by the first route-boot baseline.
 *
 * A ready signal must represent the first useful default view. Keep these
 * selectors tied to durable page structure rather than transient text.
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
]);

export const GLOBAL_DOCUMENT_MODULES = Object.freeze(new Set([
    '/altoy/js/utils.js',
    '/altoy/js/global.script.js',
    '/altoy/js/global-search.js',
    '/altoy/js/global.init.js',
]));
