/**
 * Passive-buff targeting and the damage-multiplier class.
 *
 * Two things are load-bearing here and neither is obvious from the JSON:
 *  - Targeting is decided PER CLAUSE. One skill mixes recipients (펑셔널 기믹 BOOST
 *    raises 키어사지's own stats AND grants every carrier 공습 선도), and the
 *    skill-level target_mode/target_types are the broadest of its clauses — so
 *    gating on those first drops the clauses that were meant for the caster.
 *  - vanguard/main/flagship are FLEET POSITIONS (slots 0–2 주력, 3–5 전열), which
 *    is why the fleet array has to stay positional all the way down.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { setup, resolvePassiveBuffs, sumDamageBuffs } from '../../public/js/simulators/fleet-sim.calc.js';

const ship = (gid, type, skills, nationality = 1, tagList = []) =>
    ({ gid, type, nationality, tag_list: tagList, skill: Object.fromEntries(skills.map((s) => [s, {}])) });

/** One-level passive table; resolvePassiveBuffs reads the highest level. */
const table = (entries) => {
    const out = {};
    for (const [id, mode, clauses, extra] of entries) {
        out[id] = { name: id, target_mode: mode, target_types: [], levels: { 1: clauses }, ...extra };
    }
    return out;
};

const withTable = (passiveSkillData) => setup({ passiveSkillData });
const attrs = (buffs) => buffs.map((b) => b.attr).sort();

test('vanguard targets slots 3–5, main targets 0–2', () => {
    withTable(table([
        ['1004', 'vanguard', [{ attr: 'cannonPower', value: 1500, type: 'ratio' }]],
        ['1005', 'main', [{ attr: 'loadSpeed', value: 1500, type: 'ratio' }]],
    ]));
    const caster = ship(1, 1, ['1004', '1005']);
    const front = ship(2, 1, []);
    const fleet = [caster, null, null, front, null, null];

    // slot 0 is 주력 → only the main-targeted 지휘 lands
    assert.deepEqual(attrs(resolvePassiveBuffs(caster, fleet, 0)), ['loadSpeed']);
    // slot 3 is 전열 → only the vanguard one
    assert.deepEqual(attrs(resolvePassiveBuffs(front, fleet, 3)), ['cannonPower']);
});

test('the flagship is the first OCCUPIED main slot, not slot 0', () => {
    withTable(table([['13810', 'flagship', [{ attr: 'antiAirPower', value: 1500, type: 'ratio' }]]]));
    const caster = ship(1, 1, ['13810']);
    const other = ship(2, 3, []);

    // battlefleetvo.lua appendMainUnit flags the first unit APPENDED to _mainList,
    // and the list only ever receives occupied slots.
    const gap = [null, other, caster, null, null, null];
    assert.deepEqual(attrs(resolvePassiveBuffs(other, gap, 1)), ['antiAirPower']);
    assert.deepEqual(attrs(resolvePassiveBuffs(caster, gap, 2)), []);

    // A vanguard-only fleet has no flagship at all.
    const noMain = [null, null, null, caster, other, null];
    assert.deepEqual(attrs(resolvePassiveBuffs(other, noMain, 4)), []);
});

test('a clause keeps its own recipient when the skill mode is broader', () => {
    // 펑셔널 기믹 BOOST in miniature: two self clauses beside a carriers-only aura.
    withTable(table([[
        '19670',
        'fleet',
        [
            { attr: 'cannonPower', value: 1000, type: 'ratio', target: 'self' },
            { attr: 'airPower', value: 1000, type: 'ratio', target: 'self' },
            { attr: 'damageRatioBullet', value: 0.15, type: 'flat', types: [6, 7], src: 1080 },
        ],
        { target_types: [6, 7] },
    ]]));

    const kearsarge = ship(19904, 10, ['19670']);   // 항전 — NOT a carrier type
    const carrier = ship(10706, 7, []);
    const fleet = [kearsarge, carrier, null, null, null, null];

    // The caster is type 10, so the skill-level [6,7] filter would have excluded her
    // from her own stat buffs — the bug this per-clause gate exists to prevent.
    assert.deepEqual(attrs(resolvePassiveBuffs(kearsarge, fleet, 0)), ['airPower', 'cannonPower']);
    // The carrier gets the aura and none of the caster's personal stats.
    assert.deepEqual(attrs(resolvePassiveBuffs(carrier, fleet, 1)), ['damageRatioBullet']);
});

