/**
 * sim.weapon.main.js
 * Main entry point for the weapon/skill simulator page.
 * Initializes the engine and WeaponSimData, populates the skill selector (grouped by ship),
 * renders weapon info cards, and fires barrages/aircraft when the fire button is clicked.
 * Part of the simulators module group; mirrors sim.aircraft.main.js structure.
 */

import { debounce, fetchJSON, getUrlParam, resolveUrl, showElement, hideElement, setupModal, openModal, closeModal } from '../utils.js';
import { SimulationEngine } from './sim.engine.common.js';
import { WeaponSimData } from './sim.weapon.data.js';
import { AircraftEntity } from './sim.engine.aircraft.js';

/** Ammo type display names (from bullet_template ammo_type field) */
const AMMO_TYPE_NAMES = {
    1: '철갑탄', 2: '고폭탄', 3: '통상탄', 4: '음향 유도', 5: '통상',
    6: '삼식탄', 7: '반철갑탄(SAP탄)', 8: '자성식', 9: '격발식', 10: '없음', 11: '미사일',
};

/** Bullet type labels */
const BULLET_TYPE_NAMES = {
    1: '포탄', 2: '폭탄', 3: '어뢰', 4: '파편', 5: '미사일',
    10: '빔', 11: '중력장', 14: '우주레이저', 15: '확장탄',
};

