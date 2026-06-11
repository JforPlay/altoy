/**
 * main-story.js
 * Page entry for the Main Story viewer.
 * Configures the shared StoryViewer engine with main-story-specific data sources and wires DOMContentLoaded.
 */
document.addEventListener('DOMContentLoaded', () => {

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
        },

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