test('sumDamageBuffs keeps damage multipliers apart by attribute', () => {
    const out = sumDamageBuffs([
        { attr: 'damageRatioBullet', value: 0.1 },
        { attr: 'damageRatioBullet', value: 0.2 },
        { attr: 'damageRatioByCannon', value: 0.05 },
        { attr: 'cannonPower', value: 1000 },        // a stat — must not leak in
    ]);
    assert.equal(Math.round(out.bullet * 100) / 100, 0.3);
    assert.equal(out.cannon, 0.05);
    assert.equal(out.air, 0);
});

test('a shared aura does NOT stack — the largest wins, not the sum', () => {
    // 공습 선도's own text: 「동일 스킬 효과는 중첩되지 않음」. Two carriers granting
    // buff 1080 must contribute 15%, not 30%; `src` is what makes them the same aura.
    const out = sumDamageBuffs([
        { attr: 'damageRatioBullet', value: 0.15, src: 1080 },
        { attr: 'damageRatioBullet', value: 0.108, src: 1080 },
    ]);
    assert.equal(out.bullet, 0.15);

    // Different auras still add, and an un-sourced buff adds on top of both.
    const mixed = sumDamageBuffs([
        { attr: 'damageRatioBullet', value: 0.15, src: 1080 },
        { attr: 'damageRatioBullet', value: 0.1, src: 2000 },
        { attr: 'damageRatioBullet', value: 0.05 },
    ]);
    assert.equal(Math.round(mixed.bullet * 100) / 100, 0.3);
});

test('the indexed damage families collect by their own suffix', () => {
    // Each of the three carries its key IN THE ATTR NAME, because the engine only
    // resolves it at damage time — the target's armor class, the target's label
    // tags, the bullet's ammo type. The pipeline emits the name verbatim.
    const out = sumDamageBuffs([
        { attr: 'damageToArmorRateEnhance_1', value: 0.15 },
        { attr: 'damageToArmorRateEnhance_2', value: 0.15 },
        { attr: 'damageToArmorRateEnhance_1', value: 0.1 },   // same class stacks
        { attr: 'damageRatioByAmmoType_3', value: 0.25 },
        { attr: 'DMG_TAG_EHC_T_5', value: 0.1 },
        { attr: 'DMG_TAG_EHC_N_99', value: 0.1 },
        { attr: 'DMG_TAG_EHC_YueKeCheng', value: 9 },         // a named mark, if one ever ships
        { attr: 'cannonPower', value: 1000 },                 // a stat — must not leak in
    ]);
    assert.equal(Math.round(out.byArmor['1'] * 100) / 100, 0.25);
    assert.equal(out.byArmor['2'], 0.15);
    assert.equal(out.byArmor['3'], undefined);
    assert.equal(out.byAmmo['3'], 0.25);
    assert.equal(out.byTag.T_5, 0.1);
    assert.equal(out.byTag.N_99, 0.1);
    // A named mark keys off its own suffix, so it can never be mistaken for a tag
    // the target carries — it simply matches nothing.
    assert.equal(out.byTag.YueKeCheng, 9);
    assert.equal(out.bullet, 0);
});

test('the aura rule covers the indexed families too', () => {
    const out = sumDamageBuffs([
        { attr: 'DMG_TAG_EHC_T_5', value: 0.15, src: 1080 },
        { attr: 'DMG_TAG_EHC_T_5', value: 0.108, src: 1080 },
    ]);
    assert.equal(out.byTag.T_5, 0.15);
});

test('an unknown target mode is dropped rather than guessed at', () => {
    withTable(table([['9999', 'somethingNew', [{ attr: 'cannonPower', value: 100, type: 'ratio' }]]]));
    const s = ship(1, 1, ['9999']);
    assert.deepEqual(resolvePassiveBuffs(s, [s, null, null, null, null, null], 0), []);
});

