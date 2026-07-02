/**
 * main-story.js
 * Page entry for the Main Story viewer.
 * Configures the shared StoryViewer engine with main-story-specific data sources and wires DOMContentLoaded.
 */
import { setupFactionFilter, FACTION_NAMES } from './faction-filter.js';

document.addEventListener('DOMContentLoaded', () => {

    // 진영 필터 selection ([] = 전체); read by config.filterEvent below.
    let activeNations = [];

    /** Build the shared 진영 필터 dropdown from the loaded index's nation IDs. */
    function setupNationFilter(storylineData) {
        const button = document.getElementById('filter-button');
        const panel = document.getElementById('filter-panel');
        if (!button || !panel) return;

        const uniqueNations = new Map();
        Object.values(storylineData).forEach(event => {
            (event.shipnation || []).forEach(nationId => {
                if (!uniqueNations.has(nationId) && FACTION_NAMES[nationId]) {
                    uniqueNations.set(nationId, FACTION_NAMES[nationId]);
                }
            });
        });

        setupFactionFilter({
            button,
            panel,
            badge: document.getElementById('filter-badge'),
            options: [...uniqueNations.entries()].sort((a, b) => a[0] - b[0])
                .map(([id, name]) => ({ value: String(id), label: name })),
            onChange: (selected) => {
                activeNations = selected;
                window.StoryViewer.populateEventGrid(document.getElementById('search-bar')?.value || '');
            },
        });
    }

    const mainStoryConfig = {
        viewerType: 'main',

        // {namecode:N} placeholders are resolved at build time by the pipeline;
        // the engine's getActorInfo handles the rare leftovers tolerantly, so no
        // runtime name_code.json fetch (the old AzurLaneData ShareCfg source is
        // stale and put an external dependency in the init path).
        dataPaths: [
            'data/story-viewer/main_story_index.json',
            'data/story-viewer/shipgirl_data.json'
        ],

        // Path pattern for lazy-loading individual chapters ({id} is replaced with chapter ID)
        chapterDataPath: 'data/story-viewer/main_story_chapters/chapter_{id}.json',

        processLoadedData: (viewer, dataArray) => {
            viewer.storylineData = dataArray[0];
            viewer.shipgirlData = dataArray[1];
            setupNationFilter(viewer.storylineData);
        },

        // 진영 필터 predicate for the engine's default index grid.
        filterEvent: (event) => activeNations.length === 0
            || (event.shipnation || []).some(id => activeNations.includes(String(id))),

        getEventMemories: (eventData) => eventData?.memory_id,

        findMemory: (eventData, storyId) => eventData?.memory_id?.find(mem => mem.id == storyId),

        getMemoryStory: (memoryData) => memoryData?.story,

        getEventIconPath: (eventData) => `${StoryViewer.BASE_URL}memorystoryline/`,

        // Redirect events that live in the world-story viewer
        getEventLink: (eventData) => {
            const name = (eventData?.name || '').replace(/\s+/g, '');
            if (name.includes('대형작전')) {
                const prefix = window.location.pathname.split('/story-viewer/')[0];
                const normalizedPrefix = prefix.endsWith('/') && prefix.length > 1
                    ? prefix.slice(0, -1)
                    : prefix;
                return `${normalizedPrefix}/story-viewer/world-story/`;
            }
            return null;
        },
    };

    window.StoryViewer.init(mainStoryConfig);

});
