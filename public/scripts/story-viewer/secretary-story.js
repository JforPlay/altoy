/* ============================================================
   Secretary Story Viewer – Page Script (engine-agnostic)
   ============================================================ */

import { getStorageItem, setStorageItem, createSearchIndex } from '../utils.js';

const COMPLETION_STORAGE_KEY = 'secretaryStoryCompletion';

function getCompletionData() {
  const data = getStorageItem(COMPLETION_STORAGE_KEY, null);
  return data ? JSON.parse(data) : {};
}
function setCompletionData(data) {
  setStorageItem(COMPLETION_STORAGE_KEY, JSON.stringify(data));
}

document.addEventListener('DOMContentLoaded', () => {
  // Guard: engine must be present
  if (typeof window.StoryViewer === 'undefined') {
    console.error(
      'StoryViewer engine not loaded. Include story-viewer.engine.js before this script.'
    );
    return;
  }

  /* ------------------------------------------------------------
     State
  ------------------------------------------------------------ */
  let currentFilter = 'all'; // 'all' | 'completed' | 'unmarked'
  let initialHydrateDone = false; // ensure first view uses our renderer

  /* ------------------------------------------------------------
     Rendering helper (no engine edits required)
     Renders provided entries with engine's card factory,
     then immediately wires checkboxes.
  ------------------------------------------------------------ */
  function renderEventEntries(entries) {
    const grid = document.getElementById('event-grid');
    if (!grid) return;
    grid.innerHTML = '';

    entries.forEach(([id, event]) => {
      const eventId = event.id || id;
      const card = window.StoryViewer.createCard(
        event.name,
        event.description || `Chapter: ${event.name.replace(/[^0-9]/g, '')}`,
        event.icon,
        window.StoryViewer.config.getEventIconPath(event),
        () => window.StoryViewer.selectEvent(eventId),
        eventId // ensure data-id is present for checkbox logic
      );
      grid.appendChild(card);
    });

    // ✅ Immediately annotate with saved completion state
    setupCompletionTracking();
  }

  /* ------------------------------------------------------------
     Filter (reads fresh completion snapshot each time)
     - String-normalized keys so "0" vs 0 never mismatches.
     - Calls renderEventEntries(), which will annotate right away.
  ------------------------------------------------------------ */
  function applyFilter() {
    const done = getCompletionData();
    const allEntries = Object.entries(window.StoryViewer.storylineData || {});
    let entries = allEntries;

    if (currentFilter === 'completed') {
      entries = allEntries.filter(([id]) => !!done[String(id)]);
    } else if (currentFilter === 'unmarked') {
      entries = allEntries.filter(([id]) => !done[String(id)]);
    }

    renderEventEntries(entries);
  }

  /* ------------------------------------------------------------
     Checkbox injection + persistence
     - Derives data-id when engine didn't set it
     - Special case: "아카시" → "0"
     - Avoids duplicate checkboxes on re-renders
     - String-normalized keys everywhere
  ------------------------------------------------------------ */
  function setupCompletionTracking() {
    const grid = document.getElementById('event-grid');
    if (!grid) return;

    const cards = grid.querySelectorAll('.grid-card');
    const completionData = getCompletionData();
    const nameMap =
      (window.StoryViewer && window.StoryViewer.shipgirlNameMap) || {};

    cards.forEach((card) => {
      // Ensure card has a usable id
      if (!card.dataset.id) {
        const titleEl = card.querySelector('.card-title');
        const name = titleEl ? titleEl.textContent.trim() : '';
        let derivedId = nameMap[name];
        if (!derivedId && name === '아카시') derivedId = '0'; // special case
        if (derivedId) card.dataset.id = String(derivedId);
      }

      const shipgirlIdRaw = card.dataset.id || card.dataset.eventId || '';
      const shipgirlId = String(shipgirlIdRaw);
      if (!shipgirlId) return;

      // Prevent duplicate UI on grid re-renders
      if (card.querySelector('.card-checkbox')) {
        // Also ensure class state reflects storage on first hydration
        if (completionData[String(shipgirlId)]) {
          card.classList.add('completed-card');
          card.querySelector('.card-checkbox')?.classList.add('completed');
        } else {
          card.classList.remove('completed-card');
          card.querySelector('.card-checkbox')?.classList.remove('completed');
        }
        return;
      }

      // Create checkbox UI
      const checkbox = document.createElement('div');
      checkbox.className = 'card-checkbox';

      if (completionData[String(shipgirlId)]) {
        checkbox.classList.add('completed');
        card.classList.add('completed-card');
      }

      // Toggle + persist
      checkbox.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();

        const fresh = getCompletionData();
        const key = String(shipgirlId);
        fresh[key] = !fresh[key];
        setCompletionData(fresh);

        checkbox.classList.toggle('completed');
        card.classList.toggle('completed-card');

        // Re-apply filter so the view stays in sync
        applyFilter();
      });

      card.appendChild(checkbox);
    });
  }

  /* ------------------------------------------------------------
     Fuse.js search (with highlight)
  ------------------------------------------------------------ */
  function setupSearch() {
    const source = Object.values(window.StoryViewer.storylineData || {});
    const fuse = createSearchIndex(source, { keys: ['name'], threshold: 0.4 });
    if (!fuse) return;

    const searchBar = document.getElementById('search-bar');
    const searchResults = document.getElementById('search-results');
    if (!searchBar || !searchResults) return;

    function highlightText(text, matches) {
      let out = '';
      let last = 0;
      (matches || []).forEach((m) => {
        if (m.key !== 'name' || !m.indices || !m.indices.length) return;
        const [start, end] = m.indices[0];
        out += text.substring(last, start);
        out += `<mark>${text.substring(start, end + 1)}</mark>`;
        last = end + 1;
      });
      out += text.substring(last);
      return out;
    }

    searchBar.addEventListener('input', (e) => {
      const term = e.target.value;
      searchResults.innerHTML = '';

      if (term) {
        let result = fuse.search(term);
        searchResults.style.display = 'block';

        const done = getCompletionData();
        if (currentFilter === 'completed') {
          result = result.filter((r) => !!done[String(r.item.id)]);
        } else if (currentFilter === 'unmarked') {
          result = result.filter((r) => !done[String(r.item.id)]);
        }

        if (result.length > 0) {
          result.forEach((r) => {
            const a = document.createElement('a');
            a.href = '#';
            a.innerHTML = highlightText(r.item.name, r.matches);
            a.addEventListener('click', (ev) => {
              ev.preventDefault();
              renderEventEntries([[r.item.id, r.item]]);
              searchBar.value = '';
              searchResults.style.display = 'none';
            });
            searchResults.appendChild(a);
          });
        } else {
          const none = document.createElement('div');
          none.className = 'no-results';
          none.textContent = 'No results found';
          searchResults.appendChild(none);
        }
      } else {
        searchResults.style.display = 'none';
        applyFilter(); // reset to current filter when cleared
      }
    });

    // Hide dropdown when clicking outside
    document.addEventListener('click', (e) => {
      if (e.target !== searchBar && !searchResults.contains(e.target)) {
        searchResults.style.display = 'none';
      }
    });
  }

  /* ------------------------------------------------------------
     Filter buttons
  ------------------------------------------------------------ */
  const filterButtons = document.querySelectorAll('.filter-btn');
  filterButtons.forEach((button) => {
    button.addEventListener('click', () => {
      filterButtons.forEach((btn) => btn.classList.remove('active'));
      button.classList.add('active');
      currentFilter = button.dataset.filter || 'all';
      applyFilter();
    });
  });

  /* ------------------------------------------------------------
     Page-specific configuration for the engine (no engine edits)
  ------------------------------------------------------------ */
  const secretaryStoryConfig = {
    viewerType: 'secretary',
    dataPaths: [
      'data/story-viewer/secretary_task_groups.json',
      'data/story-viewer/secretary_task_data.json',
      'data/story-viewer/secretary_story_data.json',
      'data/ship_group_data.json',
      'data/story-viewer/shipgirl_data.json'
    ],

    processLoadedData(viewer, jsonDataArray) {
      const [taskGroups, taskData, storyData, shipgirlGroupData, shipgirlStoryData] =
        jsonDataArray;

      // Merge shipgirl data
      const shipgirlData = {};
      Object.assign(shipgirlData, shipgirlStoryData, shipgirlGroupData);

      viewer.secretaryTaskGroups = taskGroups;
      viewer.shipgirlData = shipgirlData;

      // Build secretaryMemories (task → story)
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

      // Populate storylineData (only shipgirls that have tasks)
      viewer.storylineData = {};
      for (const groupId in taskGroups) {
        const shipgirlId = groupId;

        if (shipgirlId === '0') {
          // Special handling for Akashi
          viewer.storylineData[shipgirlId] = {
            id: shipgirlId,
            name: '아카시',
            icon:
              'https://raw.githubusercontent.com/Fernando2603/AzurLane/main/images/skin/312010/icon.png',
            rarity: 'SSR',
            description: '아카시 상점<br> 진행퀘스트'
          };
        } else if (viewer.shipgirlData[shipgirlId]) {
          const s = viewer.shipgirlData[shipgirlId];
          viewer.storylineData[shipgirlId] = {
            id: shipgirlId,
            name: s.name,
            icon: s.icon,
            rarity: s.rarity,
            description: `${s.name}의 <br> 비서함 스토리`
          };
        }
      }

      // Build name → id map (used for deriving card ids)
      viewer.shipgirlNameMap = viewer.shipgirlNameMap || {};
      for (const id in viewer.shipgirlData) {
        const n = viewer.shipgirlData[id]?.name;
        if (n) viewer.shipgirlNameMap[n] = id;
      }
      // Ensure Akashi is discoverable
      viewer.shipgirlNameMap['아카시'] = '0';
    },

    getEventIconPath(event) {
      // Icons are absolute URLs in this page config
      return event.icon;
    },

    // Returns the list of memory cards for a shipgirl
    getEventMemories(eventData) {
      const memories = [];
      const groupId = String(eventData.id);
      const group = window.StoryViewer.secretaryTaskGroups[groupId];

      // Accept both shapes:
      //   A) { [id]: { tasks: [...] } }
      //   B) { [id]: [...] }
      const taskIds = Array.isArray(group) ? group : (group?.tasks || []);
      if (!taskIds.length) return memories;

      taskIds.forEach((taskId) => {
        const memory = window.StoryViewer.secretaryMemories[taskId];
        if (!memory) return;

        const icon =
          memory.story_icon === 'akashi'
            ? 'https://raw.githubusercontent.com/JForPlay/data_for_toy/main/memoryicon/akashi.png'
            : `https://raw.githubusercontent.com/JForPlay/data_for_toy/main/memoryicon/memory_${memory.story_icon}.png`;

        memories.push({
          id: memory.id || taskId,
          title: memory.title || memory.name || memory.task_name,
          condition: memory.condition || memory.desc || '',
          icon,
          story: memory.story
        });
      });

      return memories;
    },

    // Engine may call this when deep-linking to a memory via URL
    findMemory(eventData, memoryId) {
      const mems = this.getEventMemories(eventData) || [];
      return mems.find((m) => String(m.id) === String(memoryId));
    },

    // Engine calls this to play a memory
    getMemoryStory(memory) {
      return memory.story;
    }
  };

  // Initialize engine with our page configuration
  window.StoryViewer.init(secretaryStoryConfig);

  /* ------------------------------------------------------------
     Automatic wiring after the grid is (re)rendered
     - set up search once
     - inject/refresh checkboxes every time
     - trigger our own initial hydrate exactly once
  ------------------------------------------------------------ */
  const observer = new MutationObserver((mutationsList) => {
    for (const m of mutationsList) {
      if (m.type === 'childList' && m.addedNodes.length > 0) {
        if (!window.StoryViewer.searchInitialized) {
          setupSearch();
          window.StoryViewer.searchInitialized = true;
        }

        // If this is the engine's first paint, immediately re-render via our filter
        if (!initialHydrateDone) {
          initialHydrateDone = true;
          applyFilter(); // this calls renderEventEntries() -> setupCompletionTracking()
        } else {
          // For subsequent engine renders (if any), ensure checkboxes match storage
          setupCompletionTracking();
        }
        break;
      }
    }
  });

  const eventGrid = document.getElementById('event-grid');
  if (eventGrid) {
    observer.observe(eventGrid, { childList: true });

    // If engine populated before we started observing, hydrate now
    if (eventGrid.children.length > 0 && !initialHydrateDone) {
      initialHydrateDone = true;
      applyFilter();
    }
  }

  // If data is already present very early, render immediately
  if (
    window.StoryViewer &&
    window.StoryViewer.storylineData &&
    Object.keys(window.StoryViewer.storylineData).length &&
    !initialHydrateDone
  ) {
    initialHydrateDone = true;
    applyFilter();
  }
});
