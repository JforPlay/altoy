import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { formatSkillDesc } from '../../public/js/simulators/sim.weapon.stats.js';

const rows = JSON.parse(readFileSync('public/data/sim/cross_fleet_skills.json', 'utf-8'));
const skillTpl = JSON.parse(readFileSync('public/data/sim/skill_data_template.json', 'utf-8'));

test('has 33 rows: 25 barrage + 8 buff', () => {
  assert.equal(rows.length, 33);
  assert.equal(rows.filter(r => r.type === 'barrage').length, 25);
  assert.equal(rows.filter(r => r.type === 'buff').length, 8);
});

test('render_kind breakdown 22 bullet / 3 aircraft / 8 none', () => {
  const c = k => rows.filter(r => r.render_kind === k).length;
  assert.equal(c('bullet'), 22);
  assert.equal(c('aircraft'), 3);
  assert.equal(c('none'), 8);
});

test('every barrage has fs_skill_id(s); buffs have none', () => {
  for (const r of rows) {
    if (r.type === 'barrage') assert.ok(Array.isArray(r.fs_skill_id) && r.fs_skill_id.length > 0, `barrage ${r.skill_name} needs fs_skill_id`);
    else assert.equal(r.fs_skill_id.length, 0);
  }
});

test('required fields present', () => {
  for (const r of rows) {
    for (const k of ['player_skill_id','ship_gid','ship_name','faction','skill_name','render_kind','type']) {
      assert.ok(r[k] !== undefined && r[k] !== null && r[k] !== '', `${r.skill_name||r.player_skill_id} missing ${k}`);
    }
  }
});

// trigger_excerpt is a substring of skill_data_template[player_skill_id].desc
// (build_cross_fleet.py:trig_excerpt), so its $n indices map onto that skill's
// desc_get_add. The catalog page must render it through formatSkillDesc — these
// guard that every placeholder resolves (no $n leaks to the UI, no out-of-range index).
test('every player skill has its template (source of $n params)', () => {
  for (const r of rows) {
    assert.ok(skillTpl[String(r.player_skill_id)], `player skill ${r.player_skill_id} (${r.skill_name}) missing from skill_data_template`);
  }
});

test('formatSkillDesc fully resolves every trigger_excerpt — no $n leaks', () => {
  for (const r of rows) {
    const tpl = skillTpl[String(r.player_skill_id)];
    const out = formatSkillDesc(r.trigger_excerpt, { descGetAdd: tpl.desc_get_add });
    assert.ok(!/\$\d/.test(out), `${r.skill_name}: unresolved placeholder in "${out}"`);
  }
});
