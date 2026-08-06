import { readFileSync, statSync } from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const dataUrl = new URL('../../public/data/', import.meta.url);

function readJson(path) {
    return JSON.parse(readFileSync(new URL(path, dataUrl), 'utf8'));
}

function buildExpectedEntries(fullMap, liteShips) {
    const idToGid = new Map(liteShips.map(({ id, gid }) => [id, String(gid)]));
    const validGids = new Set(liteShips.map(({ gid }) => String(gid)));
    const gidToEvents = new Map();

    function addEvent(gid, eventName) {
        if (!gid || !eventName) return;
        if (!gidToEvents.has(gid)) gidToEvents.set(gid, new Set());
        gidToEvents.get(gid).add(eventName);
    }

    for (const [key, chapter] of Object.entries(fullMap)) {
        if (!key.startsWith('a_')) continue;
        for (const drop of chapter.ship_drops_archive || []) {
            addEvent(idToGid.get(drop.id), chapter.event_name);
        }

        const specialDrop = chapter.special_drop;
        if (specialDrop?.type === 4 && specialDrop.id != null) {
            const rawId = String(specialDrop.id);
            addEvent(
                validGids.has(rawId) ? rawId : idToGid.get(specialDrop.id),
                chapter.event_name
            );
        }
    }

    return Object.fromEntries([...gidToEvents].map(([gid, events]) => {
        const allEvents = [...events];
        const shown = allEvents.slice(0, 2);
        const suffix = allEvents.length > shown.length
            ? ` +${allEvents.length - shown.length}`
            : '';
        return [gid, shown.join(', ') + suffix];
    }));
}

test('research archive index matches the authoritative map and ship data', () => {
    const index = readJson('shipgirl/archive_drop_index.json');
    const fullMap = readJson('maps/map_data_full.json');
    const liteShips = readJson('ship_info_lite.json');

    assert.equal(index.version, 1);
    assert.deepEqual(index.entries, buildExpectedEntries(fullMap, liteShips));
    assert.ok(Object.keys(index.entries).length > 0);
});

/**
 * The index keys a ship only through its event label, so a chapter without one
 * drops that ship out of the 아카이브 group entirely. The old page code grouped
 * it anyway (unlabeled). `buildExpectedEntries` skips the same chapters the
 * producer does, so a deepEqual can never see this class — assert the
 * precondition instead.
 */
test('every archive chapter carries the event name the index projects through', () => {
    const fullMap = readJson('maps/map_data_full.json');
    const unnamed = Object.entries(fullMap)
        .filter(([key, chapter]) => key.startsWith('a_') && !chapter.event_name)
        .map(([key]) => key);

    assert.deepEqual(unnamed, [], 'archive chapters without event_name lose their ships from the index');
});

test('research archive index stays a compact boot payload', () => {
    const indexPath = new URL('shipgirl/archive_drop_index.json', dataUrl);
    assert.ok(statSync(indexPath).size < 8 * 1024);
});
