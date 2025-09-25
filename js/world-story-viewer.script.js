/**
 * world-story-viewer.script.js
 * ----------------------------
 * This script configures and initializes the common StoryViewer engine
 * for the "World Storyline" (Operation Siren).
 */
document.addEventListener('DOMContentLoaded', () => {

    const worldStoryConfig = {
        viewerType: 'world',

        dataPaths: [
            'data/processed_world_storyline.json',
            'data/world_storyline_summary.json',
            'data/shipgirl_data.json',
            'https://raw.githubusercontent.com/AzurLaneTools/AzurLaneData/refs/heads/main/KR/ShareCfg/name_code.json'
        ],

        processLoadedData: (viewer, dataArray) => {
            viewer.storylineData = dataArray[0];
            viewer.storylineSummaryData = dataArray[1];
            viewer.shipgirlData = dataArray[2];
            viewer.nameCodeData = dataArray[3]; // Add this line
        },

        getEventMemories: (eventData) => eventData?.child,
        
        findMemory: (eventData, storyId) => {
            const numericStoryId = parseInt(storyId, 10);
            return eventData?.child?.find(mem => mem.id === numericStoryId);
        },

        getMemoryStory: (memoryData) => memoryData?.story,
        
        getEventIconPath: (eventData) => null, // World events don't use icons in the same way

        // Adds the special "Summary" card to the memory grid
        populateMemoryGridExtras: (viewer, memoryGrid, eventId) => {
            if (viewer.storylineSummaryData[eventId]) {
                const summaryData = viewer.storylineSummaryData[eventId];
                const summaryCard = viewer.createCard(
                    `${summaryData.title} 줄거리`,
                    "하나즈키가 작성한 이 챕터의 전체적인 줄거리와 핵심 정보를 확인합니다.",
                    'assets/img/hanazuki.png',
                    null,
                    () => viewer.showSummaryModal(eventId)
                );
                memoryGrid.appendChild(summaryCard);
            }
        }
    };

    window.StoryViewer.init(worldStoryConfig);

});
