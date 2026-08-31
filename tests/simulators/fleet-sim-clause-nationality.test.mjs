// tests/simulators/fleet-sim-clause-nationality.test.mjs
//
// `target_nationality` is the UNION over a skill's clauses, so using it as the filter for
// every clause scopes each one to the broadest. 소유즈 17600 is the case: 「아군 노스 유니온
// 소속 함선」의 포격·뇌장·항공 in one clause, 「아군 항공모함·경항공모함」이 주는 피해 in the
// other — no nationality at all — so the union [7] withheld the carrier clause from every
// non-노스 유니온 carrier (프리츠 루메이 is 메탈 블러드). WSL fleet_sim_skill_process.py now
// emits a per-clause `nats`; fleet-sim.calc.js `_clauseApplies` prefers it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const passive = JSON.parse(readFileSync(
    new URL('../../public/data/sim/fleet_sim_passive_skills.json', import.meta.url), 'utf8'));
const maxLevel = (r) => r.levels[Object.keys(r.levels).sort((a, b) => +a - +b).pop()];

test('소유즈 17600: the carrier 주는 피해 clause carries no nationality', () => {
    const r = passive['17600'];
    assert.deepEqual(r.target_nationality, [7], 'skill-level union is still 노스 유니온');
    const cv = maxLevel(r).find((a) => a.attr === 'damageRatioBullet' && a.target !== 'self');
    assert.ok(cv, 'the fleet-facing damageRatioBullet clause exists');
    assert.deepEqual(cv.types, [6, 7], 'scoped to 항모/경항모');
    assert.deepEqual(cv.nats, [], 'and to NO nationality — this is what the union was overriding');
    // the 노스 유니온 stat clause must keep its own filter, or the fix has over-corrected
    const nu = maxLevel(r).find((a) => a.attr === 'airPower');
    assert.deepEqual(nu.nats, [7], '항공 clause stays 노스 유니온');
});

test('13240 아이리스의 깃발 splits its two sentences instead of unioning them', () => {
    // 「아군 아이리스 리브레 … 대미지 상승」 vs 「아군 비시아 성좌 … 받는 대미지 감소」.
    const attrs = maxLevel(passive['13240']);
    assert.deepEqual(passive['13240'].target_nationality, [8, 9]);
    const dealt = attrs.find((a) => a.attr === 'damageRatioBullet');
    assert.deepEqual(dealt.nats, [8], '주는 대미지 is the 아이리스 half only');
    assert.ok(attrs.some((a) => JSON.stringify(a.nats) === '[9]'), '비시아 clause survives');
});

test('13230 성재의 Z keeps BOTH nationalities on one clause', () => {
    // It projects the SAME buff_id twice, once per nationality, and the buff_id dedup keeps
    // the first — so the per-clause value must be unioned across every effect adding it, or
    // the 비시아 half is silently dropped.
    const cannon = maxLevel(passive['13230']).find((a) => a.attr === 'cannonPower' && a.target !== 'self');
    assert.deepEqual(cannon.nats, [8, 9]);
});

test('the set of records whose scope actually moves is the reviewed one', () => {
    // Ratchet. Each of these was checked against its KR text: six had a nationality filter
    // that was being IGNORED entirely (the field path never fed the skill-level union), and
    // 17600 is the one that was over-filtered. Move this list only in the commit that earns
    // it, and say which way it went — a silent change here means a buff quietly changed who
    // it reaches. The skill-level union is NOT a superset of the per-clause values: it is
    // accumulated on the direct path only, which is why a plain subset assert cannot work.
    const same = (x, y) => JSON.stringify([...x].sort()) === JSON.stringify([...y].sort());
    const moved = new Set();
    for (const [id, r] of Object.entries(passive)) {
        const union = r.target_nationality || [];
        for (const attrs of Object.values(r.levels || {})) {
            if (!Array.isArray(attrs)) continue;
            for (const a of attrs) {
                if (a.nats === undefined || a.target === 'self') continue;
                if ((union.length > 0) !== (a.nats.length > 0) || !same(union, a.nats)) moved.add(id);
            }
        }
    }
    assert.deepEqual([...moved].sort(),
        ['13240', '13620', '14060', '14402', '150460', '16880', '17600'].sort());
});
