import test from 'node:test';
import assert from 'node:assert/strict';

import {
    attrLabel,
    buildSkillTagRows,
    isEmptyTagRows,
} from '../../public/js/shipgirl/skill-tags.js';

// Trimmed stand-ins for the two mapping files the page already loads. Fixtures,
// not the real files: `type_name` in ship_type_mapping carries trailing spaces
// on some rows, so the trim is part of what's under test.
const ctx = {
    shipTypes: {
        1: { type_name: '구축' },
        2: { type_name: '경순' },
        17: { type_name: '잠모 ' },
    },
    nationalities: {
        2: { name: '로열 네이비' },
        3: { name: '사쿠라 엠파이어' },
    },
};

test('attrLabel names the common attrs', () => {
    assert.equal(attrLabel('cannonPower', ctx), '화력');
    assert.equal(attrLabel('injureRatio', ctx), '받는 피해');
    assert.equal(attrLabel('damageRatioBullet', ctx), '주는 피해');
});

test('attrLabel resolves structured tails through the ship-type mapping', () => {
    assert.equal(attrLabel('DMG_TAG_EHC_T_2', ctx), '경순에게 주는 피해');
    assert.equal(attrLabel('DMG_FROM_TAG_1_T_1', ctx), '구축에게서 받는 피해');
    assert.equal(attrLabel('damageToArmorRateEnhance_1', ctx), '경장갑 피해');
    assert.equal(attrLabel('accuracyToShipType_1', ctx), '구축 명중');
});

test('attrLabel trims the trailing space upstream ships on some type names', () => {
    assert.equal(attrLabel('DMG_TAG_EHC_T_17', ctx), '잠모에게 주는 피해');
});

test('attrLabel returns null for an unnamed attr rather than inventing one', () => {
    assert.equal(attrLabel('someBrandNewAttr', ctx), null);
});

/** All effect chips across every group, for assertions that don't care where. */
const allEffects = (rows) => rows.groups.flatMap(g => g.effects);

/** The one group whose recipient label matches, or undefined. */
const groupFor = (rows, label) => rows.groups.find(g => g.targets.join(' / ') === label);

// The bug this feature exists to expose: 센토 제공권 확보 + (1011590). The KR
// text claims 받는 피해량 상승 (incoming damage UP); the engine raises
// damageRatioBullet — damage DEALT. If the derivation ever regresses to reading
// check_target as a target, or drops the outgoing effect, this fails.
test('센토 1011590 renders outgoing damage, never incoming', () => {
    const entry = {
        e: [
            { a: 'airPower', s: 'ally', g: ['main'], v: [5, 15], p: 1 },
            { a: 'cannonPower', s: 'ally', g: ['main'], v: [4, 10], p: 1 },
            { a: 'damageRatioBullet', s: 'ally', g: ['self'], v: [4, 10], p: 1 },
        ],
        c: [{ k: 'minTargetNumber', v: 3 }, { k: 'nationality', v: 2 }],
    };
    const rows = buildSkillTagRows(entry, ctx);

    const damage = allEffects(rows).find(r => r.label === '주는 피해');
    assert.ok(damage, 'outgoing damage row missing');
    assert.equal(damage.direction, 'up');
    assert.equal(damage.value, '4.0%→10.0%');
    assert.ok(!allEffects(rows).some(r => r.label === '받는 피해'),
        'derived an incoming-damage row the engine never applies');

    // The KR text's two clauses land in two places: the damage buff on 센토
    // herself, the stat buff on the main fleet. A flat list hid that.
    assert.deepEqual(rows.groups.map(g => g.targets.join(' / ')), ['자신', '주력']);
    assert.deepEqual(groupFor(rows, '자신').effects.map(e => e.label), ['주는 피해']);
    assert.deepEqual(groupFor(rows, '주력').effects.map(e => e.label).sort(),
        ['항공', '화력']);

    assert.deepEqual(rows.conditions, ['3척 이상', '로열 네이비']);
    assert.equal(rows.hiddenEffects, 0);
    assert.equal(rows.hiddenConditions, 0);
});

