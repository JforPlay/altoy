/**
 * skill-tags.js — Turn the engine-derived skill tag data into Korean rows.
 *
 * `public/data/sim/skill_tags.json` (WSL skill_tag_process.py) holds what a
 * skill's buff graph ACTUALLY does, in stable machine keys. This module owns
 * every Korean label, so renaming one never means re-running the pipeline, and
 * an attr nobody has named yet stays in the data — merely uncounted in display
 * rather than lost.
 *
 * Why the feature exists: the KR description is a translation and can disagree
 * with the engine. 센토's 제공권 확보 + says "받는 피해량이 상승" while the
 * engine raises `damageRatioBullet` — damage DEALT. The rows render beside the
 * description so the reader can see the difference.
 *
 * Pure: no DOM, no fetch, no module-scope side effects (node-tested).
 */

// ===== Attribute labels =====

// Explicit names cover 86.8% of derived attr references. Everything past this
// map falls to ATTR_PATTERNS, then to the "일부 효과 미표시" counter.
const ATTR_NAMES = {
    cannonPower: '화력',
    torpedoPower: '뇌장',
    airPower: '항공',
    antiAirPower: '대공',
    antiSubPower: '대잠',
    loadSpeed: '장전',
    dodgeRate: '회피',
    dodgeRateExtra: '회피율',
    attackRating: '명중',
    hitRate: '명중률',
    speed: '항속',
    luck: '운',
    cri: '치명타율',
    criDamage: '치명타 피해',
    perfectDodge: '완전 회피',
    isInvincible: '무적',
    injureRatio: '받는 피해',
    injureRatioByCannon: '받는 포격 피해',
    injureRatioByAir: '받는 항공 피해',
    injureRatioByBulletTorpedo: '받는 뇌격 피해',
    damageRatioBullet: '주는 피해',
    damageRatioAir: '주는 항공 피해',
    damageRatioTorpedo: '주는 뇌격 피해',
    damageRatioByCannon: '주는 포격 피해',
    igniteReduce: '받는 화재 피해',
    // "Shorten by N seconds" — a positive number is a longer reduction, so the
    // label has to carry the 단축 sense or the arrow reads backwards.
    igniteShorten: '화재 시간 단축',
    igniteEnhance: '화재 피해량',
    igniteResist: '화재 저항',
    ignite_accuracy: '화재 명중',
    oxyMax: '산소 최대치',
    oxyAtkDuration: '산소 소모 시간',
    torpedoSpeedExtra: '어뢰 속도',
    immuneDirectHit: '직격 무효',
    chargeBulletAccuracy: '충전 탄막 명중',
    hammerDamagePrevent: '피해 무효',
    cloakRecovery: '은폐 회복',
    cloakExposeExtra: '은폐 노출',
};

const ARMOR_NAMES = { 1: '경장갑', 2: '중형장갑', 3: '중장갑' };
const AMMO_NAMES = { 1: '철갑탄', 2: '고폭탄', 3: '대공탄', 4: '어뢰', 5: '폭탄' };

/**
 * Structured tails. Each rule turns a family of generated attr keys into a
 * label, resolving ship types through the mapping the site already ships so no
 * vocabulary is invented here.
 */
const ATTR_PATTERNS = [
    // _T_ suffixes index ship types, _N_ suffixes index nationalities.
    [/^DMG_TAG_EHC_T_(\d+)$/, (n, ctx) => `${shipType(n, ctx)}에게 주는 피해`],
    [/^DMG_TAG_EHC_N_(\d+)$/, (n, ctx) => `${nation(n, ctx)}에게 주는 피해`],
    [/^DMG_FROM_TAG_\d+_T_(\d+)$/, (n, ctx) => `${shipType(n, ctx)}에게서 받는 피해`],
    [/^DMG_FROM_TAG_\d+_N_(\d+)$/, (n, ctx) => `${nation(n, ctx)}에게서 받는 피해`],
    [/^damageToArmorRateEnhance_(\d+)$/, n => ARMOR_NAMES[n] && `${ARMOR_NAMES[n]} 피해`],
    [/^damageRatioByAmmoType_(\d+)$/, n => AMMO_NAMES[n] && `${AMMO_NAMES[n]} 피해`],
    [/^damageReduceFromAmmoType_(\d+)$/, n => AMMO_NAMES[n] && `받는 ${AMMO_NAMES[n]} 피해`],
    [/^accuracyToShipType_(\d+)$/, (n, ctx) => `${shipType(n, ctx)} 명중`],
];

// Enemy-only entries the shipped mappings don't carry: ship_type_mapping.json
// jumps 13 -> 17 and nationality_mapping.json stops well short of 99. Names are
// taken from the skill descriptions that reference them (11080 "구축함, 수송선,
// 어뢰정, 자폭선"; 19000 "세이렌에게 입히는 대미지").
const EXTRA_SHIP_TYPES = { 14: '어뢰정', 15: '수송선', 16: '자폭선' };
const EXTRA_NATIONS = { 99: '세이렌' };

