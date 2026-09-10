/**
 * Shape guard over the committed CN preview file (public/data/preview/cn_preview.json).
 * The page renders it as-is, so a field the pipeline stops emitting would show as
 * blank cards, not as an error. Reads the committed master only (never a data:split artifact).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const doc = JSON.parse(readFileSync(new URL('../../public/data/preview/cn_preview.json', import.meta.url), 'utf8'));

test('document header', () => {
    assert.match(doc.cn_version, /^\d+\.\d+\.\d+$/);
    assert.match(doc.kr_version, /^\d+\.\d+\.\d+$/);
    assert.match(doc.built, /^\d{4}-\d{2}-\d{2}$/);
    assert.ok(Array.isArray(doc.ships) && Array.isArray(doc.skins));
});

test('ship records carry the fields the cards read', () => {
    for (const s of doc.ships) {
        assert.equal(typeof s.gid, 'number');
        assert.ok(['UR', 'SSR', 'SR', 'R', 'N'].includes(s.rarity), `${s.gid} rarity ${s.rarity}`);
        assert.notEqual(s.nationality, 102, `${s.gid} is bilibili — denylist broke`);
        assert.ok(s.tiers.length >= 1 && s.tiers[0].attrs.length === 12);
        assert.ok(s.skills.every((k) => typeof k.name === 'string' && typeof k.desc === 'string'));
        assert.deepEqual(Object.keys(s.images).sort(), ['chibi', 'icon', 'painting', 'painting_n', 'qicon', 'shipyard']);
    }
});

test('skin records carry the fields the cards read', () => {
    for (const k of doc.skins) {
        assert.equal(typeof k.id, 'number');
        // Usually skin id = gid × 10 + index, but 3 of the CN skins sit in the
        // +3000 alternate block (标枪 231211 → 20121, 幽影徘徊之夜 237031 → 20703,
        // 薯条 431231 → 40123 — each verified against the KR roster name). Accept
        // both so the guard still catches a genuinely broken dex → gid join.
        assert.ok([0, 3000].includes(Math.floor(k.id / 10) - k.gid), `${k.id} gid mismatch (${k.gid})`);
        assert.ok(![101171, 201211].includes(k.id), `${k.id} is on the denylist`);
        assert.ok(Array.isArray(k.tags) && Array.isArray(k.voices));
        for (const v of k.voices) {
            assert.ok(v.text || v.audio, `${k.id}/${v.key} has neither text nor audio`);
            assert.doesNotMatch(v.text, /\{namecode:/, `${k.id}/${v.key} unresolved namecode`);
        }
    }
});
