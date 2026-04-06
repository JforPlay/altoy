/**
 * sim.aircraft.main.js
 * Main entry point for the aircraft simulator page.
 * Initializes the engine and AircraftSimData, populates the equipment selector,
 * renders weapon cards, and fires aircraft groups when the fire button is clicked.
 * Part of the simulators module group; mirrors sim.weapon.main.js structure.
 */

import { debounce, getUrlParam, setUrlParams, resolveUrl, showElement, hideElement } from '../utils.js';
import { SimulationEngine } from './sim.engine.common.js';
import { AircraftSimData } from './sim.aircraft.data.js';
import { AircraftEntity } from './sim.engine.aircraft.js';

const EQUIP_ICON_BASE = 'https://raw.githubusercontent.com/JforPlay/data_for_toy/main/equips';

const AMMO_TYPE_NAMES = {
    1: '철갑탄', 2: '고폭탄', 3: '통상탄', 4: '음향 유도', 5: '통상',
    6: '삼식탄', 7: '반철갑탄(SAP탄)', 8: '자성식', 9: '격발식', 10: '없음', 11: '미사일',
};

const BULLET_TYPE_NAMES = {
    1: '포탄', 2: '폭탄', 3: '어뢰', 4: '파편', 5: '미사일',
    10: '빔', 11: '중력장', 14: '우주레이저', 15: '확장탄',
};

