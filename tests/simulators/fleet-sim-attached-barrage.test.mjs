import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { expandBarrageSkillIds } from '../../public/js/simulators/fleet-sim.damage.js';

const data = JSON.parse(readFileSync(new URL('../../public/data/sim/fleet_sim_barrages.json', import.meta.url)));
const ships = JSON.parse(readFileSync(new URL('../../public/data/ship_info_data.json', import.meta.url)));
const has = (id) => Object.prototype.hasOwnProperty.call(data, String(id));
const byName = (n) => Object.values(ships).find((s) => s.name === n);

// 알자스 150020 is the motivating case: a passive with no `skill_150020` entry at
// all, so the table — keyed by the id that FIRES — can only reach her 주포 공격 시
// barrage through `attached_weapon_skill_id`.
test('a displayed skill with no record resolves through its attached ids', () => {
  const alsace = byName('알자스');
  assert.ok(alsace, '알자스 left the roster');
  assert.equal(has('150020'), false, '150020 is not itself a firing skill');
  assert.ok(has('150021'), '150021 (주포 공격 시 거룩한 심판) lost its record');
  assert.deepEqual(expandBarrageSkillIds(alsace, ['150020'], has), ['150021']);
});

// 괴츠 is the fire-bridge case: `build_fire_adders` gave 152333 a record, so her
// 152330 now resolves. Her four attached ids are [152333, 152333, 152337, 152335] —
// so this also pins the dedup and the drop of the two that still have no record.
test('resolution dedupes and drops attached ids that have no record', () => {
  const goetz = byName('괴츠 폰 베를리힝겐');
  assert.ok(goetz, '괴츠 left the roster');
  assert.equal(has('152330'), false, '152330 is not itself a firing skill');
  assert.ok(has('152333'), '152333 lost the record the fire bridge gave it');
  assert.deepEqual(expandBarrageSkillIds(goetz, ['152330'], has), ['152333']);
});

// Letting each unresolvable attached id count itself reported "탄막 3개" for one
// skill the card lists once. Synthetic on purpose: the real-data fixture for this
// rule rots every time the barrage table grows a record.
test('an attached id with no record falls back to its parent, not to itself', () => {
  const ship = { skill: { 999: { attached_weapon_skill_id: [{ id: 9991 }, { id: 9992 }] } } };
  assert.deepEqual(expandBarrageSkillIds(ship, ['999'], () => false), ['999'],
    'no attached id resolves, so the parent stays and counts as exactly one 미구현');
});

// The pipeline never scoped the attached ids of a skill that resolves under its own
// id, so the browser must not either — they are as often extra volleys of the record
// it already has as separate barrages (키어사지 19681..19685).
test('a skill with its own record keeps it and is not expanded', () => {
  const washington = byName('워싱턴');
  assert.ok(has('11000'), '워싱턴 11000 lost its record');
  assert.ok((washington.skill['11000'].attached_weapon_skill_id || []).length > 0);
  assert.deepEqual(expandBarrageSkillIds(washington, ['11000'], has), ['11000']);
});

test('skills with no attached ids pass through unchanged, deduped', () => {
  const bare = { skill: { 111: {}, 222: {} } };
  assert.deepEqual(expandBarrageSkillIds(bare, ['111', '222', '111'], () => false), ['111', '222']);
  assert.deepEqual(expandBarrageSkillIds(null, [], () => false), []);
});
