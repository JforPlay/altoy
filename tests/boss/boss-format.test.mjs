/**
 * boss-format.test.mjs
 * Pure formatting contract for the boss viewer (public/js/boss-format.js).
 *
 * Guards the rules that are easy to get silently wrong: portrait resolution falls
 * back from skin_qicon to boss_qicon (241 of 379 identities reuse an already
 * published shipgirl asset), a per-appearance armor override beats the identity
 * default (the processor emits one only where they disagree), and Operation Siren
 * rows are never treated as having usable stats.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
    bossPortraitUrl, bossPortraitFallbackUrl, bossPortraitFallbackAttr,
    appearanceArmor, sortAppearances, groupAppearances, isStatsUsable,
    ARMOR_LABELS, SRC_LABELS, TYPE_LABELS,
} from '../../public/js/boss-format.js';

test('portrait uses skin_qicon when the identity resolved to a skin id', () => {
    const url = bossPortraitUrl({ icon: 'ruihe', sid: 307060 });
    assert.ok(url.endsWith('/skin_qicon/307060.webp'), url);
});

test('portrait falls back to boss_qicon keyed by icon when there is no skin id', () => {
    const url = bossPortraitUrl({ icon: 'sairenboss5' });
    assert.ok(url.endsWith('/boss_qicon/sairenboss5.webp'), url);
});

test('portrait is empty rather than a broken URL for a missing identity', () => {
    assert.equal(bossPortraitUrl(null), '');
    assert.equal(bossPortraitUrl(undefined), '');
});

test('a sid-backed portrait falls back to its icon-keyed boss_qicon file', () => {
    // 프로토콜 워페어 "포트리스" resolves to skin 900405, which skin_qicon does
    // not carry — without this it renders a placeholder despite having a portrait.
    const url = bossPortraitFallbackUrl({ icon: 'baolei2', sid: 900405 });
    assert.ok(url.endsWith('/boss_qicon/baolei2.webp'), url);
});

test('no fallback is offered when boss_qicon is already the primary', () => {
    assert.equal(bossPortraitFallbackUrl({ icon: 'sairenboss5' }), '');
    assert.equal(bossPortraitFallbackUrl(null), '');
});

test('the fallback attribute is omitted entirely when there is nothing to try', () => {
    // An empty data-fallback would make the error handler set src="" and abandon
    // the data-onfail hide, so it must not be emitted at all.
    const esc = (s) => s;
    assert.equal(bossPortraitFallbackAttr({ icon: 'sairenboss5' }, esc), '');
    assert.equal(bossPortraitFallbackAttr({ icon: 'baolei2', sid: 900405 }, esc),
        ' data-fallback="https://raw.githubusercontent.com/JforPlay/data_for_toy/main/boss_qicon/baolei2.webp"');
});

test('appearance armor override beats the identity default', () => {
    const identity = { armor: 2 };
    assert.equal(appearanceArmor({ armor: 3 }, identity), 3);
    assert.equal(appearanceArmor({}, identity), 2);
});

test('appearance armor falls back to light when nothing is known', () => {
    assert.equal(appearanceArmor({}, {}), 1);
    assert.equal(appearanceArmor(null, null), 1);
});

test('sortAppearances is descending by level and does not mutate its input', () => {
    const apps = [
        { src: 'main', lv: 57, where: '5-4' },
        { src: 'main', lv: 132, where: '15-4' },
        { src: 'main', lv: 57, where: '1-1' },
    ];
    const sorted = sortAppearances(apps);
    assert.deepEqual(sorted.map((a) => a.where), ['15-4', '5-4', '1-1']);
    assert.equal(apps[0].where, '5-4', 'input array was mutated');
});

test('sortAppearances orders META tiers numerically, not alphabetically', () => {
    // The bug this guards: localeCompare put T10/T11 before T2. META rows carry
    // no level, so the tier label is the only thing left to order by.
    const tiers = [1, 2, 10, 11, 15, 3].map((t) => ({ src: 'meta', where: `T${t}` }));
    assert.deepEqual(
        sortAppearances(tiers).map((a) => a.where),
        ['T15', 'T11', 'T10', 'T3', 'T2', 'T1']
    );
});

test('sortAppearances groups sources in chip order regardless of level', () => {
    // A high-level event row must not jump above a low-level 일반해역 row.
    const apps = [
        { src: 'meta', where: 'T1' },
        { src: 'event', lv: 120, where: 'B2', ev: '어떤 이벤트' },
        { src: 'main', lv: 2, where: '1-1' },
    ];
    assert.deepEqual(sortAppearances(apps).map((a) => a.src), ['main', 'event', 'meta']);
});

test('sortAppearances tolerates an absent list', () => {
    assert.deepEqual(sortAppearances(undefined), []);
    assert.deepEqual(sortAppearances(null), []);
});

test('groupAppearances splits into one run per source, in the same order', () => {
    const apps = [
        { src: 'meta', where: 'T2' },
        { src: 'main', lv: 2, where: '1-1' },
        { src: 'meta', where: 'T10' },
        { src: 'main', lv: 132, where: '15-4' },
    ];
    const groups = groupAppearances(apps);
    assert.deepEqual(groups.map((g) => g.src), ['main', 'meta']);
    assert.deepEqual(groups[0].rows.map((a) => a.where), ['15-4', '1-1']);
    assert.deepEqual(groups[1].rows.map((a) => a.where), ['T10', 'T2']);
});

test('Operation Siren rows are marked stats-unusable, everything else usable', () => {
    assert.equal(isStatsUsable({ src: 'siren', scaled: 1 }), false);
    assert.equal(isStatsUsable({ src: 'main', hp: 455000 }), true);
});

test('every src the processor can emit has a Korean chip label', () => {
    for (const src of ['main', 'hard', 'event', 'archive', 'meta', 'challenge', 'guild', 'siren']) {
        assert.ok(SRC_LABELS[src], `missing label for src "${src}"`);
    }
});

test('armor and ship-type label tables cover the values the data uses', () => {
    assert.deepEqual(Object.keys(ARMOR_LABELS).sort(), ['1', '2', '3']);
    // enemy_data_by_type runs 1..25; the boss data uses 16 of them.
    for (const t of [1, 2, 3, 4, 5, 6, 7, 8, 10, 12, 13, 15, 17, 18, 23, 24]) {
        assert.ok(TYPE_LABELS[t], `missing label for enemy type ${t}`);
    }
});
