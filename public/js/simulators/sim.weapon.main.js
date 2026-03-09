import { debounce, getUrlParam, resolveUrl } from '../utils.js';
import { SimulationEngine } from './sim.engine.common.js';
import { WeaponSimData } from './sim.weapon.data.js';
import { AircraftEntity } from './sim.engine.aircraft.js';
document.addEventListener('DOMContentLoaded', async () => {
    // Game field dimensions (BattleConfig/BattleDataProxy)
    // X-axis: horizontal, Z-axis → Y (depth). Main fleet at X=-105, enemy at X=15
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
    const statsContent = document.getElementById('stats-content');
    const skillSelect = document.getElementById('skill-select');
    const visualLog = document.getElementById('visual-log');

    // --- State ---
    let currentSkillLevel = '1';
    let pendingFireTimers = [];
    let activeAircraft = [];

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

    // Game spawn positions (BattleConfig.MAIN_UNIT_POS):
    //   Friendly main fleet: (-105, 0, 58), Enemy: (15, 0, 58)
    //   Formation Z range: 38 (bottom) to 78 (top)
    simEngine.registerEntities({
        vanguard: {
            element: vanguard,
            baseWidth: 6.5,
            aspectRatio: 178 / 226,
            gamePos: { x: -36, y: 58 }
        },
        mainfleet: {
            element: mainfleet,
            baseWidth: 6.5,
            aspectRatio: 195 / 253,
            gamePos: { x: -105, y: 58 }
        },
        enemy: {
            element: enemy,
            baseWidth: 7.0,
            aspectRatio: 369 / 300
        }
    });

    simEngine.registerEntityState('enemy', {
        getGamePos: (state) => ({
            x: 15,
            y: state.centered ? 58 : 72
        })
    });

    simEngine.setEntityState('enemy', 'centered', false);

    let choicesInstance;
    let levelToggleListener = null;

    // --- Initialize ---
    await weaponSimData.loadData();
    simEngine.updateLayoutAndScale(playerAreaDiv);
    populateSkillSelector();
    initFPSDisplay();

    const skillIdFromUrl = getUrlParam('skill_id');

    if (skillIdFromUrl) {
        if (choicesInstance) {
            choicesInstance.setChoiceByValue(skillIdFromUrl);
        }
        await updateSkillStats(skillIdFromUrl);
    } else {
        const selectedSkillId = choicesInstance?.getValue(true);
        if (selectedSkillId) await updateSkillStats(selectedSkillId);
        else statsContent.innerHTML = '<p>사용 가능한 스킬이 없습니다.</p>';
    }

    // --- Event Listeners ---
    window.addEventListener('resize', debounce(() => {
        simEngine.updateLayoutAndScale(playerAreaDiv);
    }, 150));

    if (skillSelect) {
        skillSelect.addEventListener('change', async (e) => {
            currentSkillLevel = '1';
            await updateSkillStats(e.target.value);
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

    // --- Helper Functions ---
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
                const fps = Math.round((frameCount * 1000) / (now - lastTime));
                fpsDisplay.textContent = `FPS: ${fps}`;
                frameCount = 0;
                lastTime = now;
            }
            fpsAnimId = requestAnimationFrame(updateFPS);
        }
        fpsAnimId = requestAnimationFrame(updateFPS);

        document.addEventListener('visibilitychange', () => {
            if (document.hidden) {
                if (fpsAnimId) {
                    cancelAnimationFrame(fpsAnimId);
                    fpsAnimId = null;
                }
            } else if (!fpsAnimId) {
                lastTime = performance.now();
                frameCount = 0;
                fpsAnimId = requestAnimationFrame(updateFPS);
            }
        });
    }

    function convertToMs(value, timeUnitIsFrames = false) {
        if (timeUnitIsFrames) {
            return (value / TARGET_FPS) * 1000;
        }
        return value * 1000;
    }

    function populateSkillSelector() {
        if (!skillSelect) return;
        const skillOptions = [{ value: 'none', label: '스킬 선택 안함' }];
        for (const skillId in weaponSimData.getAllSkills()) {
            const skillName = weaponSimData.getSkillName(skillId);
            skillOptions.push({ value: skillId, label: skillName });
        }
        choicesInstance = new Choices(skillSelect, {
            choices: skillOptions, searchEnabled: true, itemSelectText: '선택', shouldSort: false
        });
        if (skillOptions.length > 1) choicesInstance.setValue([skillOptions[1].value]);
    }

    function hasMultipleLevels(skill) {
        if (!skill) return false;
        const hasLevel1 = skill['1'] && skill['1'].effect_list;
        const hasLevel10 = skill['10'] && skill['10'].effect_list;
        return hasLevel1 && hasLevel10;
    }

    function getEffectList(skill, level) {
        if (skill[level]?.effect_list) return skill[level].effect_list;
        if (skill['1']?.effect_list) return skill['1'].effect_list;
        if (skill.effect_list) return skill.effect_list;
        return null;
    }

    function createLevelToggle(skillId) {
        const skill = weaponSimData.getSkillById(skillId);
        if (!hasMultipleLevels(skill)) return '';
        const isLevel10 = currentSkillLevel === '10';
        return `
            <button id="level-toggle" class="${isLevel10 ? 'level-10' : 'level-1'}">
                레벨 ${isLevel10 ? '10' : '1'}
            </button>
        `;
    }

    function attachLevelToggleListener(skillId) {
        const button = document.getElementById('level-toggle');
        if (!button) return;

        // Remove previous listener to prevent accumulation
        if (levelToggleListener) {
            button.removeEventListener('click', levelToggleListener);
        }
        levelToggleListener = async () => {
            currentSkillLevel = currentSkillLevel === '1' ? '10' : '1';
            await updateSkillStats(skillId);
        };
        button.addEventListener('click', levelToggleListener);
    }

    function createShipgirlInfoHTML(skill, skillId) {
        const skillWeaponData = weaponSimData.getAllSkills()[skillId];
        const shipName = skillWeaponData?.name || '알 수 없음';
        const shipyardIcon = skill.shipyard ? `<img src="${skill.shipyard}" alt="Shipyard" class="shipyard-icon-large">` : '';
        return `
            <div class="shipgirl-info-card" onclick="window.location.href='${resolveUrl(`shipgirl/shipgirl-info/?ship=${encodeURIComponent(shipName)}`)}';" style="cursor: pointer;">
                <div class="shipgirl-name-large">${shipName}</div>
                ${shipyardIcon}
                <div class="more-info-text">클릭하여 함선 정보 보기 →</div>
            </div>
        `;
    }

    async function fireSkill(skillId) {
        const skill = weaponSimData.getSkillById(skillId);
        if (!skill) {
            simEngine.logToScreen(`Skill ${skillId} not found`, 'error');
            return;
        }

        await weaponSimData.ensureSkillWeaponsLoaded(skillId, currentSkillLevel);

        // Pre-load aircraft sub-weapon chunks
        const weaponInfoList = weaponSimData.getWeaponIdsFromSkill(skillId, currentSkillLevel);
        const aircraftSubWeaponLoads = [];
        for (const info of weaponInfoList) {
            const aircraftData = simEngine.allAircraftData?.[info.weaponId];
            if (aircraftData?.weapon_ID) {
                aircraftData.weapon_ID.forEach(subId =>
                    aircraftSubWeaponLoads.push(weaponSimData.ensureWeaponLoaded(subId))
                );
            }
        }
        if (aircraftSubWeaponLoads.length > 0) await Promise.all(aircraftSubWeaponLoads);

        const skillName = weaponSimData.getSkillName(skillId);
        const skillPosition = skill.position;
        simEngine.logToScreen(`Firing skill: ${skillName} (Level ${currentSkillLevel})`);

        // Each weapon fires at its effect_list 'time' offset (in frames at 30fps)
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

        for (let i = 0; i < count; i++) {
            const startY = spawnPos.y + (i - (count - 1) / 2) * 3;

            const aircraft = new AircraftEntity({
                engine: simEngine,
                aircraftData: aircraftData,
                weaponIds: aircraftData.weapon_ID || [],
                startX: spawnPos.x - 20,
                startY: startY,
                targetX: targetX,
                targetY: enemyPos?.y || startY,
                direction: 1,
                startDelay: i * 200
            });

            aircraft.onFireWeapons = (x, y, weaponIds) => {
                weaponIds.forEach(subWeaponId => {
                    const subWeapon = weaponSimData.getWeaponById(subWeaponId);
                    if (!subWeapon || !subWeapon.barrage_ID) return;

                    for (let j = 0; j < subWeapon.barrage_ID.length; j++) {
                        const barrage = simEngine.allBarrageData[subWeapon.barrage_ID[j]];
                        const bulletInfo = simEngine.allBulletData[subWeapon.bullet_ID[j]];
                        if (!barrage || !bulletInfo) continue;
                        fireBarrage(subWeapon, barrage, bulletInfo, { x, y }, 1, null);
                    }
                });
            };

            activeAircraft.push(aircraft);
        }
    }

    /**
     * Fire a barrage pattern: schedules all waves (senior_repeat) with proper timing.
     * Wave N+1 starts after wave N's bullets finish firing + senior_delay.
     */
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

        // Calculate how long a single wave takes (sum of all primal intervals)
        function calculatePrimalDuration(b) {
            const primalCount = (b.primal_repeat || 0) + 1;
            if (primalCount <= 1) return 0;

            if (b.delta_delay && b.delta_delay !== 0) {
                let total = 0;
                let currentInterval = b.delay || 0;
                for (let i = 0; i < primalCount - 1; i++) {
                    total += currentInterval;
                    currentInterval += (b.delta_delay || 0);
                }
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
                scheduleFireTimer(() => {
                    fireWaveChain(waveIndex + 1, nextWaveTime);
                }, convertToMs(nextWaveTime) - convertToMs(actualStartTime));
            }
        }

        const precastTime = weapon.precast_param?.time || 0;
        if (precastTime > 0) {
            scheduleFireTimer(() => {
                fireWaveChain(0, firstDelay);
            }, convertToMs(precastTime));
        } else {
            fireWaveChain(0, firstDelay);
        }
    }

    function fireWaveWithAdvancingDelay(waveStartTime, weapon, barrage, bulletInfo, startX_game, startY_game, baseAngle, direction = 1) {
        const primalRepeatCount = (barrage.primal_repeat || 0) + 1;
        let totalPrimalDelay = 0;
        let currentPrimalInterval = barrage.delay || 0;

        for (let i = 0; i < primalRepeatCount; i++) {
            const bulletFireTime = waveStartTime + totalPrimalDelay;
            scheduleFireTimer(() => {
                fireSingleBullet(i, weapon, barrage, bulletInfo, startX_game, startY_game, baseAngle, direction);
            }, convertToMs(bulletFireTime));

            totalPrimalDelay += currentPrimalInterval;
            currentPrimalInterval += (barrage.delta_delay || 0);
        }
    }

    function fireWaveWithConstantDelay(waveStartTime, weapon, barrage, bulletInfo, startX_game, startY_game, baseAngle, direction = 1) {
        const primalRepeatCount = (barrage.primal_repeat || 0) + 1;
        const constantInterval = barrage.delay || 0;

        for (let i = 0; i < primalRepeatCount; i++) {
            const bulletFireTime = waveStartTime + (i * constantInterval);
            scheduleFireTimer(() => {
                fireSingleBullet(i, weapon, barrage, bulletInfo, startX_game, startY_game, baseAngle, direction);
            }, convertToMs(bulletFireTime));
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
            // Game: random_angle randomizes pattern spread with full [-1, 1] range
            angleModifier = (Math.random() * 2 - 1) * (bulletIndex * (barrage.delta_angle || 0) + (barrage.angle || 0));
        } else {
            angleModifier = bulletIndex * (barrage.delta_angle || 0) + (barrage.angle || 0);
        }

        // Shotgun emitter: weapon.random_angle uses weapon.angle as spread range
        let weaponAngleSpread = 0;
        if (weapon.random_angle) {
            const angleRange = weapon.angle || 0;
            weaponAngleSpread = Math.random() * angleRange - angleRange / 2;
        }

        // Beam bullets: attach sweep rate from barrage delta_angle
        let effectiveBulletInfo = bulletInfo;
        if (bulletInfo.type === 10) {
            effectiveBulletInfo = { ...bulletInfo, beam_delta_angle: barrage.delta_angle || 0 };
        }

        let finalX_game, finalY_game;
        const isAirdrop = effectiveBulletInfo.extra_param?.airdrop;
        let airdropData = null;

        if (effectiveBulletInfo.type === 10) {
            // Beam bullets use host position directly
            finalX_game = startX_game;
            finalY_game = startY_game;
        } else if (isAirdrop) {
            // Bomb drop: calculate explode position with offsets
            const explodePos = { x: enemyGamePos.x, y: enemyGamePos.y };

            const airdrop = effectiveBulletInfo.extra_param.airdrop;
            const randomOffsetX = airdrop?.randomOffsetX || 0;
            const randomOffsetZ = airdrop?.randomOffsetZ || 0;
            if (randomOffsetX) explodePos.x += (Math.random() - 0.5) * randomOffsetX;
            if (randomOffsetZ) explodePos.y += (Math.random() - 0.5) * randomOffsetZ;

            const targetOffsetX = airdrop?.targetOffsetX || 0;
            const targetOffsetZ = airdrop?.targetOffsetZ || 0;
            explodePos.x += targetOffsetX;
            explodePos.y += targetOffsetZ;

            // Absolute coordinate override
            if (airdrop?.targetFixX !== undefined) {
                explodePos.x = airdrop.targetFixX;
            }
            if (airdrop?.targetFixZ !== undefined) {
                explodePos.y = airdrop.targetFixZ;
            }

            // Barrage priority: use barrage offsets as additional offset on target
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
            // Standard bullet: additive offsets, direction flips X
            const offsetX = ((barrage.offset_x || 0) + (bulletIndex * (barrage.delta_offset_x || 0))) * direction;
            finalX_game = startX_game + offsetX;
            finalY_game = startY_game + (barrage.offset_z || 0) + (bulletIndex * (barrage.delta_offset_z || 0));

            // Per-bullet random position jitter (from bullet extra_param)
            const rloX = effectiveBulletInfo.extra_param?.randomLaunchOffsetX;
            const rloZ = effectiveBulletInfo.extra_param?.randomLaunchOffsetZ;
            if (rloX) {
                finalX_game += Math.random() * rloX * 2 - rloX;
            }
            if (rloZ) {
                finalY_game += Math.random() * rloZ * 2 - rloZ;
            }
        }

        // AIM type: compute angle from spawn to enemy
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

    async function updateSkillStats(skillId) {
        if (skillId === 'none' || !skillId) {
            statsContent.innerHTML = `<p>스킬을 선택하여 정보를 확인하세요.</p>`;
            return;
        }

        const skill = weaponSimData.getSkillById(skillId);
        if (!skill) return;

        await weaponSimData.ensureSkillWeaponsLoaded(skillId, currentSkillLevel);

        const levelToggleHtml = createLevelToggle(skillId);
        const weaponInfoList = weaponSimData.getWeaponIdsFromSkill(skillId, currentSkillLevel);
        const skillName = weaponSimData.getSkillName(skillId);

        let skillStatsHtml = `<div class="stats-two-column">`;
        skillStatsHtml += `<div class="stats-column-left">`;
        if (skill.icon) {
            skillStatsHtml += `
                <div class="skill-icon-container">
                    <img src="${skill.icon}" alt="Skill Icon">
                    ${levelToggleHtml}
                </div>
            `;
        }
        skillStatsHtml += createShipgirlInfoHTML(skill, skillId);
        skillStatsHtml += `</div>`;

        skillStatsHtml += `<div class="stats-column-right">`;
        const weaponIdsToDisplay = weaponInfoList.map(info => info.weaponId);
        skillStatsHtml += `
            <p><strong>스킬 ID:</strong> ${skillId}</p>
            <p><strong>스킬 이름:</strong> ${skillName}</p>
            <p><strong>레벨:</strong> ${currentSkillLevel}</p>
            <p><strong>포지션:</strong> ${skill.position || '없음'}</p>
            <p><strong>요구사항:</strong> ${skill.requirement || '없음'}</p>
            <p><strong>사용 무기:</strong> ${weaponIdsToDisplay.length > 0 ? weaponIdsToDisplay.join(', ') : '없음'}</p>
        `;
        weaponInfoList.forEach(info => {
            if (info.quota !== undefined || info.time !== undefined) {
                skillStatsHtml += `<p class="weapon-detail">↳ <strong>무기 ${info.weaponId}:</strong>
                    ${info.quota !== undefined ? `Quota: ${info.quota}` : ''}
                    ${info.time !== undefined ? `, Time: ${info.time}s` : ''}
                </p>`;
            }
        });

        skillStatsHtml += `</div></div>`;

        if (weaponInfoList.length > 0) {
            const mainWeaponInfo = weaponInfoList[0];
            const weapon = weaponSimData.getWeaponById(mainWeaponInfo.weaponId);
            if (weapon) {
                const originalWeapon = weaponSimData.getAllWeapons()[mainWeaponInfo.weaponId];
                const isInherited = originalWeapon?.base ? ` (Base: ${originalWeapon.base})` : '';
                let spawnInfo = skill.position === '전열' ? '전위 (Vanguard)' : (skill.position ? '주력 (Main Fleet)' : (weapon.spawn_bound === 'vanguard' || weapon.spawn_bound === 'cannon' ? '전위 (Vanguard)' : '주력 (Main Fleet)'));
                skillStatsHtml += `
                    <hr>
                    <p><strong>주 무기 정보 (${mainWeaponInfo.weaponId})${isInherited}:</strong></p>
                    <p><strong>발사 위치:</strong> ${spawnInfo}</p>
                    <p><strong>데미지:</strong> ${weapon.damage || '없음'}</p>
                    <p><strong>축 각도 (deg):</strong> ${weapon.axis_angle ?? '없음'}° |
                       <strong>오프셋 각도 (deg):</strong> ${weapon.angle || 0}°</p>
                    <p><strong>탄막 수:</strong> ${weapon.barrage_ID ? weapon.barrage_ID.length : '?'}</p>
                `;
            }
        }
        if (skill.desc) skillStatsHtml += `<hr><p><strong>설명:</strong> ${skill.desc}</p>`;
        statsContent.innerHTML = skillStatsHtml;
        attachLevelToggleListener(skillId);
    }
});
