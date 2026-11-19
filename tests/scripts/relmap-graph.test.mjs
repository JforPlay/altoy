/**
 * relmap-graph.test.mjs
 * Pure builder for the 함순이 관계도 graph (scripts/relmap-graph.mjs).
 * Fixture-based on purpose: the real output is a git-ignored data:split
 * artifact and CI runs `npm test` before the build.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
    ownBase, createMentionMatcher, collectPairs, selectLinks, pairCounts,
    buildClasses, buildProvinces, buildRelmap, descClass,
} from '../../scripts/relmap-graph.mjs';

const SARA = 10701, SARA_META = 90701, PRINCETON = 10702, VAMP = 20104, VAMP_META = 90702;
const EAGLE = 20101, HOUSTON2 = 10703, QE = 20102, BEL = 20103, HYUGA = 30101, FLETCHER = 10704;
const SHIPS = [
    { gid: SARA, name: '새러토가' }, { gid: SARA_META, name: '새러토가·META' },
    { gid: PRINCETON, name: '프린스턴' }, { gid: VAMP, name: '뱀파이어' },
    { gid: VAMP_META, name: '뱀파이어·META' }, { gid: EAGLE, name: '이글' },
    { gid: HOUSTON2, name: '휴스턴Ⅱ' }, { gid: QE, name: '퀸 엘리자베스' },
    { gid: BEL, name: '벨파스트' }, { gid: HYUGA, name: '휴가' },
    { gid: FLETCHER, name: '플레처' },
];
const ship = (gid) => SHIPS.find((s) => s.gid === gid);
const ALIASES = [{ alias: '폐하', gid: QE, speakers: [BEL] }];
const match = createMentionMatcher(SHIPS, ALIASES);
const gids = (text, speaker) => match(text, ship(speaker)).map((m) => m.gid);

test('ownBase strips form markers to the base name', () => {
    assert.equal(ownBase('뱀파이어·META'), '뱀파이어');
    assert.equal(ownBase('꼬마 헬레나'), '헬레나');
    assert.equal(ownBase('휴스턴Ⅱ'), '휴스턴');
    assert.equal(ownBase('특장형 부린 MKIII'), '특장형 부린 MK');
    assert.equal(ownBase('아카기(μ장비)'), '아카기');
    assert.equal(ownBase('모가미改'), '모가미');
});

test('META forms are separate shipgirls: plain name → original only', () => {
    assert.deepEqual(gids('새러토가 선배와 함께', PRINCETON), [SARA]);
    assert.deepEqual(gids('새러토가·META는 어디 갔지?', PRINCETON), [SARA_META]);
});

test("a speaker's own base name is a self-reference", () => {
    assert.deepEqual(gids('뱀파이어는 딱 그런 타입이야', VAMP_META), []);
    assert.deepEqual(gids('새러토가 등장!', SARA), []);
});

test('boundaries, class suffixes and the stoplist reject false names', () => {
    assert.deepEqual(gids('이글 유니온의 깃발', PRINCETON), []);
    assert.deepEqual(gids('플레처급 구축함', PRINCETON), []);
    assert.deepEqual(gids('휴가 가자', PRINCETON), []);
    assert.deepEqual(gids('스이글은 없다', PRINCETON), []);
});

test('ASCII roman numerals match and report the original substring', () => {
    assert.deepEqual(match('휴스턴II와 같이', ship(PRINCETON)), [{ gid: HOUSTON2, matched: '휴스턴II' }]);
});

test('a name repeated in one text counts once', () => {
    assert.deepEqual(gids('새러토가, 새러토가!', PRINCETON), [SARA]);
});

test('speaker-scoped aliases match only for their speakers', () => {
    assert.deepEqual(match('폐하께서 부르십니다', ship(BEL)), [{ gid: QE, matched: '폐하' }]);
    assert.deepEqual(match('폐하께서 부르십니다', ship(PRINCETON)), []);
});

// ---------- collectPairs ----------
const key = (a, b) => (a < b ? `${a}-${b}` : `${b}-${a}`);
const FIVE = [SARA, EAGLE, QE, BEL, HYUGA];
const VOICELINES = [
    {
        '클뜯 함순이 id': PRINCETON,
        '함대 특수대사': [
            { voiceline: "['새러토가', '이글', '퀸 엘리자베스', '벨파스트', '휴가'] : 다 같이!", voicelink: 'f5.ogg', partners: FIVE, need: 1, kind: 0 },
            { voiceline: "['USS'] : 미국 함대!", voicelink: 'k3.ogg', partners: [1], need: 1, kind: 3 },
            { voiceline: "['프린스턴', '새러토가'] : 같이 가자", voicelink: 'p.ogg', partners: [PRINCETON, SARA], need: 2, kind: 0 },
        ],
        '자기소개': { voiceline: '새러토가 선배를 따라왔어요', voicelink: 'intro.ogg' },
        '설명': { voiceline: '새러토가 이야기', voicelink: null },
    },
    {   // a second skin repeats the same lines
        '클뜯 함순이 id': PRINCETON,
        '함대 특수대사': [
            { voiceline: "['프린스턴', '새러토가'] : 같이 가자", voicelink: 'p2.ogg', partners: [PRINCETON, SARA], need: 2, kind: 0 },
        ],
        '자기소개': { voiceline: '새러토가 선배를 따라왔어요', voicelink: 'intro2.ogg' },
    },
];
const ACTOR_INDEX = {
    memories: [['e', 1, 2, '제목', '이벤트']],
    ships: { [SARA]: [0], [PRINCETON]: [0], [EAGLE]: [0], 99999: [0] },
};
const JUUS = [{ ship_group: BEL, shipgirl_names: [QE, EAGLE, BEL] }];
const pairs = collectPairs({
    ships: SHIPS, voicelines: VOICELINES, actorIndex: ACTOR_INDEX, juusPosts: JUUS, aliases: ALIASES,
});

test('fleet: faction calls and kind≠0 make no pairs; need is carried; skins dedupe', () => {
    for (const g of [EAGLE, QE, BEL, HYUGA]) {
        assert.equal(pairs.get(key(PRINCETON, g))?.fleet.length ?? 0, 0, String(g));
    }
    const p = pairs.get(key(PRINCETON, SARA));
    assert.deepEqual(p.fleet, [{ speaker: PRINCETON, text: '같이 가자', audio: 'p.ogg', partners: [SARA], need: 1 }]);
});

test('mentions dedupe per speaker+text and skip 설명', () => {
    const p = pairs.get(key(PRINCETON, SARA));
    assert.deepEqual(p.mention, [{ speaker: PRINCETON, text: '새러토가 선배를 따라왔어요', audio: 'intro.ogg', matched: '새러토가' }]);
});

test('story: each pair of a 3-roster-ship cast gets 1/(cast−1)', () => {
    for (const [a, b] of [[SARA, PRINCETON], [SARA, EAGLE], [PRINCETON, EAGLE]]) {
        const p = pairs.get(key(a, b));
        assert.equal(p.story, 1);
        assert.equal(p.storyW, 0.5);
        assert.deepEqual(p.stories, [0]);
    }
});

test('JUUS: every pair in a post counts once', () => {
    for (const [a, b] of [[BEL, QE], [BEL, EAGLE], [QE, EAGLE]]) {
        assert.equal(pairs.get(key(a, b)).juus, 1);
    }
});

test('pairCounts feeds scoreLink', () => {
    assert.deepEqual(pairCounts(pairs.get(key(PRINCETON, SARA))), { f: 1, m: 1, sw: 0.5, j: 0 });
});

// ---------- selectLinks ----------
const blank = () => ({ fleet: [], mention: [], story: 0, storyW: 0, stories: [], juus: 0 });
function pairMap(list) {
    const m = new Map();
    for (const [a, b, juus] of list) m.set(key(a, b), { ...blank(), juus });
    return m;
}
const kept = (sel) => sel.map((l) => `${l.a}-${l.b}`);

test('selectLinks keeps score ≥ 2 even outside both top-3s', () => {
    const list = [[500, 501, 4]];   // score 2
    for (let k = 1; k <= 3; k++) list.push([500, 600 + k, 6], [501, 700 + k, 6]);
    assert.ok(kept(selectLinks(pairMap(list))).includes('500-501'));
});

test('selectLinks keeps a weak pair that is in an endpoint top 3', () => {
    assert.deepEqual(kept(selectLinks(pairMap([[900, 901, 1]]))), ['900-901']);
});

test('selectLinks top-3 ties break by partner gid ascending', () => {
    const list = [];
    for (let i = 1; i <= 4; i++) {
        list.push([100, i, 1]);                                   // 0.5 each
        for (let k = 1; k <= 3; k++) list.push([i, 200 + 10 * i + k, 2]);  // 1.0, stronger
    }
    const xLinks = kept(selectLinks(pairMap(list))).filter((s) => s.endsWith('-100'));
    assert.deepEqual(xLinks, ['1-100', '2-100', '3-100']);
});

test('selectLinks never keeps a zero score', () => {
    assert.deepEqual(selectLinks(pairMap([[800, 801, 0]])), []);
});

test('selectLinks returns gids a < b with the score', () => {
    const [l] = selectLinks(pairMap([[901, 900, 4]]));
    assert.equal(l.a, 900);
    assert.equal(l.b, 901);
    assert.equal(l.score, 2);
});

// ---------- classes and provinces ----------
const CLASS_SHIPS = [
    [1, 1, ['Alpha-Class']], [2, 1, ['Alpha-Class']], [3, 1, ['Alpha-Class', 'Beta-Class']],
    [4, 1, ['Beta-Class']], [5, 2, ['Beta-Class']], [6, 2, ['Beta-Class']],
    [7, 1, ['Alpha-Class']], [8, 1, ['Alpha-Class']], [9, 1, ['Beta-Class']], [10, 1, ['Alpha-Class']],
    [11, 1, ['Gamma-Class']], [12, 2, ['Gamma-Class']], [13, 1, ['Solo-Class']],
    [14, 1, ['Plan-Class']], [15, 1, ['Plan-Class']], [16, 97, ['HunterMETA']], [17, 97, ['HunterMETA']],
    [18, 1, []],
].map(([gid, nationality, tags]) => ({ gid, name: 'ship' + gid, nationality, tags }));
const TAGS = Object.fromEntries(CLASS_SHIPS.map((s) => [s.gid, s.tags]));
const NAMES = { 'Alpha-Class': '알파급', 'Beta-Class': '베타급' };
const built = buildClasses(CLASS_SHIPS, TAGS, NAMES);
const classByTag = (tag) => built.classes.find((c) => c.tag === tag);

test('buildClasses keeps -Class tags with ≥ 2 members, minus Plan-Class', () => {
    assert.deepEqual(built.classes.map((c) => c.tag).sort(), ['Alpha-Class', 'Beta-Class', 'Gamma-Class']);
    assert.deepEqual(classByTag('Alpha-Class'), { tag: 'Alpha-Class', kr: '알파급', members: [1, 2, 3, 7, 8, 10] });
    assert.deepEqual(classByTag('Beta-Class').members, [3, 4, 5, 6, 9]);
});

test('buildClasses falls back to the tag and reports missing names', () => {
    assert.equal(classByTag('Gamma-Class').kr, 'Gamma-Class');
    assert.deepEqual(built.missingNames, ['Gamma-Class']);
});

test('buildProvinces groups each ship under her largest class, per nation', () => {
    const provs = buildProvinces(CLASS_SHIPS, built.classes)
        .map((p) => [built.classes[p.cls].tag, p.nat, p.members]);
    assert.deepEqual(provs.sort((x, y) => String(x).localeCompare(String(y))), [
        ['Alpha-Class', 1, [1, 2, 3, 7, 8, 10]],   // ship 3 is in both; Alpha is larger
        ['Beta-Class', 1, [4, 9]],
        ['Beta-Class', 2, [5, 6]],                   // one class, two nations → two provinces
    ]);                                              // Gamma: two one-member provinces, dropped
});

// ---------- buildRelmap ----------
const NAT = {
    [SARA]: 1, [SARA_META]: 97, [PRINCETON]: 1, [VAMP]: 2, [VAMP_META]: 97, [EAGLE]: 2,
    [HOUSTON2]: 1, [QE]: 2, [BEL]: 2, [HYUGA]: 3, [FLETCHER]: 1,
};
const ROSTER = SHIPS.map((s) => ({ ...s, nationality: NAT[s.gid] }));
const times = (n, f) => Array.from({ length: n }, (_, i) => f(i));
const RICH_VOICE = [
    ...VOICELINES,
    {
        '클뜯 함순이 id': SARA,
        '함대 특수대사': times(3, (i) => ({
            voiceline: `['프린스턴'] : 출격 ${i}`, voicelink: `s${i}.ogg`, partners: [PRINCETON], need: 1, kind: 0,
        })),
        ...Object.fromEntries(times(3, (i) => [`메인${i + 1}`, { voiceline: `프린스턴, ${i}번째`, voicelink: `m${i}.ogg` }])),
    },
    {   // pre-pipeline entry: no partners field
        '클뜯 함순이 id': EAGLE,
        '함대 특수대사': [{ voiceline: "['벨파스트'] : 옛 데이터", voicelink: null }],
    },
];
const RICH_ACTORS = {
    memories: times(5, (i) => ['e', 7, 100 + i, `제목${i}`, '이벤트']),
    ships: { [SARA]: [0, 1, 2, 3, 4], [PRINCETON]: [0, 1, 2, 3, 4] },
};
const relmap = buildRelmap({
    ships: ROSTER,
    shipTags: { [SARA]: ['Test-Class'], [PRINCETON]: ['Test-Class'], [SARA_META]: ['SaratogaMETA'] },
    voicelines: RICH_VOICE,
    actorIndex: RICH_ACTORS,
    juusPosts: JUUS,
    nations: { 1: { name: '이글 유니온' }, 2: { name: '로열 네이비' } },
    classNames: {},
    aliases: ALIASES,
});
const { graph, evidence } = relmap;
const nodeIdx = (gid) => graph.nodes.findIndex((n) => n[0] === gid);

test('buildRelmap emits the v1 contract with parallel link and evidence arrays', () => {
    assert.equal(graph.v, 1);
    assert.equal(evidence.v, 1);
    assert.ok(graph.links.length > 0);
    assert.equal(graph.links.length, evidence.links.length);
    assert.deepEqual(graph.nodes.map((n) => n[0]), ROSTER.map((s) => s.gid));
    for (const [a, b] of graph.links) assert.ok(a < b);
});

test('buildRelmap evidence uses node indices and holds the 2/2/3 caps', () => {
    const [ia, ib] = [nodeIdx(SARA), nodeIdx(PRINCETON)].sort((x, y) => x - y);
    const li = graph.links.findIndex(([a, b]) => a === ia && b === ib);
    assert.ok(li >= 0);
    assert.deepEqual(graph.links[li].slice(2), [4, 4, 5, 0]);
    const [fleet, mention, storyCount, stories] = evidence.links[li];
    assert.equal(fleet.length, 2);
    assert.equal(mention.length, 2);
    assert.equal(storyCount, 5);
    assert.deepEqual(stories, RICH_ACTORS.memories.slice(0, 3));
    for (const [speaker, , , partners] of fleet) {
        assert.ok([SARA, PRINCETON].includes(graph.nodes[speaker][0]));
        assert.ok(partners.every((p) => [SARA, PRINCETON].includes(graph.nodes[p][0])));
    }
});

test('buildRelmap gives an unlinked shipgirl linkCount 0 and the base radius', () => {
    const hyuga = graph.nodes[nodeIdx(HYUGA)];
    assert.equal(hyuga[6], 0);
    assert.equal(hyuga[5], 5);
    assert.equal(hyuga[7], -1);
});

test('buildRelmap emits classes, provinces and nation names by index', () => {
    const members = [nodeIdx(SARA), nodeIdx(PRINCETON)];
    assert.deepEqual(graph.classes, [['Test-Class', 'Test-Class', members]]);
    assert.equal(graph.provinces.length, 1);
    assert.deepEqual(graph.provinces[0].slice(0, 2), [0, 1]);
    assert.equal(graph.nodes[nodeIdx(SARA)][7], 0);
    const names = Object.fromEntries(graph.nations.map((n) => [n[0], n[1]]));
    assert.equal(names[1], '이글 유니온');
    assert.equal(names[3], '기타');
});

test('buildRelmap warns about missing class names and partner-less fleet lines', () => {
    assert.ok(relmap.warnings.some((w) => w.includes('Test-Class')));
    assert.ok(relmap.warnings.some((w) => w.includes('partners')));
});

// ---------- final-review fixes ----------
test('a rejected long name does not fall back to a shorter name at the same spot', () => {
    const m = createMentionMatcher([
        { gid: 1, name: '요크' }, { gid: 2, name: '요크타운' }, { gid: 3, name: '프린스턴' },
    ]);
    const speaker = { gid: 3, name: '프린스턴' };
    assert.deepEqual(m('요크타운급 항공모함', speaker), []);
    assert.deepEqual(m('요크타운과 요크', speaker).map((x) => x.gid), [2, 1]);
});

test("fleet need excludes the speaker when she is on her own partner list", () => {
    const p = collectPairs({
        ships: SHIPS,
        voicelines: [{
            '클뜯 함순이 id': BEL,
            '함대 특수대사': [{ voiceline: "['벨파스트', '퀸 엘리자베스', '이글'] : 가요", voicelink: null, partners: [BEL, QE, EAGLE], need: 2, kind: 0 }],
        }],
        actorIndex: { memories: [], ships: {} },
        juusPosts: [],
    });
    assert.deepEqual(p.get(key(BEL, QE)).fleet[0], { speaker: BEL, text: '가요', audio: null, partners: [QE, EAGLE], need: 1 });
});

test('graph and evidence carry the same build stamp', () => {
    assert.equal(typeof graph.id, 'string');
    assert.ok(graph.id.length > 0);
    assert.equal(evidence.id, graph.id);
});

test('an alias pointing at an unknown gid is skipped with a warning', () => {
    const out = buildRelmap({
        ships: ROSTER, shipTags: {}, voicelines: RICH_VOICE, actorIndex: RICH_ACTORS, juusPosts: JUUS,
        nations: {}, classNames: {}, aliases: [{ alias: '프린스턴', gid: 99999 }],
    });
    assert.ok(out.warnings.some((w) => w.includes('99999')));
    assert.ok(out.graph.nodes.every((n) => n[0] !== 99999));
});

test('collab nations (≥ 100) get one 콜라보 frame; none without them', () => {
    assert.deepEqual(graph.groups, []);
    const out = buildRelmap({
        ships: ROSTER.map((s) => (s.gid === HYUGA || s.gid === FLETCHER ? { ...s, nationality: 101 } : s)),
        shipTags: {}, voicelines: RICH_VOICE, actorIndex: RICH_ACTORS, juusPosts: JUUS,
        nations: {}, classNames: {}, aliases: [],
    });
    assert.equal(out.graph.groups.length, 1);
    const [name, labelX, labelY, hull] = out.graph.groups[0];
    assert.equal(name, '콜라보');
    assert.ok(Number.isInteger(labelX) && Number.isInteger(labelY));
    assert.ok(hull.length >= 6 && hull.every(Number.isInteger));
});

// ---------- 설명 (description line) classes ----------
test('descClass reads the class from a 설명 designation line', () => {
    const nations = ['비시아 성좌', '아이리스 리브레'];
    assert.equal(descClass('즈이호급 경항공모함—치토세', nations), '즈이호급');
    assert.equal(descClass('플레처급 구축함·찰스 오스본 (DD-570)', nations), '플레처급');
    assert.equal(descClass('패러것급 구축함 - 듀이(DD-349) ', nations), '패러것급');
    assert.equal(descClass('카사블랑카급 호위 항공모함—카사블랑카, 현호 CVE-55 ', nations), '카사블랑카급');
    assert.equal(descClass('A급 실험 구축함·아마존 (D39)', nations), 'A급');
    assert.equal(descClass('류호 급 항공모함 - 류호', nations), '류호급');
    assert.equal(descClass('알렌 M. 섬너급 구축함—알렌 M. 섬너', nations), '알렌 M. 섬너급');
    assert.equal(descClass('비시아 성좌 쉬프랑급 중순양함—포슈', nations), '쉬프랑급');
});

test('descClass ignores free text and lines without a class', () => {
    const nations = [];
    assert.equal(descClass('나는 히퍼야. 아드미랄 히퍼급 중순양함의 네임쉽이고,', nations), null);
    assert.equal(descClass('노샘프턴 중순양함·휴스턴 (CA-39)', nations), null);
    assert.equal(descClass('범용형 부린. S Rare 이하의 캐릭터의 한계 돌파에 사용 가능.', nations), null);
    assert.equal(descClass('지휘관 발견! 에헤헤~ 응? 내가 누군지 몰라?!', nations), null);
    assert.equal(descClass(undefined, nations), null);
});

test('untagged ships join a same-nation tag class by name, else form 설명 classes', () => {
    const extra = [
        [19, 1, '알파'], [20, 2, '알파'], [21, 2, '알파'],   // nat 1 joins Alpha; nat 2 forms its own 알파급
        [22, 1, '감마델타'],                                // a lone 설명 class is dropped
        [23, 1, '오메가', '헌터·META'], [24, 1, '오메가'],   // META stays out → 오메가 has one member
    ].map(([gid, nationality, cls, name]) => ({ gid, name: name ?? `ship${gid}`, nationality, cls }));
    const ships = [...CLASS_SHIPS, ...extra];
    const descOf = new Map(extra.map((s) => [s.gid, `${s.cls}급`]));
    const { classes } = buildClasses(ships, TAGS, NAMES, descOf);
    const alpha = classes.find((c) => c.tag === 'Alpha-Class');
    assert.deepEqual(alpha.members, [1, 2, 3, 7, 8, 10, 19]);
    const descAlpha = classes.find((c) => c.tag === '설명:알파급');
    assert.deepEqual(descAlpha, { tag: '설명:알파급', kr: '알파급', members: [20, 21] });
    assert.ok(!classes.some((c) => c.kr === '감마델타급' || c.kr === '오메가급'));
});

test('a tagged ship keeps her tag class whatever her 설명 says', () => {
    const descOf = new Map([[4, '알파급']]);   // ship 4 is tagged Beta-Class
    const { classes } = buildClasses(CLASS_SHIPS, TAGS, NAMES, descOf);
    assert.ok(!classes.find((c) => c.tag === 'Alpha-Class').members.includes(4));
});

test('buildRelmap reads 설명 lines into classes', () => {
    const out = buildRelmap({
        ships: ROSTER, shipTags: {},
        voicelines: [
            { '클뜯 함순이 id': QE, '설명': '퀸 엘리자베스급 전함—퀸 엘리자베스' },
            { '클뜯 함순이 id': BEL, '설명': '로열 네이비 퀸 엘리자베스급 전함 - 벨파스트' },
        ],
        actorIndex: { memories: [], ships: {} }, juusPosts: [],
        nations: { 2: { name: '로열 네이비' } }, classNames: {},
    });
    assert.deepEqual(out.graph.classes, [['퀸 엘리자베스급', '설명:퀸 엘리자베스급', [nodeIdx(QE), nodeIdx(BEL)].sort((a, b) => a - b)]]);
});

test('descClass folds odd whitespace inside class names', () => {
    assert.equal(descClass('두카 델리  아브루치급 경순양함—주세페 가리발디', []), '두카 델리 아브루치급');
});
