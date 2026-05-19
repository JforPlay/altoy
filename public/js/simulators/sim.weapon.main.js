/**
 * sim.weapon.main.js
 * Main entry point for the weapon/skill simulator page.
 * Initializes the engine and WeaponSimData, populates the skill selector (grouped by ship),
 * renders weapon info cards, and fires barrages/aircraft when the fire button is clicked.
 * Part of the simulators module group; mirrors sim.aircraft.main.js structure.
 */

import { debounce, fetchJSON, getUrlParam, resolveUrl, setUrlParams, showElement, hideElement, setupModal, openModal, closeModal, createImgElement, setupFpsDisplay } from '../utils.js';
import { SimulationEngine } from './sim.engine.common.js';
import { WeaponSimData } from './sim.weapon.data.js';
import { AircraftEntity } from './sim.engine.aircraft.js';
import {
    SIM_DEFAULT_SPEED,
    SIM_GAME_COORDS,
    SIM_TARGET_FPS,
    buildWeaponCard,
    convertToMs,
    createMetaRow,
    makeClickableCard,
    populateChoicesOrSelect,
    registerDefaultBattleEntities,
    renderLevelToggle,
    renderPlaceholder,
    setupEnemyToggle,
    setupPauseButton,
    setupSpeedControls
} from './sim.ui.js';

