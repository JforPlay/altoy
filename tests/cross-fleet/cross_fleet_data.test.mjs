import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const rows = JSON.parse(readFileSync('public/data/sim/cross_fleet_skills.json', 'utf-8'));

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
