/**
 * relmap-graph.mjs
 * Pure builder for the 함순이 관계도 graph (public/data/relmap/). Collects pair
 * evidence from fleet lines, voiceline name mentions, story co-appearance and
 * JUUS posts, then picks which links to keep.
 *
 * Free of `fs` on purpose: the output is a git-ignored data:split artifact and
 * CI runs `npm test` before the build, so tests use fixtures.
 * `split_relmap_data.mjs` owns the reading and writing.
 */
import { scoreLink } from '../public/js/shipgirl/shipgirl-relations.model.js';
import { normalizeRomanNumerals } from '../public/js/utils.js';
import { layoutRelmap } from './relmap-layout.mjs';

const MIN_SCORE = 2;          // a link scoring this much is always shown
const TOP_K = 3;              // …and so is each shipgirl's 3 strongest
const MAX_FLEET_PARTNERS = 4; // longer partner lists are faction calls, not pair links
const STOPLIST = new Set(['휴가', '차라', '공주', '보이시', '파고', '저지', '히어로']);
const SKIP_FIELDS = new Set(['함대 특수대사', '설명', '드랍 설명']);
const FLEET_TEXT = /^\[.*?\]\s*:\s*([\s\S]*)$/;
const MAIN_NATIONS = [1, 2, 4, 6, 8, 9, 7, 5, 3]; // inner ring of the map
const EVIDENCE_CAP = { fleet: 2, mention: 2, stories: 3 };

// ===== Name matching =====

/** Base name a shipgirl uses for herself: drops 꼬마, ·META, (μ장비), 改 and a trailing Ⅱ/Ⅲ. */
export function ownBase(name) {
    return name.trim()
        .replace(/^꼬마\s*/, '')
        .replace(/·META$|\(μ장비\)$|改$/, '')
        .replace(/\s*(Ⅱ|Ⅲ|II|III)$/, '')
        .trim();
}

// Regex source for a name that also accepts the ASCII spelling of Ⅱ/Ⅲ, so the
// match reports the text's own substring (the panel highlights it verbatim).
const namePattern = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    .replace(/Ⅲ/g, '(?:Ⅲ|III)')
    .replace(/Ⅱ/g, '(?:Ⅱ|II)');

/**
 * Build a matcher `(text, speaker) → [{gid, matched}]` over exact display names
 * and aliases, longest first. META / μ장비 forms only match their exact name;
 * a speaker's own base name is a self-reference. Unique per gid within one text.
 */
export function createMentionMatcher(ships, aliases = []) {
    const byName = new Map(ships.map((s) => [normalizeRomanNumerals(s.name.trim()), s.gid]));
    const byAlias = new Map();
    for (const a of aliases) {
        if (!byAlias.has(a.alias)) byAlias.set(a.alias, []);
        byAlias.get(a.alias).push(a);
    }
    const terms = [...new Set([
        ...[...byName.keys()].filter((n) => n.length >= 2 && !STOPLIST.has(n)),
        ...byAlias.keys(),
    ])].sort((x, y) => y.length - x.length);
    // (?=(…))\1 makes the name choice atomic: when "요크타운" is rejected by the
    // right context ("요크타운급"), the engine must not retry "요크" at the same spot.
    const re = new RegExp(`(?<![가-힣A-Za-z0-9])(?=(${terms.map(namePattern).join('|')}))\\1(?!\\s?유니온|급|형)`, 'g');

    return (text, speaker) => {
        const own = normalizeRomanNumerals(ownBase(speaker.name));
        const found = new Map();
        for (const m of text.matchAll(re)) {
            const raw = m[1];
            const key = normalizeRomanNumerals(raw);
            const cands = byAlias.get(raw);
            // A speaker-scoped alias (폐하 for 벨파스트) beats an unscoped one.
            let gid = cands && (cands.find((c) => c.speakers?.includes(speaker.gid))
                ?? cands.find((c) => !c.speakers?.length))?.gid;
            if (gid == null && !cands) gid = byName.get(key);
            if (gid == null || gid === speaker.gid || key === own || found.has(gid)) continue;
            found.set(gid, { gid, matched: raw });
        }
        return [...found.values()];
    };
}

// ===== Pair collection =====

/**
 * Walk every source and return pair evidence keyed 'minGid-maxGid':
 * {fleet: FleetEv[], mention: MentionEv[], story, storyW, stories: memIdx[≤3], juus}.
 */
