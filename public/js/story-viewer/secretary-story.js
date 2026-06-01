/**
 * secretary-story.js
 * Page script for the secretary story viewer, layered on top of the shared
 * StoryViewer engine. Adds per-shipgirl completion tracking (localStorage),
 * a three-state completion filter, multi-select faction + rarity chip filters,
 * a visible-count indicator, and Fuse.js search with highlight. Uses a
 * MutationObserver to wire checkboxes whenever the engine re-renders the grid.
 */
import { getStorageItem, setStorageItem, createSearchIndex, ensureFuse, makeKeyboardActivatable, DATA_FOR_TOY_BASE, dataForToyUrl } from '../utils.js';

const COMPLETION_STORAGE_KEY = 'secretaryStoryCompletion';

/* Rarity tier order, low → high. Used to render chips in a predictable order
   regardless of which rarities happen to appear first in the data. */
// Ascending + PR/DR tiers; not utils.RARITY_TIERS_DESC.
const RARITY_ORDER = ['N', 'R', 'SR', 'SSR', 'UR', 'PR', 'DR'];

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
  if (typeof window.StoryViewer === 'undefined') {
    console.error(
      'StoryViewer engine not loaded. Include story-viewer.engine.js before this script.'
    );
    return;
  }

  // ===== State =====
  let currentFilter = 'all'; // 'all' | 'completed' | 'unmarked'
  let initialHydrateDone = false;
  const selectedFactions = new Set(); // empty = no faction filter
  const selectedRarities = new Set(); // empty = no rarity filter
  let chipsBuilt = false;

  // ===== Grid Rendering =====

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
        eventId
      );

      // Layer a skin_icon fallback under the shipyard portrait: a few skins
      // (notably alt forms / collab outfits) lack a skin_shipyard file and
      // would otherwise render as a blank card. CSS stacks the top URL over
      // the second, so a 404 on top falls through transparently.
      if (event.iconFallback && event.icon) {
        const thumb = card.querySelector('.card-thumbnail');
        if (thumb) {
          thumb.style.backgroundImage =
            `url("${event.icon}"), url("${event.iconFallback}")`;
        }
      }

      grid.appendChild(card);
    });

    setupCompletionTracking();
    updateVisibleCount(entries.length);
  }

  // ===== Filter =====

  /**
   * Re-render the event grid filtered by the active completion state,
   * faction chips, and rarity chips. Reads a fresh completion snapshot each
   * call so toggles since the last render are reflected. Chip sets being
   * empty means "no constraint" for that dimension.
   */
  function applyFilter() {
    const done = getCompletionData();
    const allEntries = Object.entries(window.StoryViewer.storylineData || {});

    const entries = allEntries.filter(([id, ev]) => {
      if (currentFilter === 'completed' && !done[String(id)]) return false;
      if (currentFilter === 'unmarked' && done[String(id)]) return false;

      if (selectedFactions.size > 0) {
        // Entries without a nationality (e.g. 아카시) get hidden when any
        // faction is selected — they simply don't match the user's choice.
        if (ev.nationality == null) return false;
        if (!selectedFactions.has(String(ev.nationality))) return false;
      }

      if (selectedRarities.size > 0) {
        if (!ev.rarity || !selectedRarities.has(ev.rarity)) return false;
      }

      return true;
    });

    renderEventEntries(entries);
  }

  // ===== Visible Count Indicator =====

  function updateVisibleCount(visible) {
    const el = document.getElementById('visible-count');
    if (!el) return;
    const total = Object.keys(window.StoryViewer.storylineData || {}).length;
    el.textContent = '';
    const num = document.createElement('strong');
    num.textContent = String(visible);
    el.append('표시된 함순이 ', num, ` / ${total}명`);
  }

  // ===== Chip Filter Rows =====

  /**
   * Build the faction and rarity chip rows from the rarities and nationalities
   * actually present in storylineData. Idempotent — bails out after the first
   * successful build. Called once we know storylineData and nationality
   * mapping are both available.
   */
  function buildChipRows() {
    if (chipsBuilt) return;
    const storylineData = window.StoryViewer.storylineData || {};
    const nationalityMap = window.StoryViewer.nationalityMap || {};
    if (!Object.keys(storylineData).length) return;

    const factionIds = new Set();
    const rarities = new Set();
    Object.values(storylineData).forEach((ev) => {
      if (ev.nationality != null) factionIds.add(String(ev.nationality));
      if (ev.rarity) rarities.add(ev.rarity);
    });

    const factionContainer = document.getElementById('faction-chips');
    if (factionContainer) {
      factionContainer.textContent = '';
      // Sort numerically for stable, intuitive ordering (USS=1, HMS=2, …)
      const sorted = Array.from(factionIds).sort((a, b) => Number(a) - Number(b));
      sorted.forEach((natId) => {
        const info = nationalityMap[natId];
        if (!info) return; // skip unknown nationality IDs
        const chip = makeChip({
          extraClass: 'chip-faction',
          ariaLabel: info.name || info.code || `faction ${natId}`,
          title: info.name || info.code || '',
          dataAttr: { name: 'data-faction', value: natId },
          children: [
            (() => {
              if (!info.image) return null;
              const img = document.createElement('img');
              img.src = info.image;
              img.alt = '';
              img.loading = 'lazy';
              return img;
            })(),
            (() => {
              const label = document.createElement('span');
              label.textContent = info.code || info.name || natId;
              return label;
            })()
          ].filter(Boolean),
          onToggle: (active) => {
            if (active) selectedFactions.add(natId);
            else selectedFactions.delete(natId);
            applyFilter();
          }
        });
        factionContainer.appendChild(chip);
      });
      factionContainer.appendChild(makeResetChip(selectedFactions, factionContainer));
    }

    const rarityContainer = document.getElementById('rarity-chips');
    if (rarityContainer) {
      rarityContainer.textContent = '';
      // Render in canonical tier order, then any unknown tiers at the end.
      const known = RARITY_ORDER.filter((r) => rarities.has(r));
      const unknown = Array.from(rarities).filter((r) => !RARITY_ORDER.includes(r));
      [...known, ...unknown].forEach((rarity) => {
        const chip = makeChip({
          extraClass: 'chip-rarity',
          ariaLabel: rarity,
          dataAttr: { name: 'data-rarity', value: rarity },
          children: [(() => {
            const label = document.createElement('span');
            label.textContent = rarity;
            return label;
          })()],
          onToggle: (active) => {
            if (active) selectedRarities.add(rarity);
            else selectedRarities.delete(rarity);
            applyFilter();
          }
        });
        rarityContainer.appendChild(chip);
      });
      rarityContainer.appendChild(makeResetChip(selectedRarities, rarityContainer));
    }

    chipsBuilt = true;
  }

  /** Build one toggle chip. onToggle receives the new active state. */
  function makeChip({ extraClass, ariaLabel, title, dataAttr, children, onToggle }) {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = `chip ${extraClass || ''}`.trim();
    if (title) chip.title = title;
    if (ariaLabel) chip.setAttribute('aria-label', ariaLabel);
    if (dataAttr) chip.setAttribute(dataAttr.name, dataAttr.value);
    chip.setAttribute('aria-pressed', 'false');
    children.forEach((c) => chip.appendChild(c));
    chip.addEventListener('click', () => {
      const next = !chip.classList.contains('active');
      chip.classList.toggle('active', next);
      chip.setAttribute('aria-pressed', String(next));
      onToggle(next);
    });
    return chip;
  }

  /** "전체" reset chip: clears the bound Set and visually deactivates siblings. */
  function makeResetChip(boundSet, container) {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'chip chip-reset';
    chip.textContent = '전체';
    chip.title = '필터 해제';
    chip.addEventListener('click', () => {
      if (boundSet.size === 0) return; // already cleared, nothing to do
      boundSet.clear();
      container.querySelectorAll('.chip.active').forEach((c) => {
        c.classList.remove('active');
        c.setAttribute('aria-pressed', 'false');
      });
      applyFilter();
    });
    return chip;
  }

  // ===== Completion Tracking =====

  function setupCompletionTracking() {
    const grid = document.getElementById('event-grid');
    if (!grid) return;

    const cards = grid.querySelectorAll('.grid-card');
    const completionData = getCompletionData();
    const nameMap =
      (window.StoryViewer && window.StoryViewer.shipgirlNameMap) || {};

    cards.forEach((card) => {
      if (!card.dataset.id) {
        const titleEl = card.querySelector('.card-title');
        const name = titleEl ? titleEl.textContent.trim() : '';
        let derivedId = nameMap[name];
        if (!derivedId && name === '아카시') derivedId = '0';
        if (derivedId) card.dataset.id = String(derivedId);
      }

      const shipgirlIdRaw = card.dataset.id || card.dataset.eventId || '';
      const shipgirlId = String(shipgirlIdRaw);
      if (!shipgirlId) return;

      const existingCheckbox = card.querySelector('.card-checkbox');
      if (existingCheckbox) {
        const isComplete = !!completionData[String(shipgirlId)];
        card.classList.toggle('completed-card', isComplete);
        existingCheckbox.classList.toggle('completed', isComplete);
        existingCheckbox.setAttribute('aria-checked', String(isComplete));
        return;
      }

      const checkbox = document.createElement('div');
      checkbox.className = 'card-checkbox';

      if (completionData[String(shipgirlId)]) {
        checkbox.classList.add('completed');
        card.classList.add('completed-card');
      }
      checkbox.setAttribute('aria-checked', String(checkbox.classList.contains('completed')));

      makeKeyboardActivatable(checkbox, (e) => {
        e.stopPropagation();

        const fresh = getCompletionData();
        const key = String(shipgirlId);
        fresh[key] = !fresh[key];
        setCompletionData(fresh);

        checkbox.classList.toggle('completed');
        card.classList.toggle('completed-card');
        checkbox.setAttribute('aria-checked', String(checkbox.classList.contains('completed')));

        applyFilter();
      }, { role: 'checkbox' });

      card.appendChild(checkbox);
    });
  }

  // ===== Search =====

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
        applyFilter();
      }
    });

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
      'data/story-viewer/shipgirl_data.json',
      'data/mapping/nationality_mapping.json'
    ],

    processLoadedData(viewer, jsonDataArray) {
      const [taskGroups, taskData, storyData, shipgirlGroupData, shipgirlStoryData, nationalityMap] =
        jsonDataArray;

      const shipgirlData = {};
      Object.assign(shipgirlData, shipgirlStoryData, shipgirlGroupData);

      viewer.secretaryTaskGroups = taskGroups;
      viewer.shipgirlData = shipgirlData;
      viewer.nationalityMap = nationalityMap || {};

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
          // Plain-text descriptions: the engine renders via textContent, so
          // any HTML tags would show as literal characters in the card.
          viewer.storylineData[shipgirlId] = {
            id: shipgirlId,
            name: '아카시',
            icon:
              dataForToyUrl('skin_shipyard/312010.webp'),
            iconFallback:
              dataForToyUrl('skin_icon/312010.webp'),
            rarity: 'SSR',
            description: '아카시 상점 진행퀘스트'
          };
        } else if (viewer.shipgirlData[shipgirlId]) {
          const s = viewer.shipgirlData[shipgirlId];
          // skin_shipyard is the same filename as skin_icon but a taller 3:4
          // portrait — far more recognisable on the card. Some skins lack
          // shipyard files; keep skin_icon as the bg-image fallback layer.
          const portrait = typeof s.icon === 'string'
            ? s.icon.replace('/skin_icon/', '/skin_shipyard/')
            : s.icon;
          viewer.storylineData[shipgirlId] = {
            id: shipgirlId,
            name: s.name,
            icon: portrait,
            iconFallback: s.icon,
            rarity: s.rarity,
            nationality: s.nationality,
            description: '비서함 스토리'
          };
        }
      }

      viewer.shipgirlNameMap = viewer.shipgirlNameMap || {};
      for (const id in viewer.shipgirlData) {
        const n = viewer.shipgirlData[id]?.name;
        if (n) viewer.shipgirlNameMap[n] = id;
      }
      viewer.shipgirlNameMap['아카시'] = '0';
    },

    getEventIconPath(event) {
      return event.icon;
    },

    getEventMemories(eventData) {
      const memories = [];
      const groupId = String(eventData.id);
      const group = window.StoryViewer.secretaryTaskGroups[groupId];

      const taskIds = Array.isArray(group) ? group : (group?.tasks || []);
      if (!taskIds.length) return memories;

      taskIds.forEach((taskId) => {
        const memory = window.StoryViewer.secretaryMemories[taskId];
        if (!memory) return;

        const icon =
          memory.story_icon === 'akashi'
            ? dataForToyUrl('memoryicon/akashi.webp')
            : `${DATA_FOR_TOY_BASE}/memoryicon/memory_${memory.story_icon}.webp`;

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

  const observer = new MutationObserver((mutationsList) => {
    for (const m of mutationsList) {
      if (m.type === 'childList' && m.addedNodes.length > 0) {
        if (!window.StoryViewer.searchInitialized) {
          setupSearch();
          window.StoryViewer.searchInitialized = true;
        }

        buildChipRows();

        if (!initialHydrateDone) {
          initialHydrateDone = true;
          applyFilter();
        } else {
          setupCompletionTracking();
        }
        break;
      }
    }
  });

  const eventGrid = document.getElementById('event-grid');
  if (eventGrid) {
    observer.observe(eventGrid, { childList: true });

    if (eventGrid.children.length > 0 && !initialHydrateDone) {
      initialHydrateDone = true;
      buildChipRows();
      applyFilter();
    }
  }

  window.addEventListener('pagehide', () => observer.disconnect(), { once: true });

  if (
    window.StoryViewer &&
    window.StoryViewer.storylineData &&
    Object.keys(window.StoryViewer.storylineData).length &&
    !initialHydrateDone
  ) {
    initialHydrateDone = true;
    buildChipRows();
    applyFilter();
  }
});
