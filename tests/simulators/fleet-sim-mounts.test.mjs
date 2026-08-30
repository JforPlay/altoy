/**
 * `mounts` vs `base_list` — the 포좌 / 주포 장전 상한 split.
 *
 * base_list is the per-slot weapon-UNIT count setWeapon instantiates, but
 * battleplayerunit.lua AddWeapon files those units by weapon_property.type:
 * types 1/2/3 and aircraft go to AddAutoWeapon (every mount fires each reload,
 * so base_list IS the 포좌), while type 23 POINT_HIT_AND_LOCK goes to
 * _chargeList, where ManualWeaponQueue._maxCount == parallel_max[0] gates how
 * many reload at once. On a 전함 주포, base_list is therefore the charge-stack
 * cap (주포 장전 상한) and never multiplies bullets.
 *
 * WSL ship_info_process.py build_mounts emits `mounts` from the
 * ship_data_breakout weapon_ids ladder for exactly those slots. These tests
 * guard the properties that make that substitution safe, against the committed
 * roster (never a data:split artifact).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { getShipBaseList } from '../../public/js/simulators/fleet-sim.calc.js';

const SHIPS = JSON.parse(readFileSync(new URL('../../public/data/ship_info_data.json', import.meta.url), 'utf8'));
const byName = (n) => SHIPS.find((s) => s.name === n);
const maxLB = (map) => (map ? map[Object.keys(map).sort().at(-1)] : null);

/** Slot indices 0-based; equip type 4 is 전함 주포. */
const BB_MAIN_GUN_EQUIP_TYPE = 4;

test('every ship carries a mounts map shaped exactly like base_list', () => {
    let checked = 0;
    for (const s of SHIPS) {
        if (!s.base_list || typeof s.base_list !== 'object') continue;
        assert.ok(s.mounts, `${s.name} has base_list but no mounts — pipeline did not emit it`);
        assert.deepEqual(Object.keys(s.mounts), Object.keys(s.base_list),
            `${s.name}: mounts keys diverge from base_list`);
        for (const k of Object.keys(s.base_list)) {
            assert.equal(s.mounts[k].length, s.base_list[k].length, `${s.name} ${k}: slot count differs`);
        }
        checked++;
    }
    assert.ok(checked > 800, `only ${checked} ships had a base_list — data shape moved`);
});

test('ONLY slot 1 ever differs from base_list — every other slot is untouched', () => {
    for (const s of SHIPS) {
        if (!s.base_list || !s.mounts) continue;
        for (const k of Object.keys(s.base_list)) {
            const bl = s.base_list[k];
            const m = s.mounts[k];
            for (let i = 1; i < bl.length; i++) {
                assert.equal(m[i], bl[i],
                    `${s.name} ${k} slot ${i + 1}: mounts ${m[i]} != base_list ${bl[i]} — ` +
                    'the 전함 주포 rule leaked into an auto-weapon slot');
            }
        }
    }
});

test('a 전함 주포 only ever occupies slot 1, which is what makes the slot-1 rule sound', () => {
    const misplaced = SHIPS.filter((s) =>
        (s.equip_2 || []).includes(BB_MAIN_GUN_EQUIP_TYPE) ||
        (s.equip_3 || []).includes(BB_MAIN_GUN_EQUIP_TYPE));
    assert.deepEqual(misplaced.map((s) => s.name), [],
        'a hull now takes a 전함 주포 outside slot 1 — build_mounts writes slot 1 unconditionally');
    const slot1 = SHIPS.filter((s) => (s.equip_1 || []).includes(BB_MAIN_GUN_EQUIP_TYPE));
    assert.ok(slot1.length > 100, `only ${slot1.length} hulls take a 전함 주포 — data shape moved`);
});

test('a ship with no 전함 주포 slot has mounts identical to base_list', () => {
    for (const s of SHIPS) {
        if (!s.base_list || !s.mounts) continue;
        if ((s.equip_1 || []).includes(BB_MAIN_GUN_EQUIP_TYPE)) continue;
        assert.deepEqual(s.mounts, s.base_list,
            `${s.name} has no 전함 주포 slot but its mounts diverge from base_list`);
    }
});

