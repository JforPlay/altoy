/**
 * secretary-story.js
 * Page script for the secretary story viewer, layered on top of the shared
 * StoryViewer engine. Adds per-shipgirl completion tracking (localStorage),
 * a three-state filter (all / completed / unmarked), and Fuse.js search with
 * highlight. Uses a MutationObserver to wire checkboxes whenever the engine
 * re-renders the event grid.
 */
import { getStorageItem, setStorageItem, createSearchIndex, ensureFuse, makeKeyboardActivatable } from '../utils.js';

const COMPLETION_STORAGE_KEY = 'secretaryStoryCompletion';

function getCompletionData() {
  const data = getStorageItem(COMPLETION_STORAGE_KEY, null);
  if (!data) return {};
  try {
    const parsed = JSON.parse(data);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch (error) {
    console.warn('Ignoring corrupt secretary story completion data:', error);
    setStorageItem(COMPLETION_STORAGE_KEY, JSON.stringify({}));
    return {};
  }
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

  // ===== State =====
  let currentFilter = 'all'; // 'all' | 'completed' | 'unmarked'
  let initialHydrateDone = false; // guard: ensure first render uses our filter, not the engine's default

  // ===== Grid Rendering =====

  /**
   * Re-render the event grid for the given [id, event] entries using the
   * engine's card factory, then immediately inject completion checkboxes.
   * Called by applyFilter so the grid always reflects the current filter state.
   */
  function renderEventEntries(entries) {
    const grid = document.getElementById('event-grid');
    if (!grid) return;
    grid.textContent = '';

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

    setupCompletionTracking();
  }

  // ===== Filter =====

  /**
   * Re-render the event grid filtered by `currentFilter`.
   * Reads a fresh completion snapshot on every call so the filter reflects
   * any checkbox toggle that happened since the last render.
   * Keys are string-normalized to avoid "0" vs 0 mismatches.
   */
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

  // ===== Completion Tracking =====

  /**
   * Inject a completion checkbox into each card that lacks one, and sync the
   * visual state of existing checkboxes with localStorage. Called after every
   * grid render. Derives the shipgirl ID from data-id, the name-to-id map,
   * or the special case "아카시" → "0" when the engine hasn't set it.
   */
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
      const existingCheckbox = card.querySelector('.card-checkbox');
      if (existingCheckbox) {
        // Hydrate class + aria state from storage every render
        const isComplete = !!completionData[String(shipgirlId)];
        card.classList.toggle('completed-card', isComplete);
        existingCheckbox.classList.toggle('completed', isComplete);
        existingCheckbox.setAttribute('aria-checked', String(isComplete));
        return;
      }

      // Create checkbox UI
      const checkbox = document.createElement('div');
      checkbox.className = 'card-checkbox';

      if (completionData[String(shipgirlId)]) {
        checkbox.classList.add('completed');
        card.classList.add('completed-card');
      }
      checkbox.setAttribute('aria-checked', String(checkbox.classList.contains('completed')));

      makeKeyboardActivatable(checkbox, (e) => {
        e.stopPropagation(); // don't bubble to the underlying card click

        const fresh = getCompletionData();
        const key = String(shipgirlId);
        fresh[key] = !fresh[key];
        setCompletionData(fresh);

        checkbox.classList.toggle('completed');
        card.classList.toggle('completed-card');
        checkbox.setAttribute('aria-checked', String(checkbox.classList.contains('completed')));

        applyFilter(); // keep filtered view consistent after every toggle
      }, { role: 'checkbox' });

      card.appendChild(checkbox);
    });
  }

  // ===== Search =====

  /**
   * Initialize Fuse.js search on the shipgirl event list.
   * Renders a dropdown of matching results with name-range highlights;
   * respects the active filter when narrowing results.
   */
  async function setupSearch() {
    await ensureFuse();
    const source = Object.values(window.StoryViewer.storylineData || {});
    const fuse = createSearchIndex(source, { keys: ['name'], threshold: 0.4 });
    if (!fuse) return;

    const searchBar = document.getElementById('search-bar');
    const searchResults = document.getElementById('search-results');
    if (!searchBar || !searchResults) return;

    function appendHighlightedText(target, text, matches) {
      let last = 0;
      (matches || []).forEach((m) => {
        if (m.key !== 'name' || !m.indices || !m.indices.length) return;
        const [start, end] = m.indices[0];
        target.appendChild(document.createTextNode(text.substring(last, start)));
        const mark = document.createElement('mark');
        mark.textContent = text.substring(start, end + 1);
        target.appendChild(mark);
        last = end + 1;
      });
      target.appendChild(document.createTextNode(text.substring(last)));
    }

    searchBar.addEventListener('input', (e) => {
      const term = e.target.value;
      searchResults.textContent = '';

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
            appendHighlightedText(a, r.item.name, r.matches);
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

  // ===== Filter Buttons =====
  const filterButtons = document.querySelectorAll('.filter-btn');
  filterButtons.forEach((button) => {
    button.setAttribute('aria-pressed', String(button.classList.contains('active')));
    button.addEventListener('click', () => {
      filterButtons.forEach((btn) => {
        btn.classList.remove('active');
        btn.setAttribute('aria-pressed', 'false');
      });
      button.classList.add('active');
      button.setAttribute('aria-pressed', 'true');
      currentFilter = button.dataset.filter || 'all';
      applyFilter();
    });
  });

  // ===== Engine Configuration =====

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

      // shipgirlGroupData (ship_group_data) takes priority over shipgirlStoryData for shared keys
      const shipgirlData = {};
      Object.assign(shipgirlData, shipgirlStoryData, shipgirlGroupData);

      viewer.secretaryTaskGroups = taskGroups;
      viewer.shipgirlData = shipgirlData;

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

      viewer.storylineData = {};
      for (const groupId in taskGroups) {
        const shipgirlId = groupId;

        if (shipgirlId === '0') {
          // Akashi (ID 0) uses a hardcoded icon; she's not in the normal shipgirl data.
          viewer.storylineData[shipgirlId] = {
            id: shipgirlId,
            name: '아카시',
            icon:
              'https://raw.githubusercontent.com/JforPlay/data_for_toy/main/skin_icon/312010.webp',
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

      viewer.shipgirlNameMap = viewer.shipgirlNameMap || {};
      for (const id in viewer.shipgirlData) {
        const n = viewer.shipgirlData[id]?.name;
        if (n) viewer.shipgirlNameMap[n] = id;
      }
      viewer.shipgirlNameMap['아카시'] = '0'; // Akashi is not in shipgirlData by name
    },

    getEventIconPath(event) {
      // Icons are absolute URLs in this page config
      return event.icon;
    },

    /**
     * Return the memory card list for a shipgirl.
     * The task group may be an array of IDs or an object with a `tasks` array;
     * both shapes are handled for forward compatibility.
     */
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
            ? 'https://raw.githubusercontent.com/JForPlay/data_for_toy/main/memoryicon/akashi.webp'
            : `https://raw.githubusercontent.com/JForPlay/data_for_toy/main/memoryicon/memory_${memory.story_icon}.webp`;

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

    /** Look up a memory by ID, used when deep-linking via URL params. */
    findMemory(eventData, memoryId) {
      const mems = this.getEventMemories(eventData) || [];
      return mems.find((m) => String(m.id) === String(memoryId));
    },

    getMemoryStory(memory) {
      return memory.story;
    }
  };

  window.StoryViewer.init(secretaryStoryConfig);

  // ===== MutationObserver Wiring =====

  /**
   * Watch the event grid for engine-triggered renders. On first paint,
   * replace the engine's default card list with our filtered/annotated view.
   * On subsequent renders, ensure checkboxes stay in sync with storage.
   * Search is initialized once on the first observed render.
   */
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

  // Disconnect on pagehide so it doesn't fire on stale grids in back-forward cache.
  window.addEventListener('pagehide', () => observer.disconnect(), { once: true });

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
