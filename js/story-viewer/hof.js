/**
 * hof.js (Hall of Fame Viewer)
 * ------------------------------
 * Configures and initializes the common StoryViewer engine for the Hall of Fame.
 *
 * HOF Data Structure:
 * - Top level: Character names as keys (e.g., "에기르", "체셔")
 * - Each character has: kr_name, icon, scripts[]
 * - We treat each character as an "event" with a single "memory" (story)
 */
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

        // Assigns loaded data to the correct properties in the StoryViewer
        processLoadedData: (viewer, dataArray) => {
            // HOF data structure: { "characterName": { kr_name, icon, scripts } }
            // We need to transform it to match the engine's expected structure
            const rawHofData = dataArray[0];
            const rawDummyData = dataArray[1];
            viewer.shipgirlData = dataArray[2];

            // Transform HOF data to match engine expectations
            // Each character becomes an "event" with one "memory"
            viewer.storylineData = {};

            // Process regular HoF data
            for (const [characterKey, characterData] of Object.entries(rawHofData)) {
                viewer.storylineData[characterKey] = {
                    id: characterKey,
                    name: characterData.kr_name,
                    icon: characterData.icon,
                    // Create a single memory entry containing the story
                    memory_id: [{
                        id: characterKey,
                        name: characterData.kr_name,
                        story: {
                            scripts: characterData.scripts  // Wrap scripts in an object
                        }
                    }]
                };
            }

            // Process dummy data with a prefix to distinguish them
            const dummyCharacterNames = [];
            for (const [characterKey, characterData] of Object.entries(rawDummyData)) {
                const dummyKey = `dummy_${characterKey}`;
                viewer.storylineData[dummyKey] = {
                    id: dummyKey,
                    name: characterData.kr_name,
                    icon: characterData.icon,
                    // Create a single memory entry containing the story
                    memory_id: [{
                        id: dummyKey,
                        name: characterData.kr_name,
                        story: {
                            scripts: characterData.scripts  // Wrap scripts in an object
                        }
                    }]
                };
                dummyCharacterNames.push(dummyKey);
            }

            // Define character groups for the gallery (now with dynamic dummy data)
            CHARACTER_GROUPS = {
                "2019 Hall of Fame": ["에기르", "체셔", "뉴저지"],
                "2021 Hall of Fame": ["벨파스트", "모나크", "엔터프라이즈"],
                "2023 Hall of Fame (찐빠)": dummyCharacterNames
            };
        },

        // For HOF, each "event" only has one memory (the character's story)
        getEventMemories: (eventData) => eventData?.memory_id,

        // Find the memory (always returns the first and only one)
        findMemory: (eventData, storyId) => eventData?.memory_id?.[0],

        // Get the story scripts from memory
        getMemoryStory: (memoryData) => memoryData?.story,

        // Icon path for event cards (character portraits)
        getEventIconPath: (eventData) => '',

        // Custom gallery population to show grouped characters
        customPopulateEventGrid: true
    };

    // Initialize the common viewer with HOF-specific configuration
    window.StoryViewer.init(hofConfig);

    // Override the populateEventGrid to use custom grouped gallery layout
    window.StoryViewer.populateEventGrid = function(searchTerm = '') {
        const eventGrid = this.elements.eventGrid;
        eventGrid.innerHTML = '';

        // Create grouped gallery layout
        for (const [groupTitle, characterNames] of Object.entries(CHARACTER_GROUPS)) {
            const groupWrapper = document.createElement('div');
            groupWrapper.className = 'hof-gallery-group';

            // Add special class for dummy/flawed section
            if (groupTitle.includes('찐빠')) {
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
                    card.innerHTML = `
                        <img src="${eventData.icon}" alt="${eventData.name}" class="hof-card-image">
                        <div class="hof-card-name">${eventData.name}</div>
                    `;
                    card.addEventListener('click', () => {
                        // Go directly to story (skip memory selection)
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

    // Override returnToMemorySelection to go back to character gallery
    window.StoryViewer.returnToMemorySelection = function() {
        this.switchView(this.elements.eventSelectionView);
        this.updateUrl(null, null, true);
    };

});
