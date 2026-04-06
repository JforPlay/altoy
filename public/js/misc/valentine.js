/**
 * valentine.js
 * Valentine letter viewer: master list of shipgirls + per-year letter display.
 * Supports URL parameter ?name= for deep-linking; shipgirl icons resolved from ship_group_data.json.
 * NAME_ALIASES handles spelling mismatches between valentine_data.json and ship_group_data names.
 */

import { debounce, fetchJSON, resolveUrl, getUrlParam, setUrlParams, showElement, hideElement, createSearchIndex, normalizeRomanNumerals } from '../utils.js';

// ===== State =====
let valentineData = [];
let shipgirlNameMap = new Map();
let searchIndex = null;
let selectedShipgirl = null;
let selectedYear = null;

// ===== DOM References =====
const searchInput = document.getElementById('search');
const shipgirlList = document.getElementById('shipgirl-list');
const shipgirlCount = document.getElementById('shipgirl-count');
const letterHeader = document.getElementById('letter-header');
const yearTabs = document.getElementById('year-tabs');
const letterPlaceholder = document.getElementById('letter-placeholder');
const letterContentWrapper = document.getElementById('letter-content-wrapper');
const letterYearLabel = document.getElementById('letter-year-label');
const letterText = document.getElementById('letter-text');

document.addEventListener('DOMContentLoaded', async () => {
    await loadData();
    renderShipgirlList(valentineData);
    setupEventListeners();
    handleInitialSelection();
});

/**
 * Load valentine letters and ship group data in parallel.
 * Sorts the valentine list by ship ID (unmatched names go to the end), then creates a Fuse.js index.
 */
async function loadData() {
    try {
        const [valData, shipGroupData] = await Promise.all([
            fetchJSON('data/valentine_data.json'),
            fetchJSON('data/ship_group_data.json')
        ]);

        valentineData = valData;

        // Build normalized name map for O(1) lookups; ship_group_data may be array or object
        if (Array.isArray(shipGroupData)) {
            shipGroupData.forEach(ship => {
                if (ship.name) {
                    const normalized = normalizeRomanNumerals(ship.name.trim());
                    shipgirlNameMap.set(normalized, ship);
                }
            });
        } else {
            Object.entries(shipGroupData).forEach(([id, ship]) => {
                ship.id = id;
                if (ship.name) {
                    const normalized = normalizeRomanNumerals(ship.name.trim());
                    shipgirlNameMap.set(normalized, ship);
                }
            });
        }

        valentineData.sort((a, b) => {
            const shipA = findShipgirl(a.name);
            const shipB = findShipgirl(b.name);
            const idA = shipA ? parseInt(shipA.id) || Infinity : Infinity;
            const idB = shipB ? parseInt(shipB.id) || Infinity : Infinity;
            return idA - idB;
        });

        searchIndex = createSearchIndex(valentineData, {
            keys: ['name'],
            threshold: 0.3
        });
    } catch (err) {
        console.error('Failed to load data:', err);
    }
}

// Spelling mismatches between valentine_data.json and ship_group_data — map to canonical names
const NAME_ALIASES = {
    '아드미랄 히퍼': '아드미럴 히퍼',
    '어드미럴 나히모프': '아드미랄 나히모프',
};

/**
 * Look up a shipgirl by valentine name, trying: exact normalized match → alias → suffix match.
 * The suffix fallback handles entries like "라이온" matching "라이온급 전함 - 라이온".
 */
function findShipgirl(name) {
    const trimmed = name.trim();
    const normalized = normalizeRomanNumerals(trimmed);
    const match = shipgirlNameMap.get(normalized);
    if (match) return match;

    const alias = NAME_ALIASES[trimmed];
    if (alias) return shipgirlNameMap.get(normalizeRomanNumerals(alias)) || null;

    for (const [key, ship] of shipgirlNameMap) {
        if (key.endsWith(normalized)) return ship;
    }

    return null;
}

function getIconUrl(ship) {
    if (ship && ship.icon) return ship.icon;
    return null;
}

