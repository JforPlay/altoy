import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const KINDS = new Set(['count', 'timer', 'fire', 'air', 'once']);
const data = JSON.parse(readFileSync(new URL('../../public/data/sim/fleet_sim_barrages.json', import.meta.url)));
const ships = JSON.parse(readFileSync(new URL('../../public/data/ship_info_data.json', import.meta.url)));
const displayed = new Set(Object.values(ships).flatMap((s) => Object.keys(s.skill || {})));

// The table has two scopes: the skills a ship DISPLAYS and the ones its 전용 장비
// grants, which are unreachable from `ship.skill`. 89 of the latter have no
// `skill_data_template` entry, so there is no KR name to carry — that is honest
// data, and a label fallback belongs in the browser, which knows the ship and the
// weapon the record came from. A displayed skill must still be named.
test('every record carries a weapon and a known trigger kind, and every displayed one a name', () => {
  const ids = Object.keys(data);
  assert.ok(ids.length > 400, `expected a few hundred barrage skills, got ${ids.length}`);
  for (const [sid, rec] of Object.entries(data)) {
    assert.equal(typeof rec.n, 'string', `${sid} has no name field`);
    if (displayed.has(sid)) assert.ok(rec.n, `${sid} is a displayed skill with no KR name`);
    assert.ok(Array.isArray(rec.w) && rec.w.length > 0, `${sid} fires no weapon`);
    assert.ok(KINDS.has(rec.t?.k), `${sid} has unknown kind ${rec.t?.k}`);
  }
});

test('each kind carries the fields its rate model needs', () => {
  for (const [sid, rec] of Object.entries(data)) {
    const t = rec.t;
    if (t.k === 'count') assert.ok(t.n > 0, `${sid} count without a threshold`);
    if (t.k === 'timer' || t.k === 'fire') {
      assert.ok(typeof t.d === 'number', `${sid} ${t.k} without a first-cast time`);
    }
    // A `timer` with n = 0 makes barrage.js floor(window / n) = Infinity, so the
    // fleet total becomes Infinity and the clear-check reads "격파 예상 0.0초 ✓".
    // `typeof n === 'number'` let that through. A `fire` n = 0 is legitimate and
    // common (38 records: no cooldown, one barrage per salvo) and is safe — its
    // period is n + gap/p, and gap > 0.
    if (t.k === 'timer') assert.ok(t.n > 0, `${sid} timer period must be positive, got ${t.n}`);
    if (t.k === 'fire') assert.ok(typeof t.n === 'number' && t.n >= 0, `${sid} fire cooldown must be >= 0`);
    if (rec.p != null) assert.ok(rec.p > 0 && rec.p < 10000, `${sid} p should be omitted at 10000`);
    if (rec.q != null) assert.ok(Number.isInteger(rec.q) && rec.q > 0, `${sid} quota must be a positive integer`);
    if (t.a != null) assert.ok(t.a === 'cannon' || t.a === 'torpedo' || t.a === 'air',
      `${sid} weapon class must be an engine attack attribute, got ${t.a}`);
    if (t.life != null) assert.ok(t.life > 0, `${sid} holder lifetime must be positive`);
  }
});

test('the canonical cadences survived the pipeline', () => {
  assert.deepEqual(data['29081'].t, { k: 'count', n: 15, slots: [1] }, '재블린I: 주포 15회마다');
  assert.equal(data['108090'].t.n, 10, '핫스: 주포 10회마다');
  assert.equal(data['11000'].t.n, 20, '워싱턴: 매 20초 (re-arm chase)');
});

// A `fire` trigger names the weapon class it watches, and a record that does not
// carry it counts EVERY slot's salvos: a destroyer's main gun toward a torpedo
// trigger, a battleship's 부포 toward the 전함 주포 charge trigger beside it.
test('every fire record says which weapon class its trigger watches', () => {
  for (const [sid, rec] of Object.entries(data)) {
    if (rec.t.k !== 'fire') continue;
    assert.ok(rec.t.a || (rec.t.slots && rec.t.slots.length),
      `${sid} ${rec.n}: a fire record must name its weapon class (t.a) or its slots`);
  }
  assert.equal(data['15920'].t.a, 'torpedo', 'Z16 부설 작업: 어뢰 공격 시마다');
  assert.equal(data['15920'].q, 4, 'Z16 부설 작업: 1~4번째 — the holder self-cancels at 4');
  assert.deepEqual(data['10320'].t.slots, [1], 'BIG SEVEN: the 전함 주포, not the 부포 beside it');
  assert.equal(data['17120'].t.life, 30, '나토리: 전투 시작 후 30초 안에');
});