// 114010 신의 은혜(팔나): 선봉 gets 화력/뇌장, the whole fleet gets 주는 피해 and
// a 1% heal. Flattened, that read as one blob over "자신 / 선봉 / 아군 전체".
test('effects split into one group per recipient', () => {
    const rows = buildSkillTagRows({
        e: [
            { a: 'damageRatioBullet', s: 'ally', g: ['fleet'], v: [1, 5], p: 1 },
            { a: 'cannonPower', s: 'ally', g: ['vanguard'], v: [1, 10], p: 1 },
            { a: 'torpedoPower', s: 'ally', g: ['vanguard'], v: [1, 10], p: 1 },
        ],
        t: [{ n: 'heal', s: 'ally', g: ['fleet'], v: [1] }],
    }, ctx);

    // 선봉 before 아군 전체 — own slice outward, the order a skill reads in.
    assert.deepEqual(rows.groups.map(g => g.targets.join(' / ')), ['선봉', '아군 전체']);
    assert.deepEqual(groupFor(rows, '선봉').effects.map(e => e.label).sort(), ['뇌장', '화력']);
    assert.deepEqual(groupFor(rows, '아군 전체').effects.map(e => e.label), ['주는 피해']);
    assert.deepEqual(groupFor(rows, '아군 전체').tags, ['회복 1.0%']);
    assert.deepEqual(rows.targets, [], 'nothing left over once every effect is placed');
});

// maxHPRatio sizes the heal; it is never a gate. Read as a condition it printed
// a fabricated "내구 1% 이하" on 222 skills — 9.1% of the corpus.
test('a tag magnitude renders on the tag, not as a condition', () => {
    const rows = buildSkillTagRows({
        t: [{ n: 'heal', s: 'ally', g: ['fleet'], v: [1] },
            { n: 'shield', s: 'ally', g: ['self'], v: [2, 6] }],
    }, ctx);
    assert.deepEqual(groupFor(rows, '아군 전체').tags, ['회복 1.0%']);
    assert.deepEqual(groupFor(rows, '자신').tags, ['실드 2.0%→6.0%']);
    assert.deepEqual(rows.conditions, []);
});

test('a tag with no magnitude stays a bare label', () => {
    const rows = buildSkillTagRows({ t: [{ n: 'guard', s: 'ally', g: ['self'] }] }, ctx);
    assert.deepEqual(groupFor(rows, '자신').tags, ['보호']);
});

// 즈이호 150400 heals twice off two different HP pools — "회복량은 즈이호의 내구
// 최대치의 1%" on 선봉, "대상 함선의" on 주력. Same tag, same number: without the
// base the two chips are indistinguishable.
test('a non-default HP base is named beside the magnitude', () => {
    const rows = buildSkillTagRows({
        t: [{ n: 'heal', s: 'ally', g: ['main'], v: [1, 2] },
            { n: 'heal', s: 'ally', g: ['vanguard'], v: [1, 5], b: 'c' },
            { n: 'shield', s: 'ally', g: ['self'], v: [100], b: 'n' }],
    }, ctx);
    assert.deepEqual(groupFor(rows, '주력').tags, ['회복 1.0%→2.0%']);
    assert.deepEqual(groupFor(rows, '선봉').tags, ['회복 1.0%→5.0% (시전자 내구 기준)']);
    assert.deepEqual(groupFor(rows, '자신').tags, ['실드 100.0% (현재 내구 기준)']);
});

test('an unknown base marker degrades to the bare magnitude', () => {
    const rows = buildSkillTagRows({
        t: [{ n: 'heal', s: 'ally', g: ['self'], v: [3], b: 'zzz' }],
    }, ctx);
    assert.deepEqual(groupFor(rows, '자신').tags, ['회복 3.0%']);
});

// BattleBuffHP spends HP as often as it restores it, and the producer splits the
// two by the sign of its ratio. The KR text of all five negative skills says
// 차감/소모/잃다 and never 피해, so the label is a cost, not self-damage.
test('an HP cost reads as 내구 소모, positive', () => {
    const rows = buildSkillTagRows({
        t: [{ n: 'hpcost', s: 'ally', g: ['self'], v: [5] },
            { n: 'heal', s: 'ally', g: ['self'], v: [8] }],
    }, ctx);
    assert.deepEqual(groupFor(rows, '자신').tags, ['내구 소모 5.0%', '회복 8.0%']);
});

