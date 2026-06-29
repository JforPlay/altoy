/**
 * gid-resolve.test.mjs
 * Ship-group-id → skin-character-name resolution (public/js/skin/skin.gid.js).
 *
 * Regression guard for the Admiral Hipper bug: the skin index keys the base ship
 * under an upstream-typo spelling (아드미럴 히퍼, 럴) while ship_info / the link use
 * the canonical 아드미랄 히퍼 (랄). Name matching therefore fell through to the
 * same-prefix 아드미랄 히퍼·META — a DIFFERENT ship. Resolving by stable gid fixes it.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { buildGidMap, resolveCharByGid } from '../../public/js/skin/skin.gid.js';
import { normalizeRomanNumerals } from '../../public/js/utils.js';

const here = dirname(fileURLToPath(import.meta.url));
const skinIndex = JSON.parse(
    readFileSync(join(here, '../../public/data/skin/skin_voiceline_index.json'), 'utf8')
);

// Which character key owns the skin with this clientId? (raw key, normalized to
// match buildGidMap's output — robust to the upstream 럴→랄 spelling correction.)
function ownerKeyOf(clientId) {
    const hit = Object.entries(skinIndex.characters).find(
        ([, e]) => Array.isArray(e.skins) && e.skins.some(s => Number(s.clientId) === clientId)
    );
    return hit ? normalizeRomanNumerals(hit[0]) : null;
}

test('gid resolves a ship to the character that OWNS that skin id, never a same-prefix variant', () => {
    const map = buildGidMap(skinIndex.characters);

    const baseKey = ownerKeyOf(403010);   // base Admiral Hipper (gid 40301), default skin
    const metaKey = ownerKeyOf(9703050);  // Admiral Hipper·META (gid 970305) — a different ship
    assert.ok(baseKey && metaKey && baseKey !== metaKey, 'fixture sanity: base and META are distinct keys');

    // The bug: base Hipper must resolve to the base ship, NOT the ·META unit.
    assert.equal(resolveCharByGid(map, 40301), baseKey);
    assert.notEqual(resolveCharByGid(map, 40301), metaKey);
    assert.equal(resolveCharByGid(map, 970305), metaKey);
});

test('gid distinguishes all three Hipper ships (base / μ장비 / META)', () => {
    const map = buildGidMap(skinIndex.characters);
    assert.equal(resolveCharByGid(map, 40301), ownerKeyOf(403010));   // base
    assert.equal(resolveCharByGid(map, 40307), ownerKeyOf(403070));   // μ-equip
    assert.equal(resolveCharByGid(map, 970305), ownerKeyOf(9703050)); // META
});

test('unknown / malformed gid returns "" so the caller falls back to name matching', () => {
    const map = buildGidMap(skinIndex.characters);
    assert.equal(resolveCharByGid(map, 99999999), '');
    assert.equal(resolveCharByGid(map, ''), '');
    assert.equal(resolveCharByGid(map, null), '');
    assert.equal(resolveCharByGid(map, undefined), '');
    assert.equal(resolveCharByGid(map, 'not-a-number'), '');
});

test('a gid string (as it arrives from a URL param) resolves the same as the number', () => {
    const map = buildGidMap(skinIndex.characters);
    assert.equal(resolveCharByGid(map, '40301'), resolveCharByGid(map, 40301));
});

test('cross-data invariant: gid resolution never diverges from an exact name match', () => {
    // Guards the whole name-vs-id bug class. For every ship in ship_info, if its
    // name IS an exact skin-index key, resolving by its gid must reach the SAME
    // character. gid may RESCUE ships whose name has no exact key (spelling drift),
    // but it must never send an exact-named ship to a different entity.
    const ships = JSON.parse(
        readFileSync(join(here, '../../public/data/ship_info_lite.json'), 'utf8')
    );
    const exactKeys = new Set(
        Object.keys(skinIndex.characters).map(n => normalizeRomanNumerals(n)).filter(Boolean)
    );
    const map = buildGidMap(skinIndex.characters);

    const diverged = [];
    for (const s of ships) {
        const name = String(s.name ?? '').trim();         // viewer matches raw name vs normalized keys
        const exact = exactKeys.has(name) ? name : '';
        const byGid = resolveCharByGid(map, s.gid);
        if (exact && byGid && exact !== byGid) {
            diverged.push(`"${s.name}" gid=${s.gid}: name→"${exact}" vs gid→"${byGid}"`);
        }
    }
    assert.deepEqual(diverged, [], `gid diverged from exact name:\n  ${diverged.join('\n  ')}`);
});