function shipType(id, ctx) {
    return ctx?.shipTypes?.[String(id)]?.type_name?.trim()
        || EXTRA_SHIP_TYPES[id] || `함종 ${id}`;
}

function nation(id, ctx) {
    return ctx?.nationalities?.[String(id)]?.name?.trim()
        || EXTRA_NATIONS[id] || `진영 ${id}`;
}

/** Korean label for an attr key, or null when nothing names it yet. */
export function attrLabel(attr, ctx) {
    if (ATTR_NAMES[attr]) return ATTR_NAMES[attr];
    for (const [pattern, build] of ATTR_PATTERNS) {
        const match = pattern.exec(attr);
        if (match) {
            const label = build(Number(match[1]), ctx);
            if (label) return label;
        }
    }
    return null;
}

// ===== Targets & conditions =====

const TARGET_NAMES = {
    self: '자신',
    fleet: '아군 전체',
    vanguard: '선봉',
    main: '주력',
    flagship: '기함',
    ally: '아군',
    enemy: '적',
    enemy_all: '적 전체',
};

// Own fleet outward, then the enemy — the order a player reads a skill in.
const TARGET_ORDER = ['self', 'vanguard', 'main', 'flagship', 'fleet', 'ally',
    'enemy', 'enemy_all'];

const targetRank = (codes) => Math.min(...(codes || []).map(
    c => (TARGET_ORDER.indexOf(c) + 1 || 99)), 99);

/** Machine target codes -> ordered Korean names. Unknown codes drop out. */
function targetNames(codes) {
    return (codes || [])
        .slice()
        .sort((a, b) => targetRank([a]) - targetRank([b]))
        .map(c => TARGET_NAMES[c])
        .filter(Boolean);
}

// Conditions the engine gates on. ship_tag_list is intentionally absent — its
// 393 internal tags (A2_skill1, Shizuku_fox, hololive) have no user-facing
// names, so it raises the 미표시 marker instead of rendering as a filter.
const CONDITION_BUILDERS = {
    nationality: (v, ctx) => ctx?.nationalities?.[String(v)]?.name || null,
    ship_type_list: (v, ctx) => list(v).map(t => shipType(t, ctx)).join('·') || null,
    // Barrage payloads can be restricted by the target's armour: 19470's
    // 장갑파괴 lands on 경장/중형 only, which is half of what its text promises.
    armor_type: (v) => list(v).map(a => ARMOR_NAMES[a]).filter(Boolean).join('·') || null,
    hpUpperBound: (v) => `내구 ${pct(v)} 이하`,
    hpLowerBound: (v) => `내구 ${pct(v)} 이상`,
    minWeaponNumber: (v) => `장비 ${v}개 이상`,
    check_weapon: () => '특정 장비 필요',
};

const list = (v) => (Array.isArray(v) ? v : [v]).filter(x => x != null);
const pct = (v) => `${Math.round((v <= 1 ? v * 100 : v))}%`;

/** Attach chance in basis points -> "확률 1%". 10000 never reaches here. */
const chanceLabel = (ch) => `확률 ${Number((ch / 100).toFixed(2))}%`;

// ===== Row building =====

/** `4 → "4.0%"`, `[4,10] → "4.0%→10.0%"`, non-percent values stay bare. */
function formatValue(values, isPercent) {
    const one = (n) => (isPercent ? `${n.toFixed(1)}%` : String(n));
    const [lo, hi] = values;
    return hi === undefined ? one(lo) : `${one(lo)}→${one(hi)}`;
}

/**
 * Build the display rows for one skill.
 *
 * Effects are GROUPED BY RECIPIENT, because a flat list cannot say which effect
 * lands where: 114010 신의 은혜 buffs 선봉's 화력/뇌장, the whole fleet's 주는
 * 피해, and heals the fleet — three effects, three destinations, previously one
 * undifferentiated blob followed by "대상 자신 / 선봉 / 아군 전체".
 *
 * `hiddenEffects` and `hiddenConditions` are counted apart because they mean
 * different things to a reader: an unnamed effect means the list below is
 * incomplete, an unnamed condition means the skill has a gate we can't spell
 * out. Conflating them labels 369 condition-only skills as missing effects.
 *
 * @param {object|null} entry   skill_tags.json entry ({e,t,g,c})
 * @param {object} [ctx]        { shipTypes, nationalities } mapping tables
 * @param {object} [opts]       { isBarrage } — from the existing weapon_true flag
 * @returns {{groups: Array, targets: string[], conditions: string[],
 *            tags: string[], hiddenEffects: number, hiddenConditions: number}}
 */