// Z35 오버 파이어 (11450): 장전 +200% then a -100% drawback. They come from two
// different buffs and must stay two rows — merged, they render as a single
// nonsensical "장전 -100% → 200%".
test('a buff and its drawback stay separate rows', () => {
    const rows = buildSkillTagRows({
        e: [
            { a: 'loadSpeed', s: 'ally', g: ['self'], v: [-100], p: 1 },
            { a: 'loadSpeed', s: 'ally', g: ['self'], v: [100, 200], p: 1 },
        ],
    }, ctx);

    const reload = allEffects(rows).filter(r => r.label === '장전');
    assert.equal(reload.length, 2);
    assert.deepEqual(reload.map(r => [r.direction, r.value]).sort(), [
        ['down', '100.0%'],
        ['up', '100.0%→200.0%'],
    ]);
});

test('enemy-side effects keep their side on the group', () => {
    const rows = buildSkillTagRows({
        e: [{ a: 'attackRating', s: 'enemy', g: ['enemy_all'], v: [-5, -15], p: 1 }],
    }, ctx);
    assert.equal(rows.groups[0].side, 'enemy');
    assert.deepEqual(rows.groups[0].targets, ['적 전체']);
    assert.equal(rows.groups[0].effects[0].direction, 'down');
    assert.equal(rows.groups[0].effects[0].value, '5.0%→15.0%');
});

// Same attr, same value, opposite sides — the group key must carry the side or
// an enemy debuff and a self buff collapse into one row.
test('ally and enemy groups never merge', () => {
    const rows = buildSkillTagRows({
        e: [
            { a: 'cannonPower', s: 'ally', g: ['self'], v: [5], p: 1 },
            { a: 'cannonPower', s: 'enemy', g: ['enemy'], v: [-5], p: 1 },
        ],
    }, ctx);
    assert.equal(rows.groups.length, 2);
    assert.deepEqual(rows.groups.map(g => g.side), ['ally', 'enemy']);
});

test('unnamed attrs and opaque conditions are counted, not dropped silently', () => {
    const rows = buildSkillTagRows({
        e: [
            { a: 'cannonPower', s: 'ally', g: ['self'], v: [5], p: 1 },
            { a: 'someUnmappedThing', s: 'ally', g: ['self'], v: [3], p: 1 },
        ],
        c: [{ k: 'ship_tag_list' }],
    }, ctx);
    assert.equal(allEffects(rows).length, 1);
    assert.equal(rows.hiddenEffects, 1, 'the unnamed attr is counted');
    assert.equal(rows.hiddenConditions, 1, 'the opaque ship_tag_list gate is counted separately');
});

// 19470 아우구스트: its 장갑파괴 lives in a bullet the config does not ship, so
// the walk finds targets and nothing else. The 대상 row is all there is.
test('a skill with targets but no effects still shows its recipients', () => {
    const rows = buildSkillTagRows({ g: ['self', 'enemy'] }, ctx);
    assert.deepEqual(rows.groups, []);
    assert.deepEqual(rows.targets, ['자신', '적']);
    assert.equal(isEmptyTagRows(rows), false);
});

test('non-percent values render bare', () => {
    const rows = buildSkillTagRows({ e: [{ a: 'speed', s: 'ally', g: ['self'], v: [4] }] }, ctx);
    assert.equal(allEffects(rows)[0].value, '4');
});

test('barrage flag comes from the caller, not the entry', () => {
    assert.deepEqual(buildSkillTagRows(null, ctx, { isBarrage: true }).tags, ['탄막']);
    assert.deepEqual(buildSkillTagRows(null, ctx).tags, []);
});

test('effect tags map to Korean', () => {
    const rows = buildSkillTagRows({
        t: [{ n: 'heal', s: 'ally', g: ['self'] }, { n: 'guard', s: 'ally', g: ['self'] },
            { n: 'hot', s: 'ally', g: ['self'], v: [1] }],
    }, ctx);
    assert.deepEqual(groupFor(rows, '자신').tags, ['회복', '보호', '지속 회복 1.0%']);
});

