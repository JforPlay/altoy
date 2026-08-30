import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { expandBarrageSkillIds } from '../../public/js/simulators/fleet-sim.damage.js';

const graph = JSON.parse(readFileSync(new URL('../../public/data/sim/fleet_sim_graph.json', import.meta.url)));
const ships = JSON.parse(readFileSync(new URL('../../public/data/ship_info_data.json', import.meta.url)));
const has = (id) => !!graph.b[String(id)];
const byName = (n) => Object.values(ships).find((s) => s.name === n);

// 알자스 150020 is the case the rule was written for: a passive with no
// `skill_150020` entry at all, whose barrage the old table could only reach through
// `attached_weapon_skill_id`. The simulator starts at `buff_150020` and walks to
// 150021/150022/150025/150026 by itself, so under the graph presence test she needs
// no expansion — and installing 150021 as its own root would fire it twice.
test('a root the simulator knows is left alone', () => {
  const alsace = byName('알자스');
  assert.ok(alsace, '알자스 left the roster');
  assert.ok(graph.b['150020'], '150020 lost its buff node');
  assert.equal(!!graph.s['150020'], false, '150020 is not itself a firing skill');
  assert.deepEqual(expandBarrageSkillIds(alsace, ['150020'], has), ['150020']);
});

// An attached id is NOT filtered by supersession, so appending one unconditionally
// re-installs a rung liveSkillIds correctly dropped. 위치타·META lists 801301 (LB1)
// beside 801302 (LB3) and both count `countType 801300`, at 12 and 8 — installed
// together the lower threshold trips first and resets the shared counter, taking the
// live rung from 3.00 activations to 6.00 and adding a phantom 801301 row. Same
// corruption as 아일윈 20011/20012.
test('a superseded attached rung is never appended to the live set', () => {
  const wichita = byName('위치타·META');
  assert.ok(wichita, '위치타·META left the roster');
  assert.equal(wichita.skill['801301'].upgrade, 801302, 'the chain 801301 → 801302 moved');
  assert.equal(graph.b['801301'].e[0].a.countType, graph.b['801302'].e[0].a.countType,
    'the two rungs must still share a countType for this test to mean anything');
  assert.deepEqual(expandBarrageSkillIds(wichita, ['801290', '801302'], has), ['801290', '801302']);
});

test('a root the simulator does not know falls through to the attached ids it does', () => {
  const ship = { skill: { 999: { attached_weapon_skill_id: [{ id: '150021' }, { id: 9992 }] } } };
  assert.deepEqual(expandBarrageSkillIds(ship, ['999'], has), ['150021'],
    'the id with no buff node is dropped, the one with a node replaces the parent');
});

// Letting each unresolvable attached id count itself reported "탄막 3개" for one skill
// the card lists once, so the parent survives as exactly one 미구현 unit.
test('an unresolvable attached id falls back to its parent, not to itself', () => {
  const ship = { skill: { 999: { attached_weapon_skill_id: [{ id: 9991 }, { id: 9992 }] } } };
  assert.deepEqual(expandBarrageSkillIds(ship, ['999'], () => false), ['999']);
});

test('skills with no attached ids pass through unchanged, deduped', () => {
  const bare = { skill: { 111: {}, 222: {} } };
  assert.deepEqual(expandBarrageSkillIds(bare, ['111', '222', '111'], has), ['111', '222']);
  assert.deepEqual(expandBarrageSkillIds(null, [], has), []);
});
