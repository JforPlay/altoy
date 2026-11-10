/**
 * shipgirl-relations.model.js
 * Pure model for 함순이 관계도: link scoring, source colors/labels, fleet-trigger
 * wording, graph parsing and filtering. DOM-free and node-importable — the
 * data:split builder (scripts/relmap-graph.mjs) scores links with the same code.
 */

export const SOURCES = ['fleet', 'mention', 'story', 'juus'];
export const SOURCE_COLOR = { fleet: '#e0a030', mention: '#3b82f6', story: '#8b5cf6', juus: '#10b981', class: '#64748b' };
export const SOURCE_LABEL = { fleet: '함대 특수대사', mention: '언급', story: '스토리', juus: 'JUUS', class: '함급' };
export const ALL_ON = { fleet: true, mention: true, story: true, juus: true };

const NATION_HUE = { 1: 210, 2: 262, 3: 340, 4: 12, 5: 48, 6: 140, 7: 188, 8: 300, 9: 90, 96: 28, 97: 0, 98: 0 };

// Weighted per-source terms; mentions cap at 5 so one chatty pair can't dominate.
function terms(l, on) {
    return {
        fleet: on.fleet ? l.f * 3 : 0,
        mention: on.mention ? Math.min(l.m, 5) * 2 : 0,
        story: on.story ? l.sw : 0,
        juus: on.juus ? l.j * 0.5 : 0,
    };
}

/** score = fleet×3 + min(mention,5)×2 + storyW + juus×0.5, over the sources switched on. */
export function scoreLink(l, on = ALL_ON) {
    const t = terms(l, on);
    return t.fleet + t.mention + t.story + t.juus;
}

/** Source with the largest weighted term; ties go to the earlier entry of SOURCES. */
export function dominantSource(l, on = ALL_ON) {
    const t = terms(l, on);
    return SOURCES.reduce((best, s) => (t[s] > t[best] ? s : best), SOURCES[0]);
}

/** 와/과 by the last syllable's final consonant; a non-Hangul ending reads as 와. */
export function josaWa(word) {
    const c = String(word).trim().slice(-1).charCodeAt(0);
    return c >= 0xAC00 && c <= 0xD7A3 && (c - 0xAC00) % 28 ? '과' : '와';
}

/**
 * Who has to be in the fleet for a 함대 특수대사 line to play:
 * one partner / all of them → "A·B와 함께"; one of many → "A·B·C 중 한 명과 함께";
 * some of many → "A·B·C·D 중 2명과 함께".
 */
export function fleetTrigger(names, need) {
    const list = names.join('·');
    if (need >= names.length) return `${list}${josaWa(names[names.length - 1])} 함께`;
    return `${list} 중 ${need === 1 ? '한 ' : need}명과 함께`;
}

/** Nation tint as {hue, sat}; META/기타 (97/98) are near-grey, unknown nations hash to a hue. */
export function nationColor(nat) {
    if (nat in NATION_HUE) return { hue: NATION_HUE[nat], sat: nat === 97 || nat === 98 ? 5 : 60 };
    return { hue: (nat * 47) % 360, sat: 60 };
}

/**
 * Turn relmap_graph.json into the page model. Links start scored with every
 * source on; nodes get their adjacency, class indices and class sisters (mates).
 */
export function parseGraph(json) {
    const nodes = json.nodes.map(([gid, name, nat, x, y, r, linkCount, province], i) => ({
        i, gid, name, nat, x, y, r, linkCount, province, adj: [], classes: [], mates: new Set(),
    }));
    const links = json.links.map(([a, b, f, m, sw, j], i) => {
        const l = { i, a, b, f, m, sw, j, s: 0, d: 'fleet', vis: false };
        nodes[a].adj.push(l);
        nodes[b].adj.push(l);
        return l;
    });
    const classes = json.classes.map(([kr, tag, members]) => ({ kr, tag, members }));
    classes.forEach((c, ci) => {
        for (const m of c.members) {
            nodes[m].classes.push(ci);
            for (const o of c.members) if (o !== m) nodes[m].mates.add(o);
        }
    });
    const nations = json.nations.map(([nat, name, labelX, labelY, count, hull]) => ({ nat, name, labelX, labelY, count, hull }));
    const provinces = json.provinces.map(([cls, nat, labelX, labelY, hull]) => ({ cls, nat, labelX, labelY, hull }));
    const model = { id: json.id, nodes, links, nations, classes, provinces, byGid: new Map(nodes.map((n) => [n.gid, n])) };
    visibleLinks(model, ALL_ON, 0);
    return model;
}

/**
 * Re-score every link for the given sources and minimum score, set each link's
 * `s`/`d`/`vis`, and return the visible ones weakest first (strong lines draw on top).
 */
export function visibleLinks(model, on, minScore) {
    const out = [];
    for (const l of model.links) {
        l.s = scoreLink(l, on);
        l.d = dominantSource(l, on);
        l.vis = l.s > 0 && l.s >= minScore;
        if (l.vis) out.push(l);
    }
    return out.sort((x, y) => x.s - y.s);
}

/** ?gid= value → node, or null for anything that isn't a known numeric gid. */
export function resolveDeepLink(model, raw) {
    if (typeof raw !== 'string' || !/^\d+$/.test(raw)) return null;
    return model.byGid.get(Number(raw)) ?? null;
}

/**
 * Fetch the evidence file and make sure it belongs to the loaded graph build:
 * rows pair with graph links by position, so a file cached from another build
 * would explain every link with another pair's quotes. A stale stamp gets one
 * forced refetch, then throws. `fetchEvidence(force)` returns the parsed JSON.
 */
export async function loadMatchingEvidence(fetchEvidence, graphId) {
    let ev = await fetchEvidence(false);
    if (ev.id !== graphId) ev = await fetchEvidence(true);
    if (ev.id !== graphId) throw new Error(`relmap evidence stamp ${ev.id} does not match graph ${graphId}`);
    return ev;
}