const RARITY_COLORS = {
    2: 'var(--rarity-n)', 3: 'var(--rarity-r)', 4: 'var(--rarity-sr)',
    5: 'var(--rarity-ssr)', 6: 'var(--rarity-ur)',
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
    let isPaused = false;

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

    const aircraftSimData = new AircraftSimData(simEngine);

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
    let allDeduped = [];
    let activeTypeFilter = null;

    // --- Initialize ---
    await aircraftSimData.loadData();
    simEngine.updateLayoutAndScale(playerAreaDiv);
    allDeduped = aircraftSimData.getDeduplicatedList();
    populateAircraftSelector();
    initTypeFilter();
    initFPSDisplay();
    initSpeedControls();
    initPauseButton();

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
                simEngine.bulletEngine.gSpeed = parseFloat(btn.dataset.speed);
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

        // Destroy and recreate Choices instance
        if (choicesInstance) choicesInstance.destroy();

        choicesInstance = new Choices(aircraftSelect, {
            choices: choiceGroups,
            searchEnabled: true,
            itemSelectText: '선택',
            shouldSort: false,
            searchPlaceholderValue: '함재기 검색...',
            noResultsText: '검색 결과 없음',
        });

        // Prevent page scroll when dropdown opens
        aircraftSelect.closest('.choices')?.addEventListener('showDropdown', () => {
            document.querySelector('.choices__list--dropdown')?.scrollIntoView?.({ block: 'nearest' });
        });

        const firstEquip = filtered[0];
        if (firstEquip) choicesInstance.setChoiceByValue(String(firstEquip.id));
    }

    function initTypeFilter() {
        const container = document.getElementById('type-filter');
        if (!container) return;

        const typeOrder = ['전투기', '뇌격기', '폭격기', '수상기', '대잠기'];
        const availableTypes = new Set(allDeduped.map(e => e.type_name));

        // "전체" button
        const allBtn = document.createElement('button');
        allBtn.className = 'type-filter-btn active';
        allBtn.textContent = '전체';
        allBtn.addEventListener('click', () => {
            activeTypeFilter = null;
            setActiveFilterBtn(allBtn);
            populateAircraftSelector(null);
        });
        container.appendChild(allBtn);

        for (const type of typeOrder) {
            if (!availableTypes.has(type)) continue;
            const btn = document.createElement('button');
            btn.className = 'type-filter-btn';
            btn.textContent = type;
            btn.addEventListener('click', () => {
                activeTypeFilter = type;
                setActiveFilterBtn(btn);
                populateAircraftSelector(type);
            });
            container.appendChild(btn);
        }
    }

    function setActiveFilterBtn(activeBtn) {
        document.querySelectorAll('.type-filter-btn').forEach(b => b.classList.remove('active'));
        activeBtn.classList.add('active');
    }

    // ===== Display Update =====

    // --- Update Display ---
    async function updateAircraftDisplay(equipId) {
        if (!equipId || equipId === 'none') {
            weaponCardsContainer.innerHTML = '<div class="card placeholder-card"><p>함재기를 선택하여 무기 정보를 확인하세요.</p></div>';
            hideElement(aircraftInfoCard);
            levelToggleContainer.innerHTML = '';
            currentEquipId = null;
            return;
        }

        currentEquipId = equipId;
        setUrlParams({ equip: equipId }, { replace: true });

        // Find lite data for this equip
        const equipLite = aircraftSimData.equipList.find(e => String(e.id) === String(equipId));

        await aircraftSimData.ensureAircraftWeaponsLoaded(equipId, currentLevelIndex);

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

        let html = `<div class="skill-header" style="cursor:pointer" id="equip-link">`;
        if (iconUrl) {
            html += `<img src="${iconUrl}" alt="" class="skill-icon" style="border-radius:var(--radius-sm)">`;
        }
        html += `<div>
            <div class="skill-name">${equipLite.name}</div>
            <div style="font-size:0.75rem;color:var(--text-muted)">${equipLite.type_name} · ${equipLite.nation_name || ''}</div>
        </div>
        <span class="ammo-badge" style="background:${rarityColor};margin-left:auto">${equipLite.rarity_name}</span>
        </div>`;

        // Aircraft stats
        if (aircraftData) {
            html += `<div class="weapon-stats" style="margin-top:var(--spacing-sm)">`;
            if (aircraftData.speed != null) html += `<div class="stat-item"><span class="stat-label">항속</span><span class="stat-value">${aircraftData.speed}</span></div>`;
            if (aircraftData.dodge != null) html += `<div class="stat-item"><span class="stat-label">회피</span><span class="stat-value">${aircraftData.dodge}</span></div>`;
            if (aircraftData.dodge_limit != null) html += `<div class="stat-item"><span class="stat-label">회피한계</span><span class="stat-value">${aircraftData.dodge_limit}</span></div>`;
            if (aircraftData.crash_DMG != null) html += `<div class="stat-item"><span class="stat-label">충돌 데미지</span><span class="stat-value">${aircraftData.crash_DMG}</span></div>`;
            if (aircraftData.weapon_ID) html += `<div class="stat-item"><span class="stat-label">탑재 무장</span><span class="stat-value">${aircraftData.weapon_ID.length}개</span></div>`;
            html += `</div>`;
        }

        html += `<div class="more-info" style="margin-top:var(--spacing-xs);font-size:0.8rem;color:var(--text-muted);cursor:pointer">클릭하여 장비 정보 보기 →</div>`;

        meta.innerHTML = html;
        showElement(aircraftInfoCard);

        // Cross-link to equip viewer
        aircraftInfoCard.onclick = () => {
            window.location.href = resolveUrl(`equip/equip-viewer?equip=${equipId}`);
        };
        aircraftInfoCard.style.cursor = 'pointer';
    }

    function updateLevelToggle(equipId) {
        const maxLevel = aircraftSimData.getMaxLevelIndex(equipId);
        if (maxLevel <= 0) {
            levelToggleContainer.innerHTML = '';
            return;
        }

        // Clamp current level
        if (currentLevelIndex > maxLevel) currentLevelIndex = maxLevel;

        const levelLabel = `+${currentLevelIndex}`;
        const isMax = currentLevelIndex === maxLevel;
        levelToggleContainer.innerHTML = `<button id="level-toggle" class="${isMax ? 'level-10' : ''}">${levelLabel}</button>`;

        document.getElementById('level-toggle').addEventListener('click', async () => {
            currentLevelIndex = (currentLevelIndex + 1) % (maxLevel + 1);
            await updateAircraftDisplay(currentEquipId);
        });
    }

    async function updateWeaponCards(equipId) {
        const weaponIds = aircraftSimData.getWeaponIdsForLevel(equipId, currentLevelIndex);
        if (weaponIds.length === 0) {
            weaponCardsContainer.innerHTML = '<div class="card placeholder-card"><p>무기 데이터가 없습니다.</p></div>';
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
                cards.push(buildWeaponCard(weapon, { weaponId: subWid }, weaponIndex++, true));
            }
        }

        if (cards.length === 0) {
            weaponCardsContainer.innerHTML = '<div class="card placeholder-card"><p>무기 데이터를 불러올 수 없습니다.</p></div>';
            return;
        }

        weaponCardsContainer.innerHTML = cards.join('');
    }

    function buildWeaponCard(weapon, weaponInfo, index, showNumber) {
        const firstBulletId = weapon.bullet_ID?.[0];
        const bulletInfo = firstBulletId ? simEngine.allBulletData[firstBulletId] : null;
        const ammoType = bulletInfo?.ammo_type || 0;
        const ammoName = AMMO_TYPE_NAMES[ammoType] || '알 수 없음';
        const bulletType = bulletInfo?.type || 0;
        const bulletTypeName = BULLET_TYPE_NAMES[bulletType] || '일반';

        let totalBullets = 0;
        if (weapon.barrage_ID) {
            weapon.barrage_ID.forEach(bId => {
                const barrage = simEngine.allBarrageData[bId];
                if (barrage) totalBullets += (barrage.primal_repeat || 0) + 1;
            });
        }

        const reloadMs = weapon.reload_max;
        const reloadDisplay = reloadMs ? `${(reloadMs / 10).toFixed(1)}s` : '-';
        const range = weapon.range || bulletInfo?.range || '-';
        const damage = weapon.damage || '-';
        const corrected = weapon.corrected ? ` (×${weapon.corrected}%)` : '';
        const pierce = bulletInfo?.pierce_count || '-';
        const damageType = bulletInfo?.damage_type;

        let html = `<div class="weapon-card">`;

        html += `<div class="weapon-card-header">
            <div class="weapon-card-title">${showNumber ? `무기 ${index}` : '무기 정보'}
                <span class="ammo-badge" style="background:var(--ammo-color-${ammoType})">${ammoName}</span>
            </div>
            <span class="weapon-card-id">${weaponInfo.weaponId}</span>
        </div>`;

        html += `<div class="weapon-stats">
            <div class="stat-item"><span class="stat-label">탄종</span><span class="stat-value">${bulletTypeName}</span></div>
            <div class="stat-item"><span class="stat-label">데미지</span><span class="stat-value">${damage}${corrected}</span></div>
            <div class="stat-item"><span class="stat-label">장전</span><span class="stat-value">${reloadDisplay}</span></div>
            <div class="stat-item"><span class="stat-label">사거리</span><span class="stat-value">${range}</span></div>
            <div class="stat-item"><span class="stat-label">발사 수</span><span class="stat-value">${totalBullets}</span></div>
            <div class="stat-item"><span class="stat-label">관통</span><span class="stat-value">${pierce}</span></div>`;

        if (damageType && Array.isArray(damageType) && damageType.length >= 3) {
            html += `<div class="armor-row">
                <div class="armor-chip"><span class="armor-label">경장</span>${damageType[0]}%</div>
                <div class="armor-chip"><span class="armor-label">중장</span>${damageType[1]}%</div>
                <div class="armor-chip"><span class="armor-label">중장갑</span>${damageType[2]}%</div>
            </div>`;
        }

        html += `</div>`;

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
                    </div>
                </details>`;
            }
        }

        html += `</div>`;
        return html;
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
