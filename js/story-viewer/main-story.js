/**
 * main-story-viewer.script.js
 * ---------------------------
 * This script configures and initializes the common StoryViewer engine
 * for the "Main Storyline".
 */
document.addEventListener('DOMContentLoaded', () => {

    const mainStoryConfig = {
        viewerType: 'main',
        
        dataPaths: [
            'data/story-viewer/main_story_data.json',
            'data/story-viewer/shipgirl_data.json',
            'https://raw.githubusercontent.com/AzurLaneTools/AzurLaneData/refs/heads/main/KR/ShareCfg/name_code.json'
        ],

        // Assigns loaded data to the correct properties in the StoryViewer
        processLoadedData: (viewer, dataArray) => {
            viewer.storylineData = dataArray[0];
            viewer.shipgirlData = dataArray[1];
            viewer.nameCodeData = dataArray[2]; // Add this line
        },
        
        // Defines how to get the list of stories from an event object
        getEventMemories: (eventData) => eventData?.memory_id,
        
        // Defines how to find a specific story within an event
        findMemory: (eventData, storyId) => eventData?.memory_id?.find(mem => mem.id == storyId),

        // Defines how to get the story script from a memory object
        getMemoryStory: (memoryData) => memoryData?.story,
        
        // Defines the base path for event icons
        getEventIconPath: (eventData) => `${StoryViewer.BASE_URL}memorystoryline/`,

        // Redirect events that live in the world-story viewer
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
    };

    // Initialize the common viewer with this specific configuration
    window.StoryViewer.init(mainStoryConfig);

});
