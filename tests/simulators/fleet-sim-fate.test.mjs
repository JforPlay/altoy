/**
 * 운명 시뮬레이션 (fate simulation) — the second research-ship gate beside 개조.
 *
 * Five steps, and their WHOLE stat payload is 행운: +1+2+3+4+5 on the 29 SSR
 * research ships, +3+4+5+6+7 on the 4 UR ones. Everything else fate grants is a
 * skill upgrade, which `ship.skill[…].requirement` already carries.
 *
 * The toggle's stat half rests on one coupling: `enhance.luck` exists ONLY on the
 * ships that have fate, so turning fate off means dropping exactly that term. That
 * is a property of the emitted data, not of the code, so it is asserted here — a
 * refresh that starts folding 행운 in from somewhere else would otherwise make the
 * toggle silently subtract a stat the ship keeps.
 *
 * Reads only committed data (never a data:split artifact).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { hasFateSimulation } from '../../public/js/simulators/fleet-sim.damage.js';

const SHIPS = JSON.parse(
    readFileSync(new URL('../../public/data/ship_info_data.json', import.meta.url), 'utf8'));

const fateShips = SHIPS.filter(hasFateSimulation);

test('hasFateSimulation finds the research ships the requirement string names', () => {
    const byString = SHIPS.filter((s) => Object.values(s.skill || {})
        .some((sk) => String(sk.requirement || '').startsWith('Fate Simulation')));
    assert.deepEqual(fateShips.map((s) => s.gid), byString.map((s) => s.gid));
    assert.ok(fateShips.length >= 33, `only ${fateShips.length} fate ships`);
});

test('enhance.luck is exactly the fate ships, at one of the two ladders', () => {
    for (const s of fateShips) {
        const luck = s.enhance?.luck;
        assert.ok(luck === 15 || luck === 25, `gid ${s.gid} enhance.luck ${luck}`);
    }
    for (const s of SHIPS) {
        if (hasFateSimulation(s)) continue;
        assert.ok(!s.enhance?.luck, `gid ${s.gid} carries enhance.luck without fate`);
    }
});

test('every fate skill can fall back to a base rung when the toggle is off', () => {
    // Otherwise 운명 OFF just deletes the skill instead of downgrading it, which is
    // the game's own behaviour only when there is nothing to downgrade to.
    for (const s of fateShips) {
        for (const [sid, sk] of Object.entries(s.skill)) {
            if (!String(sk.requirement || '').startsWith('Fate Simulation')) continue;
            assert.ok(sk.downgrade != null && s.skill[String(sk.downgrade)],
                `gid ${s.gid} skill ${sid} has no base rung`);
        }
    }
});
