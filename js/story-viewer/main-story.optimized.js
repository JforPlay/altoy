/**
 * main-story-viewer.script.js (Optimized)
 * ---------------------------------------
 * Configures the StoryViewer to use lazy-loaded chunked data.
 * Loads 'main_story_lite.json' for the menu, and fetches specific
 * chapter JSONs only when a story is selected.
 */
document.addEventListener('DOMContentLoaded', () => {

    const mainStoryConfig = {
        viewerType: 'main',
        
        dataPaths: [
            'data/story-viewer/main_story_lite.json', // Load the lightweight index
            'data/story-viewer/shipgirl_data.json',
            'https://raw.githubusercontent.com/AzurLaneTools/AzurLaneData/refs/heads/main/KR/ShareCfg/name_code.json'
        ],

        processLoadedData: (viewer, dataArray) => {
            viewer.storylineData = dataArray[0];
            viewer.shipgirlData = dataArray[1];
            viewer.nameCodeData = dataArray[2];
            
            // Optimization: Pre-cache chapter data map to avoid re-fetching same file
            viewer.chapterCache = {}; 
        },
        
        getEventMemories: (eventData) => eventData?.memory_id,
        
        findMemory: (eventData, storyId) => eventData?.memory_id?.find(mem => mem.id == storyId),

        /**
         * Async getter for story data.
         * If the memory object already has the story data, return it.
         * If it's a lite object, fetch the chunk file for the parent event.
         */
        getMemoryStory: async (memoryData) => {
            // 1. If story data is already present (legacy or already loaded)
            if (memoryData.story) return memoryData.story;

            // 2. Determine parent event ID to find the chunk file
            // We need to find which event this memory belongs to. 
            // Since `memoryData` is just the object, we rely on the Viewer state or we iterate.
            // Fortunately, `StoryViewer.currentEventId` is set before `startStory` is called.
            const eventId = window.StoryViewer.currentEventId;
            const eventData = window.StoryViewer.storylineData[eventId];
            
            if (!eventData || !eventData.chunk_file) {
                console.error("No chunk file definition found for event", eventId);
                return null;
            }

            const chunkUrl = `data/story-viewer/chapters/${eventData.chunk_file}`;

            // 3. Check Cache
            if (!window.StoryViewer.chapterCache[eventId]) {
                console.log(`[StoryViewer] Lazy loading chapter chunk: ${chunkUrl}`);
                try {
                    const response = await fetch(chunkUrl);
                    if (!response.ok) throw new Error(`HTTP ${response.status}`);
                    const chunkData = await response.json();
                    window.StoryViewer.chapterCache[eventId] = chunkData;
                } catch (e) {
                    console.error("Failed to load chapter chunk", e);
                    return null;
                }
            }

            // 4. Retrieve specific memory from the loaded chunk
            // The chunk is an array of memory objects (with 'story' fields populated)
            const loadedMemories = window.StoryViewer.chapterCache[eventId];
            const fullMemory = loadedMemories.find(m => m.id == memoryData.id);

            if (fullMemory) {
                // Cache it back into the main memory object so next time it's instant? 
                // Optional, but might save a lookup.
                memoryData.story = fullMemory.story;
                return fullMemory.story;
            }

            return null;
        },
        
        getEventIconPath: (eventData) => `${StoryViewer.BASE_URL}memorystoryline/`,

        getEventLink: (eventData) => {
            const name = (eventData?.name || '').replace(/\s+/g, '');
            if (name.includes('대형작전')) {
                const prefix = window.location.pathname.split('/pages/story-viewer/')[0];
                const normalizedPrefix = prefix.endsWith('/') && prefix.length > 1
                    ? prefix.slice(0, -1)
                    : prefix;
                return `${normalizedPrefix}/pages/story-viewer/world-story.html`;
            }
            return null;
        },
        
        populateMemoryGridExtras: (viewer, grid, eventId) => {
            // Optional: Add a "Download Full Chapter" button if we wanted to be fancy
        }
    };

    window.StoryViewer.init(mainStoryConfig);
});