function renderShipgirlList(data) {
    shipgirlList.innerHTML = '';
    if (shipgirlCount) {
        shipgirlCount.textContent = `${data.length}명`;
    }

    const fragment = document.createDocumentFragment();
    data.forEach(entry => {
        const item = document.createElement('div');
        item.className = 'shipgirl-item';
        item.dataset.name = entry.name;

        const ship = findShipgirl(entry.name);
        const iconUrl = getIconUrl(ship);

        if (iconUrl) {
            const img = document.createElement('img');
            img.className = 'shipgirl-item-icon';
            img.src = iconUrl;
            img.alt = entry.name;
            img.loading = 'lazy';
            img.onerror = function() { this.style.display = 'none'; };
            item.appendChild(img);
        } else {
            const ph = document.createElement('div');
            ph.className = 'shipgirl-item-placeholder';
            ph.textContent = entry.name.charAt(0);
            item.appendChild(ph);
        }

        const nameSpan = document.createElement('span');
        nameSpan.className = 'shipgirl-item-name';
        nameSpan.textContent = entry.name;
        item.appendChild(nameSpan);

        item.addEventListener('click', () => selectShipgirl(entry.name));
        fragment.appendChild(item);
    });
    shipgirlList.appendChild(fragment);

    if (selectedShipgirl) {
        highlightActive(selectedShipgirl);
    }
}

function highlightActive(name) {
    shipgirlList.querySelectorAll('.shipgirl-item').forEach(el => {
        el.classList.toggle('active', el.dataset.name === name);
    });
}

function selectShipgirl(name) {
    selectedShipgirl = name;
    const entry = valentineData.find(e => e.name === name);
    if (!entry) return;

    setUrlParams({ name }, true);
    highlightActive(name);

    const ship = findShipgirl(name);
    const iconUrl = getIconUrl(ship);

    letterHeader.innerHTML = '';
    if (iconUrl) {
        const img = document.createElement('img');
        img.className = 'letter-header-icon';
        img.src = iconUrl;
        img.alt = name;
        img.onerror = function() { this.style.display = 'none'; };
        letterHeader.appendChild(img);
    } else {
        const ph = document.createElement('div');
        ph.className = 'letter-header-placeholder';
        ph.textContent = name.charAt(0);
        letterHeader.appendChild(ph);
    }
    const nameEl = document.createElement('span');
    nameEl.className = 'letter-header-name';
    nameEl.textContent = name;
    letterHeader.appendChild(nameEl);

    const years = Object.keys(entry.letters).sort();
    yearTabs.innerHTML = '';
    years.forEach(year => {
        const tab = document.createElement('button');
        tab.className = 'year-tab';
        tab.textContent = year;
        tab.dataset.year = year;
        tab.addEventListener('click', () => showLetter(entry, year));
        yearTabs.appendChild(tab);
    });

    hideElement(letterPlaceholder);
    showElement(letterContentWrapper);

    const latestYear = years[years.length - 1];
    showLetter(entry, latestYear);
}

function showLetter(entry, year) {
    selectedYear = year;

    // Update active tab
    yearTabs.querySelectorAll('.year-tab').forEach(tab => {
        tab.classList.toggle('active', tab.dataset.year === year);
    });

    const text = entry.letters[year];
    letterYearLabel.textContent = `${year}년 발렌타인`;
    letterText.textContent = text || '';
}

function setupEventListeners() {
    if (searchInput) {
        searchInput.addEventListener('input', debounce(() => {
            const query = searchInput.value.trim();
            if (!query) {
                renderShipgirlList(valentineData);
                return;
            }
            if (searchIndex) {
                const results = searchIndex.search(query);
                renderShipgirlList(results.map(r => r.item));
            }
        }, 200));
    }
}

function handleInitialSelection() {
    const nameParam = getUrlParam('name');
    if (nameParam) {
        const entry = valentineData.find(e => e.name === nameParam);
        if (entry) {
            selectShipgirl(nameParam);
            // Scroll to the item in the list
            const item = shipgirlList.querySelector(`[data-name="${CSS.escape(nameParam)}"]`);
            if (item) item.scrollIntoView({ block: 'center' });
        }
    }
}
