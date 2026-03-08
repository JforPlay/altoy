import { debounce, getUrlParam, resolveUrl } from '../utils.js';
import { SimulationEngine } from './sim.engine.common.js';
import { WeaponSimData } from './sim.weapon.data.js';
import { AircraftEntity } from './sim.engine.aircraft.js';
document.addEventListener('DOMContentLoaded', async () => {
    // --- Constants ---
    // Game field dimensions from BattleConfig/BattleDataProxy
    // X-axis: horizontal (left-right), Z-axis mapped to Y (depth/vertical in 2D view)
    // Main fleet spawns at X=-105, enemy at X=15, formations at Z=38-78
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

    // --- Register Entities ---
    // Game spawn positions from BattleConfig.MAIN_UNIT_POS:
    //   Friendly main fleet: Vector3(-105, 0, 58) — center of formation
    //   Enemy main fleet: Vector3(15, 0, 58) — center of formation
    //   Z-axis range: 38 (bottom) to 78 (top) for formations
    // Vanguard position uses fleetCoordinate (dynamically loaded); approximate center of player area
    simEngine.registerEntities({
        vanguard: {
            element: vanguard,
            baseWidth: 6.5,
            aspectRatio: 178 / 226,
            gamePos: {
                x: -36,  // Approximate vanguard position (mid-field, from SubSupportUnitPosList)
                y: 58    // Game center Z = 58
            }
        },
        mainfleet: {
            element: mainfleet,
            baseWidth: 6.5,
            aspectRatio: 195 / 253,
            gamePos: {
                x: -105,  // Game: MAIN_UNIT_POS friendly X = -105
                y: 58     // Game: MAIN_UNIT_POS friendly Z = 58 (center)
            }
        },
        enemy: {
            element: enemy,
            baseWidth: 7.0,
            aspectRatio: 369 / 300
        }
    });

    simEngine.registerEntityState('enemy', {
        getGamePos: (state, coords) => ({
            x: 15,    // Game: MAIN_UNIT_POS enemy X = 15
            y: state.centered
                ? 58   // Game center Z = 58
                : 72   // Upper position (closer to Z=78 top formation slot)
        })
    });

    simEngine.setEntityState('enemy', 'centered', false);

    let choicesInstance;
    let levelToggleButton;

    // --- Initialize ---
    await weaponSimData.loadData();
    simEngine.updateLayoutAndScale(playerAreaDiv);
    populateSkillSelector();
    initFPSDisplay()

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

        // Pause/resume FPS counter when page visibility changes
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
        // If timeUnitIsFrames is true, value is in frames, convert to seconds first
        if (timeUnitIsFrames) {
            const seconds = value / TARGET_FPS;
            return seconds * 1000;
        }
        // Otherwise value is already in seconds
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
        levelToggleButton = document.getElementById('level-toggle');
        if (!levelToggleButton) return;
        levelToggleButton.addEventListener('click', async () => {
            currentSkillLevel = currentSkillLevel === '1' ? '10' : '1';
            await updateSkillStats(skillId);
        });
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

        // Ensure weapon chunks are loaded before firing
        await weaponSimData.ensureSkillWeaponsLoaded(skillId, currentSkillLevel);

        // Pre-load aircraft sub-weapon chunks (aircraft carry their own weapons)
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

        // iterates over weaponInfo objects
        weaponSimData.getWeaponIdsFromSkill(skillId, currentSkillLevel).forEach((weaponInfo, index) =>
            scheduleFireTimer(() => fireWeapon(weaponInfo, skillPosition), index * 100)
        );
    }

    // Accepts a weaponInfo object
    function fireWeapon(weaponInfo, skillPosition = null) {
        const weapon = weaponSimData.getWeaponById(weaponInfo.weaponId);
        if (!weapon || !Array.isArray(weapon.barrage_ID)) {
            simEngine.logToScreen(`Weapon ${weaponInfo.weaponId} has invalid data`, 'error');
            return;
        }

        // Check if this weapon has aircraft data
        const aircraftData = simEngine.allAircraftData?.[weaponInfo.weaponId];
        if (aircraftData && aircraftData.weapon_ID) {
            spawnAircraft(aircraftData, weapon, skillPosition);
            return;
        }

        for (let i = 0; i < weapon.barrage_ID.length; i++) {
            const barrage = simEngine.allBarrageData[weapon.barrage_ID[i]];
            const bulletInfo = simEngine.allBulletData[weapon.bullet_ID[i]];
            if (!barrage || !bulletInfo) continue;
            // Passes the full weaponInfo object down
            fireBarrage(weapon, barrage, bulletInfo, null, 1, skillPosition, weaponInfo);
        }
    }

    function spawnAircraft(aircraftData, parentWeapon, skillPosition) {
        const spawnLocation = skillPosition === '전열' ? 'vanguard' : 'mainfleet';
        const spawnPos = simEngine.getEntityGamePos(spawnLocation);
        const enemyPos = simEngine.getEntityGameCoords('enemy');
        const targetX = enemyPos?.x || 50;

        // Number of aircraft from barrage count
        const count = parentWeapon.barrage_ID?.length || 1;

        for (let i = 0; i < count; i++) {
            const startY = spawnPos.y + (i - (count - 1) / 2) * 3; // Spread vertically

            const aircraft = new AircraftEntity({
                engine: simEngine,
                aircraftData: aircraftData,
                weaponIds: aircraftData.weapon_ID || [],
                startX: spawnPos.x - 20,
                startY: startY,
                targetX: targetX,
                targetY: enemyPos?.y || startY,
                direction: 1,
                startDelay: i * 200 // Stagger spawns — delays both animation and visibility
            });

            // Callback: when aircraft reaches target, fire sub-weapons
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

    // Task 1.11: Fix Wave Timing - Chain waves using callbacks
    // Wave N+1 starts after wave N's bullets finish firing + senior_delay
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

        // Direction: RIGHT=1 (baseAngle stays), LEFT=-1 (baseAngle += 180)
        const rawAngle = weapon.axis_angle ?? weapon.angle ?? 0;
        baseAngle = direction === -1 ? rawAngle + 180 : rawAngle;

        const seniorRepeatCount = weaponInfo.quota ?? ((barrage.senior_repeat || 0) + 1);
        const seniorDelay = barrage.senior_delay || 0;
        const firstDelay = barrage.first_delay || 0;

        // Calculate the primal duration for a single wave (time to fire all bullets in one wave)
        function calculatePrimalDuration(b) {
            const primalCount = (b.primal_repeat || 0) + 1;
            if (primalCount <= 1) return 0;

            if (b.delta_delay && b.delta_delay !== 0) {
                // Advancing delay: sum of intervals
                let total = 0;
                let currentInterval = b.delay || 0;
                for (let i = 0; i < primalCount - 1; i++) {
                    total += currentInterval;
                    currentInterval += (b.delta_delay || 0);
                }
                return total;
            } else if (b.delay && b.delay !== 0) {
                // Constant delay
                return (primalCount - 1) * b.delay;
            }
            return 0;
        }

        // Chain waves: fire wave 0, then after its duration + senior_delay, fire wave 1, etc.
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

            // Schedule next wave after this wave's primal duration + senior_delay
            if (waveIndex + 1 < seniorRepeatCount) {
                const primalDuration = calculatePrimalDuration(barrage);
                const nextWaveTime = actualStartTime + primalDuration + seniorDelay;
                scheduleFireTimer(() => {
                    fireWaveChain(waveIndex + 1, nextWaveTime);
                }, convertToMs(nextWaveTime) - convertToMs(actualStartTime));
            }
        }

        // Precast: delay all bullet spawning by precast_param.time
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
        let currentPrimalInterval = barrage.delay || 0; // in seconds

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
        const constantInterval = barrage.delay || 0; // in seconds

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
            angleModifier = (Math.random() - 0.5) * (bulletIndex * (barrage.delta_angle || 0) + (barrage.angle || 0));
        } else {
            angleModifier = bulletIndex * (barrage.delta_angle || 0) + (barrage.angle || 0);
        }

        // Shotgun emitter: weapon.random_angle uses weapon.angle as spread range
        // Formula: random(angleRange) - angleRange/2  (uniform distribution)
        let weaponAngleSpread = 0;
        if (weapon.random_angle) {
            const angleRange = weapon.angle || 0;
            weaponAngleSpread = Math.random() * angleRange - angleRange / 2;
        }

        // Task 2.2/2.5: For beam bullets, attach barrage delta_angle and use host position
        let effectiveBulletInfo = bulletInfo;
        if (bulletInfo.type === 10) {
            effectiveBulletInfo = { ...bulletInfo, beam_delta_angle: barrage.delta_angle || 0 };
        }

        let finalX_game, finalY_game;
        const isAirdrop = effectiveBulletInfo.extra_param?.airdrop;
        let airdropData = null;

        // Task 2.5: Beam bullets skip airdrop and use host position
        if (effectiveBulletInfo.type === 10) {
            finalX_game = startX_game;
            finalY_game = startY_game;
        } else if (isAirdrop) {
            // Task 2.4: Enhanced bomb — random offset, target offset, target fix
            const explodePos = { x: enemyGamePos.x, y: enemyGamePos.y };

            // Random offset (game: randomOffsetX/Z from airdrop data)
            const randomOffsetX = effectiveBulletInfo.extra_param.airdrop?.randomOffsetX || 0;
            const randomOffsetZ = effectiveBulletInfo.extra_param.airdrop?.randomOffsetZ || 0;
            if (randomOffsetX) explodePos.x += (Math.random() - 0.5) * randomOffsetX;
            if (randomOffsetZ) explodePos.y += (Math.random() - 0.5) * randomOffsetZ;

            // Target offset (fixed offset from target position)
            const targetOffsetX = effectiveBulletInfo.extra_param.airdrop?.targetOffsetX || 0;
            const targetOffsetZ = effectiveBulletInfo.extra_param.airdrop?.targetOffsetZ || 0;
            explodePos.x += targetOffsetX;
            explodePos.y += targetOffsetZ;

            // Target fix (absolute coordinate override)
            if (effectiveBulletInfo.extra_param.airdrop?.targetFixX !== undefined) {
                explodePos.x = effectiveBulletInfo.extra_param.airdrop.targetFixX;
            }
            if (effectiveBulletInfo.extra_param.airdrop?.targetFixZ !== undefined) {
                explodePos.y = effectiveBulletInfo.extra_param.airdrop.targetFixZ;
            }

            // Barrage priority: use barrage offsets as additional offset on target
            if (barrage.offset_prioritise && effectiveBulletInfo.extra_param.airdrop?.barragePriority) {
                const bOffsetX = (barrage.offset_x || 0) + bulletIndex * (barrage.delta_offset_x || 0);
                const bOffsetZ = (barrage.offset_z || 0) + bulletIndex * (barrage.delta_offset_z || 0);
                explodePos.x += bOffsetX;
                explodePos.y += bOffsetZ;
            }

            const gravity = effectiveBulletInfo.extra_param.gravity || -0.0005;
            const offsetY = effectiveBulletInfo.extra_param.airdrop.offsetY || 0;
            const dropOffset = effectiveBulletInfo.extra_param.airdrop.dropOffset;
            let horizontalOffset = 0;
            if (dropOffset) {
                // Task 1.1: Use game speed convert (0.2) for airdrop velocity
                const convertedVelocity = effectiveBulletInfo.velocity * 0.2;
                horizontalOffset = Math.sqrt(Math.abs(offsetY * 2 / gravity)) * convertedVelocity;
                if (direction < 0) horizontalOffset *= -1;
            }
            finalX_game = explodePos.x - horizontalOffset;
            finalY_game = explodePos.y + offsetY;
            airdropData = { explodePos, gravity, offsetY, horizontalOffset };
        } else {
            // Task 1.9: Offsets are always additive (no rotation matrix)
            // offset_prioritise only affects AIM ANGLE, not offset rotation
            // Direction flips X-offset sign (game: offsetX * directionMultiplier)
            const offsetX = ((barrage.offset_x || 0) + (bulletIndex * (barrage.delta_offset_x || 0))) * direction;
            finalX_game = startX_game + offsetX;
            finalY_game = startY_game + (barrage.offset_z || 0) + (bulletIndex * (barrage.delta_offset_z || 0));

            // Random launch offset: per-bullet position jitter
            // Game formula: random() * value * 2 - value (range: -value to +value)
            if (weapon.randomLaunchOffsetX) {
                finalX_game += Math.random() * weapon.randomLaunchOffsetX * 2 - weapon.randomLaunchOffsetX;
            }
            if (weapon.randomLaunchOffsetZ) {
                finalY_game += Math.random() * weapon.randomLaunchOffsetZ * 2 - weapon.randomLaunchOffsetZ;
            }
        }

        // Task 1.10: Fix AIM Type - compute aim angle from spawn to enemy
        let finalAngle;
        if (weapon.aim_type === 1 && enemyGamePos) {
            // Compute aim angle from spawn position to enemy
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
            // Task 1.13: Pass angleModifier as barrageAngle for acceleration flip logic
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

        // Load weapon chunks for this skill's weapons
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
