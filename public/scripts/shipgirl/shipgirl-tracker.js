import { debounce, fetchJSON, getStorageItem, setStorageItem } from '../utils.js';
import { ShipgirlTrackerUtils } from './shipgirl-tracker-utils.js';
document.addEventListener('DOMContentLoaded', () => {
    let fullShipData, nationalityData, shipTypeData, attrTypeData, fleetTechGoalData, factionTechData;
    let filteredShipIds = [];
    const SAVE_KEY = 'shipgirlTrackerProgress';
    const GOAL_KEY = 'shipgirlTrackerSelectedGoal';
    const UNIQUE_ID_LENGTH = 9;

    // Cached DOM elements for performance
    let cachedElements = {
        fleetTechContainer: null,
        statTechContainer: null,
        shipListContainer: null,
        filterBar: null,
        searchBar: null,
        searchDropdown: null,
        confirmationModal: null,
        modalText: null,
        modalConfirmBtn: null,
        modalCancelBtn: null
    };

    /**
     * Caches frequently accessed DOM elements for performance optimization.
     */
    function cacheDOMElements() {
        cachedElements.fleetTechContainer = document.getElementById('fleet-tech-container');
        cachedElements.statTechContainer = document.getElementById('stat-tech-container');
        cachedElements.shipListContainer = document.getElementById('ship-list-container');
        cachedElements.filterBar = document.getElementById('filter-bar');
        cachedElements.confirmationModal = document.getElementById('confirmation-modal');
        cachedElements.modalText = document.getElementById('modal-text');
        cachedElements.modalConfirmBtn = document.getElementById('modal-confirm-btn');
        cachedElements.modalCancelBtn = document.getElementById('modal-cancel-btn');
    }

    // Use utilities from external file
    const { parseDatasetInt, getCheckedFilterValues, filterSearchDropdown, setupDropdownToggle, createTrackerItem } = ShipgirlTrackerUtils;

    /**
     * Lookup ship data by name for goal tracker.
     * @param {string} shipName - Ship name to search for.
     * @returns {object|null} Ship data or null if not found.
     */
    function getShipDataByName(shipName) {
        return Object.values(fullShipData).find(ship => ship.name === shipName) ||
               Object.values(fullShipData).find(ship =>
                   ship.name && (ship.name.includes(shipName) || shipName.includes(ship.name))
               ) || null;
    }

    /**
     * Fetches all necessary data from JSON files.
     * This includes ship data, nationality mappings, ship type mappings, and attribute mappings.
     * It uses Promise.all for efficient, parallel fetching.
     */
    async function fetchData() {
        // Paths to the data files.
        const dataPaths = [
            'data/ship_group_data.json',
            'data/mapping/nationality_mapping.json',
            'data/mapping/ship_type_mapping.json',
            'data/mapping/attr_type_mapping.json',
            'data/shipgirl/fleet_tech_goal.json',
            'data/shipgirl/fleet_tech_template.json'
        ];
        try {
            // Fetch and parse all files simultaneously using global fetchJSON
            [fullShipData, nationalityData, shipTypeData, attrTypeData, fleetTechGoalData, factionTechData] = await Promise.all(
                dataPaths.map(path => fetchJSON(path))
            );
        } catch (error) {
            // Log the error and display a message to the user if fetching fails.
            console.error("Error loading data files:", error);
            const container = document.getElementById('ship-list-container');
            if (container) container.innerHTML = `<p style="color: red; text-align: center;">데이터 파일을 불러오는 데 실패했습니다. 파일 경로와 JSON 형식을 확인하세요.</p>`;
            // Re-throw the error to stop further execution.
            throw error;
        }
    }

    function createShipCard(ship, shipId) {
        const card = document.createElement('div');
        card.className = 'ship-card';
    
        // Store ship data as data attributes on the card element for easy access.
        card.dataset.shipId = shipId;
        card.dataset.nationality = ship.nationality;
        card.dataset.type = ship.type;
        card.dataset.rarity = ship.rarity;
        card.dataset.name = ship.name;
        card.dataset.ptGet = ship.pt_get ?? 0;
        card.dataset.ptLevel = ship.pt_level ?? 0;
        card.dataset.ptUpgrade = ship.pt_upgrage ?? 0;
    
        // Add additional attributes if they exist.
        if (ship.add_get_attr) {
            card.dataset.addGetAttr = ship.add_get_attr;
            card.dataset.addGetShiptype = ship.add_get_shiptype.join(',');
            card.dataset.addGetValue = ship.add_get_value;
        }
        if (ship.add_level_attr) {
            card.dataset.addLevelAttr = ship.add_level_attr;
            card.dataset.addLevelShiptype = ship.add_level_shiptype.join(',');
            card.dataset.addLevelValue = ship.add_level_value;
        }
    
        // Create and append the ship's icon.
        const icon = document.createElement('img');
        icon.src = ship.icon;
        icon.alt = ship.name;
        icon.className = 'ship-icon';
        icon.loading = 'lazy'; // Lazy load images for better performance.
        card.appendChild(icon);
    
        // Create and append the ship's name.
        const name = document.createElement('div');
        name.className = 'ship-name';
        name.textContent = ship.name;
        card.appendChild(name);
    
        // Create the info section for nationality, type, and rarity.
        const infoSection = document.createElement('div');
        infoSection.className = 'info-section';
    
        const nationInfo = nationalityData[ship.nationality];
        if (nationInfo) {
            const infoItem = document.createElement('div');
            infoItem.className = 'info-item';
            infoItem.title = nationInfo.name;
            infoItem.innerHTML = `<img src="${nationInfo.image}" alt="${nationInfo.name}" class="info-icon"><span>${nationInfo.code || nationInfo.name}</span>`;
            infoSection.appendChild(infoItem);
        }
    
        const primaryTypeInfo = shipTypeData[ship.type];
        if (primaryTypeInfo) {
            const infoItem = document.createElement('div');
            infoItem.className = 'info-item';
            infoItem.title = primaryTypeInfo.type_name;
            infoItem.innerHTML = `<img src="${primaryTypeInfo.icon}" alt="${primaryTypeInfo.type_name}" class="info-icon"><span>${primaryTypeInfo.type_name}</span>`;
            infoSection.appendChild(infoItem);
        }
    
        if (ship.rarity) {
            const infoItem = document.createElement('div');
            infoItem.className = 'info-item';
            const raritySpan = document.createElement('span');
            raritySpan.className = `rarity-text rarity-${ship.rarity}`;
            raritySpan.textContent = ship.rarity;
            infoItem.appendChild(raritySpan);
            infoSection.appendChild(infoItem);
        }
        card.appendChild(infoSection);
    
        // Create and append the description section if it exists.
        if (ship.description && ship.description.length > 0) {
            const descriptionSection = document.createElement('div');
            descriptionSection.className = 'description-section';
            const label = document.createElement('div');
            label.className = 'description-label';
            label.textContent = '입수 방법';
            descriptionSection.appendChild(label);
            const list = document.createElement('ul');
            list.className = 'description-list';
            ship.description.forEach(desc => {
                const listItem = document.createElement('li');
                listItem.textContent = `• ${desc}`;
                list.appendChild(listItem);
            });
            descriptionSection.appendChild(list);
            card.appendChild(descriptionSection);
        }
    
        // Create the tracker section with checkboxes for progress.
        const trackerSection = document.createElement('div');
        trackerSection.className = 'tracker-section';
        if (ship.pt_get !== undefined) trackerSection.appendChild(createTrackerItem('입수 시', ship.pt_get, 'get', UNIQUE_ID_LENGTH));
        if (ship.pt_level !== undefined) trackerSection.appendChild(createTrackerItem('120 달성시', ship.pt_level, 'level', UNIQUE_ID_LENGTH));
        if (ship.pt_upgrage !== undefined) trackerSection.appendChild(createTrackerItem('풀돌 시', ship.pt_upgrage, 'upgrade', UNIQUE_ID_LENGTH));
        if (trackerSection.hasChildNodes()) {
            card.appendChild(trackerSection);
        }
    
        return card;
    }

    /**
     * Handles the logic for checkbox interactions within a ship card.
     * For example, checking "120 달성시" will also check "입수 시".
     * @param {HTMLInputElement} checkbox - The checkbox that was changed.
     */
    function handleCheckboxLogic(checkbox) {
        const card = checkbox.closest('.ship-card');
        if (!card) return;
        const getCheckbox = card.querySelector('[data-type="get"]');
        const levelCheckbox = card.querySelector('[data-type="level"]');
        const upgradeCheckbox = card.querySelector('[data-type="upgrade"]');
        if (checkbox.checked) {
            // If level or upgrade is checked, 'get' must also be checked.
            if ((checkbox.dataset.type === 'level' || checkbox.dataset.type === 'upgrade') && getCheckbox) {
                getCheckbox.checked = true;
            }
        } else {
            // If 'get' is unchecked, level and upgrade must also be unchecked.
            if (checkbox.dataset.type === 'get') {
                if (levelCheckbox) levelCheckbox.checked = false;
                if (upgradeCheckbox) upgradeCheckbox.checked = false;
            }
        }
    }

    /**
     * Calculates the scores based on the checked items and updates the display.
     * Returns calculated scores for reuse by goal tracker.
     */
    function calculateAndDisplayScores() {
        // Initialize score objects efficiently
        const fleetTech = Object.fromEntries(Object.keys(nationalityData).map(id => [id, 0]));
        const statTech = Object.fromEntries(Object.keys(attrTypeData).map(id => [id, {}]));
        const fleetTechByName = {}; // For goal tracker (by nationality name)
        const positionCounts = {}; // For goal tracker (by position)

        // Iterate over all ship cards to calculate scores (use cached container for better performance)
        const shipCards = cachedElements.shipListContainer?.querySelectorAll('.ship-card') || [];
        shipCards.forEach(card => {
            const data = card.dataset;
            const nationId = data.nationality;
            const nationalityName = nationalityData[nationId]?.name;
            const typeId = data.type;
            const position = shipTypeData[typeId]?.position;
            const isGetChecked = card.querySelector('[data-type="get"]')?.checked;
            const isLevelChecked = card.querySelector('[data-type="level"]')?.checked;
            const isUpgradeChecked = card.querySelector('[data-type="upgrade"]')?.checked;

            if (isGetChecked) {
                fleetTech[nationId] += parseDatasetInt(data.ptGet);

                // Calculate for goal tracker (avoid duplicate calculation)
                if (nationalityName) {
                    if (!fleetTechByName[nationalityName]) fleetTechByName[nationalityName] = 0;
                    fleetTechByName[nationalityName] += parseDatasetInt(data.ptGet);
                }
                if (nationalityName && position) {
                    if (!positionCounts[nationalityName]) positionCounts[nationalityName] = {};
                    if (!positionCounts[nationalityName][position]) positionCounts[nationalityName][position] = 0;
                    positionCounts[nationalityName][position]++;
                }

                if (data.addGetAttr) {
                    data.addGetShiptype.split(',').forEach(type => {
                        if (!statTech[data.addGetAttr]) statTech[data.addGetAttr] = {};
                        if (!statTech[data.addGetAttr][type]) statTech[data.addGetAttr][type] = { get: 0, level: 0 };
                        statTech[data.addGetAttr][type].get += parseDatasetInt(data.addGetValue);
                    });
                }
            }
            if (isLevelChecked) {
                fleetTech[nationId] += parseDatasetInt(data.ptLevel);

                // Add to goal tracker scores
                if (nationalityName) {
                    if (!fleetTechByName[nationalityName]) fleetTechByName[nationalityName] = 0;
                    fleetTechByName[nationalityName] += parseDatasetInt(data.ptLevel);
                }

                if (data.addLevelAttr) {
                    data.addLevelShiptype.split(',').forEach(type => {
                        if (!statTech[data.addLevelAttr]) statTech[data.addLevelAttr] = {};
                        if (!statTech[data.addLevelAttr][type]) statTech[data.addLevelAttr][type] = { get: 0, level: 0 };
                        statTech[data.addLevelAttr][type].level += parseDatasetInt(data.addLevelValue);
                    });
                }
            }
            if (isUpgradeChecked) {
                fleetTech[nationId] += parseDatasetInt(data.ptUpgrade);

                // Add to goal tracker scores
                if (nationalityName) {
                    if (!fleetTechByName[nationalityName]) fleetTechByName[nationalityName] = 0;
                    fleetTechByName[nationalityName] += parseDatasetInt(data.ptUpgrade);
                }
            }
        });

        // Render the updated score tables.
        renderFleetTechTable(fleetTech);
        renderStatTechTable(statTech);
        updateGoalDisplay(fleetTechByName, positionCounts); // Pass pre-calculated data

        // Calculate and render faction tech bonuses
        const factionBonuses = calculateFactionTechBonuses(fleetTechByName);
        renderFactionTechBonuses(factionBonuses);
    }

    // Create debounced version for checkbox changes (150ms delay)
    const debouncedCalculateScores = debounce(calculateAndDisplayScores, 150);

    /**
     * Calculates faction tech levels and bonuses based on current scores.
     * Only uses: id, groupid, pt, add fields from fleet_tech_template.json
     * @param {object} fleetTechByName - Fleet tech scores by nationality name.
     * @returns {object} Faction tech levels and bonuses for each faction.
     */
    function calculateFactionTechBonuses(fleetTechByName) {
        const factionBonuses = {};

        // Process each nationality to find their faction groupid
        Object.entries(nationalityData).forEach(([natId, natData]) => {
            const groupId = parseInt(natId);
            if (isNaN(groupId) || groupId < 1 || groupId > 4) return;

            const nationName = natData.name;
            const currentScore = fleetTechByName[nationName] || 0;

            // Find highest tech level achieved based on pt (required score)
            let currentLevel = 0;
            let activeTechData = null;

            for (let level = 1; level <= 9; level++) {
                const techId = `${groupId}00${level}`;
                const techData = factionTechData[techId];

                // pt field = required score to reach this level
                if (techData && currentScore >= techData.pt) {
                    currentLevel = level;
                    activeTechData = techData;
                } else {
                    break; // Stop if score insufficient for next level
                }
            }

            // Only show factions with achieved levels
            if (activeTechData && currentLevel > 0) {
                // Aggregate bonuses by attr_type
                // add field format: [[ship_types], attr_type, value]
                const bonusesByAttr = {};

                activeTechData.add.forEach(([shipTypes, attrType, value]) => {
                    if (!bonusesByAttr[attrType]) {
                        bonusesByAttr[attrType] = {
                            types: new Set(),
                            value: 0
                        };
                    }
                    shipTypes.forEach(typeId => {
                        const typeName = shipTypeData[typeId]?.name;
                        if (typeName) bonusesByAttr[attrType].types.add(typeName);
                    });
                    bonusesByAttr[attrType].value += value;
                });

                factionBonuses[groupId] = {
                    name: nationName,
                    level: currentLevel,
                    score: currentScore,
                    nextLevelScore: factionTechData[`${groupId}00${currentLevel + 1}`]?.pt || null,
                    bonuses: bonusesByAttr
                };
            }
        });

        return factionBonuses;
    }

    /**
     * Renders the faction tech bonuses display.
     * @param {object} factionBonuses - Calculated faction bonuses.
     */
    function renderFactionTechBonuses(factionBonuses) {
        let container = document.getElementById('faction-tech-container');

        // Create container if it doesn't exist
        if (!container) {
            const scoreArea = document.getElementById('score-display-area');
            if (!scoreArea) return;

            container = document.createElement('div');
            container.id = 'faction-tech-container';
            container.className = 'faction-tech-wrapper';
            scoreArea.parentNode.insertBefore(container, scoreArea.nextSibling);
        }

        container.innerHTML = '';

        // Header
        const header = document.createElement('div');
        header.className = 'faction-tech-header';
        header.textContent = '진영 기술 보너스';
        container.appendChild(header);

        // Grid container
        const grid = document.createElement('div');
        grid.className = 'faction-tech-grid';

        // Render each faction card
        Object.entries(factionBonuses).forEach(([groupId, data]) => {
            if (!data || data.level === 0) return;

            const card = document.createElement('div');
            card.className = 'faction-tech-card';

            // Card header
            const cardHeader = document.createElement('div');
            cardHeader.className = 'faction-tech-card-header';

            const factionName = document.createElement('div');
            factionName.className = 'faction-name';
            factionName.textContent = data.name;

            const levelBadge = document.createElement('div');
            levelBadge.className = `faction-level${data.level === 9 ? ' max-level' : ''}`;
            levelBadge.textContent = `Lv ${data.level}`;

            cardHeader.appendChild(factionName);
            cardHeader.appendChild(levelBadge);
            card.appendChild(cardHeader);

            // Progress to next level (if not max)
            if (data.nextLevelScore) {
                const progress = document.createElement('div');
                progress.className = 'faction-progress';
                progress.textContent = `다음 레벨: ${data.score} / ${data.nextLevelScore}`;
                card.appendChild(progress);
            }

            // Bonuses list
            const bonusesList = document.createElement('div');
            bonusesList.className = 'faction-bonuses';

            Object.entries(data.bonuses).forEach(([attrType, bonusData]) => {
                const bonusItem = document.createElement('div');
                bonusItem.className = 'faction-bonus-item';

                const typesText = document.createElement('div');
                typesText.className = 'bonus-types';
                const attrName = attrTypeData[attrType]?.condition || `속성 ${attrType}`;
                const shipTypesText = Array.from(bonusData.types).join(', ');
                typesText.textContent = `${shipTypesText} ${attrName}`;

                const valueText = document.createElement('div');
                valueText.className = 'bonus-value';
                valueText.textContent = `+${bonusData.value}`;

                bonusItem.appendChild(typesText);
                bonusItem.appendChild(valueText);
                bonusesList.appendChild(bonusItem);
            });

            card.appendChild(bonusesList);
            grid.appendChild(card);
        });

        container.appendChild(grid);
    }

    /**
     * Renders the fleet tech score table.
     * @param {object} scores - The calculated fleet tech scores.
     */
    function renderFleetTechTable(scores) {
        const container = cachedElements.fleetTechContainer;
        if (!container) return;
        container.innerHTML = '';

        const wrapper = document.createElement('div');
        wrapper.className = 'score-table-wrapper';

        const title = document.createElement('h2');
        title.textContent = '진영 점수';
        wrapper.appendChild(title);

        const table = document.createElement('table');
        table.className = 'score-table';

        const thead = table.createTHead();
        const headerRow = thead.insertRow();
        headerRow.innerHTML = '<th>진영</th><th>점수</th>';

        const tbody = table.createTBody();
        Object.keys(scores).forEach(id => {
            if (nationalityData[id] && scores[id] > 0) {
                const row = tbody.insertRow();
                const cell1 = row.insertCell();
                cell1.className = 'header-col';
                cell1.textContent = nationalityData[id].name;
                const cell2 = row.insertCell();
                cell2.textContent = scores[id];
            }
        });

        wrapper.appendChild(table);
        container.appendChild(wrapper);
    }

    /**
     * Renders the stat tech score table.
     * @param {object} scores - The calculated stat tech scores.
     */
    function renderStatTechTable(scores) {
        const container = cachedElements.statTechContainer;
        if (!container) return;
        container.innerHTML = '';

        const headers = new Set();
        Object.values(scores).forEach(attrScores => Object.keys(attrScores).forEach(typeId => headers.add(typeId)));

        if (headers.size === 0) {
            return; // Don't render if there are no scores.
        }

        const sortedHeaders = Array.from(headers).sort((a, b) => a - b);

        const wrapper = document.createElement('div');
        wrapper.className = 'score-table-wrapper';

        const title = document.createElement('h2');
        title.textContent = '함대 기술점수 (획득/120렙)';
        wrapper.appendChild(title);

        const table = document.createElement('table');
        table.className = 'score-table';

        const thead = table.createTHead();
        const headerRow = thead.insertRow();
        headerRow.innerHTML = `<th>속성</th>${sortedHeaders.map(id => `<th>${shipTypeData[id]?.type_name || `Type ${id}`}</th>`).join('')}`;

        const tbody = table.createTBody();
        for (const attrId in scores) {
            if (Object.keys(scores[attrId]).length > 0) {
                const row = tbody.insertRow();
                const cell1 = row.insertCell();
                cell1.className = 'header-col';
                cell1.textContent = attrTypeData[attrId]?.condition || `스탯 ${attrId}`;

                sortedHeaders.forEach(typeId => {
                    const cell = row.insertCell();
                    const cellScores = scores[attrId][typeId] || { get: 0, level: 0 };
                    if (cellScores.get > 0 || cellScores.level > 0) {
                        cell.textContent = `+${cellScores.get} / +${cellScores.level}`;
                    } else {
                        cell.textContent = '0';
                    }
                });
            }
        }

        wrapper.appendChild(table);
        container.appendChild(wrapper);
    }

    /**
     * Gets or sets the selected goal ship name.
     */
    function getSelectedGoal() {
        const saved = getStorageItem(GOAL_KEY, null);
        if (saved && fleetTechGoalData[saved]) {
            return saved;
        }
        // Default to first ship
        return Object.keys(fleetTechGoalData)[0];
    }

    function setSelectedGoal(shipName) {
        setStorageItem(GOAL_KEY, shipName);
    }

    /**
     * Renders the goal tracker panel with hybrid selection UI.
     */
    function renderGoalTracker() {
        const mainElement = document.querySelector('main');
        const filterBar = document.getElementById('filter-bar');

        // Remove existing goal tracker if present
        const existingToggle = document.getElementById('goal-tracker-toggle-btn');
        const existingTracker = document.getElementById('goal-tracker-panel');
        if (existingToggle) existingToggle.remove();
        if (existingTracker) existingTracker.remove();

        // Create toggle button
        const toggleButton = document.createElement('button');
        toggleButton.id = 'goal-tracker-toggle-btn';
        const toggleText = document.createElement('span');
        toggleText.textContent = '목표 달성 현황 보기';
        const toggleChevron = document.createElement('span');
        toggleChevron.className = 'chevron';
        toggleChevron.textContent = '▼';
        toggleButton.appendChild(toggleText);
        toggleButton.appendChild(toggleChevron);

        // Create goal tracker container
        const goalPanel = document.createElement('div');
        goalPanel.id = 'goal-tracker-panel';
        goalPanel.className = 'goal-tracker-panel collapsed';

        toggleButton.addEventListener('click', () => {
            const isCollapsed = goalPanel.classList.toggle('collapsed');
            toggleText.textContent = isCollapsed ? '목표 달성 현황 보기' : '목표 달성 현황 숨기기';
            toggleChevron.textContent = isCollapsed ? '▼' : '▲';
        });

        // Create selection controls container
        const selectionContainer = document.createElement('div');
        selectionContainer.className = 'goal-selection-container';

        // Create dropdown for goal selection
        const dropdownWrapper = document.createElement('div');
        dropdownWrapper.className = 'goal-dropdown-wrapper';

        const dropdownLabel = document.createElement('label');
        dropdownLabel.textContent = '현재 목표:';
        dropdownLabel.className = 'goal-dropdown-label';

        const dropdown = document.createElement('select');
        dropdown.id = 'goal-select-dropdown';
        dropdown.className = 'goal-select-dropdown';

        // Group ships by project
        const projects = [...new Set(Object.values(fleetTechGoalData).map(ship => ship.project))].sort((a, b) => a - b);

        projects.forEach(project => {
            const optgroup = document.createElement('optgroup');
            optgroup.label = `${project}기`;

            Object.entries(fleetTechGoalData)
                .filter(([name, data]) => data.project === project)
                .forEach(([shipName, goalData]) => {
                    const option = document.createElement('option');
                    option.value = shipName;
                    option.textContent = `${shipName} (${goalData.rarity_type})`;
                    optgroup.appendChild(option);
                });

            dropdown.appendChild(optgroup);
        });

        const selectedGoal = getSelectedGoal();
        dropdown.value = selectedGoal;

        dropdown.addEventListener('change', (e) => {
            setSelectedGoal(e.target.value);
            updateGoalDisplay();
            updateQuickButtons();
        });

        dropdownWrapper.appendChild(dropdownLabel);
        dropdownWrapper.appendChild(dropdown);
        selectionContainer.appendChild(dropdownWrapper);

        // Create quick selection buttons container
        const quickButtonsWrapper = document.createElement('div');
        quickButtonsWrapper.className = 'goal-quick-buttons-wrapper';

        const quickLabel = document.createElement('div');
        quickLabel.textContent = '빠른 선택:';
        quickLabel.className = 'goal-quick-label';
        quickButtonsWrapper.appendChild(quickLabel);

        const quickButtonsContainer = document.createElement('div');
        quickButtonsContainer.id = 'goal-quick-buttons';
        quickButtonsContainer.className = 'goal-quick-buttons';

        quickButtonsWrapper.appendChild(quickButtonsContainer);
        selectionContainer.appendChild(quickButtonsWrapper);

        // Create detail card container
        const detailContainer = document.createElement('div');
        detailContainer.id = 'goal-detail-container';
        detailContainer.className = 'goal-detail-container';

        // Assemble panel
        goalPanel.appendChild(selectionContainer);
        goalPanel.appendChild(detailContainer);

        // Insert into DOM after filter bar (filter bar should be sticky at top)
        const shipListContainer = document.getElementById('ship-list-container');
        mainElement.insertBefore(toggleButton, shipListContainer);
        mainElement.insertBefore(goalPanel, shipListContainer);

        // Initial render
        updateQuickButtons();
        updateGoalDisplay();
    }

    /**
     * Updates the quick selection buttons based on current goal's project.
     */
    function updateQuickButtons() {
        const quickButtonsContainer = document.getElementById('goal-quick-buttons');
        if (!quickButtonsContainer) return;

        quickButtonsContainer.innerHTML = '';

        const selectedGoal = getSelectedGoal();
        const selectedProject = fleetTechGoalData[selectedGoal]?.project;

        // Get all ships from the same project
        const projectShips = Object.entries(fleetTechGoalData)
            .filter(([name, data]) => data.project === selectedProject)
            .sort((a, b) => a[0].localeCompare(b[0]));

        projectShips.forEach(([shipName, goalData]) => {
            const button = document.createElement('button');
            button.className = 'goal-quick-button';
            button.textContent = shipName;

            if (shipName === selectedGoal) {
                button.classList.add('active');
            }

            button.addEventListener('click', () => {
                setSelectedGoal(shipName);
                document.getElementById('goal-select-dropdown').value = shipName;
                updateGoalDisplay();
                updateQuickButtons();
            });

            quickButtonsContainer.appendChild(button);
        });
    }

    /**
     * Updates the goal detail display for the selected ship.
     * @param {object} currentScores - Pre-calculated fleet tech scores from calculateAndDisplayScores
     * @param {object} positionCounts - Pre-calculated position counts from calculateAndDisplayScores
     */
    function updateGoalDisplay(currentScores, positionCounts) {
        const detailContainer = document.getElementById('goal-detail-container');
        if (!detailContainer) return;

        const selectedGoal = getSelectedGoal();
        const goalData = fleetTechGoalData[selectedGoal];

        if (!goalData) return;

        // If scores not provided (e.g., goal selection changed), recalculate by calling calculateAndDisplayScores
        if (!currentScores || !positionCounts) {
            calculateAndDisplayScores(); // This will call updateGoalDisplay with scores
            return;
        }

        // Data provided - update progress bars efficiently
        updateGoalProgressBars(selectedGoal, goalData, currentScores, positionCounts);
    }

    /**
     * Efficiently updates only the progress bars without recreating the entire card.
     */
    function updateGoalProgressBars(shipName, goalData, currentScores, positionCounts) {
        const detailContainer = document.getElementById('goal-detail-container');
        if (!detailContainer) return;

        const card = detailContainer.querySelector('.goal-card');
        const currentShipName = card?.querySelector('.goal-ship-name')?.textContent;

        // Card doesn't exist OR different ship selected - do full render
        if (!card || currentShipName !== shipName) {
            detailContainer.innerHTML = '';
            const newCard = createDetailedGoalCard(shipName, goalData, currentScores, positionCounts);
            detailContainer.appendChild(newCard);
            return;
        }

        // Update each requirement's progress bar
        const requirements = card.querySelectorAll('.goal-requirement');
        let reqIndex = 0;

        for (let i = 1; i <= 3; i++) {
            const nationality = goalData[`unlock_${i}`];
            const reqType = goalData[`unlock_${i}_req_type`];
            const reqValue = parseDatasetInt(goalData[`unlock_${i}_req_type_value`]);

            if (!nationality || !reqType || !reqValue) continue;

            const req = requirements[reqIndex];
            if (!req) continue;

            let current = 0;
            let isComplete = false;

            if (reqType === '점수') {
                current = currentScores[nationality] || 0;
                isComplete = current >= reqValue;
            } else {
                current = positionCounts[nationality]?.[reqType] || 0;
                isComplete = current >= reqValue;
            }

            // Update progress bar
            const progressFill = req.querySelector('.goal-progress-fill');
            const progressText = req.querySelector('.goal-progress-text');

            if (progressFill && progressText) {
                const percentage = Math.min((current / reqValue) * 100, 100);
                progressFill.style.width = `${percentage}%`;

                if (isComplete) {
                    progressFill.classList.add('complete');
                    progressText.classList.add('complete');
                    progressText.innerHTML = `${current} / ${reqValue} <span class="checkmark">✓</span>`;
                } else {
                    progressFill.classList.remove('complete');
                    progressText.classList.remove('complete');
                    progressText.textContent = `${current} / ${reqValue}`;
                }
            }

            reqIndex++;
        }

        // Update overall completion status
        let allComplete = true;
        for (let i = 1; i <= 3; i++) {
            const nationality = goalData[`unlock_${i}`];
            const reqType = goalData[`unlock_${i}_req_type`];
            const reqValue = parseDatasetInt(goalData[`unlock_${i}_req_type_value`]);

            if (!nationality || !reqType || !reqValue) continue;

            let current = 0;
            if (reqType === '점수') {
                current = currentScores[nationality] || 0;
            } else {
                current = positionCounts[nationality]?.[reqType] || 0;
            }

            if (current < reqValue) {
                allComplete = false;
                break;
            }
        }

        // Toggle complete state on card
        const completeLabel = card.querySelector('.goal-complete-label');
        if (allComplete) {
            card.classList.add('complete');
            if (!completeLabel) {
                const label = document.createElement('div');
                label.className = 'goal-complete-label';
                label.textContent = '✓ 해금 가능';
                card.querySelector('.goal-card-content').appendChild(label);
            }
        } else {
            card.classList.remove('complete');
            if (completeLabel) completeLabel.remove();
        }
    }

    /**
     * Creates a detailed goal card for a single ship (larger, more detailed version).
     */
    function createDetailedGoalCard(shipName, goalData, currentScores, positionCounts) {
        const card = document.createElement('div');
        card.className = 'goal-card goal-card-detailed';

        // Use cached ship data lookup (much faster than repeated searches)
        const shipData = getShipDataByName(shipName);

        // Create main content wrapper (left side)
        const contentWrapper = document.createElement('div');
        contentWrapper.className = 'goal-card-content';

        // Header with ship name and rarity
        const header = document.createElement('div');
        header.className = 'goal-card-header';

        const nameSpan = document.createElement('span');
        nameSpan.className = 'goal-ship-name';
        nameSpan.textContent = shipName;

        const raritySpan = document.createElement('span');
        raritySpan.className = `goal-rarity rarity-${goalData.rarity_type}`;
        raritySpan.textContent = goalData.rarity_type;

        header.appendChild(nameSpan);
        header.appendChild(raritySpan);
        contentWrapper.appendChild(header);

        // Requirements container
        const reqsContainer = document.createElement('div');
        reqsContainer.className = 'goal-requirements';

        let allComplete = true;

        // Process up to 3 unlock requirements
        for (let i = 1; i <= 3; i++) {
            const nationality = goalData[`unlock_${i}`];
            const reqType = goalData[`unlock_${i}_req_type`];
            const reqValue = parseDatasetInt(goalData[`unlock_${i}_req_type_value`]);

            if (!nationality || !reqType || !reqValue) continue;

            const req = document.createElement('div');
            req.className = 'goal-requirement';

            let current = 0;
            let label = '';
            let isComplete = false;

            if (reqType === '점수') {
                // Fleet tech score requirement
                current = currentScores[nationality] || 0;
                label = `${nationality} 점수`;
                isComplete = current >= reqValue;
            } else {
                // Position-based requirement (전열 or 후열)
                current = positionCounts[nationality]?.[reqType] || 0;
                label = `${nationality} ${reqType}`;
                isComplete = current >= reqValue;
            }

            if (!isComplete) allComplete = false;

            // Requirement label
            const reqLabel = document.createElement('div');
            reqLabel.className = 'goal-req-label';
            reqLabel.textContent = label;

            // Progress bar
            const progressBar = document.createElement('div');
            progressBar.className = 'goal-progress-bar';

            const progressFill = document.createElement('div');
            progressFill.className = 'goal-progress-fill';
            const percentage = Math.min((current / reqValue) * 100, 100);
            progressFill.style.width = `${percentage}%`;
            if (isComplete) progressFill.classList.add('complete');

            progressBar.appendChild(progressFill);

            // Progress text
            const progressText = document.createElement('div');
            progressText.className = 'goal-progress-text';
            progressText.textContent = `${current} / ${reqValue}`;
            if (isComplete) {
                progressText.classList.add('complete');
                progressText.innerHTML = `${current} / ${reqValue} <span class="checkmark">✓</span>`;
            }

            req.appendChild(reqLabel);
            req.appendChild(progressBar);
            req.appendChild(progressText);
            reqsContainer.appendChild(req);
        }

        contentWrapper.appendChild(reqsContainer);

        // Overall completion status
        if (allComplete) {
            card.classList.add('complete');
            const completeLabel = document.createElement('div');
            completeLabel.className = 'goal-complete-label';
            completeLabel.textContent = '✓ 해금 가능';
            contentWrapper.appendChild(completeLabel);
        }

        // Add content to card
        card.appendChild(contentWrapper);

        // Add ship image (right side) - always create wrapper for consistent layout
        const imageWrapper = document.createElement('div');
        imageWrapper.className = 'goal-card-image-wrapper';

        if (shipData && shipData.icon) {
            const image = document.createElement('img');
            image.src = shipData.icon;
            image.alt = shipName;
            image.className = 'goal-card-image';
            image.loading = 'lazy';

            // Add error handling for missing images
            image.onerror = () => {
                // Show placeholder instead of hiding
                image.style.display = 'none';
                const placeholder = document.createElement('div');
                placeholder.className = 'goal-card-image-placeholder';
                placeholder.textContent = '?';
                imageWrapper.appendChild(placeholder);
            };

            imageWrapper.appendChild(image);
        } else {
            // No ship data found - show placeholder
            const placeholder = document.createElement('div');
            placeholder.className = 'goal-card-image-placeholder';
            placeholder.textContent = '?';
            imageWrapper.appendChild(placeholder);
        }

        card.appendChild(imageWrapper);

        return card;
    }

    /**
     * Populates the filter bar with all filter options.
     */
    function populateFilters() {
        const filterBar = document.getElementById('filter-bar');
        filterBar.innerHTML = '';

        const topFiltersWrapper = document.createElement('div');
        topFiltersWrapper.className = 'top-filters-wrapper';
        filterBar.appendChild(topFiltersWrapper);

        const searchContainer = document.createElement('div');
        searchContainer.className = 'search-container';
        const searchLabel = document.createElement('label');
        searchLabel.htmlFor = 'search-bar';
        searchLabel.className = 'filter-group-label';
        searchLabel.textContent = '함순이 검색';
        searchContainer.appendChild(searchLabel);

        const dropdownContainer = document.createElement('div');
        dropdownContainer.className = 'dropdown-container';
        const searchInput = document.createElement('input');
        searchInput.type = 'text';
        searchInput.id = 'search-bar';
        searchInput.placeholder = '이름으로 검색...';
        searchInput.autocomplete = 'off';
        dropdownContainer.appendChild(searchInput);

        const searchDropdown = document.createElement('div');
        searchDropdown.className = 'dropdown-content';
        searchDropdown.id = 'search-dropdown';
        dropdownContainer.appendChild(searchDropdown);
        searchContainer.appendChild(dropdownContainer);
        topFiltersWrapper.appendChild(searchContainer);

        const allShipNames = Object.values(fullShipData).map(ship => ship.name).filter(Boolean).sort((a, b) => a.localeCompare(b));
        allShipNames.forEach(name => {
            const a = document.createElement('a');
            a.textContent = name;
            a.addEventListener('click', () => {
                searchInput.value = name;
                searchDropdown.style.display = 'none';
                applyFilters();
            });
            searchDropdown.appendChild(a);
        });

        const dropdownGroupWrapper = document.createElement('div');
        dropdownGroupWrapper.className = 'dropdown-group-wrapper';
        const dropdownGroupLabel = document.createElement('label');
        dropdownGroupLabel.className = 'filter-group-label';
        dropdownGroupLabel.textContent = '보기 옵션';
        dropdownGroupWrapper.appendChild(dropdownGroupLabel);

        const dropdownControlsContainer = document.createElement('div');
        dropdownControlsContainer.className = 'dropdown-controls-container';
        const dropdownFilters = [
            { id: 'progress-filter', label: '체크된 함순이들로 필터링', options: { all: '체크여부 - 전체', checked: '하나라도 체크됨', unchecked: '체크 안됨' }, description: '체크박스 상태에 따라 함순이를 필터링합니다.' },
            { id: 'get-attr-filter', label: '입수 스탯으로 필터링', data: attrTypeData, allOptionText: '입수스탯 - 전체', description: '함순이 입수 시 제공하는 함대 기술 스탯으로 필터링합니다.' },
            { id: 'level-attr-filter', label: '120렙 스탯으로 필터링', data: attrTypeData, allOptionText: '120스탯 - 전체', description: '함순이 120레벨 달성 시 제공하는 함대 기술 스탯으로 필터링합니다.' }
        ];
        dropdownFilters.forEach(f => {
            const group = document.createElement('div');
            group.className = 'dropdown-filter-group';
            if (f.description) {
                group.setAttribute('data-tooltip', f.description);
            }
            const label = document.createElement('label');
            label.htmlFor = f.id;
            label.className = 'filter-group-label sr-only';
            label.textContent = f.label;
            group.appendChild(label);

            const select = document.createElement('select');
            select.id = f.id;
            select.setAttribute('aria-label', f.label);
            if (f.options) {
                Object.entries(f.options).forEach(([val, text]) => {
                    const option = document.createElement('option');
                    option.value = val;
                    option.textContent = text;
                    select.appendChild(option);
                });
            } else {
                const allText = f.allOptionText || '전체';
                const allOption = document.createElement('option');
                allOption.value = 'all';
                allOption.textContent = allText;
                select.appendChild(allOption);
                for (const attrId in f.data) {
                    const option = document.createElement('option');
                    option.value = f.data[attrId].id;
                    option.textContent = f.data[attrId].condition;
                    select.appendChild(option);
                }
            }
            group.appendChild(select);
            dropdownControlsContainer.appendChild(group);
        });
        dropdownGroupWrapper.appendChild(dropdownControlsContainer);
        topFiltersWrapper.appendChild(dropdownGroupWrapper);

        const rarities = [...new Set(Object.values(fullShipData).map(ship => ship.rarity).filter(Boolean))];
        const rarityOrder = ['N', 'R', 'SR', 'SSR', 'UR'];
        rarities.sort((a, b) => rarityOrder.indexOf(a) - rarityOrder.indexOf(b));
        const rarityFilterData = rarities.map(r => ({ val: r, name: r }));

        const checkboxFilters = [
            { id: 'nationality-filter', label: '진영 필터링 (펼치기/접기)', data: nationalityData, val: 'id', name: 'name', icon: 'image', sort: (a, b) => a.id - b.id },
            { id: 'type-filter', label: '함종 필터링 (펼치기/접기)', data: shipTypeData, val: 'ship_type', name: 'type_name', icon: 'icon', sort: (a, b) => (a.type_name || '').localeCompare(b.type_name || '') },
            { id: 'rarity-filter', label: '등급', data: rarityFilterData, val: 'val', name: 'name', icon: null, sort: (a, b) => rarityOrder.indexOf(a.name) - rarityOrder.indexOf(b.name) }
        ];

        checkboxFilters.forEach(f => {
            const group = document.createElement('div');
            group.id = f.id;
            group.className = 'filter-group';

            const isCollapsible = f.id === 'nationality-filter' || f.id === 'type-filter';
            if (isCollapsible) {
                const button = document.createElement('button');
                button.className = 'filter-group-toggle collapsed';
                button.innerHTML = `${f.label} <span class="chevron">▼</span>`;
                group.appendChild(button);
            } else {
                const label = document.createElement('div');
                label.className = 'filter-group-label';
                label.textContent = f.label;
                group.appendChild(label);
            }
            
            const wrapper = document.createElement('div');
            wrapper.className = 'filter-controls-wrapper';
            if (isCollapsible) {
                wrapper.classList.add('collapsible-content', 'collapsed');
            }

            if (f.id === 'type-filter') {
                const allId = `${f.id}-all`;
                const allItem = document.createElement('div');
                allItem.className = 'checkbox-filter-item';
                allItem.innerHTML = `<input type="checkbox" id="${allId}" value="all" data-filter-type="all" checked><label for="${allId}">전체</label>`;
                wrapper.appendChild(allItem);

                const groupedTypes = { '전열': [], '후열': [], '잠수': [] };
                Object.values(f.data).forEach(item => {
                    if (groupedTypes[item.position]) {
                        groupedTypes[item.position].push(item);
                    }
                });

                const positionOrder = ['전열', '후열', '잠수'];
                positionOrder.forEach(position => {
                    const items = groupedTypes[position];
                    if (items.length === 0) return;
                    items.sort(f.sort);
                    const positionGroupWrapper = document.createElement('div');
                    positionGroupWrapper.className = 'filter-position-group';
                    if (position === '전열' || position === '후열') {
                        const groupAllId = `${f.id}-${position}-all`;
                        const groupAllItem = document.createElement('div');
                        groupAllItem.className = 'checkbox-filter-item';
                        groupAllItem.innerHTML = `<input type="checkbox" id="${groupAllId}" data-filter-type="group-all" data-group-target="${position}"><label for="${groupAllId}">${position} 전체</label>`;
                        positionGroupWrapper.appendChild(groupAllItem);
                    }
                    items.forEach(item => {
                        if (item.type_name === '뇌순' || item.type_name === '항순') return;
                        const uniqueId = `${f.id}-${item[f.val]}`;
                        const checkboxItem = document.createElement('div');
                        checkboxItem.className = 'checkbox-filter-item';
                        const iconHTML = f.icon ? `<img src="${item[f.icon]}" class="filter-icon">` : '';
                        checkboxItem.innerHTML = `<input type="checkbox" id="${uniqueId}" value="${item[f.val]}" data-filter-type="individual" data-position="${position}"><label for="${uniqueId}">${iconHTML} ${item[f.name]}</label>`;
                        positionGroupWrapper.appendChild(checkboxItem);
                    });
                    wrapper.appendChild(positionGroupWrapper);
                });
            } else {
                const allId = `${f.id}-all`;
                const allItem = document.createElement('div');
                allItem.className = 'checkbox-filter-item';
                allItem.innerHTML = `<input type="checkbox" id="${allId}" value="all" data-filter-type="all" checked><label for="${allId}">전체</label>`;
                wrapper.appendChild(allItem);
                const items = Array.isArray(f.data) ? f.data : Object.values(f.data);
                items.sort(f.sort).forEach(item => {
                    if (!item[f.val] || !item[f.name]) return;
                    const uniqueId = `${f.id}-${item[f.val]}`;
                    const checkboxItem = document.createElement('div');
                    checkboxItem.className = 'checkbox-filter-item';
                    const iconHTML = f.icon ? `<img src="${item[f.icon]}" class="filter-icon">` : '';
                    const rarityClass = f.id === 'rarity-filter' ? `rarity-text rarity-${item[f.name]}` : '';
                    checkboxItem.innerHTML = `<input type="checkbox" id="${uniqueId}" value="${item[f.val]}" data-filter-type="individual"><label for="${uniqueId}" class="${rarityClass}">${iconHTML} ${item[f.name]}</label>`;
                    wrapper.appendChild(checkboxItem);
                });
            }
            group.appendChild(wrapper);
            filterBar.appendChild(group);
        });

        const actionContainer = document.createElement('div');
        actionContainer.className = 'action-controls-container';

        const bulkCheckContainer = document.createElement('div');
        bulkCheckContainer.className = 'bulk-check-controls';
        const bulkCheckLabel = document.createElement('div');
        bulkCheckLabel.className = 'filter-group-label';
        bulkCheckLabel.textContent = '일괄 체크 --> 주의) 목록에 보이는 모든 함순이들에게 적용';
        bulkCheckContainer.appendChild(bulkCheckLabel);

        const bulkCheckWrapper = document.createElement('div');
        bulkCheckWrapper.className = 'filter-controls-wrapper';
        const bulkCheckActions = [
            { label: '모두 입수 체크', type: 'get', state: true },
            { label: '모두 120렙 체크', type: 'level', state: true },
            { label: '모두 풀돌 체크', type: 'upgrade', state: true },
            { label: '모두 체크 해제', type: 'all', state: false }
        ];
        bulkCheckActions.forEach(action => {
            const btn = document.createElement('button');
            btn.textContent = action.label;
            btn.className = 'bulk-check-btn';
            if (action.state === false) {
                btn.classList.add('bulk-deselect-btn');
            }
            btn.onclick = () => {
                const message = `주의)) '${action.label}' 작업을 실행하시겠습니까? 필터링 적용된 목록의 함순이들에게 일괄적용됩니다.`;
                showConfirmationModal(message, () => bulkCheck(action.type, action.state));
            };
            bulkCheckWrapper.appendChild(btn);
        });
        bulkCheckContainer.appendChild(bulkCheckWrapper);
        actionContainer.appendChild(bulkCheckContainer);
        
        const resetButton = document.createElement('button');
        resetButton.id = 'reset-filters-btn';
        resetButton.textContent = '필터 초기화';

        actionContainer.appendChild(resetButton);
        filterBar.appendChild(actionContainer);
    }

    /**
     * Performs a bulk check/uncheck operation on the visible ship cards.
     * @param {string} type - The type of checkbox to change ('get', 'level', 'upgrade', 'all').
     * @param {boolean} shouldBeChecked - The desired state of the checkbox.
     */
    function bulkCheck(type, shouldBeChecked) {
        document.querySelectorAll('.ship-card').forEach(card => {
            if (filteredShipIds.includes(card.dataset.shipId)) {
                if (type === 'all') {
                    // For 'all' type, we need to handle the checkboxes in the right order
                    // to ensure proper cascading logic
                    if (shouldBeChecked) {
                        // When checking all, check in order: get, level, upgrade
                        const getCheckbox = card.querySelector('[data-type="get"]');
                        const levelCheckbox = card.querySelector('[data-type="level"]');
                        const upgradeCheckbox = card.querySelector('[data-type="upgrade"]');
                        if (getCheckbox) {
                            getCheckbox.checked = true;
                            handleCheckboxLogic(getCheckbox);
                        }
                        if (levelCheckbox) {
                            levelCheckbox.checked = true;
                            handleCheckboxLogic(levelCheckbox);
                        }
                        if (upgradeCheckbox) {
                            upgradeCheckbox.checked = true;
                            handleCheckboxLogic(upgradeCheckbox);
                        }
                    } else {
                        // When unchecking all, uncheck in reverse order: upgrade, level, get
                        const upgradeCheckbox = card.querySelector('[data-type="upgrade"]');
                        const levelCheckbox = card.querySelector('[data-type="level"]');
                        const getCheckbox = card.querySelector('[data-type="get"]');
                        if (upgradeCheckbox) {
                            upgradeCheckbox.checked = false;
                            handleCheckboxLogic(upgradeCheckbox);
                        }
                        if (levelCheckbox) {
                            levelCheckbox.checked = false;
                            handleCheckboxLogic(levelCheckbox);
                        }
                        if (getCheckbox) {
                            getCheckbox.checked = false;
                            handleCheckboxLogic(getCheckbox);
                        }
                    }
                } else {
                    const checkbox = card.querySelector(`[data-type="${type}"]`);
                    if (checkbox && checkbox.checked !== shouldBeChecked) {
                        checkbox.checked = shouldBeChecked;
                        handleCheckboxLogic(checkbox);
                    }
                }
            }
        });
        calculateAndDisplayScores();
        autoSaveProgress();
    }

    /**
     * Current confirmation callback for the modal.
     */
    let currentConfirmCallback = null;

    /**
     * Closes the confirmation modal.
     */
    function closeConfirmationModal() {
        if (cachedElements.confirmationModal) {
            cachedElements.confirmationModal.classList.remove('visible');
            currentConfirmCallback = null;
        }
    }

    /**
     * Handles the confirm button click in the modal.
     */
    function handleModalConfirm() {
        if (currentConfirmCallback) {
            currentConfirmCallback();
        }
        closeConfirmationModal();
    }

    /**
     * Sets up modal event listeners (called once during initialization).
     */
    function setupModalEventListeners() {
        if (cachedElements.modalConfirmBtn) {
            cachedElements.modalConfirmBtn.addEventListener('click', handleModalConfirm);
        }
        if (cachedElements.modalCancelBtn) {
            cachedElements.modalCancelBtn.addEventListener('click', closeConfirmationModal);
        }
        if (cachedElements.confirmationModal) {
            cachedElements.confirmationModal.addEventListener('click', (e) => {
                if (e.target === cachedElements.confirmationModal) {
                    closeConfirmationModal();
                }
            });
        }
    }

    /**
     * Shows a confirmation modal for critical actions.
     * @param {string} message - The message to display in the modal.
     * @param {function} onConfirm - The callback function to execute on confirmation.
     */
    function showConfirmationModal(message, onConfirm) {
        if (!cachedElements.confirmationModal || !cachedElements.modalText) return;

        cachedElements.modalText.textContent = message;
        currentConfirmCallback = onConfirm;
        cachedElements.confirmationModal.classList.add('visible');
    }

    /**
     * Saves the current progress (checked boxes) to localStorage.
     */
    function autoSaveProgress() {
        const progress = JSON.parse(getStorageItem(SAVE_KEY, null) || '{}');
        document.querySelectorAll('.ship-card').forEach(card => {
            let state = 0;
            if (card.querySelector('[data-type="get"]')?.checked) state |= 1;
            if (card.querySelector('[data-type="level"]')?.checked) state |= 2;
            if (card.querySelector('[data-type="upgrade"]')?.checked) state |= 4;
            if (state > 0) {
                progress[card.dataset.shipId] = state;
            } else {
                delete progress[card.dataset.shipId];
            }
        });
        setStorageItem(SAVE_KEY, JSON.stringify(progress));
    }

    /**
     * Applies the saved progress to the ship cards.
     * @param {object} progress - The progress object loaded from localStorage.
     */
    function applyProgress(progress) {
        document.querySelectorAll('.ship-card').forEach(card => {
            const shipId = card.dataset.shipId;
            if (progress[shipId]) {
                const state = progress[shipId];
                const get = (state & 1) > 0;
                const level = (state & 2) > 0;
                const upgrade = (state & 4) > 0;
                const getCheckbox = card.querySelector('[data-type="get"]');
                const levelCheckbox = card.querySelector('[data-type="level"]');
                const upgradeCheckbox = card.querySelector('[data-type="upgrade"]');
                if (getCheckbox) getCheckbox.checked = get;
                if (levelCheckbox) levelCheckbox.checked = level;
                if (upgradeCheckbox) upgradeCheckbox.checked = upgrade;
            }
        });
    }

    /**
     * Loads progress from localStorage and applies it.
     */
    function loadProgress() {
        const savedProgress = getStorageItem(SAVE_KEY, null);
        if (!savedProgress) return;
        try {
            const progress = JSON.parse(savedProgress);
            applyProgress(progress);
        } catch (e) {
            console.error("Failed to parse saved progress:", e);
        }
    }

    /**
     * Handles the logic for the ship type filter checkboxes.
     * @param {HTMLInputElement} checkbox - The changed checkbox.
     * @param {HTMLElement} group - The filter group element.
     */
    function handleShipTypeFilterLogic(checkbox, group) {
        const allToggle = group.querySelector('[data-filter-type="all"]');
        if (checkbox === allToggle && checkbox.checked) {
            group.querySelectorAll('[data-filter-type="group-all"], [data-filter-type="individual"]').forEach(cb => cb.checked = false);
            return;
        }
        if (checkbox.dataset.filterType === 'group-all') {
            const targetGroup = checkbox.dataset.groupTarget;
            group.querySelectorAll(`[data-position="${targetGroup}"]`).forEach(cb => cb.checked = checkbox.checked);
        }
        if (checkbox.dataset.filterType === 'individual') {
            const position = checkbox.dataset.position;
            const groupAllToggle = group.querySelector(`[data-group-target="${position}"]`);
            if (groupAllToggle) {
                if (!checkbox.checked) {
                    groupAllToggle.checked = false;
                } else {
                    const individuals = Array.from(group.querySelectorAll(`[data-position="${position}"]`));
                    groupAllToggle.checked = individuals.every(cb => cb.checked);
                }
            }
            
        }
        const anyIndividualChecked = group.querySelector('[data-filter-type="individual"]:checked');
        if (anyIndividualChecked) {
            allToggle.checked = false;
        } else {
            allToggle.checked = true;
            group.querySelectorAll('[data-filter-type="group-all"]').forEach(cb => cb.checked = false);
        }
    }

    /**
     * Handles the logic for filter checkboxes (e.g., 'All' vs. individual items).
     * @param {HTMLInputElement} changedCheckbox - The checkbox that was changed.
     */
    function handleFilterCheckboxLogic(changedCheckbox) {
        const group = changedCheckbox.closest('.filter-group');
        if (!group) return;
        if (group.id === 'type-filter') {
            handleShipTypeFilterLogic(changedCheckbox, group);
            return;
        }
        const allToggle = group.querySelector('[data-filter-type="all"]');
        if (changedCheckbox === allToggle) {
            if (allToggle.checked) {
                group.querySelectorAll('[data-filter-type="individual"]:checked').forEach(cb => cb.checked = false);
            }
        } else {
            if (changedCheckbox.checked) {
                allToggle.checked = false;
            }
        }
        if (!group.querySelector('[data-filter-type="individual"]:checked')) {
            allToggle.checked = true;
        }
    }

    /**
     * Applies all active filters to the ship list.
     */
    function applyFilters() {
        const searchQuery = document.getElementById('search-bar').value.toLowerCase();
        const progressFilter = document.getElementById('progress-filter').value;
        const getAttrFilter = document.getElementById('get-attr-filter').value;
        const levelAttrFilter = document.getElementById('level-attr-filter').value;
        const checkedNations = Array.from(document.querySelectorAll('#nationality-filter input[data-filter-type="individual"]:checked')).map(cb => parseDatasetInt(cb.value));
        const checkedTypes = Array.from(document.querySelectorAll('#type-filter input[data-filter-type="individual"]:checked')).map(cb => parseDatasetInt(cb.value));
        const checkedRarities = getCheckedFilterValues('#rarity-filter input[data-filter-type="individual"]:checked');
        const isNationFilterActive = checkedNations.length > 0;
        const isTypeFilterActive = checkedTypes.length > 0;
        const isRarityFilterActive = checkedRarities.length > 0;

        const savedProgress = JSON.parse(getStorageItem(SAVE_KEY, null) || '{}');

        filteredShipIds = Object.keys(fullShipData).filter(shipId => {
            const ship = fullShipData[shipId];

            const state = savedProgress[shipId] || 0;
            const isAnyChecked = state > 0;

            let progressMatch = true;
            if (progressFilter === 'checked') {
                progressMatch = isAnyChecked;
            } else if (progressFilter === 'unchecked') {
                progressMatch = !isAnyChecked;
            }

            const searchMatch = !searchQuery || (ship.name && ship.name.toLowerCase().includes(searchQuery));
            const natMatch = !isNationFilterActive || checkedNations.includes(ship.nationality);
            const typeMatch = !isTypeFilterActive || (ship.type && checkedTypes.includes(ship.type));
            const rarityMatch = !isRarityFilterActive || (ship.rarity && checkedRarities.includes(ship.rarity));
            const getAttrMatch = getAttrFilter === 'all' || ship.add_get_attr === parseDatasetInt(getAttrFilter);
            const levelAttrMatch = levelAttrFilter === 'all' || ship.add_level_attr === parseDatasetInt(levelAttrFilter);

            return searchMatch && natMatch && typeMatch && rarityMatch && progressMatch && getAttrMatch && levelAttrMatch;
        });

        renderVisibleCards();
        calculateAndDisplayScores();
    }

    /**
     * Resets all filters to their default state.
     */
    function resetFilters() {
        document.getElementById('search-bar').value = '';
        document.querySelectorAll('#filter-bar input[type="checkbox"]').forEach(cb => {
            cb.checked = cb.dataset.filterType === 'all';
        });
        document.querySelectorAll('#filter-bar [data-filter-type="group-all"]').forEach(cb => cb.checked = false);
        document.querySelectorAll('#filter-bar select').forEach(s => s.selectedIndex = 0);
        applyFilters();
    }

    /**
     * Initial render of all ship cards (called once on page load).
     */
    function renderAllCards() {
        const container = cachedElements.shipListContainer;
        if (!container) return;
        const fragment = document.createDocumentFragment();
        Object.keys(fullShipData).forEach(shipId => {
            const ship = fullShipData[shipId];
            if (ship) {
                const card = createShipCard(ship, shipId);
                fragment.appendChild(card);
            }
        });
        container.appendChild(fragment);
        loadProgress();
    }

    /**
     * Updates visibility of ship cards based on current filters (show/hide instead of recreate).
     */
    function renderVisibleCards() {
        const container = cachedElements.shipListContainer;
        if (!container) return;
        const visibleSet = new Set(filteredShipIds);
        container.querySelectorAll('.ship-card').forEach(card => {
            card.style.display = visibleSet.has(card.dataset.shipId) ? '' : 'none';
        });
    }

    async function initialize() {
        try {
            await fetchData();

            // Cache DOM elements for performance
            cacheDOMElements();

            // Setup modal event listeners once
            setupModalEventListeners();

            const header = document.querySelector('header');
            const scoreArea = document.getElementById('score-display-area');
            const mainElement = document.querySelector('main');
            const container = cachedElements.shipListContainer;
            const filterBar = cachedElements.filterBar;

            // Create and set up the score toggle button.
            const scoreToggleButton = document.createElement('button');
            scoreToggleButton.id = 'score-toggle-btn';
            const scoreButtonText = document.createElement('span');
            scoreButtonText.textContent = '점수판 보기';
            const scoreChevron = document.createElement('span');
            scoreChevron.className = 'chevron';
            scoreChevron.textContent = '▼';
            scoreToggleButton.appendChild(scoreButtonText);
            scoreToggleButton.appendChild(scoreChevron);
            scoreToggleButton.classList.add('collapsed');
            scoreArea.classList.add('collapsed');
            header.appendChild(scoreToggleButton);

            scoreToggleButton.addEventListener('click', () => {
                scoreArea.classList.toggle('collapsed');
                const isCollapsed = scoreToggleButton.classList.toggle('collapsed');
                scoreButtonText.textContent = isCollapsed ? '점수현황판 보기' : '점수현황판 숨기기';
                scoreChevron.textContent = isCollapsed ? '▼' : '▲';
            });

            // Create and set up the filter toggle button.
            const toggleButton = document.createElement('button');
            toggleButton.id = 'filter-toggle-btn';
            const buttonText = document.createElement('span');
            buttonText.textContent = '필터 보기';
            const chevron = document.createElement('span');
            chevron.className = 'chevron';
            chevron.textContent = '▼';
            toggleButton.appendChild(buttonText);
            toggleButton.appendChild(chevron);
            // Start collapsed
            filterBar.classList.add('filters-collapsed');
            mainElement.insertBefore(toggleButton, filterBar);
            toggleButton.addEventListener('click', () => {
                const isActive = toggleButton.classList.toggle('active');
                filterBar.classList.toggle('filters-collapsed');
                buttonText.textContent = isActive ? '필터 숨기기' : '필터 보기';
                chevron.textContent = isActive ? '▲' : '▼';
            });

            // Populate filters and render initial ship list.
            // Note: Order matters - filter bar is rendered first, then goal tracker below it
            populateFilters();
            renderAllCards();
            applyFilters();
            renderGoalTracker();

            // Set up event listeners for search and filters.
            const searchInput = document.getElementById('search-bar');
            const searchDropdown = document.getElementById('search-dropdown');
            const debouncedSearchFilter = debounce(() => {
                filterSearchDropdown(searchInput, searchDropdown);
                applyFilters();
            }, 150);
            const debouncedApplyFilters = debounce(applyFilters, 150);

            searchInput.addEventListener('input', debouncedSearchFilter);
            setupDropdownToggle(searchInput, searchDropdown);

            document.getElementById('reset-filters-btn').addEventListener('click', resetFilters);

            filterBar.addEventListener('click', (e) => {
                const toggle = e.target.closest('.filter-group-toggle');
                if (toggle) {
                    const group = toggle.closest('.filter-group');
                    const content = group.querySelector('.collapsible-content');
                    toggle.classList.toggle('collapsed');
                    content.classList.toggle('collapsed');
                }
            });

            filterBar.addEventListener('change', (e) => {
                const target = e.target;
                if (target.id !== 'search-bar' && (target.tagName === 'SELECT' || (target.type === 'checkbox' && target.closest('.filter-group')))) {
                    if (target.type === 'checkbox') {
                        handleFilterCheckboxLogic(target);
                    }
                    debouncedApplyFilters();
                }
            });
            // Event delegation for tracker checkboxes.
            container.addEventListener('change', (e) => {
                if (e.target.classList.contains('tracker-checkbox')) {
                    handleCheckboxLogic(e.target);
                    debouncedCalculateScores();
                    autoSaveProgress();
                }
            });

        } catch (error) {
            // Errors from fetchData are caught here, stopping initialization.
        }
    }

    // Start the application.
    initialize();
});