// A status cleanse names the status it cures, and the two verbs differ because
// the KR text's do — 헤스티아 114020 "선봉함대 함선의 점화 상태 … 해제",
// 클리블랜드·META 802010 "탄약 부족에 의한 영향을 받지 않으며".
test('a status cleanse names its status rather than reading 해제', () => {
    const rows = buildSkillTagRows({
        t: [{ n: 'cleanseignite', s: 'ally', g: ['vanguard'] },
            { n: 'cleanseammo', s: 'ally', g: ['self'] }],
    }, ctx);
    assert.deepEqual(groupFor(rows, '선봉').tags, ['점화 해제']);
    assert.deepEqual(groupFor(rows, '자신').tags, ['탄약 부족 무시']);
});

test('an unnamed tag is counted rather than shown', () => {
    const rows = buildSkillTagRows({ t: [{ n: 'brandNewMechanic', s: 'ally', g: ['self'] }] }, ctx);
    assert.deepEqual(rows.groups, []);
    assert.equal(rows.hiddenEffects, 1);
});

test('isEmptyTagRows detects a skill with nothing to show', () => {
    assert.equal(isEmptyTagRows(buildSkillTagRows(null, ctx)), true);
    assert.equal(isEmptyTagRows(buildSkillTagRows(null, ctx, { isBarrage: true })), false);
    assert.equal(isEmptyTagRows(buildSkillTagRows({ g: ['self'] }, ctx)), false);
});

test('missing mapping tables degrade to a placeholder instead of throwing', () => {
    assert.equal(attrLabel('DMG_TAG_EHC_T_2', {}), '함종 2에게 주는 피해');
    const rows = buildSkillTagRows({ c: [{ k: 'nationality', v: 2 }] }, {});
    assert.equal(rows.hiddenConditions, 1);
});

test('nationality-indexed damage tails resolve like the ship-type ones', () => {
    assert.equal(attrLabel('DMG_TAG_EHC_N_3', ctx), '사쿠라 엠파이어에게 주는 피해');
    assert.equal(attrLabel('DMG_FROM_TAG_1_N_2', ctx), '로열 네이비에게서 받는 피해');
});

// The counts drive two differently-worded notices, so a condition-only skill
// must never report a missing effect.
test('a condition-only gap does not claim missing effects', () => {
    const rows = buildSkillTagRows({
        e: [{ a: 'cannonPower', s: 'ally', v: [5], p: 1 }],
        c: [{ k: 'ship_tag_list' }],
    }, ctx);
    assert.equal(rows.hiddenEffects, 0);
    assert.equal(rows.hiddenConditions, 1);
});

// Stacking buffs encode one rung per matching ship — (max 0), (min 1, max 1),
// (min 2, max 2). Rendering each rung produced "2척 이상 · 1척 이하", which reads
// as a contradiction; only the threshold is meaningful to a reader.
test('a fleet-count ladder collapses to its threshold', () => {
    const rows = buildSkillTagRows({
        c: [
            { k: 'maxTargetNumber', v: 0 },
            { k: 'minTargetNumber', v: 1 }, { k: 'maxTargetNumber', v: 1 },
            { k: 'minTargetNumber', v: 2 }, { k: 'maxTargetNumber', v: 2 },
            { k: 'nationality', v: 2 },
        ],
    }, ctx);
    assert.deepEqual(rows.conditions, ['1척 이상', '로열 네이비']);
    assert.equal(rows.hiddenConditions, 0, 'ladder bookkeeping is not an extra gate');
});

test('센토\u0027s single 3척 threshold survives the ladder collapse', () => {
    const rows = buildSkillTagRows({
        c: [{ k: 'minTargetNumber', v: 3 }, { k: 'nationality', v: 2 }],
    }, ctx);
    assert.deepEqual(rows.conditions, ['3척 이상', '로열 네이비']);
});

// isInvincible / perfectDodge are always exactly 1 — a value would render the
// meaningless "무적 ▲ 100.0%".
test('flag attrs render as a label with no value', () => {
    const rows = buildSkillTagRows({
        e: [{ a: 'isInvincible', s: 'ally', g: ['self'], v: [1], f: 1 }],
    }, ctx);
    assert.deepEqual(allEffects(rows), [{ label: '무적', direction: 'up', value: '' }]);
});

