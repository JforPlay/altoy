/**
 * chat-script.test.mjs
 * Pure chat-script logic behind JUUS 보기 / 3D숙소 JUUS: the game's branch filter
 * (both modes), reaching a line inside a branch, speaker @handles, and search.
 * Fixtures are the COMMITTED data files — never data:split artifacts.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
    choiceOptions,
    visibleLines,
    picksToReach,
    isGroupChat,
    speakerHandle,
    speakerOf,
    buildSpeakerIndex,
    searchSpeakers,
    searchLines,
    storyHits,
} from '../../public/js/chat-viewer/chat-viewer.script.js';

const readJson = (path) => JSON.parse(readFileSync(new URL(`../../public/data/${path}`, import.meta.url), 'utf8'));
const JUUS = readJson('chat-viewer/juus_chat_data.json');
const DORM = readJson('chat-viewer/dorm3d_data.json');
const USERNAMES = readJson('juustagram_usernames.json');

// 건스웨이 「작은 여행 계획」: choices at script indexes 1 [1,2], 3 [3], 6 [4,5], 15 [6,7,8], 26 [9,10].
const GANJ = JUUS['건스웨이']['1'];
// 템페스타 채팅방 「집무실의 보물?」: flags 3/4 are offered by BOTH index 17 (flag-1 branch) and 24 (flag-2 branch).
const TEMPESTA = JUUS['템페스타 채팅방']['19'];
const DOLPHIN = 960011;

const lineIds = (walk) => walk.items.filter(i => i.type === 'line').map(i => i.line.id);
const range = (a, b) => Array.from({ length: b - a + 1 }, (_, i) => a + i);

test('fixtures are the stories these tests were written against', () => {
    assert.equal(GANJ.name, '작은 여행 계획');
    assert.equal(TEMPESTA.name, '집무실의 보물?');
});

// ===== visibleLines: 재생 =====

test('재생 walk stops at the first unanswered choice', () => {
    const walk = visibleLines(GANJ.scripts, {});
    assert.deepEqual(lineIds(walk), [1, 2]);
    assert.equal(walk.pending.index, 1);
    assert.deepEqual(walk.pending.options.map(([f]) => f), [1, 2]);
});

test('regression: a finished branch does not run on into the unpicked ones', () => {
    // Today's jump-based engine plays lines 11-16 (flag 5, then flag 2) after this path.
    const walk = visibleLines(GANJ.scripts, { 1: 1, 3: 3, 6: 4 });
    assert.deepEqual(lineIds(walk), range(1, 10));
    assert.equal(walk.pending, null);
});

test('the picked reply is a data line, never a second copy of the label', () => {
    const walk = visibleLines(GANJ.scripts, { 1: 1 });
    const player = walk.items.filter(i => i.type === 'line' && i.line.ship_group === 0);
    assert.deepEqual(player.map(i => i.line.param), ['좋아! 가자!']);
});

test('a choice on a sticker line (Juus type 4) stops the 재생 walk', () => {
    for (const data of [JUUS, DORM]) {
        const found = Object.values(data).flatMap(Object.values).map(story => ({
            story, index: story.scripts.findIndex(l => l.type === 4 && choiceOptions(l)),
        })).find(x => x.index >= 0);
        assert.ok(found, 'fixture: a type-4 line with a choice exists');
        const full = visibleLines(found.story.scripts, picksToReach(found.story.scripts, found.index), { full: true });
        const before = Object.fromEntries(full.items
            .filter(i => i.type === 'choice' && i.index < found.index)
            .map(i => [i.index, i.picked]));
        assert.equal(visibleLines(found.story.scripts, before).pending?.index, found.index);
    }
});

// ===== visibleLines: 전체 대본 =====

test('전체 walk takes the first option at every choice and marks each one', () => {
    const walk = visibleLines(GANJ.scripts, {}, { full: true });
    assert.deepEqual(lineIds(walk), range(1, 10));
    const choices = walk.items.filter(i => i.type === 'choice');
    assert.deepEqual(choices.map(c => [c.index, c.picked]), [[1, 1], [3, 3], [6, 4]]);
    assert.equal(walk.pending, null);
});

test('전체 walk follows a picked branch and defaults the choices below it', () => {
    const walk = visibleLines(GANJ.scripts, { 1: 2 }, { full: true });
    assert.deepEqual(lineIds(walk), [1, 2, 15, 16, 17, 18, 19, 20]);
});

// ===== picksToReach =====

test('picksToReach makes every 여행 line visible, including ones off the default path', () => {
    const hits = storyHits(GANJ.scripts, { query: '여행' });
    assert.equal(hits.length, 5);
    for (const index of hits) {
        const walk = visibleLines(GANJ.scripts, picksToReach(GANJ.scripts, index), { full: true });
        assert.ok(walk.items.some(i => i.type === 'line' && i.index === index), `line ${index} visible`);
    }
});

test('picksToReach takes the nearest choice when two branches offer the same flag', () => {
    const last = storyHits(TEMPESTA.scripts, { gid: DOLPHIN }).at(-1);
    assert.deepEqual(picksToReach(TEMPESTA.scripts, last), { 24: 4, 11: 2 });
});

test('picksToReach of a trunk line is empty', () => {
    assert.deepEqual(picksToReach(GANJ.scripts, 0), {});
});

// ===== speakers =====

test('isGroupChat: group rooms have no story icon, 1:1 and Dorm3D stories do', () => {
    assert.equal(isGroupChat(TEMPESTA), true);
    assert.equal(isGroupChat(GANJ), false);
    assert.ok(Object.values(DORM).flatMap(Object.values).every(s => !isGroupChat(s)));
});

test('speakerHandle: username map first, ship_name fallback, none for system and player', () => {
    const dolphinLine = TEMPESTA.scripts.find(l => l.ship_group === DOLPHIN);
    assert.equal(speakerHandle(dolphinLine, TEMPESTA, USERNAMES), 'Dolphin');
    const newJersey = Object.values(DORM['뉴저지'])[0];
    assert.equal(speakerHandle(newJersey.scripts[0], newJersey, {}), 'BlackDragon');
    assert.equal(speakerHandle({ ship_group: 1 }, GANJ, USERNAMES), '');
    assert.equal(speakerHandle({ ship_group: 0 }, GANJ, USERNAMES), '');
    assert.equal(speakerHandle({ ship_group: 7 }, GANJ, { 7: { name: ' Raw ' } }), 'Raw');
});

test('speakerOf: Dorm3D lines borrow the owner, 시스템 is a narrator, ship_group 0 is the player', () => {
    const newJersey = Object.values(DORM['뉴저지'])[0];
    const who = speakerOf(newJersey.scripts[0], newJersey, {});
    assert.deepEqual([who.role, who.name, who.handle], ['character', '뉴저지', 'BlackDragon']);
    assert.equal(who.icon, newJersey.icon);
    assert.equal(speakerOf({ ship_group: 1, kr_name: '시스템', icon: null }, GANJ, USERNAMES).role, 'narrator');
    assert.equal(speakerOf({ ship_group: 0 }, GANJ, USERNAMES).role, 'player');
});

// ===== search =====

test('buildSpeakerIndex: 돌핀 owns a 1:1 and speaks in two group rooms', () => {
    const dolphin = buildSpeakerIndex(JUUS, USERNAMES).find(s => s.gid === DOLPHIN);
    assert.equal(dolphin.ownChat, '돌핀');
    assert.equal(dolphin.handle, 'Dolphin');
    assert.deepEqual(
        dolphin.appearances.map(a => [a.chatKey, a.count]).sort(),
        [['이벤트 준비회', 1], ['템페스타 채팅방', 5]],
    );
});

test('buildSpeakerIndex never indexes the player or 시스템', () => {
    const gids = new Set(buildSpeakerIndex(JUUS, USERNAMES).map(s => s.gid));
    assert.equal(gids.has(0), false);
    assert.equal(gids.has(1), false);
});

test('searchSpeakers matches Korean name, @아이디 (any case), and normalized Roman numerals', () => {
    const speakers = buildSpeakerIndex(JUUS, USERNAMES);
    assert.equal(searchSpeakers(speakers, '돌핀')[0].gid, DOLPHIN);
    assert.ok(searchSpeakers(speakers, '@dolphin').some(s => s.gid === DOLPHIN));
    assert.ok(searchSpeakers(speakers, 'DOLPH').some(s => s.gid === DOLPHIN));
    const roman = [{ gid: 1, name: '테스트 MKⅢ', handle: '' }];
    assert.equal(searchSpeakers(roman, '테스트 MKIII').length, 1);
    assert.deepEqual(searchSpeakers(speakers, '   '), []);
});

test('searchSpeakers ranks an exact name ahead of longer names containing it', () => {
    const list = [{ gid: 1, name: '엔터프라이즈 META', handle: '' }, { gid: 2, name: '엔터프라이즈', handle: '' }];
    assert.deepEqual(searchSpeakers(list, '엔터프라이즈').map(s => s.gid), [2, 1]);
});

test('searchLines counts every hit and caps the returned list', () => {
    const all = searchLines(JUUS, '여행', 1000);
    assert.equal(all.total, all.hits.length);
    const capped = searchLines(JUUS, '여행', 3);
    assert.equal(capped.total, all.total);
    assert.equal(capped.hits.length, 3);
    assert.deepEqual(capped.hits[0], { chatKey: '건스웨이', storyId: '1', index: 1, text: GANJ.scripts[1].param });
    assert.deepEqual(searchLines(JUUS, ''), { total: 0, hits: [] });
});

test('searchLines skips sticker ids (a type-4 param is an emoji id, not text)', () => {
    const data = { c: { 1: { scripts: [{ type: 4, param: '202' }, { type: 1, param: '202호로 와' }, { type: 5, param: '[202] 수신' }] } } };
    assert.deepEqual(searchLines(data, '202').hits.map(h => h.index), [1, 2]);
});

test('storyHits: a speaker\'s lines or a text query, in script order', () => {
    assert.deepEqual(storyHits(TEMPESTA.scripts, { gid: DOLPHIN }), [10, 11, 47, 48, 49]);
    assert.deepEqual(storyHits(GANJ.scripts, { query: '첫 여행이라' }), [13]);
    assert.deepEqual(storyHits(GANJ.scripts, {}), []);
});

// ===== Review focus: inputs the spec implies but the cases above don't reach =====

test('an empty script list walks to nothing in both modes', () => {
    assert.deepEqual(visibleLines([], {}), { items: [], pending: null });
    assert.deepEqual(visibleLines([], {}, { full: true }), { items: [], pending: null });
    assert.deepEqual(picksToReach([], 0), {});
});

test('search tolerates regex-special characters and whitespace-only queries', () => {
    assert.doesNotThrow(() => searchLines(JUUS, '?(['));
    assert.doesNotThrow(() => searchSpeakers(buildSpeakerIndex(JUUS, USERNAMES), '.*'));
    assert.deepEqual(searchLines(JUUS, '   '), { total: 0, hits: [] });
    assert.deepEqual(searchSpeakers([{ gid: 1, name: '돌핀', handle: 'Dolphin' }], ' @ '), []);
    assert.deepEqual(storyHits(GANJ.scripts, { query: '  ' }), []);
});

// ===== The game's own rule, replayed (oracle) =====

// Literal port of instagramtopic.lua SetDisplayWordList. Before the first reply it shows every
// line up to and including the first one with an option, whatever its flag; after that it
// filters by flag and stops at the first shown option line past the latest reply.
function gameDisplay(scripts, replies) {
    const out = [];
    if (!replies.length) {
        for (const [i, line] of scripts.entries()) {
            out.push(i);
            if (line.option !== '') break;
        }
        return out;
    }
    const values = replies.map(r => r.value);
    const lastKey = replies.at(-1).key;
    let keyAt = Infinity;
    for (const [i, line] of scripts.entries()) {
        const shown = line.flag === 0 || values.includes(line.flag);
        if (shown) out.push(i);
        if (line.id === lastKey) keyAt = i;
        if (shown && line.option !== '' && keyAt < i) break;
    }
    return out;
}

/**
 * Play a story the game's way, answering each choice with `choose(options)`. A red packet
 * (a string `option`, its packet id) waits for a tap in game, which is recorded as a reply;
 * the viewer shows it without stopping. Checks the 재생 walk stops where the game waits.
 */
