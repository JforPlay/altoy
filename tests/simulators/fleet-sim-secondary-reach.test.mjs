/**
 * 주력함대 부포 exclusion — a back-row secondary cannot reach the boss.
 *
 * The main fleet sits at the bottom of the screen and every 구축포/경순포 the
 * 부포 slot takes has a weapon `range` of 50–70, so its boss DPS is fiction —
 * and on a BB it out-DPSes the 주포 several-fold because it reloads ~6× faster.
 * A handful of ships buy the reach back with a skill; that roster is an
 * allowlist because the buffs are runtime and absent from the equipment.
 *
 * Two claims are asserted, and the first is the one that can rot: that NO
 * equippable 부포 reaches natively. If a future patch ships an 80+ range CL gun
 * the allowlist stops being the whole story, and this fails instead of the page
 * quietly under-reporting a real build.
 *
 * Reads only committed data (never a data:split artifact).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { hasSecondaryReach } from '../../public/js/simulators/fleet-sim.damage.js';
import { simulateAttacker } from '../../public/js/engine/damage/index.js';
import { makeTarget } from '../../public/js/engine/damage/targets.js';

const read = (p) => JSON.parse(readFileSync(new URL(p, import.meta.url), 'utf8'));
const SHIPS = read('../../public/data/ship_info_data.json');
const EQUIPS = read('../../public/data/equip/equip_data_full.json');
const WEAPONS = read('../../public/data/sim/weapon_property.json');

const byName = (n) => SHIPS.find((s) => s.name === n);

/** weapon_property entries are sparse with a recursive `base` chain — merge it. */
function mergeWeapon(w, depth = 0) {
    if (!w || w.base == null || depth > 8) return w;
    const base = WEAPONS[w.base];
    return base ? { ...mergeWeapon(base, depth + 1), ...w } : w;
}

// What the 부포 slot actually accepts, derived from the roster rather than guessed:
// `equip_2` on the back-row hulls that have one (4 = BC, 5 = BB). Hardcoding this
// picked up a submarine 203mm at range 80 that no BB can equip.
const SECONDARY_EQUIP_TYPES = new Set(
    SHIPS.filter((s) => s.type === 4 || s.type === 5).flatMap((s) => s.equip_2 || []));

test('no equippable 부포 reaches the boss natively — the allowlist is the whole exception set', () => {
    let checked = 0;
    let longest = 0;
    for (const equip of Object.values(EQUIPS)) {
        if (!equip || !SECONDARY_EQUIP_TYPES.has(equip.type) || !equip.levels?.length) continue;
        const lv = equip.levels[equip.levels.length - 1];
        const wid = Array.isArray(lv.weapon_id) ? lv.weapon_id[0] : lv.weapon_id;
        const w = mergeWeapon(WEAPONS[wid]);
        if (!w || w.range == null) continue;
        checked++;
        longest = Math.max(longest, w.range);
    }
    assert.ok(SECONDARY_EQUIP_TYPES.size > 0, 'no 부포 slot types found — ship_info_data shape moved');
    assert.ok(checked > 100, `only ${checked} secondary-capable equips found — data shape moved`);
    // The skills that grant reach set it to 80/95/105, so 80 is the bar they clear.
    assert.ok(longest < 80, `a 부포 now reaches ${longest} natively — revisit SECONDARY_REACH_SKILLS`);
});

test('hasSecondaryReach names exactly the five ships whose skill text extends 부포 사거리', () => {
    const reaching = SHIPS.filter((s) => hasSecondaryReach(s, true, true)).map((s) => s.name).sort();
    assert.deepEqual(reaching, ['발파라이소', '비스마르크', '오미', '타마키', '플랑드르'].sort());
});

test('알자스 has no reach skill; 발파라이소 does', () => {
    assert.equal(hasSecondaryReach(byName('알자스'), true, true), false);
    assert.equal(hasSecondaryReach(byName('발파라이소'), true, true), true);
});

test('an excluded weapon keeps its row but leaves the ship total and the damage curve', () => {
    const profile = { accuracy: 100, luck: 30, level: 125, reload: 200 };
    const gun = {
        attackAttribute: 'cannon', stat: 900, damage: 100, corrected: 100, ratio: 100,
        potential: 1, bulletsPerSalvo: 3, damageType: 1, ammoType: 1,
        reloadMax: 300, cycleExtra: 0, initialDelay: 0, startsOnCooldown: false,
        preloadShare: 0, label: '주포',
    };
    const secondary = { ...gun, reloadMax: 60, label: '부포' };
    const target = makeTarget('heavy');

    const both = simulateAttacker(profile, [gun, secondary], target, { window: 60 });
    const dropped = simulateAttacker(profile, [gun, { ...secondary, excluded: true }], target, { window: 60 });
    const gunOnly = simulateAttacker(profile, [gun], target, { window: 60 });

    // The row survives with its real numbers...
    assert.equal(dropped.perWeapon.length, 2);
    assert.equal(dropped.perWeapon[1].excluded, true);
    assert.ok(dropped.perWeapon[1].dps > 0);
    assert.equal(dropped.perWeapon[1].dps, both.perWeapon[1].dps);
    // ...but contributes nothing to the total, and the fast secondary dominated it.
    assert.equal(dropped.total, gunOnly.total);
    assert.ok(both.total > dropped.total * 2, 'fixture no longer exercises a dominating 부포');
    // One schedule means the kill-time solve cannot see it either.
    assert.equal(dropped.schedules.length, 1);
});