// igniteShorten is seconds (-3..6), not a percentage, and its name means
// "shorten BY n" so a positive number must read as an increase in shortening.
test('igniteShorten stays flat seconds with a 단축 label', () => {
    const rows = buildSkillTagRows({
        e: [{ a: 'igniteShorten', s: 'ally', g: ['self'], v: [3] }],
    }, ctx);
    assert.equal(allEffects(rows)[0].label, '화재 시간 단축');
    assert.equal(allEffects(rows)[0].value, '3');
    assert.equal(allEffects(rows)[0].direction, 'up');
});

// ship_type_mapping.json jumps 13 -> 17 and nationality_mapping.json stops well
// short of 99, but skills reference those enemy-only entries.
test('enemy-only types and factions fall back to named extras', () => {
    assert.equal(attrLabel('DMG_TAG_EHC_T_16', ctx), '자폭선에게 주는 피해');
    assert.equal(attrLabel('DMG_TAG_EHC_N_99', ctx), '세이렌에게 주는 피해');
    assert.equal(attrLabel('DMG_TAG_EHC_T_777', ctx), '함종 777에게 주는 피해');
});

// A barrage payload can be a dice roll. 10940 is the shape that forced the
// chance to be per-recipient rather than a skill-level condition: its 회피 is
// certain while the fire it lights lands 1% of the time, so one shared label
// would have advertised the whole skill as 1%.
test('an attach chance splits its own group and leaves certain rows alone', () => {
    const rows = buildSkillTagRows({
        e: [{ a: 'dodgeRate', s: 'ally', g: ['self'], v: [30], p: 1 }],
        t: [{ n: 'dot', s: 'enemy', g: ['enemy'], ch: 100 }],
    }, ctx);
    assert.equal(rows.groups.length, 2);
    assert.equal(groupFor(rows, '자신').chance, '');
    assert.equal(groupFor(rows, '적').chance, '확률 1%');
    assert.deepEqual(groupFor(rows, '적').tags, ['지속 피해']);
});

// Same recipient, different odds: the certain effect must not inherit the roll.
test('rows for one recipient split by chance', () => {
    const rows = buildSkillTagRows({
        e: [
            { a: 'cannonPower', s: 'enemy', g: ['enemy'], v: [10], p: 1 },
            { a: 'dodgeRate', s: 'enemy', g: ['enemy'], v: [5], p: 1, ch: 5000 },
        ],
    }, ctx);
    assert.equal(rows.groups.length, 2);
    assert.deepEqual(rows.groups.map(g => g.chance), ['', '확률 50%']);
});

// 19470's 장갑파괴 only bites 경장/중형 — the restriction is half the KR text.
test('armor_type renders the armour classes a payload is gated to', () => {
    const rows = buildSkillTagRows({
        e: [{ a: 'injureRatioByAir', s: 'enemy', g: ['enemy'], v: [8], p: 1 }],
        c: [{ k: 'armor_type', v: 1 }, { k: 'armor_type', v: 2 }],
    }, ctx);
    assert.deepEqual(rows.conditions, ['경장갑', '중형장갑']);
    assert.equal(rows.hiddenConditions, 0);
});

// The engine spells a shield seven ways. An effect type missing from the map
// renders as nothing AND does not raise the 미표시 marker (that counts unnamed
// attrs, not unmapped types), so the omission is silent — which is how 2B's
// headline 특수 실드 went missing on both 117010 and 117030.
test('every shield spelling reaches the same Korean label', () => {
    const rows = buildSkillTagRows({
        t: [{ n: 'shield', s: 'ally', g: ['self'] },
            { n: 'lockhp', s: 'ally', g: ['self'] },
            { n: 'guard', s: 'ally', g: ['main'] },
            { n: 'reflect', s: 'ally', g: ['self'] }],
    }, ctx);
    assert.deepEqual(groupFor(rows, '자신').tags, ['실드', '내구 고정', '피해 반사']);
    assert.deepEqual(groupFor(rows, '주력').tags, ['보호']);
    assert.equal(rows.hiddenEffects, 0);
});
