import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const KINDS = new Set(['count', 'timer', 'fire', 'air', 'once']);
const data = JSON.parse(readFileSync(new URL('../../public/data/sim/fleet_sim_barrages.json', import.meta.url)));

test('every record carries a name, at least one weapon, and a known trigger kind', () => {
  const ids = Object.keys(data);
  assert.ok(ids.length > 400, `expected a few hundred barrage skills, got ${ids.length}`);
  for (const [sid, rec] of Object.entries(data)) {
    assert.ok(rec.n && typeof rec.n === 'string', `${sid} has no KR name`);
    assert.ok(Array.isArray(rec.w) && rec.w.length > 0, `${sid} fires no weapon`);
    assert.ok(KINDS.has(rec.t?.k), `${sid} has unknown kind ${rec.t?.k}`);
  }
});

test('each kind carries the fields its rate model needs', () => {
  for (const [sid, rec] of Object.entries(data)) {
    const t = rec.t;
    if (t.k === 'count') assert.ok(t.n > 0, `${sid} count without a threshold`);
    if (t.k === 'timer' || t.k === 'fire') {
      assert.ok(typeof t.n === 'number', `${sid} ${t.k} without a period`);
      assert.ok(typeof t.d === 'number', `${sid} ${t.k} without a first-cast time`);
    }
    if (rec.p != null) assert.ok(rec.p > 0 && rec.p < 10000, `${sid} p should be omitted at 10000`);
  }
});

test('the canonical cadences survived the pipeline', () => {
  assert.deepEqual(data['29081'].t, { k: 'count', n: 15, slots: [1] }, '재블린I: 주포 15회마다');
  assert.equal(data['108090'].t.n, 10, '핫스: 주포 10회마다');
  assert.equal(data['11000'].t.n, 20, '워싱턴: 매 20초 (re-arm chase)');
});
