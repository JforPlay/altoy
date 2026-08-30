/**
 * Weapon-scoped skill modifiers — 주포 장전 단축 and its paired 주포 피해 감소.
 *
 * Two engine effects that scope to a WEAPON rather than to the ship, and neither
 * is a stat:
 *   BattleBuffAddReloadRequirement → `weaponReloadRatio` + `wtype`
 *     (weapon_property.type: 23 전함 주포, 16 어뢰, "airAssist" the carrier cycle)
 *   BattleBuffAddBulletAttr        → `slotDamageRatio` + `slots` (1-based equip index)
 *
 * THREE THINGS ARE LOAD-BEARING and none is visible in the JSON:
 *
 *  - The two are a MATCHED PAIR on the ships that carry them. 괴츠 폰 베를리힝겐
 *    halves her 주포 reload and pays -45% on that slot; honouring only the reload
 *    half reports her ~1.8x too high.
 *  - PERMANENT IN THE CONFIG IS NOT PERMANENT IN THE FIGHT. Most emitted entries
 *    cut only the first salvo (프린스 오브 웨일즈 -85%, 상 마르티뉴 -80%) and are
 *    torn down by a removal edge the config walk cannot see, so consumption is
 *    gated on an allowlist read off each skill's own KR text.
 *  - Neither attr may reach the stat table or the flat damage-ratio table. They
 *    have their own names precisely so `BATTLE_ATTR_TO_STAT` and `sumDamageBuffs`
 *    cannot pick them up, and a rename that collided would silently add a 50%
 *    reload stat to a ship.
 *
 * Reads only committed data (never a data:split artifact).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { setup, resolvePassiveBuffs, sumWeaponModifiers, sumDamageBuffs } from '../../public/js/simulators/fleet-sim.calc.js';

const PASSIVES = JSON.parse(readFileSync(new URL('../../public/data/sim/fleet_sim_passive_skills.json', import.meta.url), 'utf8'));
const SHIPS = JSON.parse(readFileSync(new URL('../../public/data/ship_info_data.json', import.meta.url), 'utf8'));
const shipList = Array.isArray(SHIPS) ? SHIPS : Object.values(SHIPS);
const byName = (name) => shipList.find((s) => s.name === name);

/** 괴츠 폰 베를리힝겐 — the worked example, and the only ship carrying BOTH halves. */
const GOETZ_SKILL = '152340';
const BB_MAIN_GUN = 23;      // weapon_property.type
const MAIN_GUN_SLOT = 1;     // 1-based equip index, the game's own numbering

const topLevel = (entry) => entry.levels[Math.max(...Object.keys(entry.levels).map(Number))];
const fleetOf = (ship) => [ship, null, null, null, null, null];

test('괴츠 152340 emits BOTH halves of the pair at max level', () => {
    const rows = topLevel(PASSIVES[GOETZ_SKILL]);
    const reload = rows.filter((r) => r.attr === 'weaponReloadRatio');
    const damage = rows.filter((r) => r.attr === 'slotDamageRatio');

    assert.deepEqual(reload, [{ attr: 'weaponReloadRatio', value: -0.5, type: 'flat', wtype: BB_MAIN_GUN }]);
    assert.deepEqual(damage, [{ attr: 'slotDamageRatio', value: -0.45, type: 'flat', slots: [MAIN_GUN_SLOT] }]);
});

test('그 스킬은 괴츠의 것 — the roster still pins the pair to her', () => {
    const goetz = byName('괴츠 폰 베를리힝겐');
    assert.ok(goetz, '괴츠 폰 베를리힝겐 missing from the roster');
    assert.ok(GOETZ_SKILL in (goetz.skill || {}), 'skill 152340 no longer hers');
});

test('sumWeaponModifiers resolves a fleet into per-weapon-type and per-slot totals', () => {
    setup({ passiveSkillData: PASSIVES });
    const goetz = byName('괴츠 폰 베를리힝겐');
    const buffs = resolvePassiveBuffs(goetz, fleetOf(goetz), 0);
    const mods = sumWeaponModifiers(buffs);

    assert.equal(mods.reloadByWeaponType[BB_MAIN_GUN], -0.5);
    assert.equal(mods.damageBySlot[MAIN_GUN_SLOT], -0.45);
});

test('the two attrs never leak into the stat total or the flat damage ratio', () => {
    setup({ passiveSkillData: PASSIVES });
    const goetz = byName('괴츠 폰 베를리힝겐');
    const buffs = resolvePassiveBuffs(goetz, fleetOf(goetz), 0);

    // sumDamageBuffs maps damageRatio* only — a weapon-scoped row must contribute
    // nothing, to any bucket, flat or indexed.
    assert.deepEqual(sumDamageBuffs(buffs), {
        bullet: 0, cannon: 0, air: 0, torpedo: 0, byArmor: {}, byAmmo: {}, byTag: {},
    });

    // ...and the names must stay distinct from every stat attr the calc loop reads.
    const statAttrs = new Set(['durability', 'cannonPower', 'airPower', 'torpedoPower',
        'antiAirPower', 'dodgeRate', 'attackRating', 'loadSpeed', 'antiSubPower']);
    for (const attr of ['weaponReloadRatio', 'slotDamageRatio']) {
        assert.ok(!statAttrs.has(attr), `${attr} collides with a ship stat`);
    }
});

test('the allowlist gates consumption — an un-allowlisted skill emits but never applies', () => {
    // 상 마르티뉴 17200 is the counter-example the allowlist exists for: its -80%
    // is real in the config and lasts exactly one salvo in the fight.
    const rows = topLevel(PASSIVES['17200']).filter((r) => r.attr === 'weaponReloadRatio');
    assert.equal(rows.length, 1, 'expected 17200 to still carry its emitted reload cut');
    assert.equal(rows[0].value, -0.8);

    setup({ passiveSkillData: PASSIVES });
    const ship = byName('상 마르티뉴');
    assert.ok(ship, '상 마르티뉴 missing from the roster');
    const mods = sumWeaponModifiers(resolvePassiveBuffs(ship, fleetOf(ship), 0));
    assert.deepEqual(mods.reloadByWeaponType, {}, '17200 must not reach the descriptors');
});

test('every allowlisted skill still resolves to a weapon-scoped row', () => {
    // The allowlist is private to calc.js on purpose, so drive it the way the sim
    // does: a fleet of one, per owning ship. A data refresh that renames or drops
    // one of these ids would silently turn its modifier off.
    const expected = {
        152340: { reload: { [BB_MAIN_GUN]: -0.5 }, damage: { [MAIN_GUN_SLOT]: -0.45 } },
        18350: { reload: { [BB_MAIN_GUN]: -0.4 }, damage: {} },
        19350: { reload: { [BB_MAIN_GUN]: -0.4 }, damage: {} },
        15460: { reload: {}, damage: { [MAIN_GUN_SLOT]: 0.1 } },
    };
    setup({ passiveSkillData: PASSIVES });
    for (const [skillId, want] of Object.entries(expected)) {
        const owner = shipList.find((s) => skillId in (s.skill || {}));
        assert.ok(owner, `no ship carries allowlisted skill ${skillId}`);
        const mods = sumWeaponModifiers(resolvePassiveBuffs(owner, fleetOf(owner), 0));
        assert.deepEqual(mods.reloadByWeaponType, want.reload, `${skillId} reload`);
        assert.deepEqual(mods.damageBySlot, want.damage, `${skillId} damage`);
    }
});