document.addEventListener('DOMContentLoaded', async () => {
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
    let classGroupsData = null;
    let displayToken = 0;

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
        gameCoords: SIM_GAME_COORDS,
        targetFps: SIM_TARGET_FPS,
        gSpeed: SIM_DEFAULT_SPEED,
        visualLog: visualLog
    });

    const weaponSimData = new WeaponSimData(simEngine);

    registerDefaultBattleEntities(simEngine, { vanguard, mainfleet, enemy });

    let choicesInstance;

    // --- Initialize ---
    try {
        await weaponSimData.loadData();
    } catch (error) {
        renderPlaceholder(weaponCardsContainer, '스킬 데이터를 불러올 수 없습니다. 잠시 후 다시 시도하세요.', 'error');
        fireButton.disabled = true;
        shipBrowseBtn.disabled = true;
        return;
    }
    simEngine.updateLayoutAndScale(playerAreaDiv);
    populateSkillSelector();
    setupFpsDisplay(document.getElementById('fps-display'));
    setupSpeedControls(simEngine);
    setupPauseButton(simEngine, pauseButton);
    setupEnemyToggle(simEngine, enemyToggle, playerAreaDiv);
    initShipBrowseModal();
    setupModal('class-group-modal', { closeOnEscape: true, closeOnBackdrop: true, closeButtonSelector: '.modal-close-btn', restoreFocus: true });

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
        const selectedSkillId = getSelectedSkillId();
        if (selectedSkillId && selectedSkillId !== 'none') await fireSkill(selectedSkillId);
        else simEngine.logToScreen("No skill selected to fire.", "error");
    });

    // ===== Ship Browse Modal =====

    // --- Ship Browse Modal ---
    function initShipBrowseModal() {
        setupModal('ship-browse-modal', {
            closeOnEscape: true,
            closeOnBackdrop: true,
            closeButtonSelector: '.modal-close-btn',
            restoreFocus: true
        });

        shipBrowseBtn.addEventListener('click', () => {
            populateShipBrowseList();
            openModal('ship-browse-modal');
        });

        const searchInput = document.getElementById('ship-search-input');
        searchInput.addEventListener('input', debounce(() => {
            filterShipBrowseList(searchInput.value);
        }, 200));

        document.getElementById('ship-browse-list')?.addEventListener('click', (event) => {
            const item = event.target.closest('.ship-grid-item');
            if (!item) return;
            filterSkillsByShip(item.dataset.ship);
            closeModal('ship-browse-modal');
        });
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
        const fragment = document.createDocumentFragment();
        for (const name of getUniqueShipNames()) {
            const iconUrl = getShipIconUrl(name);
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'ship-grid-item';
            button.dataset.ship = name;
            if (iconUrl) button.appendChild(createImgElement(iconUrl, '', { className: 'ship-grid-icon' }));
            const label = document.createElement('span');
            label.textContent = name;
            button.appendChild(label);
            fragment.appendChild(button);
        }
        container.replaceChildren(fragment);
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

        const firstSkillId = Object.keys(allSkills)[0];
        choicesInstance = populateChoicesOrSelect(skillSelect, choiceGroups, {
            choicesConfig: {
                searchEnabled: true,
                itemSelectText: '선택',
                shouldSort: false,
                searchPlaceholderValue: '함순이 또는 스킬 검색...',
                noResultsText: '검색 결과 없음',
                placeholder: false,
            },
            firstValue: firstSkillId,
        });

        // Inject shipgirl face icons into the rendered group headings.
        const headings = skillSelect.closest('.choices')?.querySelectorAll('.choices__heading');
        headings?.forEach(heading => {
            const iconUrl = groupIcons[heading.textContent.trim()];
            if (iconUrl) heading.prepend(createImgElement(iconUrl, '', { className: 'group-icon' }));
        });
    }

    function hasMultipleLevels(skill) {
        if (!skill) return false;
        return !!(skill['1']?.effect_list && skill['10']?.effect_list);
    }

    function getSelectedSkillId() {
        return choicesInstance ? choicesInstance.getValue(true) : skillSelect.value;
    }

    // ===== Display Update =====

    // --- Update Display (replaces old updateSkillStats) ---
    async function updateSkillDisplay(skillId) {
        if (skillId === 'none' || !skillId) {
            renderPlaceholder(weaponCardsContainer, '스킬을 선택하여 무기 정보를 확인하세요.');
            hideElement(shipgirlCard);
            hideElement(skillInfoCard);
            levelToggleContainer.replaceChildren();
            return;
        }

        const token = ++displayToken;
        const skill = weaponSimData.getSkillById(skillId);
        if (!skill) return;

        await weaponSimData.ensureSkillWeaponsLoaded(skillId, currentSkillLevel);
        if (token !== displayToken) return;
        setUrlParams({ skill_id: skillId }, { replace: true });

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

        const nodes = [];
        if (skill.shipyard) {
            nodes.push(createImgElement(skill.shipyard, '', { className: 'shipyard-icon' }));
        }
        const name = document.createElement('div');
        name.className = 'ship-name';
        name.textContent = shipName;
        nodes.push(name);
        if (className) {
            const shipClass = document.createElement('div');
            shipClass.className = 'ship-class';
            shipClass.textContent = className;
            nodes.push(shipClass);
        }
        const moreInfo = document.createElement('div');
        moreInfo.className = 'more-info';
        moreInfo.textContent = className ? '클릭하여 동급 함순이 보기 →' : '클릭하여 함순이 정보 보기 →';
        nodes.push(moreInfo);

        shipgirlCard.replaceChildren(...nodes);
        makeClickableCard(shipgirlCard, {
            onActivate: className
                ? () => openClassGroupModal(className, shipName)
                : () => { window.location.href = resolveUrl(`shipgirl/shipgirl-info/?ship=${encodeURIComponent(shipName)}`); },
            ariaLabel: `${shipName} 정보 보기`,
        });
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
        const fragment = document.createDocumentFragment();
        for (const s of ships) {
            const iconUrl = s.shipyard ? s.shipyard.replace('shipyard.png', 'icon.png') : '';
            const link = document.createElement('a');
            link.href = resolveUrl(`shipgirl/shipgirl-info/?ship=${encodeURIComponent(s.name)}`);
            link.className = `ship-grid-item${s.name === currentShipName ? ' class-group-current' : ''}`;
            link.target = '_blank';
            link.rel = 'noopener noreferrer';
            if (iconUrl) link.appendChild(createImgElement(iconUrl, '', { className: 'ship-grid-icon' }));
            const label = document.createElement('span');
            label.textContent = s.name;
            link.appendChild(label);
            fragment.appendChild(link);
        }
        container.replaceChildren(fragment);

        openModal('class-group-modal');
    }

    function updateSkillInfoCard(skill, skillId) {
        const skillName = weaponSimData.getSkillName(skillId);
        const skillMeta = document.getElementById('skill-meta');
        const fragment = document.createDocumentFragment();
        if (skill.icon) {
            const header = document.createElement('div');
            header.className = 'skill-header';
            const text = document.createElement('div');
            const name = document.createElement('div');
            name.className = 'skill-name';
            name.textContent = skillName;
            const id = document.createElement('div');
            id.className = 'sim-muted-text';
            id.textContent = `ID: ${skillId}`;
            text.append(name, id);
            header.append(createImgElement(skill.icon, '', { className: 'skill-icon' }), text);
            fragment.appendChild(header);
        }

        fragment.append(
            createMetaRow('포지션', skill.position || '없음'),
            createMetaRow('레벨', currentSkillLevel)
        );

        if (skill.requirement) {
            fragment.appendChild(createMetaRow('요구사항', skill.requirement));
        }

        if (skill.desc) {
            const desc = document.createElement('div');
            desc.className = 'skill-desc';
            desc.textContent = skill.desc;
            fragment.appendChild(desc);
        }

        skillMeta.replaceChildren(fragment);
        showElement(skillInfoCard);
    }

    function updateLevelToggle(skillId) {
        const skill = weaponSimData.getSkillById(skillId);
        if (!hasMultipleLevels(skill)) {
            levelToggleContainer.replaceChildren();
            return;
        }

        const isLevel10 = currentSkillLevel === '10';
        renderLevelToggle(levelToggleContainer, `Lv.${isLevel10 ? '10' : '1'}`, isLevel10, async () => {
            currentSkillLevel = currentSkillLevel === '1' ? '10' : '1';
            await updateSkillDisplay(skillId);
        });
    }

    async function updateWeaponCards(skillId) {
        const weaponInfoList = weaponSimData.getWeaponIdsFromSkill(skillId, currentSkillLevel);
        if (weaponInfoList.length === 0) {
            renderPlaceholder(weaponCardsContainer, '무기 데이터가 없습니다.');
            return;
        }

        const cards = [];
        const showNumber = weaponInfoList.length > 1;

        for (let i = 0; i < weaponInfoList.length; i++) {
            const info = weaponInfoList[i];
            const weapon = weaponSimData.getWeaponById(info.weaponId);
            if (!weapon) continue;

            const card = buildWeaponCard(weapon, info, i + 1, showNumber, {
                bulletData: simEngine.allBulletData,
                barrageData: simEngine.allBarrageData
            });
            cards.push(card);
        }

        weaponCardsContainer.replaceChildren(...cards);
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
            // Airdrop bomb. extra_param.airdrop is a boolean flag — the airdrop
            // parameters are FLAT on extra_param, NOT nested under .airdrop.
            // Assemble the explode point faithfully: SetTemplateData's
            // randomOffset plus SetExplodePosition (battlebombbulletunit.lua).
            // accuracy has no buff source (treated as 0); barragePriority /
            // barrageLowPriority / fixToRange appear on 0 airdrop bombs and are
            // not modelled.
            const ep = effectiveBulletInfo.extra_param;
            const explodePos = (ep.targetFixX !== undefined && ep.targetFixZ !== undefined)
                ? { x: ep.targetFixX, y: ep.targetFixZ }
                : { x: enemyGamePos?.x ?? startX_game, y: enemyGamePos?.y ?? startY_game };

            const rOffX = ep.randomOffsetX || 0;
            const rOffZ = ep.randomOffsetZ || 0;
            let scatterX = 0, scatterZ = 0;
            if (rOffX !== 0) scatterX = rOffX * (Math.random() - 0.5) + (ep.offsetX || 0);
            if (rOffZ !== 0) scatterZ = rOffZ * (Math.random() - 0.5) + (ep.offsetZ || 0);
            explodePos.x += scatterX + (ep.targetOffsetX || 0);
            explodePos.y += scatterZ + (ep.targetOffsetZ || 0);

            // The faithful physics core (BombBulletUnit) derives the bomb's
            // spawn point, drop height and vertical speed from explodePos.
            airdropData = { explodePos, direction };

            // finalX/Y feed createBullet's NaN guard and the legacy path (a
            // non-migrated airdrop bomb — e.g. airdrop + shrapnel). The
            // physics-core bomb path ignores them and uses airdropData.
            const gravity = ep.gravity ?? -0.05;
            const offsetY = ep.offsetY || 0;
            let horizontalOffset = 0;
            if (ep.dropOffset) {
                const convertedVelocity = effectiveBulletInfo.velocity * 0.2;
                horizontalOffset = Math.sqrt(Math.abs(offsetY * 2 / gravity)) * convertedVelocity;
                if (direction < 0) horizontalOffset *= -1;
            }
            finalX_game = explodePos.x - horizontalOffset;
            finalY_game = explodePos.y + offsetY;
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
