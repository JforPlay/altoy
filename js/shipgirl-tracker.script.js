document.addEventListener('DOMContentLoaded', () => {
    let fullShipData, nationalityData, shipTypeData, attrTypeData;
    const SAVE_KEY = 'shipgirlTrackerProgress';

    async function fetchData() {
        const dataPaths = [
            'data/shipgirl_group_data.json',
            'data/nationality_mapping.json',
            'data/ship_type_mapping.json',
            'data/attr_type_mapping.json'
        ];
        try {
            const responses = await Promise.all(dataPaths.map(path => fetch(path)));
            for (const res of responses) {
                if (!res.ok) {
                    throw new Error(`Failed to fetch ${res.url}: ${res.statusText}`);
                }
            }
            [fullShipData, nationalityData, shipTypeData, attrTypeData] = await Promise.all(
                responses.map(res => res.json())
            );
        } catch (error) {
            console.error("Error loading data files:", error);
            const container = document.getElementById('ship-list-container');
            if(container) container.innerHTML = `<p style="color: red; text-align: center;">데이터 파일을 불러오는 데 실패했습니다. 파일 경로와 JSON 형식을 확인하세요.</p>`;
            throw error;
        }
    }

    function createShipCard(ship, shipId) {
        const card = document.createElement('div');
        card.className = 'ship-card';
        card.style.display = 'flex';

        card.dataset.shipId = shipId;
        card.dataset.nationality = ship.nationality;
        card.dataset.type = ship.type;
        card.dataset.rarity = ship.rarity;
        card.dataset.name = ship.name;
        card.dataset.ptGet = ship.pt_get ?? 0;
        card.dataset.ptLevel = ship.pt_level ?? 0;
        card.dataset.ptUpgrade = ship.pt_upgrage ?? 0;

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

        const nationInfo = nationalityData[ship.nationality];
        const primaryTypeInfo = shipTypeData[ship.type];
        const rarityClass = ship.rarity ? `rarity-${ship.rarity}` : '';
        
        let descriptionHTML = '';
        if (ship.description && ship.description.length > 0) {
            const listItems = ship.description.map(desc => `<li>• ${desc}</li>`).join('');
            descriptionHTML = `
                <div class="description-section">
                    <div class="description-label">입수 방법</div>
                    <ul class="description-list">${listItems}</ul>
                </div>
            `;
        }

        let trackerHTML = '';
        const trackerItems = [];
        if (ship.pt_get !== undefined) trackerItems.push(createTrackerItemHTML('입수 시', ship.pt_get, 'get'));
        if (ship.pt_level !== undefined) trackerItems.push(createTrackerItemHTML('120 달성시', ship.pt_level, 'level'));
        if (ship.pt_upgrage !== undefined) trackerItems.push(createTrackerItemHTML('풀돌 시', ship.pt_upgrage, 'upgrade'));
        if(trackerItems.length > 0) {
            trackerHTML = `<div class="tracker-section">${trackerItems.join('')}</div>`;
        }

        card.innerHTML = `
            <img src="${ship.icon}" alt="${ship.name}" class="ship-icon" loading="lazy">
            <div class="ship-name">${ship.name}</div>
            <div class="info-section">
                ${nationInfo ? `<div class="info-item" title="${nationInfo.name}"><img src="${nationInfo.image}" alt="${nationInfo.name}" class="info-icon"><span>${nationInfo.code || nationInfo.name}</span></div>` : ''}
                ${primaryTypeInfo ? `<div class="info-item" title="${primaryTypeInfo.type_name}"><img src="${primaryTypeInfo.icon}" alt="${primaryTypeInfo.type_name}" class="info-icon"><span>${primaryTypeInfo.type_name}</span></div>` : ''}
                ${ship.rarity ? `<div class="info-item"><span class="rarity-text ${rarityClass}">${ship.rarity}</span></div>` : ''}
            </div>
            ${descriptionHTML}
            ${trackerHTML}
        `;

        return card;
    }

    function createTrackerItemHTML(labelText, points, type) {
        const uniqueId = `${type}-${Math.random().toString(36).substr(2, 9)}`;
        return `
            <div class="tracker-item">
                <label for="${uniqueId}">${labelText} (+${points})</label>
                <input type="checkbox" id="${uniqueId}" class="tracker-checkbox" data-type="${type}">
            </div>
        `;
    }

    function handleCheckboxLogic(checkbox) {
        const card = checkbox.closest('.ship-card');
        if (!card) return;
        const getCheckbox = card.querySelector('[data-type="get"]');
        const levelCheckbox = card.querySelector('[data-type="level"]');
        const upgradeCheckbox = card.querySelector('[data-type="upgrade"]');
        if (checkbox.checked) {
            if ((checkbox.dataset.type === 'level' || checkbox.dataset.type === 'upgrade') && getCheckbox) {
                getCheckbox.checked = true;
            }
        } else {
            if (checkbox.dataset.type === 'get') {
                if (levelCheckbox) levelCheckbox.checked = false;
                if (upgradeCheckbox) upgradeCheckbox.checked = false;
            }
        }
    }
    
    function calculateAndDisplayScores() {
        const fleetTech = {};
        const statTech = {};
        Object.keys(nationalityData).forEach(id => { fleetTech[id] = 0; });
        Object.keys(attrTypeData).forEach(id => { statTech[id] = {}; });

        document.querySelectorAll('.ship-card').forEach(card => {
            if (card.style.display === 'none') return;
            const data = card.dataset;
            const nationId = data.nationality;
            const isGetChecked = card.querySelector('[data-type="get"]')?.checked;
            const isLevelChecked = card.querySelector('[data-type="level"]')?.checked;
            const isUpgradeChecked = card.querySelector('[data-type="upgrade"]')?.checked;

            if (isGetChecked) {
                fleetTech[nationId] += parseInt(data.ptGet, 10);
                if (data.addGetAttr) {
                    data.addGetShiptype.split(',').forEach(type => {
                        if (!statTech[data.addGetAttr][type]) statTech[data.addGetAttr][type] = { get: 0, level: 0 };
                        statTech[data.addGetAttr][type].get += parseInt(data.addGetValue, 10);
                    });
                }
            }
            if (isLevelChecked) {
                fleetTech[nationId] += parseInt(data.ptLevel, 10);
                if (data.addLevelAttr) {
                    data.addLevelShiptype.split(',').forEach(type => {
                        if (!statTech[data.addLevelAttr][type]) statTech[data.addLevelAttr][type] = { get: 0, level: 0 };
                        statTech[data.addLevelAttr][type].level += parseInt(data.addLevelValue, 10);
                    });
                }
            }
            if (isUpgradeChecked) fleetTech[nationId] += parseInt(data.ptUpgrade, 10);
        });

        renderFleetTechTable(fleetTech);
        renderStatTechTable(statTech);
    }
    
    function renderFleetTechTable(scores) {
        const container = document.getElementById('fleet-tech-container');
        let tableHTML = `<div class="score-table-wrapper"><h2>진영 점수</h2><table class="score-table"><tr><th>진영</th><th>점수</th></tr>`;
        Object.keys(scores).forEach(id => {
            if (nationalityData[id] && scores[id] > 0) {
                tableHTML += `<tr><td class="header-col">${nationalityData[id].name}</td><td>${scores[id]}</td></tr>`;
            }
        });
        tableHTML += `</table></div>`;
        container.innerHTML = tableHTML;
    }

    function renderStatTechTable(scores) {
        const container = document.getElementById('stat-tech-container');
        const headers = new Set();
        Object.values(scores).forEach(attrScores => Object.keys(attrScores).forEach(typeId => headers.add(typeId)));
        
        if (headers.size === 0) {
            container.innerHTML = ''; 
            return;
        }

        const sortedHeaders = Array.from(headers).sort((a, b) => a - b);
        let tableHTML = `<div class="score-table-wrapper"><h2>함대 기술점수 (획득/120렙)</h2><table class="score-table"><tr><th>속성</th>${sortedHeaders.map(id => `<th>${shipTypeData[id]?.type_name || `Type ${id}`}</th>`).join('')}</tr>`;
        
        for (const attrId in scores) {
            if (Object.keys(scores[attrId]).length > 0) {
                tableHTML += `<tr><td class="header-col">${attrTypeData[attrId]?.condition || `스탯 ${attrId}`}</td>`;
                sortedHeaders.forEach(typeId => {
                    const cellScores = scores[attrId][typeId] || { get: 0, level: 0 };
                    if (cellScores.get > 0 || cellScores.level > 0) {
                        tableHTML += `<td>+${cellScores.get} / +${cellScores.level}</td>`;
                    } else {
                        tableHTML += `<td>0</td>`;
                    }
                });
                tableHTML += `</tr>`;
            }
        }
        tableHTML += `</table></div>`;
        container.innerHTML = tableHTML;
    }

    function populateFilters() {
        const filterBar = document.getElementById('filter-bar');
        filterBar.innerHTML = '';

        const searchContainer = document.createElement('div');
        searchContainer.className = 'search-container';
        searchContainer.innerHTML = `
            <label for="search-bar" class="filter-group-label">함선 검색</label>
            <div class="dropdown-container">
                <input type="text" id="search-bar" placeholder="이름으로 검색..." autocomplete="off">
                <div class="dropdown-content" id="search-dropdown"></div>
            </div>
        `;
        filterBar.appendChild(searchContainer);

        const searchDropdown = document.getElementById('search-dropdown');
        const allShipNames = Object.values(fullShipData).map(ship => ship.name).filter(Boolean).sort((a, b) => a.localeCompare(b));
        allShipNames.forEach(name => {
            const a = document.createElement('a');
            a.textContent = name;
            a.addEventListener('click', () => {
                document.getElementById('search-bar').value = name;
                searchDropdown.style.display = 'none';
                applyFilters();
            });
            searchDropdown.appendChild(a);
        });
        
        const rarities = [...new Set(Object.values(fullShipData).map(ship => ship.rarity).filter(Boolean))];
        const rarityOrder = ['N', 'R', 'SR', 'SSR', 'UR'];
        rarities.sort((a, b) => rarityOrder.indexOf(a) - rarityOrder.indexOf(b));
        const rarityFilterData = rarities.map(r => ({ val: r, name: r }));

        const checkboxFilters = [
            { id: 'nationality-filter', label: '진영', data: nationalityData, val: 'id', name: 'name', icon: 'image', sort: (a, b) => a.id - b.id },
            { id: 'type-filter', label: '함종', data: shipTypeData, val: 'ship_type', name: 'type_name', icon: 'icon', sort: (a, b) => (a.type_name || '').localeCompare(b.type_name || '') },
            { id: 'rarity-filter', label: '등급', data: rarityFilterData, val: 'val', name: 'name', icon: null, sort: (a, b) => rarityOrder.indexOf(a.name) - rarityOrder.indexOf(b.name) }
        ];

        checkboxFilters.forEach(f => {
            const group = document.createElement('div');
            group.id = f.id;
            group.className = 'filter-group';
            group.innerHTML = `<div class="filter-group-label">${f.label}</div>`;
            const wrapper = document.createElement('div');
            wrapper.className = 'filter-controls-wrapper';
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
            group.appendChild(wrapper);
            filterBar.appendChild(group);
        });
        
        const dropdownContainer = document.createElement('div');
        dropdownContainer.className = 'dropdown-controls-container';
        const dropdownFilters = [
            { id: 'progress-filter', label: '진행도', options: { all: '전체', checked: '하나라도 체크됨', unchecked: '체크 안됨' } },
            { id: 'get-attr-filter', label: '획득 보너스 스탯', data: attrTypeData },
            { id: 'level-attr-filter', label: '레벨 보너스 스탯', data: attrTypeData }
        ];
        dropdownFilters.forEach(f => {
            const group = document.createElement('div');
            group.className = 'dropdown-filter-group';
            group.innerHTML = `<label for="${f.id}" class="filter-group-label">${f.label}</label>`;
            const select = document.createElement('select');
            select.id = f.id;
            let optionsHTML = '';
            if (f.options) {
                optionsHTML = Object.entries(f.options).map(([val, text]) => `<option value="${val}">${text}</option>`).join('');
            } else {
                optionsHTML = '<option value="all">전체</option>';
                for (const attrId in f.data) {
                    optionsHTML += `<option value="${f.data[attrId].id}">${f.data[attrId].condition}</option>`;
                }
            }
            select.innerHTML = optionsHTML;
            group.appendChild(select);
            dropdownContainer.appendChild(group);
        });
        filterBar.appendChild(dropdownContainer);
        
        const actionContainer = document.createElement('div');
        actionContainer.className = 'action-controls-container';

        const bulkCheckContainer = document.createElement('div');
        bulkCheckContainer.className = 'bulk-check-controls';
        bulkCheckContainer.innerHTML = `<div class="filter-group-label">일괄 체크</div>`;
        const bulkCheckWrapper = document.createElement('div');
        bulkCheckWrapper.className = 'filter-controls-wrapper';
        const bulkCheckActions = [
            { label: '표시된 함선 모두 입수', type: 'get', state: true },
            { label: '표시된 함선 모두 120렙', type: 'level', state: true },
            { label: '표시된 함선 모두 풀돌', type: 'upgrade', state: true },
        ];
        bulkCheckActions.forEach(action => {
            const btn = document.createElement('button');
            btn.textContent = action.label;
            btn.className = 'bulk-check-btn';
            btn.onclick = () => bulkCheck(action.type, action.state);
            bulkCheckWrapper.appendChild(btn);
        });
        bulkCheckContainer.appendChild(bulkCheckWrapper);
        actionContainer.appendChild(bulkCheckContainer);

        const exportButton = document.createElement('button');
        exportButton.id = 'export-progress-btn';
        exportButton.textContent = '내보내기';

        const importButton = document.createElement('button');
        importButton.id = 'import-progress-btn';
        importButton.textContent = '가져오기';
        
        const resetButton = document.createElement('button');
        resetButton.id = 'reset-filters-btn';
        resetButton.textContent = '필터 초기화';
        
        actionContainer.appendChild(exportButton);
        actionContainer.appendChild(importButton);
        actionContainer.appendChild(resetButton);
        filterBar.appendChild(actionContainer);
    }

    function bulkCheck(type, shouldBeChecked) {
        document.querySelectorAll('.ship-card').forEach(card => {
            if (card.style.display !== 'none') {
                const checkbox = card.querySelector(`[data-type="${type}"]`);
                if (checkbox && checkbox.checked !== shouldBeChecked) {
                    checkbox.checked = shouldBeChecked;
                    handleCheckboxLogic(checkbox);
                }
            }
        });
        calculateAndDisplayScores();
        autoSaveProgress();
    }

    function autoSaveProgress() {
        const progress = {};
        document.querySelectorAll('.ship-card').forEach(card => {
            let state = 0;
            if (card.querySelector('[data-type="get"]')?.checked) state |= 1;
            if (card.querySelector('[data-type="level"]')?.checked) state |= 2;
            if (card.querySelector('[data-type="upgrade"]')?.checked) state |= 4;
            if (state > 0) {
                progress[card.dataset.shipId] = state;
            }
        });
        localStorage.setItem(SAVE_KEY, JSON.stringify(progress));
    }

    function applyProgress(progress) {
        document.querySelectorAll('.tracker-checkbox').forEach(cb => cb.checked = false);
        for (const shipId in progress) {
            const card = document.querySelector(`.ship-card[data-ship-id="${shipId}"]`);
            if (card) {
                const state = progress[shipId];
                const get = (state & 1) > 0;
                const level = (state & 2) > 0;
                const upgrade = (state & 4) > 0;
                const getCheckbox = card.querySelector('[data-type="get"]');
                const levelCheckbox = card.querySelector('[data-type="level"]');
                const upgradeCheckbox = card.querySelector('[data-type="upgrade"]');
                if(getCheckbox) getCheckbox.checked = get;
                if(levelCheckbox) levelCheckbox.checked = level;
                if(upgradeCheckbox) upgradeCheckbox.checked = upgrade;
            }
        }
        calculateAndDisplayScores();
    }

    function loadProgress() {
        const savedProgress = localStorage.getItem(SAVE_KEY);
        if (!savedProgress) return;
        try {
            const progress = JSON.parse(savedProgress);
            applyProgress(progress);
        } catch (e) {
            console.error("Failed to parse saved progress:", e);
        }
    }

    function exportProgress() {
        const progress = {};
        document.querySelectorAll('.ship-card').forEach(card => {
            let state = 0;
            if (card.querySelector('[data-type="get"]')?.checked) state |= 1;
            if (card.querySelector('[data-type="level"]')?.checked) state |= 2;
            if (card.querySelector('[data-type="upgrade"]')?.checked) state |= 4;
            if (state > 0) {
                progress[card.dataset.shipId] = state;
            }
        });
        const dataStr = JSON.stringify(progress, null, 2);
        const dataBlob = new Blob([dataStr], {type: "application/json"});
        const url = URL.createObjectURL(dataBlob);
        const link = document.createElement('a');
        link.download = 'shipgirl_progress.json';
        link.href = url;
        link.click();
        URL.revokeObjectURL(url);
    }
    
    function importProgress() {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.json,application/json';
        input.onchange = e => {
            const file = e.target.files[0];
            if (!file) return;
            const reader = new FileReader();
            reader.onload = event => {
                try {
                    const progress = JSON.parse(event.target.result);
                    applyProgress(progress);
                    autoSaveProgress();
                    alert('파일을 성공적으로 불러왔습니다.');
                } catch (err) {
                    alert('오류: 잘못된 파일 형식입니다.');
                    console.error("Error parsing imported file:", err);
                }
            };
            reader.readAsText(file);
        };
        input.click();
    }

    function handleFilterCheckboxLogic(changedCheckbox) {
        const group = changedCheckbox.closest('.filter-group');
        if (!group) return;
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
    
    function applyFilters() {
        const searchQuery = document.getElementById('search-bar').value.toLowerCase();
        const progressFilter = document.getElementById('progress-filter').value;
        const getAttrFilter = document.getElementById('get-attr-filter').value;
        const levelAttrFilter = document.getElementById('level-attr-filter').value;
        const checkedNations = Array.from(document.querySelectorAll('#nationality-filter input[data-filter-type="individual"]:checked')).map(cb => cb.value);
        const checkedTypes = Array.from(document.querySelectorAll('#type-filter input[data-filter-type="individual"]:checked')).map(cb => cb.value);
        const checkedRarities = Array.from(document.querySelectorAll('#rarity-filter input[data-filter-type="individual"]:checked')).map(cb => cb.value);
        
        const isNationFilterActive = checkedNations.length > 0;
        const isTypeFilterActive = checkedTypes.length > 0;
        const isRarityFilterActive = checkedRarities.length > 0;

        document.querySelectorAll('.ship-card').forEach(card => {
            const data = card.dataset;
            
            const getChecked = card.querySelector('[data-type="get"]')?.checked;
            const levelChecked = card.querySelector('[data-type="level"]')?.checked;
            const upgradeChecked = card.querySelector('[data-type="upgrade"]')?.checked;
            const isAnyChecked = getChecked || levelChecked || upgradeChecked;
            let progressMatch = true;
            if (progressFilter === 'checked') {
                progressMatch = isAnyChecked;
            } else if (progressFilter === 'unchecked') {
                progressMatch = !isAnyChecked;
            }

            const searchMatch = !searchQuery || (data.name && data.name.toLowerCase().includes(searchQuery));
            const natMatch = !isNationFilterActive || checkedNations.includes(data.nationality);
            const typeMatch = !isTypeFilterActive || (data.type && checkedTypes.includes(data.type));
            const rarityMatch = !isRarityFilterActive || (data.rarity && checkedRarities.includes(data.rarity));
            const getAttrMatch = getAttrFilter === 'all' || data.addGetAttr === getAttrFilter;
            const levelAttrMatch = levelAttrFilter === 'all' || data.addLevelAttr === levelAttrFilter;

            card.style.display = (searchMatch && natMatch && typeMatch && rarityMatch && progressMatch && getAttrMatch && levelAttrMatch) ? 'flex' : 'none';
        });

        calculateAndDisplayScores();
    }
    
    function resetFilters() {
        document.getElementById('search-bar').value = '';
        document.querySelectorAll('#filter-bar input[type="checkbox"]').forEach(cb => {
            cb.checked = cb.dataset.filterType === 'all';
        });
        document.querySelectorAll('#filter-bar select').forEach(s => s.selectedIndex = 0);
        applyFilters();
    }

    function filterSearchDropdown(input, dropdown) {
        const filter = input.value.toUpperCase();
        const items = dropdown.getElementsByTagName('a');
        for (let i = 0; i < items.length; i++) {
            const txtValue = items[i].textContent || items[i].innerText;
            items[i].style.display = txtValue.toUpperCase().indexOf(filter) > -1 ? "" : "none";
        }
    }

    function setupDropdownToggle(input, dropdown) {
        input.addEventListener('focus', () => dropdown.style.display = 'block');
        input.addEventListener('blur', () => {
            setTimeout(() => {
                dropdown.style.display = 'none';
            }, 150);
        });
    }

    async function initialize() {
        try {
            await fetchData();
            const container = document.getElementById('ship-list-container');
            const filterBar = document.getElementById('filter-bar');

            populateFilters();
            
            const fragment = document.createDocumentFragment();
            for (const shipId in fullShipData) {
                fragment.appendChild(createShipCard(fullShipData[shipId], shipId));
            }
            container.appendChild(fragment);

            const searchInput = document.getElementById('search-bar');
            const searchDropdown = document.getElementById('search-dropdown');
            searchInput.addEventListener('input', () => {
                filterSearchDropdown(searchInput, searchDropdown);
                applyFilters();
            });
            setupDropdownToggle(searchInput, searchDropdown);

            document.getElementById('reset-filters-btn').addEventListener('click', resetFilters);
            document.getElementById('import-progress-btn').addEventListener('click', importProgress);
            document.getElementById('export-progress-btn').addEventListener('click', exportProgress);

            filterBar.addEventListener('change', (e) => {
                const target = e.target;
                if (target.id !== 'search-bar' && (target.tagName === 'SELECT' || (target.type === 'checkbox' && target.closest('.filter-group')))) {
                    if (target.type === 'checkbox') {
                        handleFilterCheckboxLogic(target);
                    }
                    applyFilters();
                }
            });
            container.addEventListener('change', (e) => {
                if (e.target.classList.contains('tracker-checkbox')) {
                    handleCheckboxLogic(e.target);
                    calculateAndDisplayScores();
                    autoSaveProgress();
                }
            });

            loadProgress();
        } catch (error) {
            // Error is handled by fetchData
        }
    }

    initialize();
});