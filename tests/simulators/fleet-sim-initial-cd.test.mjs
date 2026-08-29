/**
 * Opening cooldown: which weapons are ready at t=0, and which start reloading.
 *
 * The game's answer is a per-weapon flag, NOT "everything starts on cooldown":
 * battleweaponunit.lua InitialCD is a no-op unless `initial_over_heat == 1`, and
 * battleplayerunit.lua setWeapon then exempts the first `preload_count[slot]`
 * mounts of the manual/charge classes. The flag splits the roster cleanly, which
 * is why a destroyer opens fire instantly and a battleship's first salvo is late.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { countSalvos, countSalvosWithPreload } from '../../public/js/engine/damage/timeline.js';
import { mergeWeaponWithBase } from '../../public/js/simulators/fleet-sim.damage.js';

const read = (p) => JSON.parse(readFileSync(new URL(`../../public/data/${p}`, import.meta.url), 'utf8'));
const WEAPONS = read('sim/weapon_property.json');
const EQUIPS = read('equip/equip_data_full.json');
const SHIPS = read('ship_info_data.json');

const getWeapon = (id) => WEAPONS[String(id)] || null;
const equipList = Array.isArray(EQUIPS) ? EQUIPS : Object.values(EQUIPS);
/** Merged launcher weapons for an equip at max enhance. */
const launchers = (equipId) => {
    const e = equipList.find((x) => x.id === equipId);
    const wid = e.levels[e.levels.length - 1].weapon_id;
    return (Array.isArray(wid) ? wid : [wid]).map((id) => mergeWeaponWithBase(getWeapon(id), getWeapon));
};
const shipByName = (n) => Object.values(SHIPS).find((s) => s.name === n);

test('initial_over_heat splits the roster exactly along the classes players feel', () => {
    const byType = {};
    for (const e of equipList) {
        const lv = e.levels || [];
        if (!lv.length) continue;
        for (const w of launchers(e.id)) {
            if (!w || w.type == null) continue;
            byType[w.type] = byType[w.type] || { n: 0, hot: 0 };
            byType[w.type].n++;
            if (w.initial_over_heat === 1) byType[w.type].hot++;
        }
    }
    // 전함 주포 (POINT_HIT_AND_LOCK) and 어뢰 (MANUAL_TORPEDO): every one starts on cooldown.
    for (const t of [16, 23]) assert.equal(byType[t].hot, byType[t].n, `weapon type ${t}`);
    // 부포 / 구축·경순·중순 주포 (SUB_CANNON): none of them do — they fire at t=0.
    assert.equal(byType[2].hot, 0);
    // Aircraft launchers carry the flag OFF, but the air assist that fires them
    // starts on cooldown regardless (BattleAllInStrike.InitialCD is unconditional),
    // which is why the descriptor sets startsOnCooldown by hand rather than reading this.
    assert.equal(byType[10].hot, 0);
});

test('a preloaded mount fires at t=0 and the rest a full reload later', () => {
    // 라피 and 426 other ships ship preload_count [0,1,0] against 2 torpedo mounts,
    // so half the slot opens immediately — the salvo count is legitimately fractional.
    const laffey = shipByName('라피');
    assert.deepEqual(laffey.preload_count, [0, 1, 0]);
    assert.deepEqual(Object.values(laffey.base_list).pop(), [1, 2, 1]);

    const interval = 19.68, window = 90, cool = 19.68;
    const ready = countSalvos(interval, 0, window);            // 5
    const late = countSalvos(interval, cool, window);          // 4
    assert.equal(ready, 5);
    assert.equal(late, 4);
    assert.equal(countSalvosWithPreload(interval, 0, cool, window, 0.5), 4.5);
});

test('no preload means the whole slot waits; full preload means none of it does', () => {
    const interval = 20, window = 90, cool = 20;
    assert.equal(countSalvosWithPreload(interval, 0, cool, window, 0), countSalvos(interval, cool, window));
    assert.equal(countSalvosWithPreload(interval, 0, cool, window, 1), countSalvos(interval, 0, window));
    // startsOnCooldown false ⇒ coolStart 0 ⇒ the preload share is irrelevant.
    assert.equal(countSalvosWithPreload(interval, 0, 0, window, 0), countSalvos(interval, 0, window));
});

test('the opening cooldown is the RAW reload, not the full fire cycle', () => {
    // InitialCD passes GetReloadTime() alone — no salvo firing time, no 발사 후 경직 —
    // so a weapon whose cycle is padded still opens after just its reload.
    const cycle = 12, cool = 10, window = 90;
    assert.equal(countSalvosWithPreload(cycle, 0, cool, window, 0), Math.floor((90 - 10) / 12) + 1);
});
