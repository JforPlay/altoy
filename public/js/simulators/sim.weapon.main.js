/**
 * sim.weapon.main.js
 * Main entry point for the weapon/skill simulator page.
 * Initializes the engine and WeaponSimData, populates the skill selector (grouped by ship),
 * renders weapon info cards, and fires barrages/aircraft when the fire button is clicked.
 * Part of the simulators module group; mirrors sim.aircraft.main.js structure.
 */

import { debounce, fetchJSON, getUrlParam, resolveUrl, setUrlParams, showElement, hideElement, setupModal, openModal, closeModal, createImgElement, setupFpsDisplay } from '../utils.js';
import { createWeaponSim } from './sim.weapon.controller.js';
import {
    buildWeaponCard,
    createMetaRow,
    makeClickableCard,
    populateChoicesOrSelect,
    renderLevelToggle,
    renderPlaceholder,
    setupEnemyToggle,
    setupPauseButton,
    setupSpeedControls
} from './sim.ui.js';
import { formatSkillDesc } from './sim.weapon.stats.js';

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
    let classGroupsData = null;
    let displayToken = 0;

    // --- Engine Initialization (shared controller) ---
    const sim = createWeaponSim({
        container: simContainer,
        entities: { vanguard, mainfleet, enemy },
        visualLog,
    });
    const simEngine = sim.simEngine;
    const weaponSimData = sim.data;

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
        sim.clearActiveFire();
        const selectedSkillId = getSelectedSkillId();
        if (selectedSkillId && selectedSkillId !== 'none') await sim.fireSkill(selectedSkillId, currentSkillLevel);
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
            const isCF = allSkills[skillId]?.cross_fleet;
            groups[shipName].push({ value: skillId, label: isCF ? `${skillName} (지원 탄막)` : skillName });
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
            desc.textContent = formatSkillDesc(skill.desc, {
                descGetAdd: skill.desc_get_add,
                descGet: skill.desc_get,
            });
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

        // Resolve each skill weapon to the entries we actually card. An aircraft
        // launcher (weapon_id is an aircraft_template) carries its real damage on its
        // sub-weapons (bombs/torpedoes), so expand it into those — mirroring the
        // aircraft simulator and the spawnAircraft firing path. The launcher's own
        // `damage` is a placeholder and must not be shown. Normal weapons pass through.
        const displayWeapons = [];
        for (const info of weaponInfoList) {
            const aircraftData = simEngine.allAircraftData?.[info.weaponId];
            // Only expand when the plane actually carries payload sub-weapons. Some
            // launchers (e.g. 다이호 彩云 61016/recon) have an empty weapon_ID — their
            // attack is the launcher's own barrage, so fall through to its card.
            if (aircraftData?.weapon_ID?.length) {
                for (const subWid of aircraftData.weapon_ID) {
                    const subWeapon = weaponSimData.getWeaponById(subWid);
                    if (subWeapon) displayWeapons.push({ weapon: subWeapon, info: { weaponId: String(subWid) } });
                }
            } else {
                const weapon = weaponSimData.getWeaponById(info.weaponId);
                if (weapon) displayWeapons.push({ weapon, info });
            }
        }

        if (displayWeapons.length === 0) {
            renderPlaceholder(weaponCardsContainer, '무기 데이터를 불러올 수 없습니다.');
            return;
        }

        const showNumber = displayWeapons.length > 1;
        const cards = displayWeapons.map(({ weapon, info }, i) =>
            buildWeaponCard(weapon, info, i + 1, showNumber, {
                bulletData: simEngine.allBulletData,
                barrageData: simEngine.allBarrageData,
            })
        );

        weaponCardsContainer.replaceChildren(...cards);
    }

});