export function collectPairs({ ships, voicelines, actorIndex, juusPosts, aliases = [] }) {
    const roster = new Map(ships.map((s) => [s.gid, s]));
    const pairs = new Map();
    const pair = (a, b) => {
        const k = a < b ? `${a}-${b}` : `${b}-${a}`;
        if (!pairs.has(k)) pairs.set(k, { fleet: [], mention: [], story: 0, storyW: 0, stories: [], juus: 0 });
        return pairs.get(k);
    };
    const match = createMentionMatcher(ships, aliases);
    const seenFleet = new Set();
    const seenText = new Set();

    for (const entry of voicelines) {
        const g = entry['클뜯 함순이 id'];
        const speaker = roster.get(g);
        if (!speaker) continue;
        for (const x of entry['함대 특수대사'] || []) {
            // kind 0 = partners are gids; 1-4 are faction/type selectors.
            if (x.kind !== 0 || !Array.isArray(x.partners) || x.partners.length > MAX_FLEET_PARTNERS) continue;
            const text = FLEET_TEXT.exec(x.voiceline)?.[1];
            if (!text || seenFleet.has(`${g}|${text}`)) continue;
            seenFleet.add(`${g}|${text}`);
            const partners = [...new Set(x.partners)].filter((p) => p !== g && roster.has(p));
            // A speaker on her own list counts toward `need` (하타카제 lists herself + 2 with need 3).
            const need = Math.max(1, x.need - (x.partners.includes(g) ? 1 : 0));
            const ev = { speaker: g, text, audio: x.voicelink ?? null, partners, need };
            for (const p of partners) pair(g, p).fleet.push(ev);
        }
        for (const [field, value] of Object.entries(entry)) {
            if (SKIP_FIELDS.has(field)) continue;
            for (const x of Array.isArray(value) ? value : [value]) {
                if (!x || typeof x.voiceline !== 'string' || seenText.has(`${g}|${x.voiceline}`)) continue;
                seenText.add(`${g}|${x.voiceline}`);
                for (const { gid, matched } of match(x.voiceline, speaker)) {
                    pair(g, gid).mention.push({ speaker: g, text: x.voiceline, audio: x.voicelink ?? null, matched });
                }
            }
        }
    }

    // Story weight 1/(cast−1) keeps the main-story regulars from dominating.
    const cast = new Map();
    for (const [g, mems] of Object.entries(actorIndex.ships)) {
        if (!roster.has(Number(g))) continue;
        for (const m of mems) {
            if (!cast.has(m)) cast.set(m, []);
            cast.get(m).push(Number(g));
        }
    }
    for (const m of [...cast.keys()].sort((x, y) => x - y)) {
        const c = cast.get(m);
        for (let i = 0; i < c.length; i++) {
            for (let j = i + 1; j < c.length; j++) {
                const p = pair(c[i], c[j]);
                p.story++;
                p.storyW += 1 / (c.length - 1);
                if (p.stories.length < 3) p.stories.push(m);
            }
        }
    }

    for (const post of juusPosts) {
        const c = [...new Set([post.ship_group, ...(post.shipgirl_names || [])])].filter((g) => roster.has(g));
        for (let i = 0; i < c.length; i++) for (let j = i + 1; j < c.length; j++) pair(c[i], c[j]).juus++;
    }
    return pairs;
}

// ===== Classes (함급) =====

/**
 * Hull classes from skill-target tags: `X-Class` minus `Plan-Class` (research
 * ships), ≥ 2 members. Korean names come from the hand table; a tag without
 * one keeps the tag as its name and is reported in missingNames.
 */
export function buildClasses(ships, shipTags, classNames, descOf = new Map()) {
    const isClassTag = (tag) => /-Class$/.test(tag) && tag !== 'Plan-Class';
    const byTag = new Map();
    for (const s of ships) {
        for (const tag of (shipTags[s.gid] || []).filter(isClassTag)) {
            if (!byTag.has(tag)) byTag.set(tag, []);
            byTag.get(tag).push(s.gid);
        }
    }
    const classes = [...byTag].filter(([, members]) => members.length >= 2)
        .map(([tag, members]) => ({ tag, kr: classNames[tag] ?? tag, members }));
    const missingNames = classes.filter((c) => !(c.tag in classNames)).map((c) => c.tag);

    // Ships no skill targets carry no class tag; their 설명 line often names the class.
    // Join a same-nation tag class of that name ("M급" is a RN and a KMS class), else
    // group by name. META forms stay out, as they do for tags.
    const natOf = new Map(ships.map((s) => [s.gid, s.nationality]));
    const byDesc = new Map();
    for (const s of ships) {
        const kr = descOf.get(s.gid);
        if (!kr || (shipTags[s.gid] || []).some(isClassTag) || /·META$/.test(s.name.trim())) continue;
        const host = classes.find((c) => c.kr === kr && c.members.some((g) => natOf.get(g) === s.nationality));
        if (host) { host.members.push(s.gid); continue; }
        if (!byDesc.has(kr)) byDesc.set(kr, []);
        byDesc.get(kr).push(s.gid);
    }
    for (const [kr, members] of byDesc) {
        if (members.length >= 2) classes.push({ tag: `설명:${kr}`, kr, members });
    }
    return { classes, missingNames };
}