document.addEventListener('DOMContentLoaded', async () => {
    const GAME_COORDS = {
        totalArea: { minX: -120, minY: 30, maxX: 80, maxY: 85 },
        playerArea: { minX: -120, minY: 30, maxX: 15, maxY: 85 }
    };
    const TARGET_FPS = 30;
    const GLOBAL_SPEED_MULTIPLIER = 1.5;

    // --- DOM Elements ---
    const simContainer = document.getElementById('simulation-container');
    const vanguard = document.getElementById('vanguard');
    const mainfleet = document.getElementById('mainfleet');
    const enemy = document.getElementById('enemy');
    const playerAreaDiv = document.getElementById('player-area');
    const fireButton = document.getElementById('fire-button');
    const enemyToggle = document.getElementById('enemy-toggle');
    const pauseButton = document.getElementById('pause-button');
    const skillSelect = document.getElementById('skill-select');
    const visualLog = document.getElementById('visual-log');
    const weaponCardsContainer = document.getElementById('weapon-cards-container');
    const shipgirlCard = document.getElementById('shipgirl-card');
    const skillInfoCard = document.getElementById('skill-info-card');
    const levelToggleContainer = document.getElementById('level-toggle-container');
    const shipBrowseBtn = document.getElementById('ship-browse-btn');

    // --- State ---
    let currentSkillLevel = '1';
    let pendingFireTimers = [];
    let activeAircraft = [];
    let isPaused = false;
    let classGroupsData = null;

    function scheduleFireTimer(fn, delay) {
        const id = setTimeout(() => {
            pendingFireTimers = pendingFireTimers.filter(t => t !== id);
            fn();
        }, delay);
        pendingFireTimers.push(id);
    }

    // --- Engine Initialization ---
    const simEngine = new SimulationEngine({
        container: simContainer,
        gameCoords: GAME_COORDS,
        targetFps: TARGET_FPS,
        gSpeed: GLOBAL_SPEED_MULTIPLIER,
        visualLog: visualLog
    });

    const weaponSimData = new WeaponSimData(simEngine);

    simEngine.registerEntities({
        vanguard: { element: vanguard, baseWidth: 6.5, aspectRatio: 178 / 226, gamePos: { x: -36, y: 58 } },
        mainfleet: { element: mainfleet, baseWidth: 6.5, aspectRatio: 195 / 253, gamePos: { x: -105, y: 58 } },
        enemy: { element: enemy, baseWidth: 7.0, aspectRatio: 369 / 300 }
    });

    simEngine.registerEntityState('enemy', {
        getGamePos: (state) => ({ x: 15, y: state.centered ? 58 : 72 })
    });
    simEngine.setEntityState('enemy', 'centered', false);

    let choicesInstance;

    // --- Initialize ---
    await weaponSimData.loadData();
    simEngine.updateLayoutAndScale(playerAreaDiv);
    populateSkillSelector();
    initFPSDisplay();
    initSpeedControls();
    initPauseButton();
    initShipBrowseModal();
    setupModal('class-group-modal', { closeOnEscape: true, closeOnBackdrop: true, closeButtonSelector: '.modal-close-btn' });

    const skillIdFromUrl = getUrlParam('skill_id');
    if (skillIdFromUrl) {
        if (choicesInstance) choicesInstance.setChoiceByValue(skillIdFromUrl);
        await updateSkillDisplay(skillIdFromUrl);
    } else {
        const selectedSkillId = choicesInstance?.getValue(true);
        if (selectedSkillId && selectedSkillId !== 'none') await updateSkillDisplay(selectedSkillId);
    }

    // --- Event Listeners ---
    window.addEventListener('resize', debounce(() => {
        simEngine.updateLayoutAndScale(playerAreaDiv);
    }, 150));

    if (skillSelect) {
        skillSelect.addEventListener('change', async (e) => {
            currentSkillLevel = '1';
            await updateSkillDisplay(e.target.value);
        });
    }

    fireButton.addEventListener('click', async () => {
        pendingFireTimers.forEach(id => clearTimeout(id));
        pendingFireTimers = [];
        activeAircraft.forEach(a => a.destroy());
        activeAircraft = [];
        simEngine.clearBullets();
        const selectedSkillId = choicesInstance.getValue(true);
        if (selectedSkillId && selectedSkillId !== 'none') await fireSkill(selectedSkillId);
        else simEngine.logToScreen("No skill selected to fire.", "error");
    });

    enemyToggle.addEventListener('click', () => {
        const currentState = simEngine.getEntityState('enemy', 'centered');
        simEngine.setEntityState('enemy', 'centered', !currentState);
        const isCentered = simEngine.getEntityState('enemy', 'centered');
        enemyToggle.textContent = isCentered ? '적 위치: 중앙' : '적 위치: 상단';
        enemyToggle.classList.toggle('centered', isCentered);
        simEngine.updateLayoutAndScale(playerAreaDiv);
    });

    // ===== Controls Initialization =====

    // --- Speed Controls ---
    function initSpeedControls() {
        document.querySelectorAll('.speed-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                document.querySelectorAll('.speed-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                const speed = parseFloat(btn.dataset.speed);
                simEngine.bulletEngine.gSpeed = speed;
            });
        });
    }

    // --- Pause/Resume ---
    function initPauseButton() {
        pauseButton.addEventListener('click', () => {
            isPaused = !isPaused;
            const icon = pauseButton.querySelector('.material-symbols-outlined');
            if (isPaused) {
                simEngine.bulletEngine.gSpeed = 0;
                icon.textContent = 'play_arrow';
                pauseButton.title = '재생';
            } else {
                const activeSpeedBtn = document.querySelector('.speed-btn.active');
                simEngine.bulletEngine.gSpeed = activeSpeedBtn ? parseFloat(activeSpeedBtn.dataset.speed) : 1.5;
                icon.textContent = 'pause';
                pauseButton.title = '일시정지';
            }
        });
    }

    // ===== Ship Browse Modal =====

    // --- Ship Browse Modal ---
    function initShipBrowseModal() {
        setupModal('ship-browse-modal', {
            closeOnEscape: true,
            closeOnBackdrop: true,
            closeButtonSelector: '.modal-close-btn'
        });

        shipBrowseBtn.addEventListener('click', () => {
            populateShipBrowseList();
            openModal('ship-browse-modal');
        });

        const searchInput = document.getElementById('ship-search-input');
        searchInput.addEventListener('input', debounce(() => {
            filterShipBrowseList(searchInput.value);
        }, 200));
    }

    function getShipIconUrl(shipName) {
        const allSkills = weaponSimData.getAllSkills();
        for (const skillId in allSkills) {
            const s = allSkills[skillId];
            if (s?.name === shipName && s.shipyard) {
                return s.shipyard.replace('shipyard.png', 'icon.png');
            }
        }
        return '';
    }

    function populateShipBrowseList() {
        const container = document.getElementById('ship-browse-list');
        const shipNames = getUniqueShipNames();
        container.innerHTML = shipNames.map(name => {
            const iconUrl = getShipIconUrl(name);
            const iconHtml = iconUrl ? `<img src="${iconUrl}" alt="" class="ship-grid-icon" loading="lazy">` : '';
            return `<div class="ship-grid-item" data-ship="${name}">${iconHtml}<span>${name}</span></div>`;
        }).join('');

        container.querySelectorAll('.ship-grid-item').forEach(item => {
            item.addEventListener('click', () => {
                const shipName = item.dataset.ship;
                filterSkillsByShip(shipName);
                closeModal('ship-browse-modal');
            });
        });
    }

    function filterShipBrowseList(query) {
        const items = document.querySelectorAll('.ship-grid-item');
        const q = query.toLowerCase();
        items.forEach(item => {
            const match = item.textContent.toLowerCase().includes(q);
            item.style.display = match ? '' : 'none';
        });
    }

    function getUniqueShipNames() {
        const allSkills = weaponSimData.getAllSkills();
        const names = new Set();
        for (const skillId in allSkills) {
            const name = allSkills[skillId]?.name;
            if (name) names.add(name);
        }
        return [...names].sort();
    }

    function filterSkillsByShip(shipName) {
        if (!choicesInstance) return;
        const allSkills = weaponSimData.getAllSkills();
        // Find first skill of this ship and select it
        for (const skillId in allSkills) {
            if (allSkills[skillId]?.name === shipName) {
                choicesInstance.setChoiceByValue(skillId);
                skillSelect.dispatchEvent(new Event('change'));
                break;
            }
        }
    }

    // ===== FPS Display =====

    // --- FPS Display ---
    function initFPSDisplay() {
        const fpsDisplay = document.getElementById('fps-display');
        if (!fpsDisplay) return;
        let lastTime = performance.now();
        let frameCount = 0;
        let fpsAnimId = null;

        function updateFPS() {
            const now = performance.now();
            frameCount++;
            if (now >= lastTime + 1000) {
                fpsDisplay.textContent = `FPS: ${Math.round((frameCount * 1000) / (now - lastTime))}`;
                frameCount = 0;
                lastTime = now;
            }
            fpsAnimId = requestAnimationFrame(updateFPS);
        }
        fpsAnimId = requestAnimationFrame(updateFPS);

        document.addEventListener('visibilitychange', () => {
            if (document.hidden) {
                if (fpsAnimId) { cancelAnimationFrame(fpsAnimId); fpsAnimId = null; }
            } else if (!fpsAnimId) {
                lastTime = performance.now(); frameCount = 0;
                fpsAnimId = requestAnimationFrame(updateFPS);
            }
        });
    }

    function convertToMs(value, timeUnitIsFrames = false) {
        return timeUnitIsFrames ? (value / TARGET_FPS) * 1000 : value * 1000;
    }

    // ===== Skill Selector =====

    // --- Skill Selector (grouped by shipgirl) ---
    function populateSkillSelector() {
        if (!skillSelect) return;
        const allSkills = weaponSimData.getAllSkills();

        // Group skills by shipgirl name
        const groups = {};
        const groupIcons = {};
        for (const skillId in allSkills) {
            const skillData = allSkills[skillId];
            const shipName = skillData?.name || '알 수 없음';
            if (!groups[shipName]) {
                groups[shipName] = [];
                if (skillData?.shipyard) {
                    groupIcons[shipName] = skillData.shipyard.replace('shipyard.png', 'icon.png');
                }
            }
            const skillName = weaponSimData.getSkillName(skillId);
            groups[shipName].push({ value: skillId, label: skillName });
        }

        const choiceGroups = Object.keys(groups).sort().map(shipName => ({
            label: shipName,
            choices: groups[shipName]
        }));

        choicesInstance = new Choices(skillSelect, {
            choices: choiceGroups,
            searchEnabled: true,
            itemSelectText: '선택',
            shouldSort: false,
            searchPlaceholderValue: '함순이 또는 스킬 검색...',
            noResultsText: '검색 결과 없음',
        });

        // Inject shipgirl face icons into group headings
        const headings = skillSelect.closest('.choices')?.querySelectorAll('.choices__heading');
        if (headings) {
            headings.forEach(heading => {
                const name = heading.textContent.trim();
                const iconUrl = groupIcons[name];
                if (iconUrl) {
                    const img = document.createElement('img');
                    img.src = iconUrl;
                    img.alt = '';
                    img.className = 'group-icon';
                    img.loading = 'lazy';
                    heading.prepend(img);
                }
            });
        }

        // Select first skill
        const firstSkillId = Object.keys(allSkills)[0];
        if (firstSkillId) choicesInstance.setChoiceByValue(firstSkillId);
    }

    function hasMultipleLevels(skill) {
        if (!skill) return false;
        return !!(skill['1']?.effect_list && skill['10']?.effect_list);
    }

    function getEffectList(skill, level) {
        if (skill[level]?.effect_list) return skill[level].effect_list;
        if (skill['1']?.effect_list) return skill['1'].effect_list;
        if (skill.effect_list) return skill.effect_list;
        return null;
    }

    // ===== Display Update =====

    // --- Update Display (replaces old updateSkillStats) ---
    async function updateSkillDisplay(skillId) {
        if (skillId === 'none' || !skillId) {
            weaponCardsContainer.innerHTML = '<div class="card placeholder-card"><p>스킬을 선택하여 무기 정보를 확인하세요.</p></div>';
            hideElement(shipgirlCard);
            hideElement(skillInfoCard);
            levelToggleContainer.innerHTML = '';
            return;
        }

        const skill = weaponSimData.getSkillById(skillId);
        if (!skill) return;

        await weaponSimData.ensureSkillWeaponsLoaded(skillId, currentSkillLevel);

        // Shipgirl card
        updateShipgirlCard(skill, skillId);

        // Skill info card
        updateSkillInfoCard(skill, skillId);

        // Level toggle in playback bar
        updateLevelToggle(skillId);

        // Weapon cards
        await updateWeaponCards(skillId);
    }

    function updateShipgirlCard(skill, skillId) {
        const skillWeaponData = weaponSimData.getAllSkills()[skillId];
        const shipName = skillWeaponData?.name || '알 수 없음';
        const className = skillWeaponData?.class_name;
        const shipyardHtml = skill.shipyard ? `<img src="${skill.shipyard}" alt="" class="shipyard-icon">` : '';
        const classHtml = className ? `<div class="ship-class">${className}</div>` : '';

        shipgirlCard.innerHTML = `
            ${shipyardHtml}
            <div class="ship-name">${shipName}</div>
            ${classHtml}
            <div class="more-info">${className ? '클릭하여 동급 함순이 보기 →' : '클릭하여 함순이 정보 보기 →'}</div>
        `;
        shipgirlCard.onclick = className
            ? () => openClassGroupModal(className, shipName)
            : () => { window.location.href = resolveUrl(`shipgirl/shipgirl-info/?ship=${encodeURIComponent(shipName)}`); };
        showElement(shipgirlCard);
    }

    // --- Class Group Modal ---
    async function loadClassGroups() {
        if (!classGroupsData) {
            classGroupsData = await fetchJSON('data/sim/class_groups.json');
        }
        return classGroupsData;
    }

    async function openClassGroupModal(className, currentShipName) {
        const groups = await loadClassGroups();
        const ships = groups?.[className];
        if (!ships || ships.length === 0) {
            window.location.href = resolveUrl(`shipgirl/shipgirl-info/?ship=${encodeURIComponent(currentShipName)}`);
            return;
        }

        document.getElementById('class-group-title').textContent = className;
        const container = document.getElementById('class-group-list');
        container.innerHTML = ships.map(s => {
            const iconUrl = s.shipyard ? s.shipyard.replace('shipyard.png', 'icon.png') : '';
            const iconHtml = iconUrl ? `<img src="${iconUrl}" alt="" class="ship-grid-icon" loading="lazy">` : '';
            const activeClass = s.name === currentShipName ? ' class-group-current' : '';
            return `<a href="${resolveUrl(`shipgirl/shipgirl-info/?ship=${encodeURIComponent(s.name)}`)}" class="ship-grid-item${activeClass}" target="_blank">${iconHtml}<span>${s.name}</span></a>`;
        }).join('');

        openModal('class-group-modal');
    }

    function updateSkillInfoCard(skill, skillId) {
        const skillName = weaponSimData.getSkillName(skillId);
        const skillMeta = document.getElementById('skill-meta');

        let html = '';
        if (skill.icon) {
            html += `<div class="skill-header">
                <img src="${skill.icon}" alt="" class="skill-icon">
                <div>
                    <div class="skill-name">${skillName}</div>
                    <div style="font-size:0.75rem;color:var(--text-muted)">ID: ${skillId}</div>
                </div>
            </div>`;
        }

        html += `
            <div class="skill-meta-row"><span class="meta-label">포지션</span><span class="meta-value">${skill.position || '없음'}</span></div>
            <div class="skill-meta-row"><span class="meta-label">레벨</span><span class="meta-value">${currentSkillLevel}</span></div>
        `;

        if (skill.requirement) {
            html += `<div class="skill-meta-row"><span class="meta-label">요구사항</span><span class="meta-value">${skill.requirement}</span></div>`;
        }

        if (skill.desc) {
            html += `<div class="skill-desc">${skill.desc}</div>`;
        }

        skillMeta.innerHTML = html;
        showElement(skillInfoCard);
    }

    function updateLevelToggle(skillId) {
        const skill = weaponSimData.getSkillById(skillId);
        if (!hasMultipleLevels(skill)) {
            levelToggleContainer.innerHTML = '';
            return;
        }

        const isLevel10 = currentSkillLevel === '10';
        levelToggleContainer.innerHTML = `<button id="level-toggle" class="${isLevel10 ? 'level-10' : ''}">Lv.${isLevel10 ? '10' : '1'}</button>`;

        document.getElementById('level-toggle').addEventListener('click', async () => {
            currentSkillLevel = currentSkillLevel === '1' ? '10' : '1';
            await updateSkillDisplay(skillId);
        });
    }

    async function updateWeaponCards(skillId) {
        const weaponInfoList = weaponSimData.getWeaponIdsFromSkill(skillId, currentSkillLevel);
        if (weaponInfoList.length === 0) {
            weaponCardsContainer.innerHTML = '<div class="card placeholder-card"><p>무기 데이터가 없습니다.</p></div>';
            return;
        }

        const cards = [];
        const showNumber = weaponInfoList.length > 1;

        for (let i = 0; i < weaponInfoList.length; i++) {
            const info = weaponInfoList[i];
            const weapon = weaponSimData.getWeaponById(info.weaponId);
            if (!weapon) continue;

            const card = buildWeaponCard(weapon, info, i + 1, showNumber);
            cards.push(card);
        }

        weaponCardsContainer.innerHTML = cards.join('');
    }

    function buildWeaponCard(weapon, weaponInfo, index, showNumber) {
        // Get first bullet info for ammo type display
        const firstBulletId = weapon.bullet_ID?.[0];
        const bulletInfo = firstBulletId ? simEngine.allBulletData[firstBulletId] : null;
        const ammoType = bulletInfo?.ammo_type || 0;
        const ammoName = AMMO_TYPE_NAMES[ammoType] || '알 수 없음';
        const bulletType = bulletInfo?.type || 0;
        const bulletTypeName = BULLET_TYPE_NAMES[bulletType] || '일반';

        // Calculate total bullets per fire
        let totalBullets = 0;
        if (weapon.barrage_ID) {
            weapon.barrage_ID.forEach(bId => {
                const barrage = simEngine.allBarrageData[bId];
                if (barrage) totalBullets += (barrage.primal_repeat || 0) + 1;
            });
        }
        totalBullets *= (weaponInfo.quota || 1);

        // Reload time
        const reloadMs = weapon.reload_max;
        const reloadDisplay = reloadMs ? `${(reloadMs / 10).toFixed(1)}s` : '-';

        // Range
        const range = weapon.range || bulletInfo?.range || '-';

        // Damage
        const damage = weapon.damage || '-';
        const corrected = weapon.corrected ? ` (×${weapon.corrected}%)` : '';

        // Pierce
        const pierce = bulletInfo?.pierce_count || '-';

        // Armor modifiers
        const damageType = bulletInfo?.damage_type;

        let html = `<div class="weapon-card">`;

        // Header
        html += `<div class="weapon-card-header">
            <div class="weapon-card-title">${showNumber ? `무기 ${index}` : '무기 정보'}
                <span class="ammo-badge" style="background:var(--ammo-color-${ammoType})">${ammoName}</span>
            </div>
            <span class="weapon-card-id">${weaponInfo.weaponId}</span>
        </div>`;

        // Stats grid
        html += `<div class="weapon-stats">
            <div class="stat-item"><span class="stat-label">탄종</span><span class="stat-value">${bulletTypeName}</span></div>
            <div class="stat-item"><span class="stat-label">데미지</span><span class="stat-value">${damage}${corrected}</span></div>
            <div class="stat-item"><span class="stat-label">장전</span><span class="stat-value">${reloadDisplay}</span></div>
            <div class="stat-item"><span class="stat-label">사거리</span><span class="stat-value">${range}</span></div>
            <div class="stat-item"><span class="stat-label">발사 수</span><span class="stat-value">${totalBullets}</span></div>
            <div class="stat-item"><span class="stat-label">관통</span><span class="stat-value">${pierce}</span></div>`;

        // Armor modifiers row
        if (damageType && Array.isArray(damageType) && damageType.length >= 3) {
            html += `<div class="armor-row">
                <div class="armor-chip"><span class="armor-label">경장</span>${damageType[0]}%</div>
                <div class="armor-chip"><span class="armor-label">중장</span>${damageType[1]}%</div>
                <div class="armor-chip"><span class="armor-label">중장갑</span>${damageType[2]}%</div>
            </div>`;
        }

        html += `</div>`; // close weapon-stats

        // Barrage details (expandable)
        if (weapon.barrage_ID && weapon.barrage_ID.length > 0) {
            const firstBarrage = simEngine.allBarrageData[weapon.barrage_ID[0]];
            if (firstBarrage) {
                html += `<details class="barrage-details">
                    <summary>탄막 상세 (${weapon.barrage_ID.length}개 패턴)</summary>
                    <div class="barrage-detail-grid">
                        <div class="barrage-detail-item"><span class="stat-label">각도</span> ${firstBarrage.angle || 0}°</div>
                        <div class="barrage-detail-item"><span class="stat-label">Δ각도</span> ${firstBarrage.delta_angle || 0}°</div>
                        <div class="barrage-detail-item"><span class="stat-label">딜레이</span> ${firstBarrage.delay || 0}s</div>
                        <div class="barrage-detail-item"><span class="stat-label">반복</span> ${(firstBarrage.primal_repeat || 0) + 1}발</div>
                        ${firstBarrage.senior_repeat ? `<div class="barrage-detail-item"><span class="stat-label">시니어</span> ${firstBarrage.senior_repeat + 1}회</div>` : ''}
                        ${weaponInfo.quota ? `<div class="barrage-detail-item"><span class="stat-label">Quota</span> ${weaponInfo.quota}회</div>` : ''}
                        ${weaponInfo.time ? `<div class="barrage-detail-item"><span class="stat-label">발동</span> ${weaponInfo.time}f</div>` : ''}
                    </div>
                </details>`;
            }
        }

        html += `</div>`; // close weapon-card
        return html;
    }

    // ===== Firing Logic =====

    async function fireSkill(skillId) {
        const skill = weaponSimData.getSkillById(skillId);
        if (!skill) { simEngine.logToScreen(`Skill ${skillId} not found`, 'error'); return; }

        await weaponSimData.ensureSkillWeaponsLoaded(skillId, currentSkillLevel);

        const weaponInfoList = weaponSimData.getWeaponIdsFromSkill(skillId, currentSkillLevel);
        const aircraftSubWeaponLoads = [];
        for (const info of weaponInfoList) {
            const aircraftData = simEngine.allAircraftData?.[info.weaponId];
            if (aircraftData?.weapon_ID) {
                aircraftData.weapon_ID.forEach(subId => aircraftSubWeaponLoads.push(weaponSimData.ensureWeaponLoaded(subId)));
            }
        }
        if (aircraftSubWeaponLoads.length > 0) await Promise.all(aircraftSubWeaponLoads);

        const skillName = weaponSimData.getSkillName(skillId);
        const skillPosition = skill.position;
        simEngine.logToScreen(`Firing: ${skillName} (Lv.${currentSkillLevel})`);

        weaponSimData.getWeaponIdsFromSkill(skillId, currentSkillLevel).forEach((weaponInfo) =>
            scheduleFireTimer(() => fireWeapon(weaponInfo, skillPosition),
                weaponInfo.time ? convertToMs(weaponInfo.time, true) : 0)
        );
    }

    function fireWeapon(weaponInfo, skillPosition = null) {
        const weapon = weaponSimData.getWeaponById(weaponInfo.weaponId);
        if (!weapon || !Array.isArray(weapon.barrage_ID)) {
            simEngine.logToScreen(`Weapon ${weaponInfo.weaponId} has invalid data`, 'error');
            return;
        }

        const aircraftData = simEngine.allAircraftData?.[weaponInfo.weaponId];
        if (aircraftData && aircraftData.weapon_ID) {
            spawnAircraft(aircraftData, weapon, skillPosition);
            return;
        }

        for (let i = 0; i < weapon.barrage_ID.length; i++) {
            const barrage = simEngine.allBarrageData[weapon.barrage_ID[i]];
            const bulletInfo = simEngine.allBulletData[weapon.bullet_ID[i]];
            if (!barrage || !bulletInfo) continue;
            fireBarrage(weapon, barrage, bulletInfo, null, 1, skillPosition, weaponInfo);
        }
    }

    function spawnAircraft(aircraftData, parentWeapon, skillPosition) {
        const spawnLocation = skillPosition === '전열' ? 'vanguard' : 'mainfleet';
        const spawnPos = simEngine.getEntityGamePos(spawnLocation);
        const enemyPos = simEngine.getEntityGameCoords('enemy');
        const targetX = enemyPos?.x || 50;
        const count = parentWeapon.barrage_ID?.length || 1;
        const subWeaponIds = aircraftData.weapon_ID || [];

        // Get per-weapon firing ranges from weapon_property.range
        const weaponRanges = subWeaponIds.map(wid => {
            const w = weaponSimData.getWeaponById(wid);
            return w?.range || 30;
        });

        for (let i = 0; i < count; i++) {
            const startY = spawnPos.y + (i - (count - 1) / 2) * 3;
            const aircraft = new AircraftEntity({
                engine: simEngine, aircraftData, weaponIds: subWeaponIds,
                startX: spawnPos.x - 20, startY, targetX, targetY: enemyPos?.y || startY,
                direction: 1, startDelay: i * 200, weaponRanges
            });

            aircraft.onFireWeapon = (x, y, subWeaponId) => {
                const subWeapon = weaponSimData.getWeaponById(subWeaponId);
                if (!subWeapon || !subWeapon.barrage_ID) return;
                for (let j = 0; j < subWeapon.barrage_ID.length; j++) {
                    const barrage = simEngine.allBarrageData[subWeapon.barrage_ID[j]];
                    const bulletInfo = simEngine.allBulletData[subWeapon.bullet_ID[j]];
                    if (!barrage || !bulletInfo) continue;
                    fireBarrage(subWeapon, barrage, bulletInfo, { x, y }, 1, null);
                }
            };
            activeAircraft.push(aircraft);
        }
    }

    function fireBarrage(weapon, barrage, bulletInfo, overrideStartPos = null, direction = 1, skillPosition = null, weaponInfo = {}) {
        let baseAngle, startX_game, startY_game;

        if (overrideStartPos) {
            ({ x: startX_game, y: startY_game } = overrideStartPos);
        } else {
            let spawnLocation = 'mainfleet';
            if (skillPosition) {
                spawnLocation = skillPosition === '전열' ? 'vanguard' : 'mainfleet';
            } else if (weapon.spawn_bound === 'vanguard' || weapon.spawn_bound === 'cannon') {
                spawnLocation = 'vanguard';
            }
            const spawnPos = simEngine.getEntityGamePos(spawnLocation);
            startX_game = spawnPos.x;
            startY_game = spawnPos.y;
        }

        const rawAngle = weapon.axis_angle ?? weapon.angle ?? 0;
        baseAngle = direction === -1 ? rawAngle + 180 : rawAngle;

        const seniorRepeatCount = weaponInfo.quota ?? ((barrage.senior_repeat || 0) + 1);
        const seniorDelay = barrage.senior_delay || 0;
        const firstDelay = barrage.first_delay || 0;

        function calculatePrimalDuration(b) {
            const primalCount = (b.primal_repeat || 0) + 1;
            if (primalCount <= 1) return 0;
            if (b.delta_delay && b.delta_delay !== 0) {
                let total = 0, currentInterval = b.delay || 0;
                for (let i = 0; i < primalCount - 1; i++) { total += currentInterval; currentInterval += (b.delta_delay || 0); }
                return total;
            } else if (b.delay && b.delay !== 0) {
                return (primalCount - 1) * b.delay;
            }
            return 0;
        }

        function fireWaveChain(waveIndex, waveStartTime) {
            if (waveIndex >= seniorRepeatCount) return;
            const actualStartTime = (waveIndex === 0) ? firstDelay : waveStartTime;

            if (barrage.delta_delay && barrage.delta_delay !== 0) {
                fireWaveWithAdvancingDelay(actualStartTime, weapon, barrage, bulletInfo, startX_game, startY_game, baseAngle, direction);
            } else if (barrage.delay && barrage.delay !== 0) {
                fireWaveWithConstantDelay(actualStartTime, weapon, barrage, bulletInfo, startX_game, startY_game, baseAngle, direction);
            } else {
                fireWaveImmediate(actualStartTime, weapon, barrage, bulletInfo, startX_game, startY_game, baseAngle, direction);
            }

            if (waveIndex + 1 < seniorRepeatCount) {
                const primalDuration = calculatePrimalDuration(barrage);
                const nextWaveTime = actualStartTime + primalDuration + seniorDelay;
                scheduleFireTimer(() => { fireWaveChain(waveIndex + 1, nextWaveTime); },
                    convertToMs(nextWaveTime) - convertToMs(actualStartTime));
            }
        }

        const precastTime = weapon.precast_param?.time || 0;
        if (precastTime > 0) {
            scheduleFireTimer(() => { fireWaveChain(0, firstDelay); }, convertToMs(precastTime));
        } else {
            fireWaveChain(0, firstDelay);
        }
    }

    function fireWaveWithAdvancingDelay(waveStartTime, weapon, barrage, bulletInfo, startX_game, startY_game, baseAngle, direction = 1) {
        const primalRepeatCount = (barrage.primal_repeat || 0) + 1;
        let totalPrimalDelay = 0, currentPrimalInterval = barrage.delay || 0;
        for (let i = 0; i < primalRepeatCount; i++) {
            const bulletFireTime = waveStartTime + totalPrimalDelay;
            scheduleFireTimer(() => { fireSingleBullet(i, weapon, barrage, bulletInfo, startX_game, startY_game, baseAngle, direction); }, convertToMs(bulletFireTime));
            totalPrimalDelay += currentPrimalInterval;
            currentPrimalInterval += (barrage.delta_delay || 0);
        }
    }

    function fireWaveWithConstantDelay(waveStartTime, weapon, barrage, bulletInfo, startX_game, startY_game, baseAngle, direction = 1) {
        const primalRepeatCount = (barrage.primal_repeat || 0) + 1;
        const constantInterval = barrage.delay || 0;
        for (let i = 0; i < primalRepeatCount; i++) {
            const bulletFireTime = waveStartTime + (i * constantInterval);
            scheduleFireTimer(() => { fireSingleBullet(i, weapon, barrage, bulletInfo, startX_game, startY_game, baseAngle, direction); }, convertToMs(bulletFireTime));
        }
    }

    function fireWaveImmediate(waveStartTime, weapon, barrage, bulletInfo, startX_game, startY_game, baseAngle, direction = 1) {
        const primalRepeatCount = (barrage.primal_repeat || 0) + 1;
        scheduleFireTimer(() => {
            for (let i = 0; i < primalRepeatCount; i++) {
                fireSingleBullet(i, weapon, barrage, bulletInfo, startX_game, startY_game, baseAngle, direction);
            }
        }, convertToMs(waveStartTime));
    }

    function fireSingleBullet(bulletIndex, weapon, barrage, bulletInfo, startX_game, startY_game, baseAngle, direction = 1) {
        const enemyGamePos = simEngine.getEntityGameCoords('enemy');
        let angleModifier;
        if (barrage.random_angle) {
            angleModifier = (Math.random() * 2 - 1) * (bulletIndex * (barrage.delta_angle || 0) + (barrage.angle || 0));
        } else {
            angleModifier = bulletIndex * (barrage.delta_angle || 0) + (barrage.angle || 0);
        }

        let weaponAngleSpread = 0;
        if (weapon.random_angle) {
            const angleRange = weapon.angle || 0;
            weaponAngleSpread = Math.random() * angleRange - angleRange / 2;
        }

        let effectiveBulletInfo = bulletInfo;
        if (bulletInfo.type === 10) {
            effectiveBulletInfo = { ...bulletInfo, beam_delta_angle: barrage.delta_angle || 0 };
        }

        let finalX_game, finalY_game;
        const isAirdrop = effectiveBulletInfo.extra_param?.airdrop;
        let airdropData = null;

        if (effectiveBulletInfo.type === 10) {
            finalX_game = startX_game;
            finalY_game = startY_game;
        } else if (isAirdrop) {
            const explodePos = { x: enemyGamePos.x, y: enemyGamePos.y };
            const airdrop = effectiveBulletInfo.extra_param.airdrop;
            const randomOffsetX = airdrop?.randomOffsetX || 0;
            const randomOffsetZ = airdrop?.randomOffsetZ || 0;
            if (randomOffsetX) explodePos.x += (Math.random() - 0.5) * randomOffsetX;
            if (randomOffsetZ) explodePos.y += (Math.random() - 0.5) * randomOffsetZ;
            explodePos.x += airdrop?.targetOffsetX || 0;
            explodePos.y += airdrop?.targetOffsetZ || 0;
            if (airdrop?.targetFixX !== undefined) explodePos.x = airdrop.targetFixX;
            if (airdrop?.targetFixZ !== undefined) explodePos.y = airdrop.targetFixZ;

            if (barrage.offset_prioritise && airdrop?.barragePriority) {
                const bOffsetX = (barrage.offset_x || 0) + bulletIndex * (barrage.delta_offset_x || 0);
                const bOffsetZ = (barrage.offset_z || 0) + bulletIndex * (barrage.delta_offset_z || 0);
                explodePos.x += bOffsetX;
                explodePos.y += bOffsetZ;
            }

            const gravity = effectiveBulletInfo.extra_param?.gravity || -0.0005;
            const offsetY = airdrop?.offsetY || 0;
            const dropOffset = airdrop?.dropOffset;
            let horizontalOffset = 0;
            if (dropOffset) {
                const convertedVelocity = effectiveBulletInfo.velocity * 0.2;
                horizontalOffset = Math.sqrt(Math.abs(offsetY * 2 / gravity)) * convertedVelocity;
                if (direction < 0) horizontalOffset *= -1;
            }
            finalX_game = explodePos.x - horizontalOffset;
            finalY_game = explodePos.y + offsetY;
            airdropData = { explodePos, gravity, offsetY, horizontalOffset };
        } else {
            const offsetX = ((barrage.offset_x || 0) + (bulletIndex * (barrage.delta_offset_x || 0))) * direction;
            finalX_game = startX_game + offsetX;
            finalY_game = startY_game + (barrage.offset_z || 0) + (bulletIndex * (barrage.delta_offset_z || 0));

            const rloX = effectiveBulletInfo.extra_param?.randomLaunchOffsetX;
            const rloZ = effectiveBulletInfo.extra_param?.randomLaunchOffsetZ;
            if (rloX) finalX_game += Math.random() * rloX * 2 - rloX;
            if (rloZ) finalY_game += Math.random() * rloZ * 2 - rloZ;
        }

        // AIM type: compute angle toward enemy from bullet's actual spawn position
        let finalAngle;
        if (weapon.aim_type === 1 && enemyGamePos) {
            const aimDx = enemyGamePos.x - finalX_game;
            const aimDy = enemyGamePos.y - finalY_game;
            const aimAngle = Math.atan2(aimDy, aimDx) * 180 / Math.PI;
            finalAngle = aimAngle + angleModifier + weaponAngleSpread;
        } else {
            finalAngle = baseAngle + angleModifier + weaponAngleSpread;
        }

        const screenPos = simEngine.bulletEngine.gameToScreen(finalX_game, finalY_game);
        const transformChain = simEngine.generateTransformBarrages(weapon.barrage_ID?.[0] || barrage.id, direction, bulletIndex);
        const weaponScreenPos = simEngine.bulletEngine.gameToScreen(startX_game, startY_game);
        simEngine.bulletEngine.createBullet({
            startX: screenPos.x, startY: screenPos.y, startZ: finalY_game, angle: finalAngle,
            bulletInfo: effectiveBulletInfo,
            transformChain, shrapnelCallback: handleShrapnel, airdropData,
            weaponPos: { x: weaponScreenPos.x, y: weaponScreenPos.y },
            enemyTarget: enemyGamePos, aimType: weapon.aim_type,
            barrageAngle: angleModifier
        });
    }

    function handleShrapnel(parentBulletInfo, finalPos) {
        const shrapnel = parentBulletInfo.extra_param.shrapnel;
        for (const key in shrapnel) {
            if (!isNaN(key) && shrapnel[key] && !shrapnel[key].initialSplit) {
                const entry = shrapnel[key];
                const barrage = simEngine.allBarrageData[entry.barrage_ID];
                const bullet = simEngine.allBulletData[entry.bullet_ID];
                if (barrage && bullet) {
                    const fakeWeapon = { id: `shrapnel_${key}`, angle: 0, aim_type: entry.reaim ? 1 : 0 };
                    fireBarrage(fakeWeapon, barrage, bullet, finalPos);
                }
            }
        }
    }
});