function playLikeTheGame(scripts, choose) {
    const replies = [];
    const picks = {};
    for (let step = 0; step < 500; step++) {
        const shown = gameDisplay(scripts, replies);
        const at = shown.at(-1);
        const last = scripts[at];
        if (!last || last.option === '') return { shown, picks };
        const options = choiceOptions(last);
        if (!options) {
            replies.push({ key: last.id, value: last.option });
            continue;
        }
        assert.equal(visibleLines(scripts, picks).pending?.index, at, `재생 waits where the game waits (step ${step})`);
        picks[at] = choose(options);
        replies.push({ key: last.id, value: picks[at] });
    }
    throw new Error('playthrough did not finish');
}

function seeded(seed) {
    return () => {
        seed = (seed * 1103515245 + 12345) % 2147483648;
        return seed / 2147483648;
    };
}

test('a flagged line before the first choice still shows (하쿠호 「비 오는 날의 향도」)', () => {
    const story = JUUS['하쿠호']['165'];
    assert.equal(story.name, '비 오는 날의 향도');
    const walk = visibleLines(story.scripts, {});
    assert.deepEqual(walk.items.map(i => i.index), [0, 1, 2]);
    assert.equal(walk.pending.index, 2);
});

test('every committed story ends on exactly the lines the game shows, for any pick sequence', () => {
    const stories = [JUUS, DORM].flatMap(data => Object.values(data).flatMap(Object.values));
    const random = seeded(20261011);
    const choosers = [
        options => options[0][0],
        options => options.at(-1)[0],
        options => options[Math.floor(random() * options.length)][0],
        options => options[Math.floor(random() * options.length)][0],
    ];
    for (const story of stories) {
        for (const choose of choosers) {
            const { shown, picks } = playLikeTheGame(story.scripts, choose);
            const walk = visibleLines(story.scripts, picks);
            assert.deepEqual(walk.items.map(i => i.index), shown, `${story.name}: 재생 end state`);
            assert.equal(walk.pending, null);
        }
        const firstPath = playLikeTheGame(story.scripts, choosers[0]).shown;
        const full = visibleLines(story.scripts, {}, { full: true });
        assert.deepEqual(full.items.filter(i => i.type === 'line').map(i => i.index), firstPath, `${story.name}: 전체 대본`);
    }
});

test('every text line in every story is reachable — a 대사 search hit always lands', () => {
    for (const data of [JUUS, DORM]) {
        for (const story of Object.values(data).flatMap(Object.values)) {
            story.scripts.forEach((line, index) => {
                if (line.type !== 1 && line.type !== 5) return;
                const walk = visibleLines(story.scripts, picksToReach(story.scripts, index), { full: true });
                assert.ok(walk.items.some(i => i.type === 'line' && i.index === index), `${story.name} line ${index}`);
            });
        }
    }
});
