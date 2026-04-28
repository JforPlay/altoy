/**
 * sim.aircraft.main.js
 * Main entry point for the aircraft simulator page.
 * Initializes the engine and AircraftSimData, populates the equipment selector,
 * renders weapon cards, and fires aircraft groups when the fire button is clicked.
 * Part of the simulators module group; mirrors sim.weapon.main.js structure.
 */

import { debounce, getUrlParam, setUrlParams, resolveUrl, showElement, hideElement, createImgElement, setupFpsDisplay } from '../utils.js';
import { SimulationEngine } from './sim.engine.common.js';
import { AircraftSimData } from './sim.aircraft.data.js';
import { AircraftEntity } from './sim.engine.aircraft.js';
import {
    SIM_DEFAULT_SPEED,
    SIM_GAME_COORDS,
    SIM_TARGET_FPS,
    buildWeaponCard,
    convertToMs,
    makeClickableCard,
    populateChoicesOrSelect,
    registerDefaultBattleEntities,
    renderLevelToggle,
    renderPlaceholder,
    setPressed,
    setupEnemyToggle,
    setupPauseButton,
    setupSpeedControls
} from './sim.ui.js';

const EQUIP_ICON_BASE = 'https://raw.githubusercontent.com/JforPlay/data_for_toy/main/equips';

