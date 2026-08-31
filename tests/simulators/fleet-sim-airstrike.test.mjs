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
import { mergeWeaponWithBase, barrageBulletCount, attackAttributeKey, resolveWeaponDescriptors, resolveBarrageDot } from '../../public/js/simulators/fleet-sim.damage.js';
import { calculateAirAssistReloadMax, calculateReloadTime } from '../../public/js/engine/damage/reload.js';
import { statTableKey } from '../../public/js/ship-stat-table.js';

const read = (p) => JSON.parse(readFileSync(new URL(`../../public/data/${p}`, import.meta.url), 'utf8'));

const WEAPONS = read('sim/weapon_property.json');
const AIRCRAFT = read('sim/aircraft_template.json');
const BARRAGES = read('sim/barrage_template.json');
const EQUIPS = read('equip/equip_data_full.json');
const BULLETS = read('sim/bullet_template.json');
const SHIPS = read('ship_info_data.json');

const getWeapon = (id) => WEAPONS[String(id)] || null;
const getAircraft = (id) => AIRCRAFT[String(id)] || null;
const getBarrage = (id) => BARRAGES[String(id)] || null;
const getBullet = (id) => BULLETS[String(id)] || null;
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
const LA9 = 85600;           // 시제형 함상식 La-9 — a fighter whose ordnance is the S-21 rocket
const F6F_HVAR = 17440;      // F6F 헬캣(HVAR 탑재형) — 키어사지's stock aviation slot