// 설명 designation line: "<class>급 <hull type>—<name>"; separators vary (—, -, ·, space).
const DESC_CLASS = /^\s*(\S.{0,29}?)\s?급\s*((?:[가-힣]+\s)?[가-힣]*(?:함|모함|정))(?=[\s—·・\-(,]|$)/;

/**
 * Class name from a 설명 line ("즈이호급 경항공모함—치토세" → "즈이호급"), or null
 * for intros and other free text. A leading nation name ("비시아 성좌 쉬프랑급") is dropped.
 */
export function descClass(desc, nationNames) {
    const m = typeof desc === 'string' ? DESC_CLASS.exec(desc) : null;
    if (!m) return null;
    let name = m[1].replace(/\s+/g, ' ').trim(); // some lines use U+00A0 between words
    if (/[!?,…~"「」]|[가-힣]\./.test(name)) return null; // a sentence, not a designation
    for (const n of nationNames) if (n && name.startsWith(`${n} `)) name = name.slice(n.length + 1);
    return `${name}급`;
}

/**
 * Provinces = (nation, the ship's largest class) with ≥ 2 members, so sisters sit
 * together inside their nation. Returns [{cls: class index, nat, members: gid[]}].
 */
export function buildProvinces(ships, classes) {
    const classesOf = new Map();
    classes.forEach((c, ci) => c.members.forEach((g) => {
        if (!classesOf.has(g)) classesOf.set(g, []);
        classesOf.get(g).push(ci);
    }));
    const provs = new Map();
    for (const s of ships) {
        const cis = classesOf.get(s.gid);
        if (!cis) continue;
        const cls = cis.reduce((a, b) => (classes[b].members.length > classes[a].members.length ? b : a));
        const k = `${s.nationality}:${cls}`;
        if (!provs.has(k)) provs.set(k, { cls, nat: s.nationality, members: [] });
        provs.get(k).members.push(s.gid);
    }
    return [...provs.values()].filter((p) => p.members.length >= 2);
}

// ===== Link selection =====

/** Pair evidence → the {f, m, sw, j} counts scoreLink takes. */
export function pairCounts(p) {
    return { f: p.fleet.length, m: p.mention.length, sw: p.storyW, j: p.juus };
}

/**
 * Keep a pair if it scores ≥ 2 or is among either shipgirl's 3 strongest
 * (ties → lower partner gid). Returns [{a, b, pair, score}] with gids a < b, sorted.
 */
export function selectLinks(pairs) {
    const scored = [];
    const byShip = new Map();
    for (const [k, p] of pairs) {
        const score = scoreLink(pairCounts(p));
        if (!(score > 0)) continue;
        const [a, b] = k.split('-').map(Number);
        const link = { a, b, pair: p, score };
        scored.push(link);
        for (const [g, other] of [[a, b], [b, a]]) {
            if (!byShip.has(g)) byShip.set(g, []);
            byShip.get(g).push({ link, other });
        }
    }
    const keep = new Set(scored.filter((l) => l.score >= MIN_SCORE));
    for (const list of byShip.values()) {
        list.sort((x, y) => y.link.score - x.link.score || x.other - y.other)
            .slice(0, TOP_K)
            .forEach(({ link }) => keep.add(link));
    }
    return scored.filter((l) => keep.has(l)).sort((x, y) => x.a - y.a || x.b - y.b);
}

// ===== Assembly =====

// 32-bit FNV-1a, hex — a build stamp, not a security hash.
function fnv1a(str) {
    let h = 0x811c9dc5;
    for (let i = 0; i < str.length; i++) h = Math.imul(h ^ str.charCodeAt(i), 0x01000193);
    return (h >>> 0).toString(16);
}

/**
 * Build both relmap files from the committed inputs: the boot graph (nodes with
 * baked layout, links, nations, classes, provinces) and the lazy evidence file
 * whose links[i] explains graph.links[i]. See the plan's data contract.
 */
export function buildRelmap({ ships, shipTags, voicelines, actorIndex, juusPosts, nations, classNames, aliases: rawAliases = [] }) {
    const warnings = [];
    const idx = new Map(ships.map((s, i) => [s.gid, i]));
    // The alias table is hand-edited: a typo'd gid must not take the build down.
    const aliases = rawAliases.filter((a) => idx.has(a.gid));
    for (const a of rawAliases) if (!idx.has(a.gid)) warnings.push(`alias "${a.alias}" → unknown gid ${a.gid}, skipped`);
    const kept = selectLinks(collectPairs({ ships, voicelines, actorIndex, juusPosts, aliases }))
        .map((l) => {
            const [a, b] = [idx.get(l.a), idx.get(l.b)].sort((x, y) => x - y);
            return { ...l, a, b };
        })
        .sort((x, y) => x.a - y.a || x.b - y.b);

    const linkCount = new Array(ships.length).fill(0);
    for (const l of kept) { linkCount[l.a]++; linkCount[l.b]++; }
    const radius = linkCount.map((n) => 5 + Math.sqrt(n) * 2.4);

    const nationNames = Object.values(nations).map((n) => n?.name).filter(Boolean);
    const descOf = new Map();
    for (const e of voicelines) {
        const g = e['클뜯 함순이 id'];
        const kr = descOf.has(g) ? null : descClass(typeof e['설명'] === 'string' ? e['설명'] : e['설명']?.voiceline, nationNames);
        if (kr) descOf.set(g, kr);
    }
    const { classes, missingNames } = buildClasses(ships, shipTags, classNames, descOf);
    if (missingNames.length) warnings.push(`class names missing (tag used): ${missingNames.join(', ')}`);
    const provinces = buildProvinces(ships, classes).map((p) => ({ ...p, members: p.members.map((g) => idx.get(g)) }));
    const provinceOf = new Array(ships.length).fill(-1);
    provinces.forEach((p, pi) => p.members.forEach((i) => { provinceOf[i] = pi; }));

    const noPartners = voicelines.flatMap((e) => e['함대 특수대사'] || []).filter((x) => !Array.isArray(x.partners)).length;
    if (noPartners) warnings.push(`${noPartners} 함대 특수대사 entries have no "partners" (run the WSL pipeline)`);

    const layout = layoutRelmap({
        nodes: ships.map((s, i) => ({ nat: s.nationality, r: radius[i] })),
        links: kept.map((l) => ({ a: l.a, b: l.b, score: l.score })),
        provinces: provinces.map((p) => ({ ...p, kr: classes[p.cls].kr })),
        mainNations: MAIN_NATIONS,
    });

    // Evidence rows pair with graph links by position; a shared stamp lets the page
    // reject an evidence file cached from a different build.
    const id = fnv1a(kept.map((l) => `${ships[l.a].gid}-${ships[l.b].gid}`).join(','));
    const graph = {
        v: 1,
        id,
        nodes: ships.map((s, i) => [
            s.gid, s.name, s.nationality,
            Math.round(layout.xy[i][0]), Math.round(layout.xy[i][1]),
            Number(radius[i].toFixed(1)), linkCount[i], provinceOf[i],
        ]),
        links: kept.map(({ a, b, pair }) => [a, b, pair.fleet.length, pair.mention.length, Number(pair.storyW.toFixed(2)), pair.juus]),
        nations: layout.nations.map((n) => [
            n.nat, nations[n.nat]?.name ?? '기타', Math.round(n.labelX), Math.round(n.labelY), n.members.length, n.hull,
        ]),
        classes: classes.map((c) => [c.kr, c.tag, c.members.map((g) => idx.get(g))]),
        provinces: provinces.map((p, pi) => [
            p.cls, p.nat, Math.round(layout.provinces[pi].labelX), Math.round(layout.provinces[pi].labelY), layout.provinces[pi].hull,
        ]),
    };
    const evidence = {
        v: 1,
        id,
        links: kept.map(({ pair }) => [
            pair.fleet.slice(0, EVIDENCE_CAP.fleet)
                .map((e) => [idx.get(e.speaker), e.text, e.audio, e.partners.map((g) => idx.get(g)), e.need]),
            pair.mention.slice(0, EVIDENCE_CAP.mention)
                .map((e) => [idx.get(e.speaker), e.text, e.audio, e.matched]),
            pair.story,
            pair.stories.slice(0, EVIDENCE_CAP.stories).map((m) => actorIndex.memories[m]),
        ]),
    };
    return { graph, evidence, warnings };
}
