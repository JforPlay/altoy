import { debounce, getUrlParam, resolveUrl } from '../utils.js';
import { SimulationEngine } from './sim.engine.common.js';
import { WeaponSimData } from './sim.weapon.data.js';
document.addEventListener('DOMContentLoaded', async () => {
    // --- Constants ---
    const GAME_COORDS = {
        totalArea: { minX: -80, minY: 20, maxX: 90, maxY: 70 },
        playerArea: { minX: -80, minY: 20, maxX: 45, maxY: 68 }
    };
    const TARGET_FPS = 30;
    const GLOBAL_SPEED_MULTIPLIER = 1.5;
    // const TIME_UNIT_IS_FRAMES = false;

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
    simEngine.registerEntities({
        vanguard: {
            element: vanguard,
            baseWidth: 6.5,
            aspectRatio: 178 / 226,
            gamePos: {
                x: (GAME_COORDS.playerArea.minX + GAME_COORDS.playerArea.maxX) / 2,
                y: (GAME_COORDS.playerArea.minY + GAME_COORDS.playerArea.maxY) / 2
            }
        },
        mainfleet: {
            element: mainfleet,
            baseWidth: 6.5,
            aspectRatio: 195 / 253,
            gamePos: {
                x: GAME_COORDS.totalArea.minX + 6.5 / 2,
                y: (GAME_COORDS.totalArea.minY + GAME_COORDS.totalArea.maxY) / 2
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
            x: coords.playerArea.maxX + 7.0 / 2,
            y: state.centered
                ? (coords.playerArea.minY + coords.playerArea.maxY) / 2
                : coords.playerArea.maxY - 10
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

        function updateFPS() {
            const now = performance.now();
            frameCount++;

            if (now >= lastTime + 1000) {
                const fps = Math.round((frameCount * 1000) / (now - lastTime));
                fpsDisplay.textContent = `FPS: ${fps}`;
                frameCount = 0;
                lastTime = now;
            }
            requestAnimationFrame(updateFPS);
        }
        updateFPS();
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

        const skillName = weaponSimData.getSkillName(skillId);
        const skillPosition = skill.position;
        simEngine.logToScreen(`Firing skill: ${skillName} (Level ${currentSkillLevel})`);

        // iterates over weaponInfo objects
        weaponSimData.getWeaponIdsFromSkill(skillId, currentSkillLevel).forEach((weaponInfo, index) =>
            setTimeout(() => fireWeapon(weaponInfo, skillPosition), index * 100)
        );
    }

    // Accepts a weaponInfo object
    function fireWeapon(weaponInfo, skillPosition = null) {
        const weapon = weaponSimData.getWeaponById(weaponInfo.weaponId);
        if (!weapon || !Array.isArray(weapon.barrage_ID)) {
            simEngine.logToScreen(`Weapon ${weaponInfo.weaponId} has invalid data`, 'error');
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

        baseAngle = weapon.axis_angle ?? weapon.angle ?? 0;

        const seniorRepeatCount = weaponInfo.quota ?? ((barrage.senior_repeat || 0) + 1);
        const recoverTime = weapon.recover_time || 0;
        const seniorDelay = barrage.senior_delay || 0;
        const lastTime = bulletInfo.extra_param?.lastTime || 0;

        const delayBetweenWaves = weaponInfo.time ?? (recoverTime > 0 ? recoverTime : seniorDelay);

        for (let j = 0; j < seniorRepeatCount; j++) {
            let waveStartTime;
            if (j === 0) {
                waveStartTime = barrage.first_delay || 0;
            } else {
                const additionalDelay = lastTime > 0 ? lastTime : 0;
                waveStartTime = (barrage.first_delay || 0) + (j * delayBetweenWaves) + (j * additionalDelay);
            }

            if (barrage.delta_delay && barrage.delta_delay !== 0) {
                fireWaveWithAdvancingDelay(waveStartTime, weapon, barrage, bulletInfo, startX_game, startY_game, baseAngle, direction);
            } else if (barrage.delay && barrage.delay !== 0) {
                fireWaveWithConstantDelay(waveStartTime, weapon, barrage, bulletInfo, startX_game, startY_game, baseAngle, direction);
            } else {
                fireWaveImmediate(waveStartTime, weapon, barrage, bulletInfo, startX_game, startY_game, baseAngle, direction);
            }
        }
    }

    function fireWaveWithAdvancingDelay(waveStartTime, weapon, barrage, bulletInfo, startX_game, startY_game, baseAngle, direction = 1) {
        const primalRepeatCount = (barrage.primal_repeat || 0) + 1;
        let totalPrimalDelay = 0;
        let currentPrimalInterval = barrage.delay || 0; // in seconds

        for (let i = 0; i < primalRepeatCount; i++) {
            const bulletFireTime = waveStartTime + totalPrimalDelay;
            setTimeout(() => {
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
            setTimeout(() => {
                fireSingleBullet(i, weapon, barrage, bulletInfo, startX_game, startY_game, baseAngle, direction);
            }, convertToMs(bulletFireTime));
        }
    }

    function fireWaveImmediate(waveStartTime, weapon, barrage, bulletInfo, startX_game, startY_game, baseAngle, direction = 1) {
        const primalRepeatCount = (barrage.primal_repeat || 0) + 1;
        setTimeout(() => {
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
        const finalAngle = baseAngle + angleModifier;
        let finalX_game, finalY_game;
        const isAirdrop = bulletInfo.extra_param?.airdrop;
        let airdropData = null;
        if (isAirdrop) {
            const explodePos = { x: enemyGamePos.x, y: enemyGamePos.y };
            const gravity = bulletInfo.extra_param.gravity || -0.0005;
            const offsetY = bulletInfo.extra_param.airdrop.offsetY || 0;
            const dropOffset = bulletInfo.extra_param.airdrop.dropOffset;
            let horizontalOffset = 0;
            if (dropOffset) {
                const convertedVelocity = bulletInfo.velocity * GLOBAL_SPEED_MULTIPLIER;
                horizontalOffset = Math.sqrt(Math.abs(offsetY * 2 / gravity)) * convertedVelocity;
                if (direction < 0) horizontalOffset *= -1;
            }
            finalX_game = explodePos.x - horizontalOffset;
            finalY_game = explodePos.y + offsetY;
            airdropData = { explodePos, gravity, offsetY, horizontalOffset };
        } else {
            if (barrage.offset_prioritise) {
                const effectiveAngleInRadians = baseAngle * Math.PI / 180;
                const cos_a = Math.cos(effectiveAngleInRadians);
                const sin_a = Math.sin(effectiveAngleInRadians);
                const totalOffsetX = (barrage.offset_x || 0) + (bulletIndex * (barrage.delta_offset_x || 0));
                const totalOffsetY = (barrage.offset_z || 0) + (bulletIndex * (barrage.delta_offset_z || 0));
                finalX_game = startX_game + (totalOffsetX * cos_a - totalOffsetY * sin_a);
                finalY_game = startY_game + (totalOffsetX * sin_a + totalOffsetY * cos_a);
            } else {
                finalX_game = startX_game + (barrage.offset_x || 0) + (bulletIndex * (barrage.delta_offset_x || 0));
                finalY_game = startY_game + (barrage.offset_z || 0) + (bulletIndex * (barrage.delta_offset_z || 0));
            }
        }
        const screenPos = simEngine.bulletEngine.gameToScreen(finalX_game, finalY_game);
        const transformChain = simEngine.generateTransformBarrages(weapon.barrage_ID?.[0] || barrage.id, direction, bulletIndex);
        const weaponScreenPos = simEngine.bulletEngine.gameToScreen(startX_game, startY_game);
        simEngine.bulletEngine.createBullet({
            startX: screenPos.x, startY: screenPos.y, startZ: finalY_game, angle: finalAngle, bulletInfo,
            transformChain, shrapnelCallback: handleShrapnel, airdropData,
            weaponPos: { x: weaponScreenPos.x, y: weaponScreenPos.y },
            enemyTarget: enemyGamePos, aimType: weapon.aim_type
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
        // **MODIFIED**: Now gets a list of info objects
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
        // **MODIFIED**: Displays weapon IDs from the info list
        const weaponIdsToDisplay = weaponInfoList.map(info => info.weaponId);
        skillStatsHtml += `
            <p><strong>스킬 ID:</strong> ${skillId}</p>
            <p><strong>스킬 이름:</strong> ${skillName}</p>
            <p><strong>레벨:</strong> ${currentSkillLevel}</p>
            <p><strong>포지션:</strong> ${skill.position || '없음'}</p>
            <p><strong>요구사항:</strong> ${skill.requirement || '없음'}</p>
            <p><strong>사용 무기:</strong> ${weaponIdsToDisplay.length > 0 ? weaponIdsToDisplay.join(', ') : '없음'}</p>
        `;
        // **NEW**: Displays quota and time if present
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