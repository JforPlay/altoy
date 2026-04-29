/**
 * hof.js
 * Page init for the Hall of Fame viewer.
 * Transforms the flat HOF JSON (character key → {kr_name, icon, scripts[]}) into
 * the engine's event/memory structure, then overrides populateEventGrid with a
 * custom grouped gallery (by year/group), and returnToMemorySelection to skip
 * the memory layer and go directly back to the character gallery.
 */
import { createImgElement, makeKeyboardActivatable } from '../utils.js';

document.addEventListener('DOMContentLoaded', () => {

    // This will be populated dynamically after data loads
    let CHARACTER_GROUPS = {};

    const hofConfig = {
        viewerType: 'hof',

        dataPaths: [
            'data/story-viewer/hof_kr.json',
            'data/story-viewer/hof_kr_dummy.json',
            'data/story-viewer/shipgirl_data.json'
        ],

        processLoadedData: (viewer, dataArray) => {
            const rawHofData = dataArray[0];
            const rawDummyData = dataArray[1];
            viewer.shipgirlData = dataArray[2];

            viewer.storylineData = {};

            // Each character becomes a single-memory "event" so the engine's
            // selectEvent → startStory flow works without a separate memory screen.
            for (const [characterKey, characterData] of Object.entries(rawHofData)) {
                viewer.storylineData[characterKey] = {
                    id: characterKey,
                    name: characterData.kr_name,
                    icon: characterData.icon,
                    memory_id: [{
                        id: characterKey,
                        name: characterData.kr_name,
                        story: { scripts: characterData.scripts }
                    }]
                };
            }

            // Dummy entries get a prefix so they don't collide with real character keys.
            const dummyCharacterNames = [];
            for (const [characterKey, characterData] of Object.entries(rawDummyData)) {
                const dummyKey = `dummy_${characterKey}`;
                viewer.storylineData[dummyKey] = {
                    id: dummyKey,
                    name: characterData.kr_name,
                    icon: characterData.icon,
                    memory_id: [{
                        id: dummyKey,
                        name: characterData.kr_name,
                        story: { scripts: characterData.scripts }
                    }]
                };
                dummyCharacterNames.push(dummyKey);
            }

            // Define character groups for the gallery (now with dynamic dummy data)
            CHARACTER_GROUPS = {
                "2019 Hall of Fame": ["벨파스트", "모나크", "엔터프라이즈"],
                "2021 Hall of Fame": ["에기르", "체셔", "뉴저지"],
                "2023 Hall of Fame": ["힌덴부르크", "임플래커블", "다이호"],
                "2023 Hall of Fame (찐빠 - 보관용)": dummyCharacterNames
            };
        },

        // Each HOF "event" has exactly one memory — no memory selection step.
        getEventMemories: (eventData) => eventData?.memory_id,
        findMemory: (eventData, storyId) => eventData?.memory_id?.[0],
        getMemoryStory: (memoryData) => memoryData?.story,
        getEventIconPath: (eventData) => '',
        customPopulateEventGrid: true
    };

    window.StoryViewer.init(hofConfig);

    // Replace the engine's default flat grid with a year-grouped gallery.
    window.StoryViewer.populateEventGrid = function(searchTerm = '') {
        const eventGrid = this.elements.eventGrid;
        eventGrid.textContent = '';

        // Create grouped gallery layout
        for (const [groupTitle, characterNames] of Object.entries(CHARACTER_GROUPS)) {
            const groupWrapper = document.createElement('div');
            groupWrapper.className = 'hof-gallery-group';

            if (groupTitle.includes('찐빠') || groupTitle.includes('초안')) { // draft/placeholder section
                groupWrapper.classList.add('dummy-section');
            }

            const titleElement = document.createElement('h2');
            titleElement.className = 'hof-group-title';
            titleElement.textContent = groupTitle;
            groupWrapper.appendChild(titleElement);

            const grid = document.createElement('div');
            grid.className = 'hof-character-grid';

            characterNames.forEach(characterName => {
                const eventData = this.storylineData[characterName];
                if (eventData) {
                    const card = document.createElement('div');
                    card.className = 'hof-character-card story-card';

                    card.appendChild(createImgElement(eventData.icon, eventData.name, { className: 'hof-card-image' }));
                    const name = document.createElement('div');
                    name.className = 'hof-card-name';
                    name.textContent = eventData.name;
                    card.appendChild(name);

                    makeKeyboardActivatable(card, () => {
                        // Skip the memory selection step — HOF characters have only one story.
                        this.currentEventId = characterName;
                        const memoryData = eventData.memory_id[0];
                        this.startStory(memoryData, true);
                    });
                    grid.appendChild(card);
                }
            });

            groupWrapper.appendChild(grid);
            eventGrid.appendChild(groupWrapper);
        }
    };

    // Return to the gallery instead of the memory list (there is none for HOF).
    window.StoryViewer.returnToMemorySelection = function() {
        this.switchView(this.elements.eventSelectionView);
        this.updateUrl(null, null, true);
    };

});
