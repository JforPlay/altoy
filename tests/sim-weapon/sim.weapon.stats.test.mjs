import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    weaponCooldownSeconds,
    computeBarrageStats,
    formatSkillDesc,
    targetChoiceAimsAtEnemy,
    airdropExplodeBase,
} from '../../public/js/simulators/sim.weapon.stats.js';

// ===== weaponCooldownSeconds =====

test('weaponCooldownSeconds matches the game formula at default load speed', () => {
    // reload_max 240 @ loadSpeed 100 → 240/6/sqrt(200*3.14) ≈ 1.596s
    const cd = weaponCooldownSeconds(240);
    assert.ok(Math.abs(cd - 1.596) < 0.01, `expected ~1.60, got ${cd}`);
});

test('weaponCooldownSeconds decreases as load speed rises', () => {
    assert.ok(weaponCooldownSeconds(240, 150) < weaponCooldownSeconds(240, 100));
});

test('weaponCooldownSeconds returns null for missing reload', () => {
    assert.equal(weaponCooldownSeconds(0), null);
    assert.equal(weaponCooldownSeconds(undefined), null);
});

// ===== computeBarrageStats =====

const stores = (barrages) => ({ barrageData: barrages, bulletData: {} });

test('single barrage: total = (senior+1) * (primal+1)', () => {
    const weapon = { barrage_ID: [10], bullet_ID: [1] };
    const barrages = { 10: { primal_repeat: 4, senior_repeat: 2, delay: 0.05, senior_delay: 0.3, delta_angle: 3, random_angle: false } };
    const s = computeBarrageStats(weapon, stores(barrages));
    assert.equal(s.waves, 3);
    assert.equal(s.bulletsPerWave, 5);
    assert.equal(s.totalBullets, 15);
    assert.equal(s.scatterAngle, 12);   // |3| * 4
    assert.equal(s.patternCount, 1);
    assert.equal(s.uniform, true);
});

test('quota overrides senior_repeat for wave count', () => {
    const weapon = { barrage_ID: [1], bullet_ID: [1] };
    const barrages = { 1: { primal_repeat: 0, senior_repeat: 5 } };
    const s = computeBarrageStats(weapon, stores(barrages), { quota: 3 });
    assert.equal(s.waves, 3);
    assert.equal(s.bulletsPerWave, 1);
    assert.equal(s.totalBullets, 3);
});

test('multi-pattern uniform sums all patterns', () => {
    const weapon = { barrage_ID: [1, 2], bullet_ID: [1, 2] };
    const barrages = { 1: { primal_repeat: 1 }, 2: { primal_repeat: 1 } };
    const s = computeBarrageStats(weapon, stores(barrages));
    assert.equal(s.totalBullets, 4);
    assert.equal(s.patternCount, 2);
    assert.equal(s.uniform, true);
});

test('multi-pattern non-uniform flags uniform=false', () => {
    const weapon = { barrage_ID: [1, 2], bullet_ID: [1, 2] };
    const barrages = { 1: { primal_repeat: 1 }, 2: { primal_repeat: 3 } };
    const s = computeBarrageStats(weapon, stores(barrages));
    assert.equal(s.totalBullets, 6);    // (1*2) + (1*4)
    assert.equal(s.uniform, false);
});

test('random_angle uses angle as scatter', () => {
    const weapon = { barrage_ID: [1], bullet_ID: [1] };
    const barrages = { 1: { primal_repeat: 2, angle: 30, delta_angle: 5, random_angle: true } };
    const s = computeBarrageStats(weapon, stores(barrages));
    assert.equal(s.scatterAngle, 30);
});

test('no valid barrage returns null', () => {
    assert.equal(computeBarrageStats({ barrage_ID: [99] }, stores({})), null);
});

// ===== formatSkillDesc =====

test('substitutes $n with min~max range', () => {
    const out = formatSkillDesc('$1 확률로 $2 상승', { descGetAdd: [['7.0%', '20.0%'], ['17.0%', '40.0%']] });
    assert.equal(out, '7.0% ~ 20.0% 확률로 17.0% ~ 40.0% 상승');
});

test('collapses to single value when min===max', () => {
    assert.equal(formatSkillDesc('$1 발사', { descGetAdd: [['4', '4']] }), '4 발사');
});

test('does not mangle $10 when $1 exists', () => {
    const add = Array.from({ length: 10 }, (_, i) => [String(i + 1)]);
    assert.equal(formatSkillDesc('$1 그리고 $10', { descGetAdd: add }), '1 그리고 10');
});

test('falls back to descGet when descGetAdd empty (skill 2091 case)', () => {
    const out = formatSkillDesc('$1초마다 발사', { descGetAdd: [], descGet: '35초(Max Lv : 15초)마다 발사' });
    assert.equal(out, '35초(Max Lv : 15초)마다 발사');
});

test('falls back to raw desc when no data', () => {
    assert.equal(formatSkillDesc('$1 효과', {}), '$1 효과');
});

test('empty desc → 설명 없음', () => {
    assert.equal(formatSkillDesc('', {}), '설명 없음');
});

