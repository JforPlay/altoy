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
    appearanceArmor, sortAppearances, groupDetail, parseSkillText,
    isStatsUsable, ARMOR_LABELS, SRC_LABELS, TYPE_LABELS,
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

test('groupDetail splits appearances into one section per source, in chip order', () => {
    const apps = [
        { src: 'meta', where: 'T2' },
        { src: 'main', lv: 2, where: '1-1' },
        { src: 'meta', where: 'T10' },
        { src: 'main', lv: 132, where: '15-4' },
    ];
    const groups = groupDetail(apps, null);
    assert.deepEqual(groups.map((g) => g.src), ['main', 'meta']);
    assert.deepEqual(groups[0].rows.map((a) => a.where), ['15-4', '1-1']);
    assert.deepEqual(groups[1].rows.map((a) => a.where), ['T10', 'T2']);
    assert.deepEqual(groups.map((g) => g.skills), [[], []]);
});

test('groupDetail files each skill under its own source, not the boss', () => {
    // 헬레나 is the identity that holds two sets: the META mechanics must not
    // appear over the 한계 챌린지 rows, nor over its plain 일반해역 row.
    const apps = [
        { src: 'main', lv: 2, where: '1-1' },
        { src: 'meta', where: 'T1' },
        { src: 'challenge', where: '황소자리 · 하드' },
    ];
    const skills = [
        { src: 'meta', n: '레이더 스캔·Hacking', d: '…' },
        { src: 'challenge', n: '위협 감지', d: '…' },
        { src: 'meta', n: '「영」 사분면 전개-5%', d: '…' },
    ];
    const groups = groupDetail(apps, skills);
    assert.deepEqual(groups.map((g) => g.src), ['main', 'meta', 'challenge']);
    assert.deepEqual(groups[0].skills, []);
    assert.deepEqual(groups[1].skills.map((s) => s.n), ['레이더 스캔·Hacking', '「영」 사분면 전개-5%']);
    assert.deepEqual(groups[2].skills.map((s) => s.n), ['위협 감지']);
});

test('groupDetail keeps a skill whose source has no appearances', () => {
    // No such boss ships today, but a new skill family must surface rather
    // than vanish because nothing matched its source.
    const groups = groupDetail([{ src: 'main', lv: 2, where: '1-1' }], [{ src: 'siren', n: 'X', d: '…' }]);
    assert.deepEqual(groups.map((g) => g.src), ['main', 'siren']);
    assert.deepEqual(groups[1].rows, []);
    assert.deepEqual(groups[1].skills.map((s) => s.n), ['X']);
});

test('groupDetail tolerates missing lists', () => {
    assert.deepEqual(groupDetail(undefined, undefined), []);
    assert.deepEqual(groupDetail(null, null), []);
});

test('parseSkillText flags <color> spans without carrying the hex through', () => {
    // The value is deliberately dropped: one hex is used across all 82
    // descriptions and it means emphasis, so the sheet picks a themed colour.
    const segs = parseSkillText('실드가 <color=#92fc63>60%</color> 회복된다.');
    assert.deepEqual(segs, [
        { text: '실드가 ', em: false },
        { text: '60%', em: true },
        { text: ' 회복된다.', em: false },
    ]);
    assert.ok(!JSON.stringify(segs).includes('92fc63'));
});

test('parseSkillText handles several spans and preserves newlines', () => {
    const segs = parseSkillText('a<color=#92fc63>1</color>\nb<color=#92fc63>2</color>');
    assert.deepEqual(segs.map((s) => s.text), ['a', '1', '\nb', '2']);
    assert.deepEqual(segs.map((s) => s.em), [false, true, false, true]);
});

test('parseSkillText leaves plain text and empty input intact', () => {
    assert.deepEqual(parseSkillText('평범한 설명'), [{ text: '평범한 설명', em: false }]);
    assert.deepEqual(parseSkillText(''), []);
    assert.deepEqual(parseSkillText(null), []);
});

test('parseSkillText is reusable — the global regex must not keep lastIndex', () => {
    // A /g regex reused across calls silently drops the first match on every
    // other call unless lastIndex is reset.
    const once = parseSkillText('x<color=#92fc63>hit</color>');
    assert.deepEqual(parseSkillText('x<color=#92fc63>hit</color>'), once);
    assert.deepEqual(parseSkillText('x<color=#92fc63>hit</color>'), once);
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