test('only the live rung of a chain buffs the fleet, and 운명 is a gate on it', () => {
    // 4 research ships have a passive on both sides of a Fate Simulation step, and
    // 3 more on both sides of a Retrofit one. Iterating ship.skill raw applied both.
    withTable(table([
        ['19440', 'self', [{ attr: 'cannonPower', value: 1500, type: 'ratio' }]],
        ['18440', 'self', [{ attr: 'loadSpeed', value: 1500, type: 'ratio' }]],
    ]));
    const pr = {
        gid: 19903, type: 1, nationality: 1, skill: {
            19440: { upgrade: 18440, requirement: 'Default' },
            18440: { downgrade: 19440, requirement: 'Fate Simulation 5' },
        },
    };
    const fleet = [pr, null, null, null, null, null];

    assert.deepEqual(attrs(resolvePassiveBuffs(pr, fleet, 0)), ['loadSpeed'], 'fate defaults to max');
    assert.deepEqual(attrs(resolvePassiveBuffs(pr, fleet, 0, [{ fate: true }])), ['loadSpeed']);
    assert.deepEqual(attrs(resolvePassiveBuffs(pr, fleet, 0, [{ fate: false }])), ['cannonPower']);
});

// `ship_data_statistics[sid].tag_list` — battleplayerunit.lua:87 seeds these before
// any buff runs, and 38 of the 49 skills carrying a `target_ship_tags` buff OTHER
// ships, so before the seed 후부키's 「특형 네임쉽!」 raised the whole fleet's 화력.
test('a target_ship_tags clause reaches only ships carrying one of the tags', () => {
    withTable(table([['10960', 'fleet',
        [{ attr: 'cannonPower', value: 3000, type: 'ratio' }],
        { target_ship_tags: ['Special Type'] }]]));
    const fubuki = ship(1, 1, ['10960'], 3, ['Special Type']);
    const amazon = ship(2, 1, [], 2, ['B-Class']);
    const fleet = [fubuki, amazon, null, null, null, null];

    assert.deepEqual(attrs(resolvePassiveBuffs(fubuki, fleet, 0)), ['cannonPower']);
    assert.deepEqual(attrs(resolvePassiveBuffs(amazon, fleet, 1)), []);
});

// ANY of the listed tags is enough — ContainsLabelTag returns on the first hit
// (battleunit.lua:437). 6 skills list two, e.g. 16232 Essex-Class + Yorktown-Class.
test('a multi-tag gate matches on any one of them, and no gate still reaches everyone', () => {
    withTable(table([
        ['16232', 'fleet', [{ attr: 'airPower', value: 1000, type: 'ratio' }],
            { target_ship_tags: ['Essex-Class', 'Yorktown-Class'] }],
        ['1000', 'fleet', [{ attr: 'loadSpeed', value: 1000, type: 'ratio' }]],
    ]));
    const essex = ship(1, 7, ['16232', '1000'], 1, ['Essex-Class']);
    const yorktown = ship(2, 7, [], 1, ['Yorktown-Class']);
    const other = ship(3, 7, [], 1, ['Lexington-Class']);
    const fleet = [essex, yorktown, other, null, null, null];

    assert.deepEqual(attrs(resolvePassiveBuffs(essex, fleet, 0)), ['airPower', 'loadSpeed']);
    assert.deepEqual(attrs(resolvePassiveBuffs(yorktown, fleet, 1)), ['airPower', 'loadSpeed']);
    // No tag of its own, so only the ungated skill reaches it.
    assert.deepEqual(attrs(resolvePassiveBuffs(other, fleet, 2)), ['loadSpeed']);
});

// A tag this lane cannot answer must not flip the clause from "buffs everyone" to
// "buffs nobody" in silence — that is the same over/under-report evalGate is
// three-valued to avoid. UNEVALUABLE_SHIP_TAGS keeps today's behaviour and
// fleet-sim-ship-tags.test.mjs pins the set so a NEW orphan fails loudly.
test('an unevaluable tag leaves the clause unchanged rather than zeroing it', () => {
    withTable(table([
        ['102020', 'fleet', [{ attr: 'cannonPower', value: 3000, type: 'ratio' }],
            { target_ship_tags: ['Bilibili'] }],
        // 탄약 부족 is deliberately NOT on that list: a fresh sortie is not ammo-starved,
        // so reading it as unset is certain and 2190's fleet-wide +15% stops applying.
        ['2190', 'fleet', [{ attr: 'damageRatioBullet', value: 0.15, type: 'flat' }],
            { target_ship_tags: ['danyaokuifa'] }],
    ]));
    const caster = ship(1, 1, ['102020', '2190'], 1, ['Z-Class']);
    const fleet = [caster, null, null, null, null, null];
    assert.deepEqual(attrs(resolvePassiveBuffs(caster, fleet, 0)), ['cannonPower']);
});
