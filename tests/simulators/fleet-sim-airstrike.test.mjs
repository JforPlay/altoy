/**
 * The air assist (항공 지원) is a property of the EQUIPPED LAUNCHER, not of the hull.
 *
 * 키어사지 is a 항전 (type 10) carrying a 전함주포 + an F6F 헬캣 + a 대공포. Under the
 * old carrier-or-surface fork she took the surface path wholesale, where an
 * airstrike launcher's `bullet_ID` is empty (its "bullets" are AIRCRAFT ids) — so
 * the aviation slot resolved to nothing and her card showed a raw 8.80s launcher
 * reload instead of the game's combined `avg(reload_max) × 2.2`.
 *
 * These assert the two data facts the fix rests on, straight off the committed
 * JSON, plus the arithmetic of the fixed pipeline. They read only files that are
 * committed (never a data:split artifact).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mergeWeaponWithBase, barrageBulletCount, attackAttributeKey } from '../../public/js/simulators/fleet-sim.damage.js';
import { calculateAirAssistReloadMax, calculateReloadTime } from '../../public/js/engine/damage/reload.js';

const read = (p) => JSON.parse(readFileSync(new URL(`../../public/data/${p}`, import.meta.url), 'utf8'));

const WEAPONS = read('sim/weapon_property.json');
const AIRCRAFT = read('sim/aircraft_template.json');
const BARRAGES = read('sim/barrage_template.json');
const EQUIPS = read('equip/equip_data_full.json');
const SHIPS = read('ship_info_data.json');

const getWeapon = (id) => WEAPONS[String(id)] || null;
const getAircraft = (id) => AIRCRAFT[String(id)] || null;
const getBarrage = (id) => BARRAGES[String(id)] || null;
const equipById = (id) => (Array.isArray(EQUIPS) ? EQUIPS : Object.values(EQUIPS)).find((e) => e.id === id);
const shipByName = (n) => Object.values(SHIPS).find((s) => s.name === n);

/** Merged launcher weapon_property entries at an equip's max enhance level. */
const launchers = (equipId) => {
    const e = equipById(equipId);
    const wid = e.levels[e.levels.length - 1].weapon_id;
    return (Array.isArray(wid) ? wid : [wid]).map((id) => mergeWeaponWithBase(getWeapon(id), getWeapon));
};

const STRIKE_AIRCRAFT_TYPE = 10;
const AIRCRAFT_GUN_TYPE = 4;
const F6F_HVAR = 17440;      // F6F 헬캣(HVAR 탑재형) — 키어사지's stock aviation slot

test('the F6F HVAR launcher is a hive, and its bullet_ID is empty', () => {
    const [launcher] = launchers(F6F_HVAR);
    assert.equal(launcher.type, STRIKE_AIRCRAFT_TYPE);
    // This is why the surface path yielded nothing: resolveWeaponDescriptor looks
    // up bullet_ID[0], and an airstrike launcher carries aircraft, not bullets.
    assert.deepEqual(launcher.bullet_ID, []);
});

test('the launcher id doubles as the aircraft_template id', () => {
    const [launcher] = launchers(F6F_HVAR);
    const ac = mergeWeaponWithBase(getAircraft(launcher.id), getAircraft);
    assert.ok(Array.isArray(ac.weapon_ID) && ac.weapon_ID.length > 0);
});

test('the plane drops one real ordnance; its strafing guns are anti-air only', () => {
    const [launcher] = launchers(F6F_HVAR);
    const ac = mergeWeaponWithBase(getAircraft(launcher.id), getAircraft);
    const subs = ac.weapon_ID.map((id) => mergeWeaponWithBase(getWeapon(id), getWeapon));

    const guns = subs.filter((w) => w.type === AIRCRAFT_GUN_TYPE);
    const ordnance = subs.filter((w) => w.type !== AIRCRAFT_GUN_TYPE);
    assert.equal(guns.length, 2, 'the two strafing autocannons');
    assert.equal(ordnance.length, 1, 'the HVAR rocket');

    // A strafing gun is BattleAntiAirUnit — it can never touch a boss, so counting
    // it would inflate every carrier. Its flat [1,1,1] mods are the giveaway.
    for (const g of guns) assert.deepEqual(getBulletMods(g), [1, 1, 1]);

    const [rocket] = ordnance;
    assert.equal(attackAttributeKey(rocket.attack_attribute), 'air');
    assert.ok(barrageBulletCount(rocket.barrage_ID, getBarrage) > 0);
});

