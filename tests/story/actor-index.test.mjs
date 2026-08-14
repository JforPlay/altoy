/**
 * actor-index.test.mjs
 * Pure character → memories index builder behind /story-viewer/story-search/.
 * Fixture-driven on purpose: the emitted story_actor_index.json is a data:split
 * artifact (git-ignored), and CI runs `npm test` before `npm run build`.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { collectActorIds, characterKey, baseNames, buildActorIndex } from '../../scripts/story-actor-index.mjs';

const ACTORS = {
    107060: { name: '엔터프라이즈' },
    107061: { name: '엔터프라이즈 (수영복)' },
    302140: { name: '아야나미' },
    900190: { name: '엔터프라이즈' },   // story-NPC portrait of the same ship
    900199: { name: '워스파이트' },     // …and an unrelated character 9 ids away
    900284: { name: '네비게이터-TB' },
};

// ===== collectActorIds =====

test('collects speaking actors, ignoring narration and the Commander', () => {
    const ids = collectActorIds([
        { actor: 107060, say: '출격.' },
        { say: '조용한 밤이었다.' },
        { actor: 0, say: '지휘관 대사' },
    ]);
    assert.deepEqual([...ids], [107060]);
});

test('counts an actorName override only when it resolves to a known skin', () => {
    const known = (id) => Object.hasOwn(ACTORS, id);
    const ids = collectActorIds([
        { actorName: '302140', say: '…' },
        { actorName: '???', say: '누구세요' },
        { actorName: '999999', say: '알 수 없는 스킨' },
    ], known);
    assert.deepEqual([...ids], [302140]);
});

test('counts non-speaking subActors', () => {
    const ids = collectActorIds([
        { actor: 107060, subActors: [{ actor: 302140 }, { actor: 0 }] },
    ]);
    assert.deepEqual([...ids].sort(), [107060, 302140]);
});

test('tolerates object-shaped scripts and subActors from the pipeline', () => {
    const ids = collectActorIds({
        0: { actor: 107060, subActors: { a: { actor: 302140 } } },
    });
    assert.deepEqual([...ids].sort(), [107060, 302140]);
});

test('tolerates missing and malformed script input', () => {
    assert.equal(collectActorIds(undefined).size, 0);
    assert.equal(collectActorIds([null, 'nope', 42]).size, 0);
});

// ===== characterKey =====

test('groups a ship\'s skins onto its gid', () => {
    assert.equal(characterKey(107060), '10706');
    assert.equal(characterKey(107061), '10706');
});

test('keeps each 9xxxxx story-NPC portrait separate', () => {
    // These are different characters, not skins — dividing by 10 merged them.
    assert.equal(characterKey(900190), 'n900190');
    assert.equal(characterKey(900199), 'n900199');
});

test('treats the 7-digit collab ranges as ordinary skin groups', () => {
    assert.equal(characterKey(10600010), '1060001');
    assert.equal(characterKey(10600011), '1060001');
});

test('the roster rescues real ships that share the 9xxxxx range with NPCs', () => {
    // 905010 장 바르 and 999010 가스코뉴 are ships; 900190 is a portrait. Only the
    // roster tells them apart — the numeric range alone cannot.
    const roster = new Set([90501, 99901]);
    assert.equal(characterKey(905010, roster), '90501');
    assert.equal(characterKey(905011, roster), '90501');
    assert.equal(characterKey(999010, roster), '99901');
    assert.equal(characterKey(900190, roster), 'n900190');
});

// ===== baseNames =====

test('prefers the base skin name over alternate skins of the same ship', () => {
    assert.equal(baseNames(ACTORS)['10706'], '엔터프라이즈');
});

test('falls back to an alternate skin when no base skin exists', () => {
    assert.equal(baseNames({ 107061: { name: '엔터프라이즈 (수영복)' } })['10706'], '엔터프라이즈 (수영복)');
});

test('names a story-NPC portrait from its own entry', () => {
    assert.equal(baseNames(ACTORS)['n900199'], '워스파이트');
});

test('trims upstream trailing spaces so a ship and its NPC portrait merge', () => {
    const names = baseNames({ 305080: { name: '토사 ' }, 900434: { name: '토사' } });
    assert.equal(names['30508'], '토사');
    assert.equal(names['n900434'], '토사');
});

// ===== buildActorIndex =====

const SOURCES = [
    {
        src: 'm', id: 1, name: '청홍의 메아리',
        memories: [
            { id: 620, title: '프롤로그', scripts: [{ actor: 107060 }, { actor: 302140 }] },
            { id: 621, title: '나레이션뿐', scripts: [{ say: '바다가 울었다.' }] },
        ],
    },
    {
        src: 'e', id: 101, name: '「노력, 희망과 계획」',
        memories: [
            { id: 10000, title: '개막', scripts: [{ actor: 107060 }] },
        ],
    },
];

test('indexes memories by ship gid across sources', () => {
    const idx = buildActorIndex(SOURCES, ACTORS);
    assert.equal(idx.v, 1);
    assert.deepEqual(idx.memories, [
        ['m', 1, 620, '프롤로그', '청홍의 메아리'],
        ['e', 101, 10000, '개막', '「노력, 희망과 계획」'],
    ]);
    assert.deepEqual(idx.ships['10706'], [0, 1]);
    assert.deepEqual(idx.ships['30214'], [0]);
    assert.equal(idx.names['10706'], '엔터프라이즈');
});

test('merges a story-NPC portrait into the ship of the same name', () => {
    const idx = buildActorIndex([{
        src: 'm', id: 1, name: '챕터',
        memories: [
            { id: 1, title: '함선으로', scripts: [{ actor: 107060 }] },
            { id: 2, title: 'NPC로', scripts: [{ actor: 900190 }] },
        ],
    }], ACTORS);
    // One 엔터프라이즈, keyed by the real gid so ?gid= stays a site-wide gid.
    assert.deepEqual(Object.values(idx.names).filter((n) => n === '엔터프라이즈'), ['엔터프라이즈']);
    assert.deepEqual(idx.ships['10706'], [0, 1]);
});

test('keeps neighbouring story-NPC ids apart', () => {
    const idx = buildActorIndex([{
        src: 'm', id: 1, name: '챕터',
        memories: [
            { id: 1, title: '엔터', scripts: [{ actor: 900190 }] },
            { id: 2, title: '워스파이트', scripts: [{ actor: 900199 }] },
        ],
    }], ACTORS);
    assert.deepEqual(idx.ships['n900190'], [0]);
    assert.deepEqual(idx.ships['n900199'], [1]);
    assert.equal(idx.names['n900199'], '워스파이트');
});

test('does not merge unnamed characters with each other', () => {
    const idx = buildActorIndex([{
        src: 'm', id: 1, name: '챕터',
        memories: [{ id: 1, title: '회상', scripts: [{ actor: 900501 }, { actor: 900502 }] }],
    }], { 900501: { name: '' }, 900502: { name: '' } });
    assert.equal(Object.keys(idx.ships).length, 2);
});

test('a 9xxxxx ship in the roster keeps its skins together and gets its info', () => {
    const actors = { 905010: { name: '장 바르' }, 905011: { name: '봄의 등불' }, 900190: { name: '엔터프라이즈' } };
    const idx = buildActorIndex([{
        src: 'm', id: 1, name: '챕터',
        memories: [{ id: 1, title: '회상', scripts: [{ actor: 905010 }, { actor: 905011 }, { actor: 900190 }] }],
    }], actors, { 90501: { rarity: 'SSR', faction: '비시아 성좌' } });
    assert.deepEqual(idx.ships['90501'], [0]);
    assert.deepEqual(idx.info['90501'], ['SSR', '비시아 성좌']);
    assert.deepEqual(idx.ships['n900190'], [0]);
});

test('bakes rarity and 진영 for ships, and omits them for story-only NPCs', () => {
    const idx = buildActorIndex([{
        src: 'm', id: 1, name: '챕터',
        memories: [
            { id: 1, title: '함선', scripts: [{ actor: 107060 }] },
            { id: 2, title: 'NPC', scripts: [{ actor: 900284 }] },
        ],
    }], ACTORS, { 10706: { rarity: 'SSR', faction: '이글 유니온' } });
    assert.deepEqual(idx.info['10706'], ['SSR', '이글 유니온']);
    assert.equal(idx.info['n900284'], undefined);
});

test('appends the event subtype only to event rows', () => {
    const idx = buildActorIndex([
        { src: 'e', id: 101, name: '이벤트', subtype: 2, memories: [{ id: 1, title: 'A', scripts: [{ actor: 107060 }] }] },
        { src: 'm', id: 1, name: '챕터', memories: [{ id: 2, title: 'B', scripts: [{ actor: 107060 }] }] },
    ], ACTORS);
    assert.deepEqual(idx.memories[0], ['e', 101, 1, 'A', '이벤트', 2]);
    assert.deepEqual(idx.memories[1], ['m', 1, 2, 'B', '챕터']);
});

test('merges characters whose upstream names differ only by a trailing space', () => {
    const idx = buildActorIndex([{
        src: 'm', id: 1, name: '챕터',
        memories: [{ id: 1, title: '회상', scripts: [{ actor: 306050 }, { actor: 900600 }] }],
    }], { 306050: { name: '토사 ' }, 900600: { name: '토사' } });
    assert.equal(Object.keys(idx.ships).length, 1);
    assert.equal(idx.names['30605'], '토사');
});

test('drops memories with no resolvable character', () => {
    const idx = buildActorIndex(SOURCES, ACTORS);
    assert.equal(idx.memories.length, 2);
    assert.ok(!idx.memories.some(([, , memId]) => memId === 621));
});

test('collapses several skins of one ship in one memory to a single row', () => {
    const idx = buildActorIndex([{
        src: 'm', id: 1, name: '챕터',
        memories: [{ id: 1, title: '회상', scripts: [{ actor: 107060 }, { actor: 107061 }] }],
    }], ACTORS);
    assert.deepEqual(idx.ships['10706'], [0]);
});

test('row references stay valid when a skipped memory sits between kept ones', () => {
    const idx = buildActorIndex([{
        src: 'm', id: 1, name: '챕터',
        memories: [
            { id: 1, title: '첫째', scripts: [{ actor: 107060 }] },
            { id: 2, title: '나레이션', scripts: [{ say: '…' }] },
            { id: 3, title: '셋째', scripts: [{ actor: 107060 }] },
        ],
    }], ACTORS);
    assert.deepEqual(idx.ships['10706'].map((row) => idx.memories[row][2]), [1, 3]);
});
