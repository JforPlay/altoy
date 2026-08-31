/**
 * The static `tag_list` seed, guarded against the pipeline dropping it and against a
 * data refresh introducing a gate whose tag nothing produces.
 *
 * Both failures are SILENT at runtime and in opposite directions. Lose the field and
 * every `target_ship_tags` clause goes back to buffing the whole fleet (38 skills,
 * 후부키's 「특형 네임쉽!」 raising 트라팔가's 화력). Add a gate naming a tag no ship
 * carries and the clause quietly buffs nobody instead — which is why an unanswerable
 * tag is listed rather than merely unmatched, and why the list is pinned here.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { UNEVALUABLE_SHIP_TAGS } from '../../public/js/simulators/fleet-sim.calc.js';

const read = (p) => JSON.parse(readFileSync(new URL(p, import.meta.url)));
const ships = read('../../public/data/ship_info_data.json');
const passives = read('../../public/data/sim/fleet_sim_passive_skills.json');
const graph = read('../../public/data/sim/fleet_sim_graph.json');

/** Tags a roster ship carries into battle before any buff runs. */
const staticTags = new Set(ships.flatMap((s) => s.tag_list || []));

/** Tags some graph edge stamps mid-battle — the battle sim's multiset, not this lane. */
const stampedTags = new Set(
    [...Object.values(graph.b), ...Object.values(graph.s)]
        .flatMap((n) => n.e)
        .flatMap((e) => ['tag', 'tag_list'].flatMap((k) => {
            const v = e.a?.[k];
            return v == null ? [] : (Array.isArray(v) ? v : [v]).map(String);
        })),
);

test('the pipeline still emits tag_list, and it covers the roster', () => {
    assert.equal(ships.length, 886);
    // 51 ships genuinely have none; a pipeline that dropped the field reads 886.
    const without = ships.filter((s) => !(s.tag_list || []).length).length;
    assert.equal(without, 51);
    for (const name of ['Z-Class', 'Special Type', 'Fletcher-Class', 'Anshan-Class']) {
        assert.ok(staticTags.has(name), `class tag missing from the roster: ${name}`);
    }
});

// The MLB record is the state the sim models. 9 ships vary their tags by limit break
// and reading the base sid would give 나토리 FullBurst1 where the graph wants
// FullBurst2 — the tag that lets her 17130 fire at all.
test('tag_list is read from the MLB stat record', () => {
    const natori = ships.find((s) => s.name === '나토리');
    assert.ok(natori.tag_list.includes('FullBurst2'), JSON.stringify(natori.tag_list));
});

/**
 * Tags nothing produces and nothing needs to: their ABSENCE is the settled answer, so
 * the plain unmatched path is already right and listing them would flip a correct
 * `false` into an incorrect pass. 탄약 부족 is the only one — a fresh sortie is not
 * ammo-starved.
 */
const SETTLED_ABSENT = new Set(['danyaokuifa']);

test('every tag a passive gate demands is answerable, or listed as one that is not', () => {
    const orphans = [];
    for (const [id, skill] of Object.entries(passives)) {
        const tags = skill.target_ship_tags || [];
        if (!tags.length) continue;
        if (tags.some((t) => staticTags.has(t))) continue;
        if (tags.some((t) => UNEVALUABLE_SHIP_TAGS.has(t))) continue;
        if (tags.every((t) => SETTLED_ABSENT.has(t))) continue;
        orphans.push(`${id} ${JSON.stringify(tags)} (${skill.name || 'unnamed'})`);
    }
    // A new entry here is a live buff about to be silently zeroed. Decide what the tag
    // means before adding it to UNEVALUABLE_SHIP_TAGS — the list is not a mute button.
    assert.deepEqual(orphans, []);
});

// The list may only SHRINK. Every entry is either a runtime stamp this lane cannot see
// or a tag KR data cannot produce; a tag that becomes answerable must leave.
test('the unevaluable list stays pinned to what the data still cannot answer', () => {
    assert.deepEqual([...UNEVALUABLE_SHIP_TAGS].sort(), [
        'Bilibili', 'P3_Harmony', 'QE_supplicate', 'dadan', 'danyaochongzu',
        'keluoladuogai', 'noSeydlitz',
    ]);
    for (const tag of UNEVALUABLE_SHIP_TAGS) {
        assert.ok(!staticTags.has(tag), `${tag} is a static roster tag now — drop it from the list`);
    }
    // Four are stamped by a graph edge (the battle sim models them; this lane does not),
    // three are not producible from KR data at all. Both are unanswerable HERE.
    const stamped = [...UNEVALUABLE_SHIP_TAGS].filter((t) => stampedTags.has(t)).sort();
    assert.deepEqual(stamped, ['P3_Harmony', 'QE_supplicate', 'dadan', 'keluoladuogai']);
});

// 탄약 부족 must stay OFF the list: a fresh sortie is not ammo-starved, so reading it as
// unset is certain, and 2190's fleet-wide +15% 주는 피해 correctly stops applying. Its
// opposite 탄약 충족 rides buff 201, attached outside the Lua battle layer, so whether a
// run receives it is not derivable — that one is listed.
test('the ammo pair is split by which half the data can settle', () => {
    assert.ok(!UNEVALUABLE_SHIP_TAGS.has('danyaokuifa') && SETTLED_ABSENT.has('danyaokuifa'));
    assert.ok(UNEVALUABLE_SHIP_TAGS.has('danyaochongzu'));
    assert.ok(!staticTags.has('danyaokuifa') && !stampedTags.has('danyaokuifa'));
});
