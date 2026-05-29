/**
 * sim.weapon.controller.js
 * Reusable weapon-sim engine controller: owns the SimulationEngine, WeaponSimData,
 * and all barrage/aircraft firing logic. Consumed by sim.weapon.main.js (skill
 * dropdown page) and cross-fleet.main.js (catalog page). Page-specific UI stays
 * in the respective main.js. Part of the simulators module group.
 */
import { SimulationEngine } from './sim.engine.common.js';
import { WeaponSimData } from './sim.weapon.data.js';
import { AircraftEntity } from './sim.engine.aircraft.js';
import { SIM_DEFAULT_SPEED, SIM_GAME_COORDS, SIM_TARGET_FPS, convertToMs, registerDefaultBattleEntities } from './sim.ui.js';

export function createWeaponSim({ container, entities, visualLog }) {
    const simEngine = new SimulationEngine({
        container, gameCoords: SIM_GAME_COORDS, targetFps: SIM_TARGET_FPS,
        gSpeed: SIM_DEFAULT_SPEED, visualLog,
    });
    const data = new WeaponSimData(simEngine);
    registerDefaultBattleEntities(simEngine, entities);

    let activeAircraft = [];
    let pendingFireTimers = [];

    function scheduleFireTimer(fn, delay) {
        const id = setTimeout(() => {
            pendingFireTimers = pendingFireTimers.filter(t => t !== id);
            fn();
        }, delay);
        pendingFireTimers.push(id);
    }

    function clearActiveFire() {
        pendingFireTimers.forEach(id => clearTimeout(id));
        pendingFireTimers = [];
        activeAircraft.forEach(a => a.destroy());
        activeAircraft = [];
        simEngine.clearBullets();
    }

    // ===== Firing Logic =====

    async function fireSkill(skillId, level) {
        const skill = data.getSkillById(skillId);
        if (!skill) { simEngine.logToScreen(`Skill ${skillId} not found`, 'error'); return; }

        await data.ensureSkillWeaponsLoaded(skillId, level);

        const weaponInfoList = data.getWeaponIdsFromSkill(skillId, level);
        const aircraftSubWeaponLoads = [];
        for (const info of weaponInfoList) {
            const aircraftData = simEngine.allAircraftData?.[info.weaponId];
            if (aircraftData?.weapon_ID) {
                aircraftData.weapon_ID.forEach(subId => aircraftSubWeaponLoads.push(data.ensureWeaponLoaded(subId)));
            }
        }
        if (aircraftSubWeaponLoads.length > 0) await Promise.all(aircraftSubWeaponLoads);

        const skillName = data.getSkillName(skillId);
        const skillPosition = skill.position;
        simEngine.logToScreen(`Firing: ${skillName} (Lv.${level})`);

        data.getWeaponIdsFromSkill(skillId, level).forEach((weaponInfo) =>
            scheduleFireTimer(() => fireWeapon(weaponInfo, skillPosition),
                weaponInfo.time ? convertToMs(weaponInfo.time, true) : 0)
        );
    }

    function fireWeapon(weaponInfo, skillPosition = null) {
        const weapon = data.getWeaponById(weaponInfo.weaponId);
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
            const w = data.getWeaponById(wid);
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
                const subWeapon = data.getWeaponById(subWeaponId);
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

    return {
        simEngine, data,
        loadData: () => data.loadData(),
        fireSkill,                 // async (skillId, level)
        clearActiveFire,
        updateLayoutAndScale: (el) => simEngine.updateLayoutAndScale(el),
    };
}
