import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeClearCheck } from '../../public/js/engine/damage/clear-check.js';

test('clears when ttk within the time limit', () => {
  const r = computeClearCheck({ fleetDps: 2000, bossHp: 54000, timeLimit: 90 });
  assert.equal(r.clears, true);
  assert.ok(Math.abs(r.ttkSeconds - 27) < 1e-9);
  assert.equal(r.hpRemaining, 0);
});

test('does not clear when ttk exceeds the limit; reports leftover HP', () => {
  const r = computeClearCheck({ fleetDps: 2000, bossHp: 300000, timeLimit: 90 });
  assert.equal(r.clears, false);
  assert.ok(Math.abs(r.ttkSeconds - 150) < 1e-9);
  assert.equal(r.hpRemaining, 300000 - 2000 * 90); // 120000
});

test('zero DPS never clears and leaves full HP', () => {
  const r = computeClearCheck({ fleetDps: 0, bossHp: 54000, timeLimit: 90 });
  assert.equal(r.clears, false);
  assert.equal(r.ttkSeconds, Infinity);
  assert.equal(r.hpRemaining, 54000);
});