test('the F6F HVAR launcher is a hive, and its bullet_ID is empty', () => {
    const [launcher] = launchers(F6F_HVAR);
    assert.equal(launcher.type, STRIKE_AIRCRAFT_TYPE);
    // This is why the surface path yielded nothing: resolveWeaponDescriptors looks
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

/**
 * A SKILL can fire a hive too, and that path used to drop the whole root.
 *
 * 나히모프's 파괴성 접속·피크 로드 크래시 (19810 → weapon 164770) and 프리츠 루메이's
 * 두려움을 모르는 용걸의 날개 (150750 → 167000) are STRIKE_AIRCRAFT weapons with an
 * EMPTY bullet_ID, so `resolveWeaponDescriptors` resolved nothing and the root was
 * disclosed as 미구현 — zeroing the signature barrage of 34 항모 and 9 경항모.
 *
 * Unlike an equipped launcher, a skill hive has no `base_list`: its plane count is
 * its OWN barrage expansion (battlehiveunit.lua SingleFire spawns one aircraft per
 * barrage bullet).
 */
test('a barrage-fired hive expands into its planes ordnance, not nothing', () => {
    const deps = { getAircraft, getWeapon, getBullet, getBarrage };

    for (const [weaponId, planes, subDamage] of [[164770, 5, 200], [167000, 3, 160]]) {
        const hive = mergeWeaponWithBase(getWeapon(weaponId), getWeapon);
        assert.equal(hive.type, STRIKE_AIRCRAFT_TYPE);
        assert.deepEqual(hive.bullet_ID, [], 'a hive carries no bullets — that is why it used to resolve to nothing');
        assert.equal(barrageBulletCount(hive.barrage_ID, getBarrage), planes);

        // A barrage passes mountCount 1: base_list does not apply to a skill hive, so
        // the plane count is the hive's own barrage expansion.
        const out = resolveWeaponDescriptors(hive, { aviation: 1000 }, { ...deps, mountCount: 1 });
        assert.equal(out.length, 1, `weapon ${weaponId} should yield exactly one ordnance descriptor`);
        const { d, weapon } = out[0];
        assert.equal(d.attackAttribute, 'air');
        assert.equal(d.damage, subDamage);
        assert.equal(d.stat, 1000, 'aviation is the scaling stat');
        // every plane drops the barrage, so the volley scales with the plane count
        assert.equal(d.bulletsPerSalvo, barrageBulletCount(weapon.barrage_ID, getBarrage) * planes);
        // the DOT lane reads bullets off the ORDNANCE, never off the bulletless hive
        assert.ok(weapon.bullet_ID.length > 0);
    }

    // Without the aircraft lookup a hive resolves to nothing rather than guessing —
    // the pure helper stays callable from a caller that has no aircraft data.
    const hive = mergeWeaponWithBase(getWeapon(164770), getWeapon);
    assert.deepEqual(resolveWeaponDescriptors(hive, { aviation: 1000 }, { ...deps, getAircraft: undefined }), []);
});

/**
 * The plane count is `mountCount × hive barrage expansion` for BOTH callers. That is
 * a no-op for equipment only because every equipped launcher spawns exactly one
 * plane per hive — assert it, or a future launcher that does not silently doubles
 * every carrier.
 */
test('every equipped strike launcher spawns exactly one plane per hive', () => {
    let checked = 0;
    for (const equip of Object.values(EQUIPS)) {
        for (const level of equip.levels || []) {
            for (const id of [].concat(level?.weapon_id ?? [])) {
                const w = mergeWeaponWithBase(getWeapon(id), getWeapon);
                if (!w || w.type !== STRIKE_AIRCRAFT_TYPE) continue;
                assert.equal(barrageBulletCount(w.barrage_ID, getBarrage), 1,
                    `equip ${equip.id} launcher ${id} spawns more than one plane per hive`);
                checked++;
            }
        }
    }
    assert.ok(checked > 1600, `expected the full launcher corpus, saw ${checked}`);
});

/**
 * A hive's ordnance must not multiply its burn.
 *
 * `resolveBarrageDot` sums a weapon's activations so a weapon firing under TWO
 * triggers ticks off its whole schedule. A hive breaks that arithmetic from the other
 * side: one row expands into one descriptor PER ORDNANCE, each carrying the row's full
 * activation count, so a per-descriptor sum would multiply the burn by the plane's
 * payload count. No graph hive carries a DOT today (9 multi-ordnance hives, 10 with a
 * burn, disjoint sets), which is precisely why nothing would have caught it.
 */
test('a burn counts activations once per row, not once per descriptor', () => {
    const dot = { a: 'air', v: 100, int: 3, life: 9, stack: 1 };
    const bullet = { attach_buff: [{ buff_id: 7, rant: 10000, buff_level: 1 }] };
    const weapon = { bullet_ID: [1], barrage_ID: [] };
    const deps = {
        getDot: (id) => (id === 7 ? dot : null),
        getBullet: () => bullet,
        getBarrage: () => null,
        stats: { aviation: 0 },
        simCtx: { window: 60 },
        hitRate: 1,
    };
    const d = () => ({ activations: 4, damage: 10, corrected: 100, bulletsPerSalvo: 2 });
    const row = { weaponId: 99 };

    // Two ordnance descriptors off ONE row: the burn sees 4 activations, not 8.
    const oneRow = resolveBarrageDot(
        [{ d: d(), weapon, weaponId: 99, row }, { d: d(), weapon, weaponId: 99, row }], '', deps,
    );
    // Two DISTINCT rows (same weapon, two triggers) still sum to 8 — the case the
    // per-weapon map exists for.
    const twoRows = resolveBarrageDot(
        [{ d: d(), weapon, weaponId: 99, row }, { d: d(), weapon, weaponId: 99, row: { weaponId: 99 } }], '', deps,
    );
    assert.ok(oneRow && twoRows, 'both cases must produce a burn');
    assert.ok(twoRows.descriptor.activations > oneRow.descriptor.activations,
        'two triggers must out-tick two ordnance off one trigger');
});

/**
 * INTERCEPT_AIRCRAFT (11) fired by a SKILL is a plane too.
 *
 * `battleplayerunit.lua AddWeapon` (:243) sends type 11 to AddAutoWeapon rather than
 * `_hiveList`, so it is rightly out of the air-assist pool — but a skill that fires one
 * still spawns planes, and 33 roster roots (인트레피드 13070, 히요/준요 11260, 다이호
 * 11620, 시나노 13580 …) were reported 미구현 with zero damage because of it.
 *
 * Two orderings are load-bearing, and this pins both:
 *   - the aircraft test runs AFTER the bullet lookup, because 1537 weapons carry an
 *     aircraft_template entry AND a real bullet — asking about the aircraft first
 *     diverts real guns onto the plane path;
 *   - it runs BEFORE attack_attribute, because the LAUNCHER's own attribute is 0 on 20
 *     of the 33 (다이호 67310, 류조 67690) and only the ordnance carries the real one.
 */
test('a skill-fired INTERCEPT_AIRCRAFT resolves to its ordnance', () => {
    const deps = { getWeapon, getAircraft, getBullet, getBarrage };
    // 인트레피드 13070 w69170: launcher attr 4, 3 planes, two bombs (380 + 220).
    // 다이호 11620 w67310: launcher attr 0 — the case an attribute pre-filter kills.
    for (const [id, planes] of [[69170, 3], [67310, 1]]) {
        const w = mergeWeaponWithBase(getWeapon(id), getWeapon);
        assert.equal(w.type, 11, `w${id} must be INTERCEPT_AIRCRAFT`);
        assert.equal(getBullet(w.bullet_ID[0]), null, `w${id} bullet_ID must hold an aircraft id`);
        const out = resolveWeaponDescriptors(w, { aviation: 1000, firepower: 1000, torpedo: 1000 },
            { ...deps, mountCount: 1 });
        assert.ok(out.length > 0, `w${id} must resolve to ordnance`);
        assert.equal(barrageBulletCount(w.barrage_ID, getBarrage), planes, `w${id} plane count`);
        for (const { d } of out) assert.ok(d.damage > 0 && d.bulletsPerSalvo > 0);
    }
});

/**
 * A real gun that happens to share its id with an aircraft_template entry must NOT be
 * diverted. 1537 weapons carry both, so this is the guard on the ordering above.
 */
test('a gun whose id also exists in aircraft_template stays on the bullet path', () => {
    const deps = { getWeapon, getAircraft, getBullet, getBarrage };
    let checked = 0;
    for (const id of Object.keys(WEAPONS)) {
        const w = mergeWeaponWithBase(getWeapon(id), getWeapon);
        if (!w || w.type === 10 || !getAircraft(id)) continue;
        const bid = Array.isArray(w.bullet_ID) ? w.bullet_ID[0] : w.bullet_ID;
        if (!getBullet(bid) || !attackAttributeKey(w.attack_attribute)) continue;
        const [first] = resolveWeaponDescriptors(w, { aviation: 1, firepower: 1, torpedo: 1 }, deps);
        assert.equal(first?.weapon?.id, w.id, `w${id} must resolve as itself, not as its aircraft`);
        checked++;
    }
    assert.ok(checked > 500, `expected many gun/aircraft id collisions, saw ${checked}`);
});

// 프리츠 루메이's 함재기 수 is 2/2/1 at base and 4/4/1 at MLB, so a slot's plane count
// is a 한계돌파 stat, not a constant — and it multiplies the whole airstrike. The
// descriptor now reports it (`mounts`) purely so the panel can show the volley;
// `bulletsPerSalvo` must stay planes x the ordnance's own barrage, which for La-9
// is the 4-rocket S-21 salvo: barrage 2221 states primal_repeat 3, and the count is
// primal+1 (the repeats are IN ADDITION to the first shot) — read as a bare 3 it
// under-reports every volley in the game by one bullet.
test('a fighter with air-to-surface rockets counts them, planes x rockets', () => {
    const rumey = shipByName('프리츠 루메이');
    assert.deepEqual(rumey.mounts[statTableKey(rumey, true)], [4, 4, 1], '루메이 MLB 함재기 수');

    const planes = rumey.mounts[statTableKey(rumey, true)][0];
    const [hive] = launchers(LA9);                     // 시제형 함상식 La-9 +13
    assert.equal(hive.type, STRIKE_AIRCRAFT_TYPE);
    const out = resolveWeaponDescriptors(hive, { aviation: 1000 }, {
        getWeapon, getAircraft, getBarrage, getBullet, mountCount: planes,
    });

    // The 기총 is dropped and the S-21 survives: a fighter is NOT damage-less, so
    // "fighters only strafe" cannot be a rule — only weapon type 4 may be dropped.
    assert.equal(out.length, 1, 'the S-21 rocket, with the strafing gun dropped');
    const [{ d, weapon }] = out;
    assert.notEqual(weapon.type, AIRCRAFT_GUN_TYPE);
    assert.equal(d.mounts, planes, 'planes per slot, reported for display');
    assert.equal(d.bulletsPerSalvo, barrageBulletCount(weapon.barrage_ID, getBarrage) * planes);
    assert.equal(barrageBulletCount(weapon.barrage_ID, getBarrage), 4, 'S-21 x4 = primal_repeat 3 + 1');
    assert.equal(d.bulletsPerSalvo, 16, '4 planes x 4 S-21 rockets');
});
