/**
 * sim.weapon.controller.js
 * Reusable weapon-sim engine controller: owns the SimulationEngine, WeaponSimData,
 * and all barrage/aircraft firing logic. Consumed by sim.weapon.main.js (skill
 * dropdown page) and cross-fleet.main.js (catalog page). Page-specific UI stays
 * in the respective main.js. Part of the simulators module group.
 */
import { SimulationEngine } from './sim.engine.common.js';
import { WeaponSimData } from './sim.weapon.data.js';
import { targetChoiceAimsAtEnemy } from './sim.weapon.stats.js';
import { AircraftEntity } from './sim.engine.aircraft.js';
import { SIM_DEFAULT_SPEED, SIM_GAME_COORDS, SIM_TARGET_FPS, convertToMs, registerDefaultBattleEntities } from './sim.ui.js';
import { isWeaponDriverType, buildWeaponDriverOpts } from './physics/weapons/weapon-registry.js';

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

        // §D1/§D5 weapon-driver routing (Phase 4b — harness-only, DOM deferred).
        // A BEAM (type 24) or SPACE_LASER (type 28) weapon ADDITIONALLY spawns a
        // physics weapon-driver for its state/geometry. It runs ALONGSIDE the
        // normal barrage below (e.g. skill 112130 keeps firing its bomb payload
        // unchanged), so in-browser behaviour is identical until a renderer is
        // added in Phase 5. weapon.type undefined -> isWeaponDriverType false -> no-op.
        if (isWeaponDriverType(weapon.type)) {
            const hostPos = simEngine.getEntityGamePos(
                skillPosition === '전열' ? 'vanguard' : 'mainfleet');
            const enemyPos = simEngine.getEntityGameCoords('enemy');
            simEngine.bulletEngine.spawnWeaponDriver(buildWeaponDriverOpts(weapon, {
                hostPos, enemyPos,
                barrageTemplates: simEngine.allBarrageData,
                bulletTemplates: simEngine.allBulletData,
            }));
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

        // AIM vs FORWARD is decided by the SKILL effect's target_choise, NOT
        // weapon.aim_type: skill weapons fire via SingleFire (battleweaponunit.lua
        // :738), which aims iff the skill resolved a target and never reads
        // aim_type. weaponInfo.targetChoise is set for every skill-fired barrage
        // (null = resolved no enemy → forward); it is absent only on the aircraft
        // sub-weapon path, which fires via the aircraft unit (aim_type applies).
        const aimAtEnemy = weaponInfo.targetChoise !== undefined
            ? targetChoiceAimsAtEnemy(weaponInfo.targetChoise)
            : (weapon.aim_type === 1);

        // §E6: BattleShotgunEmitter replaces the barrage angle with a random
        // shotgun spread (vs the normal additive fan). 0 reached skills select
        // it today. Threaded as a param to the fireWave*/fireSingleBullet
        // siblings (they are NOT closures over fireBarrage).
        const isShotgunEmitter = weaponInfo.emitter === 'BattleShotgunEmitter';

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
                fireWaveWithAdvancingDelay(actualStartTime, weapon, barrage, bulletInfo, startX_game, startY_game, baseAngle, direction, isShotgunEmitter, aimAtEnemy);
            } else if (barrage.delay && barrage.delay !== 0) {
                fireWaveWithConstantDelay(actualStartTime, weapon, barrage, bulletInfo, startX_game, startY_game, baseAngle, direction, isShotgunEmitter, aimAtEnemy);
            } else {
                fireWaveImmediate(actualStartTime, weapon, barrage, bulletInfo, startX_game, startY_game, baseAngle, direction, isShotgunEmitter, aimAtEnemy);
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

    function fireWaveWithAdvancingDelay(waveStartTime, weapon, barrage, bulletInfo, startX_game, startY_game, baseAngle, direction = 1, isShotgunEmitter = false, aimAtEnemy = false) {
        const primalRepeatCount = (barrage.primal_repeat || 0) + 1;
        let totalPrimalDelay = 0, currentPrimalInterval = barrage.delay || 0;
        for (let i = 0; i < primalRepeatCount; i++) {
            const bulletFireTime = waveStartTime + totalPrimalDelay;
            scheduleFireTimer(() => { fireSingleBullet(i, weapon, barrage, bulletInfo, startX_game, startY_game, baseAngle, direction, isShotgunEmitter, aimAtEnemy); }, convertToMs(bulletFireTime));
            totalPrimalDelay += currentPrimalInterval;
            currentPrimalInterval += (barrage.delta_delay || 0);
        }
    }

    function fireWaveWithConstantDelay(waveStartTime, weapon, barrage, bulletInfo, startX_game, startY_game, baseAngle, direction = 1, isShotgunEmitter = false, aimAtEnemy = false) {
        const primalRepeatCount = (barrage.primal_repeat || 0) + 1;
        const constantInterval = barrage.delay || 0;
        for (let i = 0; i < primalRepeatCount; i++) {
            const bulletFireTime = waveStartTime + (i * constantInterval);
            scheduleFireTimer(() => { fireSingleBullet(i, weapon, barrage, bulletInfo, startX_game, startY_game, baseAngle, direction, isShotgunEmitter, aimAtEnemy); }, convertToMs(bulletFireTime));
        }
    }

    function fireWaveImmediate(waveStartTime, weapon, barrage, bulletInfo, startX_game, startY_game, baseAngle, direction = 1, isShotgunEmitter = false, aimAtEnemy = false) {
        const primalRepeatCount = (barrage.primal_repeat || 0) + 1;
        scheduleFireTimer(() => {
            for (let i = 0; i < primalRepeatCount; i++) {
                fireSingleBullet(i, weapon, barrage, bulletInfo, startX_game, startY_game, baseAngle, direction, isShotgunEmitter, aimAtEnemy);
            }
        }, convertToMs(waveStartTime));
    }

    function fireSingleBullet(bulletIndex, weapon, barrage, bulletInfo, startX_game, startY_game, baseAngle, direction = 1, isShotgunEmitter = false, aimAtEnemy = false) {
        const enemyGamePos = simEngine.getEntityGameCoords('enemy');
        let angleModifier;
        if (isShotgunEmitter) {
            // §E6: shotgun REPLACES the angle with a random spread
            // (battleshotgunemitter.lua:26); no index fan. Standard: uniform
            // [−angle/2, +angle/2]. Under random_angle: a two-draw weighted
            // variant with asymmetric range [−angle, 0] (0-reached for a
            // shotgun barrage today).
            const angleRange = barrage.angle || 0;
            angleModifier = barrage.random_angle
                ? (Math.random() - 0.5) * (Math.random() * angleRange) - angleRange / 2
                : Math.random() * angleRange - angleRange / 2;
        } else if (barrage.random_angle) {
            // §E7: game jitters the per-bullet angle by (random − 0.5), giving
            // a ±Angle/2 cone — NOT (random·2 − 1) which doubles the width.
            // Mirrors battlebulletemitter.lua:97.
            angleModifier = (Math.random() - 0.5) * (bulletIndex * (barrage.delta_angle || 0) + (barrage.angle || 0));
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

        // AIM vs FORWARD: aimAtEnemy comes from the skill effect's target_choise
        // (see fireBarrage), faithfully mirroring SingleFire — which aims at the
        // resolved target or fires forward, ignoring weapon.aim_type. When aiming,
        // compute the angle toward the enemy from the bullet's actual spawn point.
        let finalAngle;
        if (aimAtEnemy && enemyGamePos) {
            const aimDx = enemyGamePos.x - finalX_game;
            const aimDy = enemyGamePos.y - finalY_game;
            const aimAngle = Math.atan2(aimDy, aimDx) * 180 / Math.PI;
            finalAngle = aimAngle + angleModifier + weaponAngleSpread;
        } else {
            finalAngle = baseAngle + angleModifier + weaponAngleSpread;
        }

        const screenPos = simEngine.bulletEngine.gameToScreen(finalX_game, finalY_game);
        const transformChain = simEngine.generateTransformBarrages(weapon.barrage_ID?.[0] || barrage.id, direction, bulletIndex);
        simEngine.bulletEngine.createBullet({
            startX: screenPos.x, startY: screenPos.y, angle: finalAngle,
            bulletInfo: effectiveBulletInfo,
            transformChain, airdropData,
            enemyTarget: enemyGamePos,
            barrageAngle: angleModifier
        });
    }

    return {
        simEngine, data,
        loadData: () => data.loadData(),
        fireSkill,                 // async (skillId, level)
        clearActiveFire,
        updateLayoutAndScale: (el) => simEngine.updateLayoutAndScale(el),
    };
}
