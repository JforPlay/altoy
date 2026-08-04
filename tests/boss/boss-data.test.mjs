/**
 * boss-data.test.mjs
 * Shape contract on the generated public/data/boss/boss_data.json.
 *
 * Catches a pipeline regression before it reaches the page: a new `src` value the
 * UI has no chip for, an Operation Siren row that lost its `scaled` flag (and so
 * would render raw world_enhancement-scaled numbers as if they were real), a
 * chapter row missing the `cid` the map-viewer crosslink deep-links on, or a
 * fleet-sim target missing the stats it needs.
 *
 * CI runs `npm test` BEFORE `npm run build`, so this may only read committed data.
 * boss_data.json is committed, so it is fair game.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { SRC_LABELS, TYPE_LABELS } from '../../public/js/boss-format.js';

const here = dirname(fileURLToPath(import.meta.url));
const data = JSON.parse(
    readFileSync(join(here, '../../public/data/boss/boss_data.json'), 'utf8')
);
const identities = Object.entries(data);
const apps = identities.flatMap(([, r]) => r.app);
const CHAPTER_SRC = new Set(['main', 'hard', 'event', 'archive']);

test('dataset is non-trivial', () => {
    assert.ok(identities.length > 300, `only ${identities.length} identities`);
    assert.ok(apps.length > 1200, `only ${apps.length} appearances`);
});

test('every identity has a name, a valid armor type, and at least one appearance', () => {
    for (const [icon, r] of identities) {
        assert.ok(r.name, `${icon}: missing name`);
        assert.ok([1, 2, 3].includes(r.armor), `${icon}: bad armor ${r.armor}`);
        assert.ok(Array.isArray(r.app) && r.app.length > 0, `${icon}: no appearances`);
    }
});

test('every identity type has a label — no unlabelled 함종 can reach the UI', () => {
    for (const [icon, r] of identities) {
        assert.ok(TYPE_LABELS[r.type], `${icon}: unknown enemy type ${r.type}`);
    }
});

test('every src value has a chip label — no unlabelled group can reach the UI', () => {
    for (const a of apps) {
        assert.ok(SRC_LABELS[a.src], `unknown src "${a.src}"`);
    }
});

test('scaled is set on exactly the Operation Siren appearances', () => {
    for (const a of apps) {
        assert.equal(Boolean(a.scaled), a.src === 'siren',
            `src=${a.src} scaled=${a.scaled} — mismatch`);
    }
});

test('scaled appearances carry no stat fields at all', () => {
    // Raw config stats for these are wrong by three orders of magnitude. If any
    // leak through, the drawer would render them as real numbers.
    for (const a of apps.filter((x) => x.scaled)) {
        for (const f of ['hp', 'eva', 'aa', 'fp', 'trp', 'air', 'rld', 'acc', 'spd', 'eid']) {
            assert.ok(!(f in a), `siren row "${a.where}" leaked ${f}`);
        }
    }
});

test('non-scaled appearances carry the stats fleet-sim needs as a damage target', () => {
    for (const a of apps.filter((x) => !x.scaled)) {
        for (const f of ['hp', 'eva', 'luck', 'aa', 'lv']) {
            assert.equal(typeof a[f], 'number', `${a.where}: ${f} is ${typeof a[f]}`);
        }
        assert.ok(a.hp > 0, `${a.where}: hp is ${a.hp}`);
    }
});

test('chapter appearances carry the cid map-viewer deep-links on', () => {
    for (const a of apps.filter((x) => CHAPTER_SRC.has(x.src))) {
        assert.ok(Number.isInteger(a.cid), `${a.src} "${a.where}": missing cid`);
    }
});

test('event and archive appearances carry the event name that disambiguates them', () => {
    // Chapter labels like 'B2' and 'A1' repeat across dozens of events, so a row
    // is unidentifiable without `ev` beside it.
    const needsEvent = apps.filter((a) => a.src === 'event' || a.src === 'archive');
    const missing = needsEvent.filter((a) => !a.ev);
    assert.ok(missing.length / needsEvent.length < 0.05,
        `${missing.length}/${needsEvent.length} event/archive rows lack an event name`);
});

test('skill text exists only where the game actually publishes it', () => {
    // Every other boss's mechanics live in buff configs whose name is a Chinese
    // dev note and whose desc is empty — if a third src ever shows up here, the
    // processor picked up internal strings that must not be shown to users.
    const srcs = new Set(identities.flatMap(([, r]) => (r.skills || []).map((s) => s.src)));
    assert.deepEqual([...srcs].sort(), ['challenge', 'meta']);
});

test('every skill entry has a name, a description, and a labelled source', () => {
    for (const [icon, r] of identities) {
        for (const s of r.skills || []) {
            assert.ok(s.n && s.n.trim(), `${icon}: skill with no name`);
            assert.ok(s.d && s.d.trim(), `${icon}: skill "${s.n}" has no description`);
            assert.ok(SRC_LABELS[s.src], `${icon}: skill "${s.n}" has unknown src "${s.src}"`);
        }
    }
});

test('an identity never lists the same skill twice for one source', () => {
    // Both sources repeat themselves: a META boss carries its description on
    // every tier row, and the three 별자리 tiers share one description block.
    for (const [icon, r] of identities) {
        const keys = (r.skills || []).map((s) => `${s.src}\u0000${s.n}`);
        assert.equal(new Set(keys).size, keys.length, `${icon}: duplicate skill entries`);
    }
});

test('all 23 META bosses carry their skill text', () => {
    const meta = identities.filter(([, r]) => r.app.some((a) => a.src === 'meta'));
    const withSkills = meta.filter(([, r]) => (r.skills || []).some((s) => s.src === 'meta'));
    assert.equal(withSkills.length, 23, `${withSkills.length}/${meta.length} META bosses have skills`);
});

test('한계 챌린지 별자리 pairs both carry the mechanic that names both ships', () => {
    // 5101–5103 and 5128–5130 are two-boss fights; resolving only a flagship
    // would drop 사우스다코타 and 킹 조지 5세 from the database entirely.
    for (const icon of ['huashengdun', 'nandaketa', 'qiaozhiwushi', 'yuekegongjue']) {
        const r = data[icon];
        assert.ok(r, `${icon} is missing`);
        assert.ok((r.skills || []).some((s) => s.src === 'challenge'),
            `${icon}: no 한계 챌린지 skill text`);
    }
});

test('a known boss resolves to its verified in-game stats', () => {
    // 16-4 무사시 — cross-checked against the KR config during the survey.
    const musashi = data.wuzang;
    assert.ok(musashi, 'wuzang identity is missing');
    assert.equal(musashi.name, '무사시');
    assert.equal(musashi.armor, 3);
    const app = musashi.app.find((a) => a.cid === 1604);
    assert.ok(app, '16-4 appearance is missing');
    assert.equal(app.hp, 455000);
    assert.equal(app.lv, 132);
});