function getBulletMods(w) {
    const bullets = read('sim/bullet_template.json');
    const id = Array.isArray(w.bullet_ID) ? w.bullet_ID[0] : w.bullet_ID;
    return bullets[String(id)].damage_type;
}

test('키어사지 airstrike reload = avg(hive reload_max) × 2.2, not the bare launcher reload', () => {
    const ship = shipByName('키어사지');
    assert.equal(ship.type, 10, '항전');

    // base_list at max limit break: [주포 1, 함재기 4, 대공 1]. setWeapon builds one
    // hive per plane, so the air-assist mean is weighted by that count.
    const baseList = Object.values(ship.base_list).pop();
    assert.deepEqual(baseList, [1, 4, 1]);

    const [launcher] = launchers(F6F_HVAR);
    const hiveReloads = Array(baseList[1]).fill(launcher.reload_max);
    const combined = calculateAirAssistReloadMax(hiveReloads);
    assert.equal(combined, launcher.reload_max * 2.2);

    // At the card's 장전 193 the game shows ~19.4s; the pre-fix surface path showed
    // the raw launcher reload, which is the same number divided by 2.2.
    const seconds = calculateReloadTime(combined, 193);
    assert.ok(seconds > 19.2 && seconds < 19.5, `expected ~19.35s, got ${seconds}`);
    assert.ok(Math.abs(calculateReloadTime(launcher.reload_max, 193) - 8.8) < 0.01);
});

test('a 3/3/2 carrier weighs its slots by plane count, not 1:1:1', () => {
    // The weighting only shows up when the slots differ, which is why an unweighted
    // mean of the three slot values passed unnoticed on same-reload loadouts.
    const weighted = calculateAirAssistReloadMax([100, 100, 100, 200, 200, 200, 300, 300]);
    const unweighted = calculateAirAssistReloadMax([100, 200, 300]);
    assert.notEqual(weighted, unweighted);
    assert.equal(weighted, (1500 / 8) * 2.2);   // 3×100 + 3×200 + 2×300
});

/**
 * An EMPTY slot is not an idle slot: battleplayerunit.lua setWeapon's else-branch
 * arms `default_equip_list[slot]`, and ship.lua getAircraftReloadCD folds the same
 * default into the dock's 항공 CD. The sim skipped empty slots, so 엔터프라이즈 with
 * one plane equipped read 22.3s where the game shows 37.2s.
 *
 * The non-obvious fact the fallback rests on: on the BATTLE path those ids are
 * WEAPON ids handed straight to CreateWeaponUnit — not equip ids — so they resolve
 * through weapon_property and never through an equip's level table. (equip_data_full
 * does not even carry them.) 엔터프라이즈's own defaults are 109/111/110.
 */
test('the default aircraft ids resolve as strike-aircraft weapons, not equips', () => {
    for (const [id, expected] of [[109, 1800], [110, 3114], [111, 3600]]) {
        const w = mergeWeaponWithBase(getWeapon(id), getWeapon);
        assert.ok(w, `weapon_property[${id}] missing — the empty-slot fallback has no source`);
        assert.equal(w.type, STRIKE_AIRCRAFT_TYPE, `default ${id} must be a hive`);
        assert.equal(w.reload_max, expected);
    }

    // And they are slow enough that ignoring them is the 22.3s-vs-37.2s gap:
    // 엔터프라이즈 base_list 3/3/2 with only the fighter slot filled (F6F+13 = 1639).
    const equipped = calculateAirAssistReloadMax(Array(3).fill(1639));
    const withDefaults = calculateAirAssistReloadMax(
        [...Array(3).fill(1639), ...Array(3).fill(3600), ...Array(2).fill(3114)]);
    assert.ok(calculateReloadTime(withDefaults, 132) - calculateReloadTime(equipped, 132) > 10);
});