test('hand-checked 포좌 counts at max limit break', () => {
    // 괴츠: two 「주포 포좌 +1」 breaks over a base of 1 -> 3. base_list reads 2,
    // which is her 「주포 장전 상한 +1」 from the middle break.
    assert.equal(maxLB(byName('괴츠 폰 베를리힝겐').mounts)[0], 3);
    assert.equal(maxLB(byName('괴츠 폰 베를리힝겐').base_list)[0], 2);
    // 네바다: the ordinary BB shape — base_list never moves, the ladder goes 1->2->3.
    assert.equal(maxLB(byName('네바다').mounts)[0], 3);
    assert.equal(maxLB(byName('네바다').base_list)[0], 1);
    // 리슐리외: her unique gun's ladder lists 1 -> 2.
    assert.equal(maxLB(byName('리슐리외').mounts)[0], 2);
    // 캔자스: ladder reaches 4.
    assert.equal(maxLB(byName('캔자스').mounts)[0], 4);
    // META hulls break through ship_meta_breakout and must be covered too.
    assert.equal(maxLB(byName('히에이·META').mounts)[0], 3);
    // Carrier + destroyer: base_list is already the plane / gun count.
    assert.deepEqual(maxLB(byName('허미즈').mounts), maxLB(byName('허미즈').base_list));
    assert.deepEqual(maxLB(byName('다이도').mounts), maxLB(byName('다이도').base_list));
});

test('both 가스코뉴 resolve to the same 포좌 — the case that forces max(), not a product', () => {
    // 가스코뉴 is the game's only 「주포 2회 발사」 ship: parallel_max[0] == 2, so two
    // charge units reload together and she fires twice per cycle. Her μ변형's LB1
    // grants 「주포 발사 수 +1」 (moving base_list AND parallel_max 1 -> 2) and her LB3
    // then grows weapon_ids 1 -> 2 with NO grant in its text — the art catching up
    // with the same grant. Multiplying the two encodings would give her 4 against
    // research 가스코뉴's 2; they describe one quantity, so build_mounts takes the
    // larger. If this ever fails, the two encodings have genuinely diverged and the
    // rule needs re-deriving rather than patching.
    const a = maxLB(byName('가스코뉴').mounts)[0];
    const b = maxLB(byName('가스코뉴(μ장비)').mounts)[0];
    assert.equal(a, 2);
    assert.equal(b, 2, '가스코뉴(μ장비) diverged from 가스코뉴 — see build_mounts');
});

test('the LB table is resolved by ID — 안샨 with 개조 off keeps her own 포좌', () => {
    // 안샨/푸슌/창춘/타이위안 carry SIX tables: four of their own, then two 改 forms
    // (미구-전열 `retrofit.id`, 미구-후열 one higher). The old positional rule read
    // "second to last" with 개조 off and landed on the 改 전열 table, handing her the
    // 改 포좌 [2,1,1] instead of her own [1,2,1] — main gun doubled, torpedoes halved.
    // Only this class can see the regression through mounts: 카스미's 개조-off bug
    // moves her base stats (LB2 instead of MLB) while her 포좌 stay [1,2,1].
    for (const name of ['안샨', '푸슌', '창춘', '타이위안']) {
        const ship = byName(name);
        assert.equal(Object.keys(ship.base).length, 6, `${name}: expected 6 LB tables`);
        assert.deepEqual(getShipBaseList(ship, false), ship.mounts[String(ship.sid + 3)],
            `${name}: 개조 off must read her own MLB 포좌, not a 改 table`);
        assert.deepEqual(getShipBaseList(ship, true), ship.mounts[String(ship.retrofit.id)],
            `${name}: 개조 on must read the retrofit.id table`);
    }
});

test('getShipBaseList prefers mounts and falls back to base_list', () => {
    const goetz = byName('괴츠 폰 베를리힝겐');
    assert.equal(getShipBaseList(goetz, true)[0], 3);
    const legacy = { ...goetz };
    delete legacy.mounts;                      // a visitor on cached pre-1.74 ship data
    assert.equal(getShipBaseList(legacy, true)[0], 2);
    assert.equal(getShipBaseList({}, true), null);
});
