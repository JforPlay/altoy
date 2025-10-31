const COMPLETION_STORAGE_KEY = 'secretaryStoryCompletion';

function getCompletionData() {
    const data = localStorage.getItem(COMPLETION_STORAGE_KEY);
    return data ? JSON.parse(data) : {};
}

function setCompletionData(data) {
    localStorage.setItem(COMPLETION_STORAGE_KEY, JSON.stringify(data));
}

document.addEventListener('DOMContentLoaded', () => {
    // ... existing code ...

    // --- Completion Tracking and Filtering ---
    let currentFilter = 'all';
    const completionData = getCompletionData();

    function setupCompletionTracking() {
        const grid = document.getElementById('event-grid');
        if (!grid) return;

        const cards = grid.querySelectorAll('.grid-card');
        const map =
            (window.StoryViewer && window.StoryViewer.shipgirlNameMap) || {};
        const completionData = getCompletionData(); // uses your existing helper

        cards.forEach(card => {
            // 1) Ensure each card has a usable id
            if (!card.dataset.id) {
                const titleEl = card.querySelector('.card-title');
                const name = titleEl ? titleEl.textContent.trim() : '';

                // Try to derive id from name map
                let derivedId = map[name];

                // Special case: Akashi (hardcoded storyline entry uses id "0")
                if (!derivedId && name === '아카시') derivedId = '0';

                if (derivedId) card.dataset.id = String(derivedId);
            }

            // 2) Read the id (prefer data-id; fall back to any legacy data-event-id)
            const shipgirlId = card.dataset.id || card.dataset.eventId;

            // Helpful debug (you can keep/remove)
            console.log('Processing card for shipgirlId:', shipgirlId);

            if (!shipgirlId) return;

            // 3) Prevent duplicate checkboxes on re-renders
            if (card.querySelector('.card-checkbox')) return;

            // 4) Create/initialize the checkbox UI
            const checkbox = document.createElement('div');
            checkbox.className = 'card-checkbox';

            if (completionData[shipgirlId]) {
                checkbox.classList.add('completed');
                card.classList.add('completed-card');
            }

            // 5) Toggle + persist
            checkbox.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();

                completionData[shipgirlId] = !completionData[shipgirlId];
                setCompletionData(completionData);

                checkbox.classList.toggle('completed');
                card.classList.toggle('completed-card');

                // Re-apply your filter to reflect new state
                if (typeof applyFilter === 'function') applyFilter();
            });

            card.appendChild(checkbox);
        });
    }
    
    function applyFilter() {
        const allData = Object.values(window.StoryViewer.storylineData);
        let filteredData;

        if (currentFilter === 'completed') {
            filteredData = allData.filter(item => completionData[item.id]);
        } else if (currentFilter === 'unmarked') {
            filteredData = allData.filter(item => !completionData[item.id]);
        } else {
            filteredData = allData;
        }

        const mappedData = filteredData.map(item => [item.id, item]);
        window.StoryViewer.populateEventGrid('', mappedData);
    }

    const filterButtons = document.querySelectorAll('.filter-btn');
    filterButtons.forEach(button => {
        button.addEventListener('click', () => {
            filterButtons.forEach(btn => btn.classList.remove('active'));
            button.classList.add('active');
            currentFilter = button.dataset.filter;
            applyFilter();
        });
    });
    // Ensure StoryViewer global object exists
    if (typeof window.StoryViewer === 'undefined') {
        console.error('StoryViewer engine not loaded. Make sure story-viewer.engine.js is included before this script.');
        return;
    }

    // Configuration for the Secretary Story Viewer
    const secretaryStoryConfig = {
        viewerType: 'secretary',
        dataPaths: [
            'data/story-viewer/secretary_task_groups.json',
            'data/story-viewer/secretary_task_data.json',
            'data/story-viewer/secretary_story_data.json',
            'data/ship_group_data.json',
            'data/story-viewer/shipgirl_data.json' // Added this line
        ],

        // Process all loaded JSON data
        processLoadedData: function (viewer, jsonDataArray) {
            const [taskGroups, taskData, storyData, shipgirlGroupData, shipgirlStoryData] = jsonDataArray;

            // Merge shipgirl data
            const shipgirlData = {};
            Object.assign(shipgirlData, shipgirlStoryData, shipgirlGroupData);

            viewer.secretaryTaskGroups = taskGroups;
            viewer.shipgirlData = shipgirlData;

            // Combine task and story data into a single object for easier access
            viewer.secretaryMemories = {};
            for (const taskId in taskData) {
                const task = taskData[taskId];
                if (task.story_id) {
                    viewer.secretaryMemories[taskId] = {
                        ...task,
                        story: storyData[task.story_id.toLowerCase()]
                    };
                }
            }

            // Populate storylineData with shipgirls that have tasks
            viewer.storylineData = {};
            for (const groupId in taskGroups) {
                const shipgirlId = groupId;

                if (shipgirlId === "0") { // Special handling for Akashi
                    viewer.storylineData[shipgirlId] = {
                        id: shipgirlId,
                        name: "아카시",
                        icon: "https://raw.githubusercontent.com/Fernando2603/AzurLane/main/images/skin/312010/icon.png", // Akashi's icon
                        rarity: "SSR", // Akashi's rarity
                        description: "아카시 상점<br> 진행퀘스트"
                    };
                } else if (viewer.shipgirlData[shipgirlId]) {
                    const shipgirl = viewer.shipgirlData[shipgirlId];
                    viewer.storylineData[shipgirlId] = {
                        id: shipgirlId,
                        name: shipgirl.name,
                        icon: shipgirl.icon,
                        rarity: shipgirl.rarity,
                        description: `${shipgirl.name}의 <br> 비서함 스토리`
                    };
                }
            }

            // Build shipgirlNameMap for actor lookup
            for (const id in viewer.shipgirlData) {
                viewer.shipgirlNameMap[viewer.shipgirlData[id].name] = id;
            }
        },

        getEventIconPath: function (event) {
            return event.icon;
        },

        getEventMemories: function (shipgirl) {
            const memories = [];
            const taskIds = StoryViewer.secretaryTaskGroups[shipgirl.id];
            if (taskIds) {
                taskIds.forEach(taskId => {
                    const memory = StoryViewer.secretaryMemories[taskId];
                    if (memory) {
                        memories.push({
                            id: taskId,
                            title: memory.name,
                            condition: memory.desc,
                            icon: shipgirl.id === "0" ? `https://raw.githubusercontent.com/JForPlay/data_for_toy/main/memoryicon/akashi.png` : `https://raw.githubusercontent.com/JForPlay/data_for_toy/main/memoryicon/memory_${memory.story_icon}.png`,
                            story: memory.story
                        });
                    }
                });
            }
            return memories;
        },

        getMemoryStory: function (memory) {
            return memory.story;
        },


    };

    // Initialize the StoryViewer with the secretary story configuration
    window.StoryViewer.init(secretaryStoryConfig);

    // --- Fuse.js Search Setup ---
    function setupSearch() {
        const fuse = new Fuse(Object.values(window.StoryViewer.storylineData), {
            keys: ['name'],
            threshold: 0.4,
            includeMatches: true,
        });

        const searchBar = document.getElementById('search-bar');
        const searchResults = document.getElementById('search-results');

        // Helper function to highlight matches
        function highlightText(text, matches) {
            let highlightedText = '';
            let lastIndex = 0;

            matches.forEach(match => {
                // Only consider matches for the 'name' key
                if (match.key === 'name') {
                    const [start, end] = match.indices[0]; // Fuse.js returns [start, end] inclusive
                    highlightedText += text.substring(lastIndex, start);
                    highlightedText += `<mark>${text.substring(start, end + 1)}</mark>`;
                    lastIndex = end + 1;
                }
            });

            highlightedText += text.substring(lastIndex);
            return highlightedText;
        }

        searchBar.addEventListener('input', (e) => {
            const searchTerm = e.target.value;
            searchResults.innerHTML = '';

            if (searchTerm) {
                let result = fuse.search(searchTerm);
                searchResults.style.display = 'block';

                if (currentFilter === 'completed') {
                    result = result.filter(item => completionData[item.item.id]);
                } else if (currentFilter === 'unmarked') {
                    result = result.filter(item => !completionData[item.item.id]);
                }

                if (result.length > 0) {
                    result.forEach(item => {
                        const a = document.createElement('a');
                        a.href = '#';
                        a.innerHTML = highlightText(item.item.name, item.matches); // Use innerHTML for mark tags
                        a.addEventListener('click', (e) => {
                            e.preventDefault();
                            window.StoryViewer.populateEventGrid('', [[item.item.id, item.item]]);
                            searchBar.value = '';
                            searchResults.style.display = 'none';
                        });
                        searchResults.appendChild(a);
                    });
                } else {
                    const noResults = document.createElement('div');
                    noResults.className = 'no-results';
                    noResults.textContent = 'No results found';
                    searchResults.appendChild(noResults);
                }
            } else {
                searchResults.style.display = 'none';
                applyFilter(); // Call applyFilter when search is cleared
            }
        });
        document.addEventListener('click', (e) => {
            if (e.target !== searchBar && !searchResults.contains(e.target)) { // Also check if click is inside searchResults
                searchResults.style.display = 'none';
            }
        });
    }

    // Wait for data to be loaded before setting up search and completion tracking
    const observer = new MutationObserver((mutationsList, observer) => {
        for (const mutation of mutationsList) {
            if (mutation.type === 'childList' && mutation.addedNodes.length > 0) {
                if (!window.StoryViewer.searchInitialized) {
                    setupSearch();
                    window.StoryViewer.searchInitialized = true;
                }
                setupCompletionTracking();
                break;
            }
        }
    });

    observer.observe(document.getElementById('event-grid'), { childList: true });
});