const RARITY_COLORS = {
    2: 'var(--rarity-n)', 3: 'var(--rarity-r)', 4: 'var(--rarity-sr)',
    5: 'var(--rarity-ssr)', 6: 'var(--rarity-ur)',
};

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
    const aircraftSelect = document.getElementById('aircraft-select');
    const visualLog = document.getElementById('visual-log');
    const weaponCardsContainer = document.getElementById('weapon-cards-container');
    const aircraftInfoCard = document.getElementById('aircraft-info-card');
    const levelToggleContainer = document.getElementById('level-toggle-container');

    // --- State ---
    let currentLevelIndex = 0;
    let currentEquipId = null;
    let pendingFireTimers = [];
    let activeAircraft = [];
    let displayToken = 0;
    const typeFilterButtons = [];

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

    const aircraftSimData = new AircraftSimData(simEngine);

    registerDefaultBattleEntities(simEngine, { vanguard, mainfleet, enemy });

    let choicesInstance;
    let allDeduped = [];

    // --- Initialize ---
    try {
        await aircraftSimData.loadData();
    } catch (error) {
        renderPlaceholder(weaponCardsContainer, '함재기 데이터를 불러올 수 없습니다. 잠시 후 다시 시도하세요.', 'error');
        fireButton.disabled = true;
        return;
    }
    simEngine.updateLayoutAndScale(playerAreaDiv);
    allDeduped = aircraftSimData.getDeduplicatedList();
    populateAircraftSelector();
    initTypeFilter();
    setupFpsDisplay(document.getElementById('fps-display'));
    setupSpeedControls(simEngine);
    setupPauseButton(simEngine, pauseButton);
    setupEnemyToggle(simEngine, enemyToggle, playerAreaDiv);

    const equipIdFromUrl = getUrlParam('equip');
    if (equipIdFromUrl) {
        if (choicesInstance) choicesInstance.setChoiceByValue(equipIdFromUrl);
        await updateAircraftDisplay(equipIdFromUrl);
    } else {
        const selectedId = choicesInstance?.getValue(true);
        if (selectedId && selectedId !== 'none') await updateAircraftDisplay(selectedId);
    }

    // --- Event Listeners ---
    window.addEventListener('resize', debounce(() => {
        simEngine.updateLayoutAndScale(playerAreaDiv);
    }, 150));

    if (aircraftSelect) {
        aircraftSelect.addEventListener('change', async (e) => {
            currentLevelIndex = 0;
            await updateAircraftDisplay(e.target.value);
        });
    }

    fireButton.addEventListener('click', async () => {
        pendingFireTimers.forEach(id => clearTimeout(id));
        pendingFireTimers = [];
        activeAircraft.forEach(a => a.destroy());
        activeAircraft = [];
        simEngine.clearBullets();
        if (currentEquipId) await fireAircraft(currentEquipId);
        else simEngine.logToScreen('No aircraft selected.', 'error');
    });

    // ===== Aircraft Selector =====

    // --- Aircraft Selector (grouped by type with filter) ---
    function populateAircraftSelector(filterType = null) {
        if (!aircraftSelect) return;
        if (allDeduped.length === 0) allDeduped = aircraftSimData.getDeduplicatedList();

        const filtered = filterType
            ? allDeduped.filter(e => e.type_name === filterType)
            : allDeduped;

        // Group by type_name
        const groups = {};
        for (const equip of filtered) {
            const typeName = equip.type_name || '기타';
            if (!groups[typeName]) groups[typeName] = [];
            groups[typeName].push({ value: String(equip.id), label: equip.name });
        }

        const typeOrder = ['전투기', '뇌격기', '폭격기', '수상기', '대잠기'];
        const choiceGroups = typeOrder
            .filter(t => groups[t])
            .map(t => ({ label: t, choices: groups[t] }));

        for (const t of Object.keys(groups)) {
            if (!typeOrder.includes(t)) {
                choiceGroups.push({ label: t, choices: groups[t] });
            }
        }

        const firstEquip = filtered[0];
        choicesInstance = populateChoicesOrSelect(aircraftSelect, choiceGroups, {
            choicesConfig: {
                searchEnabled: true,
                itemSelectText: '선택',
                shouldSort: false,
                searchPlaceholderValue: '함재기 검색...',
                noResultsText: '검색 결과 없음',
                placeholder: false,
            },
            firstValue: firstEquip ? String(firstEquip.id) : null,
            destroyExisting: choicesInstance,
        });

        return firstEquip ? String(firstEquip.id) : null;
    }

    function initTypeFilter() {
        const container = document.getElementById('type-filter');
        if (!container) return;

        const typeOrder = ['전투기', '뇌격기', '폭격기', '수상기', '대잠기'];
        const availableTypes = new Set(allDeduped.map(e => e.type_name));

        const makeFilterBtn = (label, filterType, isInitial) => {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = `type-filter-btn${isInitial ? ' active' : ''}`;
            btn.textContent = label;
            btn.setAttribute('aria-pressed', String(isInitial));
            btn.addEventListener('click', async () => {
                setActiveFilterBtn(btn);
                const selectedId = populateAircraftSelector(filterType);
                currentLevelIndex = 0;
                if (selectedId) await updateAircraftDisplay(selectedId);
            });
            container.appendChild(btn);
            typeFilterButtons.push(btn);
        };

        makeFilterBtn('전체', null, true);
        for (const type of typeOrder) {
            if (availableTypes.has(type)) makeFilterBtn(type, type, false);
        }
    }

    function setActiveFilterBtn(activeBtn) {
        for (const btn of typeFilterButtons) setPressed(btn, btn === activeBtn);
    }

    // ===== Display Update =====

    // --- Update Display ---
    async function updateAircraftDisplay(equipId) {
        if (!equipId || equipId === 'none') {
            renderPlaceholder(weaponCardsContainer, '함재기를 선택하여 무기 정보를 확인하세요.');
            hideElement(aircraftInfoCard);
            levelToggleContainer.replaceChildren();
            currentEquipId = null;
            return;
        }

        const token = ++displayToken;
        currentEquipId = equipId;
        setUrlParams({ equip: equipId }, { replace: true });

        // Find lite data for this equip
        const equipLite = aircraftSimData.equipList.find(e => String(e.id) === String(equipId));

        await aircraftSimData.ensureAircraftWeaponsLoaded(equipId, currentLevelIndex);
        if (token !== displayToken) return;

        updateAircraftInfoCard(equipId, equipLite);
        updateLevelToggle(equipId);
        await updateWeaponCards(equipId);
    }

    function updateAircraftInfoCard(equipId, equipLite) {
        const meta = document.getElementById('aircraft-meta');
        if (!equipLite) {
            hideElement(aircraftInfoCard);
            return;
        }

        const iconUrl = equipLite.icon ? `${EQUIP_ICON_BASE}/${equipLite.icon}.webp` : '';
        const rarityColor = RARITY_COLORS[equipLite.rarity] || 'var(--text-muted)';

        // Get aircraft template stats
        const weaponIds = aircraftSimData.getWeaponIdsForLevel(equipId, currentLevelIndex);
        const aircraftData = weaponIds.length > 0 ? aircraftSimData.getAircraftTemplate(weaponIds[0]) : null;

        const fragment = document.createDocumentFragment();
        const header = document.createElement('div');
        header.className = 'skill-header';
        header.id = 'equip-link';
        if (iconUrl) {
            header.appendChild(createImgElement(iconUrl, '', { className: 'skill-icon aircraft-equip-icon' }));
        }
        const headerText = document.createElement('div');
        const name = document.createElement('div');
        name.className = 'skill-name';
        name.textContent = equipLite.name;
        const sub = document.createElement('div');
        sub.className = 'sim-muted-text';
        sub.textContent = `${equipLite.type_name} · ${equipLite.nation_name || ''}`;
        headerText.append(name, sub);
        const rarity = document.createElement('span');
        rarity.className = 'ammo-badge aircraft-rarity-badge';
        rarity.style.background = rarityColor;
        rarity.textContent = equipLite.rarity_name;
        header.append(headerText, rarity);
        fragment.appendChild(header);

        if (aircraftData) {
            const stats = document.createElement('div');
            stats.className = 'weapon-stats aircraft-stats';
            const statRows = [
                ['항속', aircraftData.speed],
                ['회피', aircraftData.dodge],
                ['회피한계', aircraftData.dodge_limit],
                ['충돌 데미지', aircraftData.crash_DMG],
                ['탑재 무장', aircraftData.weapon_ID ? `${aircraftData.weapon_ID.length}개` : null],
            ];
            for (const [label, value] of statRows) {
                if (value == null) continue;
                const item = document.createElement('div');
                item.className = 'stat-item';
                const labelEl = document.createElement('span');
                labelEl.className = 'stat-label';
                labelEl.textContent = label;
                const valueEl = document.createElement('span');
                valueEl.className = 'stat-value';
                valueEl.textContent = value;
                item.append(labelEl, valueEl);
                stats.appendChild(item);
            }
            fragment.appendChild(stats);
        }

        const moreInfo = document.createElement('div');
        moreInfo.className = 'more-info';
        moreInfo.textContent = '클릭하여 장비 정보 보기 →';
        fragment.appendChild(moreInfo);

        meta.replaceChildren(fragment);
        showElement(aircraftInfoCard);

        makeClickableCard(aircraftInfoCard, {
            onActivate: () => { window.location.href = resolveUrl(`equip/equip-viewer?equip=${equipId}`); },
            ariaLabel: `${equipLite.name} 장비 정보 보기`,
        });
    }

    function updateLevelToggle(equipId) {
        const maxLevel = aircraftSimData.getMaxLevelIndex(equipId);
        if (maxLevel <= 0) {
            levelToggleContainer.replaceChildren();
            return;
        }

        // Clamp current level
        if (currentLevelIndex > maxLevel) currentLevelIndex = maxLevel;

        const levelLabel = `+${currentLevelIndex}`;
        const isMax = currentLevelIndex === maxLevel;
        renderLevelToggle(levelToggleContainer, levelLabel, isMax, async () => {
            currentLevelIndex = (currentLevelIndex + 1) % (maxLevel + 1);
            await updateAircraftDisplay(currentEquipId);
        });
    }

    async function updateWeaponCards(equipId) {
        const weaponIds = aircraftSimData.getWeaponIdsForLevel(equipId, currentLevelIndex);
        if (weaponIds.length === 0) {
            renderPlaceholder(weaponCardsContainer, '무기 데이터가 없습니다.');
            return;
        }

        const cards = [];
        let weaponIndex = 1;

        for (const wid of weaponIds) {
            const aircraftData = aircraftSimData.getAircraftTemplate(wid);
            if (!aircraftData?.weapon_ID) continue;

            for (const subWid of aircraftData.weapon_ID) {
                const weapon = aircraftSimData.getWeaponById(subWid);
                if (!weapon) continue;
                cards.push(buildWeaponCard(weapon, { weaponId: subWid }, weaponIndex++, true, {
                    bulletData: simEngine.allBulletData,
                    barrageData: simEngine.allBarrageData
                }));
            }
        }

        if (cards.length === 0) {
            renderPlaceholder(weaponCardsContainer, '무기 데이터를 불러올 수 없습니다.');
            return;
        }

        weaponCardsContainer.replaceChildren(...cards);
    }

    // ===== Firing Logic =====

    async function fireAircraft(equipId) {
        const weaponIds = aircraftSimData.getWeaponIdsForLevel(equipId, currentLevelIndex);
        if (weaponIds.length === 0) {
            simEngine.logToScreen('No weapon data for this aircraft.', 'error');
            return;
        }

        await aircraftSimData.ensureAircraftWeaponsLoaded(equipId, currentLevelIndex);

        const equipLite = aircraftSimData.equipList.find(e => String(e.id) === String(equipId));
        simEngine.logToScreen(`Launching: ${equipLite?.name || equipId} (+${currentLevelIndex})`);

        for (const wid of weaponIds) {
            const aircraftData = aircraftSimData.getAircraftTemplate(wid);
            if (!aircraftData?.weapon_ID) continue;

            const weapon = aircraftSimData.getWeaponById(wid);
            spawnAircraft(aircraftData, weapon);
        }
    }

    function spawnAircraft(aircraftData, parentWeapon) {
        const spawnPos = simEngine.getEntityGamePos('mainfleet');
        const enemyPos = simEngine.getEntityGameCoords('enemy');
        const targetX = enemyPos?.x || 50;
        const count = parentWeapon?.barrage_ID?.length || 1;
        const subWeaponIds = aircraftData.weapon_ID || [];

        // Get per-weapon firing ranges from weapon_property.range
        const weaponRanges = subWeaponIds.map(wid => {
            const w = aircraftSimData.getWeaponById(wid);
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
                const subWeapon = aircraftSimData.getWeaponById(subWeaponId);
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
            const spawnPos = simEngine.getEntityGamePos('mainfleet');
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

        let finalAngle;
        if (weapon.aim_type === 1 && enemyGamePos) {
            // Always aim from bullet's actual spawn position — each bullet converges on target
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
