/**
 * story-actor-index.mjs
 * Pure builder for `story_actor_index.json` — the character → memories index
 * behind /story-viewer/story-search/.
 *
 * Deliberately free of `fs`: the generated index is a `data:split` artifact and
 * therefore git-ignored, and CI runs `npm test` before `npm run build`, so tests
 * must exercise this logic against fixtures rather than the emitted file.
 * `split_story_data.mjs` owns all the reading and writing.
 */

/** Story-NPC portrait ids share this range with real ships — see characterKey. */
const NPC_MIN = 900000;
const NPC_MAX = 1000000;

/**
 * Story scripts and `subActors` are arrays in the overwhelming majority of
 * records but a handful arrive from the pipeline as plain objects, which would
 * otherwise throw mid-walk.
 */
const toArray = (value) => (
    Array.isArray(value) ? value
        : value && typeof value === 'object' ? Object.values(value)
            : []
);

/**
 * Group one actor id with the other ids that are the same character.
 *
 * Normal skin ids follow `gid * 10 + skinIndex`, so `floor(id / 10)` collapses a
 * ship's skins onto its group id. Story-NPC portraits do NOT: they are packed one
 * id per character, so dividing there merges unrelated people — group 90019 holds
 * 엔터프라이즈, 타카오, 호넷 AND 워스파이트, and it filed 워스파이트's scenes under
 * 엔터프라이즈 until 2026-08-13.
 *
 * Those portraits live in 900000–999999, but **so do real ships** (장 바르 905010,
 * 가스코뉴 999010 — the 비시아/아이리스 factions), so the range alone cannot decide
 * it. `knownGids` (the ship roster) does: inside that range, a group id the roster
 * knows is a genuine skin group and anything else is per-id portraits. Outside the
 * range every id is a skin group, including the ~26 whose ship is missing from the
 * roster (collabs).
 *
 * @param {number} actorId
 * @param {Set<number>} [knownGids] - ship group ids from the roster
 * @returns {string} ship gid, or `n<id>` for a story-NPC portrait
 */
export function characterKey(actorId, knownGids) {
    const gid = Math.floor(actorId / 10);
    const isNpc = actorId >= NPC_MIN && actorId < NPC_MAX && !knownGids?.has(gid);
    return isNpc ? `n${actorId}` : String(gid);
}

/** A key is a real ship group only when it is not from the NPC block. */
const isShipKey = (key) => !key.startsWith('n');

/**
 * Collect the actor ids of every character appearing in one memory's script.
 *
 * Mirrors the engine's `getActorInfo` resolution order (story-viewer.engine.js):
 * the speaking `actor`, an `actorName` override, and non-speaking `subActors`.
 *
 * @param {Array|Object} scripts - The memory's `story.scripts`
 * @param {(actorId: number) => boolean} [isKnownActor] - Guard for `actorName`
 * @returns {Set<number>} actor ids (NOT character keys)
 */
export function collectActorIds(scripts, isKnownActor = () => true) {
    const ids = new Set();

    for (const line of toArray(scripts)) {
        if (!line || typeof line !== 'object') continue;

        if (typeof line.actor === 'number' && line.actor > 0) ids.add(line.actor);

        // actorName overrides the speaker, but it doubles as a literal display
        // name ('???', a Korean NPC name) — only ids that resolve to a real
        // actor are characters.
        const override = Number.parseInt(line.actorName, 10);
        if (Number.isInteger(override) && override > 0 && isKnownActor(override)) ids.add(override);

        for (const sub of toArray(line.subActors)) {
            if (sub && sub.actor > 0) ids.add(sub.actor);
        }
    }

    return ids;
}

/**
 * Reduce the actor table to one display name per character key, preferring the
 * base skin (`gid * 10`) so the plain name wins over 「(수영복)」 variants. NPC
 * keys are one id each, so their own name is the base name.
 *
 * Names are trimmed: 324 of the upstream skin names carry a trailing space and
 * the ship/NPC entries for the same character don't agree on it (`"토사 "` vs
 * `"토사"`), which split 43 characters into duplicate rows in the exact-name
 * merge below. Trim HERE, not in shipgirl_data.json — the WSL name → skin-id
 * lookup matches story text against the untrimmed form.
 *
 * @param {Record<string, {name: string}>} actorTable - shipgirl_data.json
 * @param {Set<number>} [knownGids] - ship group ids from the roster
 * @returns {Record<string, string>} character key → name
 */
