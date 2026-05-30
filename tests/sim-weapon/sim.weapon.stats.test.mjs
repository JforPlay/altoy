import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    weaponCooldownSeconds,
    computeBarrageStats,
    formatSkillDesc,
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