export function buildSkillTagRows(entry, ctx = {}, opts = {}) {
    const rows = {
        groups: [], targets: [], conditions: [], tags: [],
        hiddenEffects: 0, hiddenConditions: 0,
    };
    if (opts.isBarrage) rows.tags.push('탄막');
    if (!entry) return rows;

    const byRecipient = new Map();
    // Chance is part of the key, not a skill-level note: 10940's 회피 is certain
    // while the fire it lights is a 1% roll, so one shared label would advertise
    // the whole skill as 1%.
    const groupFor = (codes, side, chance) => {
        const names = targetNames(codes);
        const key = `${side}|${names.join('/')}|${chance || ''}`;
        let group = byRecipient.get(key);
        if (!group) {
            group = {
                targets: names, side, effects: [], tags: [],
                chance: chance ? chanceLabel(chance) : '',
                rank: targetRank(codes),
            };
            byRecipient.set(key, group);
            rows.groups.push(group);
        }
        return group;
    };

    for (const effect of (entry.e || [])) {
        const label = attrLabel(effect.a, ctx);
        if (!label) {
            rows.hiddenEffects += 1;
            continue;
        }
        const group = groupFor(effect.g, effect.s, effect.ch);
        // Flag attrs (무적, 완전 회피) are always 1 — the label IS the effect, and
        // a value would read as "무적 ▲ 100.0%".
        if (effect.f) {
            group.effects.push({ label, direction: 'up', value: '' });
            continue;
        }
        const values = Array.isArray(effect.v) ? effect.v : [effect.v];
        const up = values[values.length - 1] > 0;
        group.effects.push({
            label,
            // The arrow states direction plainly; a bare signed number reads as
            // a stat, not as "this goes up".
            direction: up ? 'up' : 'down',
            value: formatValue(values.map(Math.abs), Boolean(effect.p)),
        });
    }

    for (const tag of (entry.t || [])) {
        const name = EFFECT_TAG_NAMES[tag.n];
        if (!name) {
            rows.hiddenEffects += 1;
            continue;
        }
        // The ratio sizes the tagged effect rather than gating it, so a heal
        // reads "회복 1.0%" — the number the KR text quotes. `b` names the HP it
        // is a percentage OF, and is present only when that is not the default
        // (the recipient's own max HP).
        const base = HP_BASE_NAMES[tag.b];
        const text = tag.v
            ? `${name} ${formatValue(tag.v, true)}${base ? ` (${base})` : ''}`
            : name;
        const group = groupFor(tag.g, tag.s, tag.ch);
        if (!group.tags.includes(text)) group.tags.push(text);
    }

    rows.groups.sort((a, b) => a.rank - b.rank);
    // Only the recipients no group already names — the producer drops the rest.
    rows.targets = targetNames(entry.g);

    // Fleet-count gates come as a LADDER, not as independent conditions: a
    // stacking buff encodes one rung per matching ship — (max 0), (min 1, max 1),
    // (min 2, max 2) — so rendering each rung yields "2척 이상 · 1척 이하", which
    // reads as a contradiction. The reader-facing fact is the threshold at which
    // the skill starts working, so collapse to the smallest positive minimum and
    // let maxTargetNumber go: it is bookkeeping for the same ladder, never an
    // extra gate, and counting it would flag a skill as having conditions it
    // does not have.
    const thresholds = (entry.c || [])
        .filter(c => c.k === 'minTargetNumber' && c.v > 0)
        .map(c => c.v);
    if (thresholds.length) rows.conditions.push(`${Math.min(...thresholds)}척 이상`);

    for (const condition of (entry.c || [])) {
        if (condition.k === 'minTargetNumber' || condition.k === 'maxTargetNumber') continue;
        const build = CONDITION_BUILDERS[condition.k];
        const text = build ? build(condition.v, ctx) : null;
        if (text) {
            if (!rows.conditions.includes(text)) rows.conditions.push(text);
        } else {
            rows.hiddenConditions += 1;
        }
    }

    return rows;
}

const EFFECT_TAG_NAMES = {
    heal: '회복',
    hot: '지속 회복',
    // The engine spends HP as often as it restores it, and the KR text is
    // consistent about which: 차감 (14250, 800730), 소모 (17770), 잃다 (150990).
    // None of the five says 피해, so this is not 자해.
    hpcost: '내구 소모',
    shield: '실드',
    guard: '보호',
    lockhp: '내구 고정',
    reflect: '피해 반사',
    cleanse: '해제',
    summon: '소환',
    slow: '감속',
    stun: '스턴',
    zone: '장판',
    dot: '지속 피해',
    proficiency: '숙련도',
    weapon: '무장 추가',
    aircraft: '함재기',
    bullet: '탄 속성',
    sonar: '소나',
    cloak: '은폐',
};

// Which HP a tag's percentage is measured against. The default — the
// recipient's own max HP — is unmarked, so only 27 rows carry one of these.
// The distinction is the KR text's own: 즈이호's 150400 spells out "회복량은
// 즈이호의 내구 최대치의 1%" for its 선봉 clause and "대상 함선의" for its 주력
// one, which would otherwise render as two identical 회복 1.0% chips.
const HP_BASE_NAMES = {
    c: '시전자 내구 기준',
    n: '현재 내구 기준',
};

/** True when there is nothing worth rendering for this skill. */
export function isEmptyTagRows(rows) {
    return !rows.groups.length && !rows.targets.length
        && !rows.conditions.length && !rows.tags.length;
}
