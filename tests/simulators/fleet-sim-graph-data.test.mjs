import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const graph = JSON.parse(readFileSync(new URL('../../public/data/sim/fleet_sim_graph.json', import.meta.url)));

// The nine classes that decide WHEN a barrage fires. A class outside this set in
// the published file means the pruner's KEEP_ARGS moved without the sim's dispatch
// table moving with it — the sim would silently ignore it. The two removal classes
// joined in 2026-08-30: they are what BOUNDS a loop (애버크롬비 11300's self-cancel,
// 꼬마 다이호 16800's cleanse at 6 stacks), and battle-sim.js `apply` dispatches both.
const CLASSES = new Set([
  'BattleBuffCastSkill', 'BattleBuffCastSkillRandom', 'BattleBuffAddBuff',
  'BattleBuffCount', 'BattleBuffAddTag', 'BattleSkillFire', 'BattleSkillFireSupport',
  'BattleSkillAddBuff', 'BattleBuffCancelBuff', 'BattleBuffCleanse',
]);

test('the graph is two node tables of pruned effects', () => {
  assert.ok(Object.keys(graph.b).length > 2000, `too few buffs: ${Object.keys(graph.b).length}`);
  assert.ok(Object.keys(graph.s).length > 2000, `too few skills: ${Object.keys(graph.s).length}`);
  for (const [id, node] of Object.entries({ ...graph.b, ...graph.s })) {
    assert.ok(Array.isArray(node.e) && node.e.length, `${id} has no effects`);
    for (const e of node.e) {
      assert.ok(CLASSES.has(e.ty), `${id} carries unknown class ${e.ty}`);
      assert.equal(typeof e.a, 'object', `${id} effect has no arg object`);
    }
  }
});

// The prune keeps only what can reach a weapon, so a kept buff pointing at a
// dropped payload branch is CORRECT, not a dangling edge — the sim returns early
// on an absent node by design. What must hold is soundness in the other
// direction: nothing that fires a weapon may be stranded out of reach of a root.
test('every weapon-firing skill is reachable from some buff in the graph', () => {
  const targeted = new Set();
  for (const node of Object.values(graph.b)) {
    for (const e of node.e) {
      if (e.a.skill_id != null) targeted.add(String(e.a.skill_id));
      for (const s of e.a.skill_id_list || []) targeted.add(String(s));
    }
  }
  for (const node of Object.values(graph.s)) {
    for (const e of node.e) {
      if (e.a.buff_id != null && graph.b[String(e.a.buff_id)]) {
        for (const e2 of graph.b[String(e.a.buff_id)].e) {
          if (e2.a.skill_id != null) targeted.add(String(e2.a.skill_id));
        }
      }
    }
  }
  const stranded = Object.entries(graph.s)
    .filter(([id, n]) => n.e.some((e) => e.ty === 'BattleSkillFire' || e.ty === 'BattleSkillFireSupport'))
    .filter(([id]) => !targeted.has(id) && !graph.b[id])
    .map(([id]) => id);
  assert.deepEqual(stranded.slice(0, 20), [], `${stranded.length} weapon-firing skills unreachable`);
});

test('the canonical roots survived, and no skill was invented', () => {
  for (const id of ['29081', '1011000', '150020', '15290']) {
    assert.ok(graph.b[id], `buff_${id} missing`);
  }
  // 알자스 150020 is a passive the engine applies as buff_150020; there is no
  // skill_150020 in the config and the pruner must not manufacture one.
  assert.equal(graph.s['150020'], undefined);
});

// The graph is fleet-sim's ONLY KR-name source now that fleet_sim_barrages.json is
// gone (deleted in Task 9) — a root buff carries its display name straight off
// skill_data_template.json, keyed by its own seed id (never a borrowed parent name).
test('a root buff node carries its Korean skill name', () => {
  assert.equal(graph.b['29081'].n, '전탄 발사 - 재블린I');
});

// A buff whose only effect stamps a tag reaches no weapon, so a fire-only prune drops
// it — and with it the tag every ship_tag_list gate downstream reads, which then
// silently takes its "tag absent" arm. This is the acceptance check on that closure.
test('most tags a gate reads are stampable by a buff the graph kept', () => {
  const tagsOf = (a) => [].concat(a.tag_list || [], a.tag || []).map(String);
  const required = new Set();
  const stampable = new Set();
  for (const node of [...Object.values(graph.b), ...Object.values(graph.s)]) {
    for (const e of node.e) {
      for (const t of [].concat(e.a.ship_tag_list || [])) required.add(String(t));
      if (e.ty === 'BattleBuffAddTag') for (const t of tagsOf(e.a)) stampable.add(t);
    }
  }
  const covered = [...required].filter((t) => stampable.has(t)).length;
  // 82 of ~202 are ship identity / engine-side and are stamped by nothing anywhere;
  // the rest must be reachable. Anything below half means the closure lost its
  // tag-stamping seed again.
  assert.ok(covered / required.size > 0.5,
    `only ${covered}/${required.size} gate tags are stampable — tag seed lost?`);
});

test('워싱턴 1011000 keeps BOTH cast branches — the record format could hold one', () => {
  const e = graph.b['1011000'].e;
  const casts = e.filter((x) => x.ty === 'BattleBuffCastSkill' && x.a.skill_id === 1011000);
  const adds = e.filter((x) => x.ty === 'BattleBuffAddBuff');
  assert.equal(casts.length, 1, 'the 10s opener cast');
  assert.ok(adds.some((x) => String(x.a.buff_id) === '1011005'), 'the 20s branch-2 adder');
});

// The corpus-level half of the same closure fix. A removal-only buff is kept only
// because its cleanse names a buff that is already live; the two clauses above it
// (reaches a weapon / stamps a tag) both decline it. Before that clause existed only
// 20 survived — the ones that happened to sit on a node kept for another reason —
// against 105 removal-only buffs upstream. A count back near 20 means the closure
// dropped the rule again and every bounded loop those buffs close ran unbounded.
test('removal-only buffs survive the prune when they strip a live buff', () => {
  const REMOVAL = new Set(['BattleBuffCleanse', 'BattleBuffCancelBuff']);
  const removalOnly = Object.entries(graph.b).filter(([, n]) => n.e.every((e) => REMOVAL.has(e.ty)));
  assert.ok(removalOnly.length > 40, `only ${removalOnly.length} removal-only buffs kept`);
  // 드미트리 190006 is the canonical one: its cleanse of the 1s tag holder 190008 is
  // the only thing that closes her onUpdate cast's window.
  const dmitri = graph.b['190006'];
  assert.ok(dmitri, 'buff_190006 missing');
  assert.deepEqual(dmitri.e.map((e) => e.ty), ['BattleBuffCleanse']);
  assert.ok(dmitri.e[0].a.buff_id_list.includes(190008), 'must strip the tag holder 190008');
  assert.ok(graph.b['190008'], 'the buff it strips must itself be live');
});