export function baseNames(actorTable, knownGids) {
    const names = {};

    for (const [actorId, entry] of Object.entries(actorTable)) {
        const id = Number(actorId);
        if (!Number.isInteger(id)) continue;
        const key = characterKey(id, knownGids);
        if (!isShipKey(key) || id % 10 === 0 || !(key in names)) names[key] = entry?.name?.trim() || '';
    }

    return names;
}

/**
 * Build the search index from every story source.
 *
 * Memories are stored once as compact tuples and referenced by row number, so a
 * character appearing in 196 memories costs 196 integers rather than 196 copies
 * of the title. Memories with no resolvable character (pure narration) are
 * skipped — nothing could ever reference them.
 *
 * Keys sharing an exact display name are merged into one character: the 9xxxxx
 * story-NPC portraits are the same shipgirls as their ship entries (라피 is both
 * 10117 and n900240), and leaving them apart splits one character across several
 * near-identical search results. The surviving key is the ship gid whenever one
 * exists, so `?gid=` stays a real gid consistent with the rest of the site.
 *
 * `shipInfo` (gid → rarity/진영, resolved by the caller) is baked in here rather
 * than fetched at runtime: the page needs two labels per character, which is not
 * worth pulling a 274 KB roster and a mapping file for.
 *
 * @param {Array<{src: 'm'|'e'|'w', id: number, name: string, subtype?: number, memories: Array<{id: number, title: string, scripts: *}>}>} sources
 * @param {Record<string, {name: string}>} actorTable - shipgirl_data.json
 * @param {Record<string, {rarity: string, faction: string}>} [shipInfo] - by gid
 * @returns {{v: number, memories: Array, ships: Record<string, number[]>, names: Record<string, string>, info: Record<string, [string, string]>}}
 */
export function buildActorIndex(sources, actorTable, shipInfo = {}) {
    // The roster doubles as the ship/NPC discriminator inside 9xxxxx.
    const knownGids = new Set(Object.keys(shipInfo).map(Number));
    const names = baseNames(actorTable, knownGids);
    const isKnownActor = (actorId) => Object.hasOwn(actorTable, actorId);

    const memories = [];
    const byKey = new Map();

    for (const source of sources) {
        for (const memory of source.memories || []) {
            const actorIds = collectActorIds(memory.scripts, isKnownActor);
            if (actorIds.size === 0) continue;

            const row = memories.length;
            // 6th slot = the event's own E.X./S.P./데일리 subtype; appended only
            // for event rows, since main/world memories have no such grading.
            const tuple = [source.src, source.id, memory.id, memory.title || '', source.name || ''];
            if (source.subtype) tuple.push(source.subtype);
            memories.push(tuple);

            for (const actorId of actorIds) {
                const key = characterKey(actorId, knownGids);
                if (!byKey.has(key)) byKey.set(key, new Set());
                byKey.get(key).add(row);
            }
        }
    }

    return { v: 1, memories, ...mergeByName(byKey, names, shipInfo) };
}

/**
 * Collapse character keys that share an exact display name.
 * Unnamed entries stay separate — an empty name is missing data, not a match.
 *
 * @param {Map<string, Set<number>>} byKey - character key → memory rows
 * @param {Record<string, string>} names - character key → display name
 * @param {Record<string, {rarity: string, faction: string}>} shipInfo - by gid
 */
function mergeByName(byKey, names, shipInfo) {
    const characters = new Map();

    for (const [key, rows] of byKey) {
        const name = names[key] || '';
        const groupId = name ? `name:${name}` : `key:${key}`;
        const existing = characters.get(groupId);

        if (!existing) {
            characters.set(groupId, { key, name: name || `#${key}`, rows: new Set(rows) });
            continue;
        }
        for (const row of rows) existing.rows.add(row);
        // Prefer a real ship gid as the surviving key; among equals, the lowest.
        if ((isShipKey(key) && !isShipKey(existing.key))
            || (isShipKey(key) === isShipKey(existing.key) && key.localeCompare(existing.key, 'en', { numeric: true }) < 0)) {
            existing.key = key;
        }
    }

    const ships = {};
    const outNames = {};
    const info = {};
    for (const character of [...characters.values()].sort((a, b) => b.rows.size - a.rows.size)) {
        ships[character.key] = [...character.rows].sort((a, b) => a - b);
        outNames[character.key] = character.name;
        // Story-only NPCs have no roster entry — the page renders name alone.
        const entry = shipInfo[character.key];
        if (entry) info[character.key] = [entry.rarity || '', entry.faction || ''];
    }

    return { ships, names: outNames, info };
}