// ===== targetChoiceAimsAtEnemy =====
// Skill weapons fire via SingleFire, which aims iff the skill resolved an enemy
// target — NOT by weapon.aim_type. "Harm" target choices select enemies.

test('TargetNil / TargetNull / null / undefined → forward (no aim)', () => {
    assert.equal(targetChoiceAimsAtEnemy('TargetNil'), false);
    assert.equal(targetChoiceAimsAtEnemy('TargetNull'), false);
    assert.equal(targetChoiceAimsAtEnemy(null), false);
    assert.equal(targetChoiceAimsAtEnemy(undefined), false);
    assert.equal(targetChoiceAimsAtEnemy(''), false);
});

test('Harm family → aim at enemy', () => {
    for (const tc of ['TargetHarmNearest', 'TargetHarmFarthest', 'TargetHarmRandom', 'TargetHarmRandomByWeight']) {
        assert.equal(targetChoiceAimsAtEnemy(tc), true, tc);
    }
});

test('comma-joined combos containing Harm → aim', () => {
    assert.equal(targetChoiceAimsAtEnemy('TargetAllHarm,TargetShipTag'), true);
    assert.equal(targetChoiceAimsAtEnemy('TargetAllHarm,TargetShipTag,TargetRandom'), true);
    assert.equal(targetChoiceAimsAtEnemy('TargetShipTag,TargetHarmRandomByWeight'), true);
    assert.equal(targetChoiceAimsAtEnemy('TargetAllHarm,TargetLowestHP'), true);
});

test('self / ally / bare same-IFF tag → forward', () => {
    assert.equal(targetChoiceAimsAtEnemy('TargetSelf'), false);
    assert.equal(targetChoiceAimsAtEnemy('TargetPlayerFlagShip'), false);
    assert.equal(targetChoiceAimsAtEnemy('TargetShipTag'), false);
});

test('Amagi 봉황의 연으로 부익하리 (skill 150480, TargetNil) fires forward', () => {
    // The bug report: aim_type=1 weapon, but the skill resolves no target → forward.
    assert.equal(targetChoiceAimsAtEnemy('TargetNil'), false);
});

// ===== airdropExplodeBase =====
// A skill-fired bomb lands on the resolved target, else forward-from-host
// (battlebulletdatafunction.lua _createBombBullet EqualZero() fallback) — the
// same target_choise resolution as the launch aim, NOT weapon.aim_type.

const HOST = { x: -105, y: 58 };   // mainfleet (backline) game pos; sim y = game depth
const ENEMY = { x: 15, y: 72 };

test('aimAtEnemy with an enemy → explode at the enemy', () => {
    const p = airdropExplodeBase({ aimAtEnemy: true, host: HOST, enemy: ENEMY, range: 90 });
    assert.deepEqual(p, { x: 15, y: 72 });
});

test('no target (forward) → host + range·direction, host depth', () => {
    // 소비에츠카야 러시아 wid 69081: backline host, range 80 → −105 + 80 = −25.
    const p = airdropExplodeBase({ aimAtEnemy: false, host: HOST, enemy: ENEMY, range: 80 });
    assert.deepEqual(p, { x: -25, y: 58 });
});

test('forward is a FIXED distance, independent of the enemy position', () => {
    const near = airdropExplodeBase({ aimAtEnemy: false, host: HOST, enemy: { x: 5, y: 60 }, range: 90 });
    const far = airdropExplodeBase({ aimAtEnemy: false, host: HOST, enemy: { x: 80, y: 40 }, range: 90 });
    assert.deepEqual(near, far);                 // enemy moved, drop point did not
    assert.deepEqual(near, { x: -15, y: 58 });
});

test('볼가-style aim_type=1 but TargetNil → forward (helper sees only aimAtEnemy)', () => {
    // 볼가 wid 64981: aim_type=1 yet target_choise=TargetNil ⇒ aimAtEnemy=false.
    const p = airdropExplodeBase({ aimAtEnemy: false, host: HOST, enemy: ENEMY, range: 90 });
    assert.deepEqual(p, { x: -15, y: 58 });
});

test('targetFixX/Z override both target and forward', () => {
    const p = airdropExplodeBase({ aimAtEnemy: true, host: HOST, enemy: ENEMY, range: 90, targetFixX: 7, targetFixZ: 33 });
    assert.deepEqual(p, { x: 7, y: 33 });
});

test('direction -1 fires the forward drop to the left', () => {
    const p = airdropExplodeBase({ aimAtEnemy: false, host: { x: 50, y: 58 }, enemy: ENEMY, range: 90, direction: -1 });
    assert.deepEqual(p, { x: -40, y: 58 });
});

test('aimAtEnemy but no enemy resolved → forward fallback', () => {
    // Harm choice that found nothing alive → game falls back to forward, not (0,0).
    const p = airdropExplodeBase({ aimAtEnemy: true, host: HOST, enemy: null, range: 100 });
    assert.deepEqual(p, { x: -5, y: 58 });
});

test('missing range defaults to 0 → drop at host', () => {
    const p = airdropExplodeBase({ aimAtEnemy: false, host: HOST, enemy: ENEMY });
    assert.deepEqual(p, { x: -105, y: 58 });
});
