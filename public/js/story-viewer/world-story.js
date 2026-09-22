/**
 * world-story.js
 * Page init for the World Storyline (Operation Siren) viewer.
 * Wires the shared StoryViewer engine with world-specific data paths
 * and injects the "Summary" card via populateMemoryGridExtras.
 */
import { resolveUrl } from '../utils.js';

document.addEventListener('DOMContentLoaded', () => {

    const worldStoryConfig = {
        viewerType: 'world',

        // namecodes are pipeline-resolved; no runtime name_code.json fetch
        // (the old AzurLaneData ShareCfg source is stale — see main-story.js).
        // FROZEN (2026-09-22): world_story_data.json's producer
        // (story_world_data_process.py) is archived in WSL altoy_process under
        // archive/legacy_processors/story_world/ -- the game stopped updating the
        // world story. The deploy is 'cp -r ./output/*' and never deletes, so the
        // file keeps serving its last build; new Operation Siren chapters will not
        // appear until that processor is revived. world_story_summary_data.json has
        // never had a producer at all.
        // Frozen does NOT mean stale here: this file matches the config exactly --
        // 6 record groups of 24/14/14/14/22/1 against world_collection_record_*'s
        // 89 templates (checked 2026-09-22), so a revived run would add nothing.
        // Its sibling world_collection_data.json was the opposite case and IS live
        // again -- see world-file.js.
        dataPaths: [
            'data/story-viewer/world_story_data.json',
            'data/story-viewer/world_story_summary_data.json',
            'data/story-viewer/shipgirl_data.json'
        ],

        processLoadedData: (viewer, dataArray) => {
            viewer.storylineData = dataArray[0];
            viewer.storylineSummaryData = dataArray[1];
            viewer.shipgirlData = dataArray[2];
        },

        getEventMemories: (eventData) => eventData?.child,
        
        findMemory: (eventData, storyId) => {
            const numericStoryId = parseInt(storyId, 10);
            return eventData?.child?.find(mem => mem.id === numericStoryId);
        },

        getMemoryStory: (memoryData) => memoryData?.story,
        
        getEventIconPath: (eventData) => null, // world events have no icon prefix

        // Adds the special "Summary" card to the memory grid
        populateMemoryGridExtras: (viewer, memoryGrid, eventId) => {
            if (viewer.storylineSummaryData[eventId]) {
                const summaryData = viewer.storylineSummaryData[eventId];
                const summaryCard = viewer.createCard(
                    `${summaryData.title} 줄거리`,
                    "하나즈키가 작성한 이 챕터의 전체적인 줄거리와 핵심 정보를 확인합니다.",
                    resolveUrl('assets/img/hanazuki.webp'),
                    null,
                    () => viewer.showSummaryModal(eventId)
                );
                memoryGrid.appendChild(summaryCard);
            }
        }
    };

    window.StoryViewer.init(worldStoryConfig);

});
