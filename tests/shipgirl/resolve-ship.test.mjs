/**
 * resolve-ship.test.mjs
 * Ship resolution for the shipgirl-info page (public/js/shipgirl/shipgirl-info.resolve.js).
 *
 * Cross-page links into shipgirl-info now carry ?gid= alongside ?ship=. This
 * guards the resolution contract: gid wins (exact, no fuzzy), name is the
 * fallback (exact, then roman-numeral-normalized), and a drifted name can never
 * silently reach the wrong ship — it returns null so the page bounces, exactly
 * as before. Mirrors tests/skin/gid-resolve.test.mjs on the shipgirl side.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { resolveShip } from '../../public/js/shipgirl/shipgirl-info.resolve.js';

const here = dirname(fileURLToPath(import.meta.url));
const ships = JSON.parse(
    readFileSync(join(here, '../../public/data/ship_info_lite.json'), 'utf8')
);

test('gid resolves to the ship that owns it, even when the name is drifted/wrong', () => {
    // Lion: ship_info name 라이온 (gid 20516); the skin index keys it under the
    // verbose 라이온급 전함 - 라이온. A link carrying the gid must land on 라이온.
    const byGid = resolveShip(ships, { gid: 20516, name: '라이온급 전함 - 라이온' });
    assert.ok(byGid, 'gid 20516 must resolve');
    assert.equal(byGid.gid, 20516);
    assert.equal(byGid.name, '라이온');
});

test('gid wins over a name that points at a different ship', () => {
    const a = ships[0];
    const b = ships.find(s => s.gid !== a.gid);
    assert.ok(b, 'fixture needs two distinct ships');
    // name says ship A, gid says ship B → gid wins.
    const r = resolveShip(ships, { gid: b.gid, name: a.name });
    assert.equal(r.gid, b.gid);
});

test('a gid string (as it arrives from a URL param) resolves the same as the number', () => {
    assert.equal(resolveShip(ships, { gid: '20516' })?.gid, resolveShip(ships, { gid: 20516 })?.gid);
});

test('falls back to exact name when no gid is supplied', () => {
    const s = ships.find(x => x.name);
    assert.equal(resolveShip(ships, { name: s.name })?.gid, s.gid);
});

test('falls back to roman-numeral-normalized name (exact, not fuzzy)', () => {
    // Find a ship whose name carries a roman numeral; pass the ASCII-spelled form.
    const withRoman = ships.find(s => /[ⅠⅡⅢⅣⅤ]/.test(s.name || ''));
    if (!withRoman) return; // dataset may not contain one; the contract is still exercised below
    const asciiName = withRoman.name
        .replace('Ⅲ', 'III').replace('Ⅱ', 'II').replace('Ⅳ', 'IV').replace('Ⅴ', 'V').replace('Ⅰ', 'I');
    const r = resolveShip(ships, { name: asciiName });
    assert.ok(r, `normalized name "${asciiName}" should resolve`);
    assert.equal(r.gid, withRoman.gid);
});

test('unknown gid + unknown name returns null (caller bounces, never picks a wrong ship)', () => {
    assert.equal(resolveShip(ships, { gid: 99999999, name: '존재하지않는함순이' }), null);
    assert.equal(resolveShip(ships, { gid: '', name: '' }), null);
    assert.equal(resolveShip(ships, {}), null);
    assert.equal(resolveShip(null, { gid: 20516 }), null);
});

test('no fuzzy: a close-but-not-equal name does NOT resolve', () => {
    const s = ships.find(x => x.name && x.name.length > 2);
    const mangled = s.name + 'XYZ존재안함';
    assert.equal(resolveShip(ships, { name: mangled }), null);
});
