/**
 * data-integrity.test.mjs
 * Permanent safety net over the hand-maintained src/data/kr_event_timeline.json:
 * every 원본ID must resolve, every non-empty 날짜 must parse, and the two
 * deleted duration columns must stay deleted. Catches hand-edit typos in CI
 * before they ship as silently-standalone groups.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { parseEventDate } from '../../public/js/event-timeline.groups.js';

const here = dirname(fileURLToPath(import.meta.url));
const events = JSON.parse(
    readFileSync(join(here, '../../src/data/kr_event_timeline.json'), 'utf8')
);

test('every 원본ID points at an existing, different event ID', () => {
    const ids = new Set(events.map(e => String(e.ID)));
    for (const e of events) {
        if (!e.원본ID) continue;
        assert.ok(ids.has(String(e.원본ID)),
            `row ${e.ID} (${e.이벤트명}): 원본ID ${e.원본ID} matches no event`);
        assert.notEqual(String(e.원본ID), String(e.ID),
            `row ${e.ID} (${e.이벤트명}): self-referencing 원본ID`);
    }
});

test('every non-empty 날짜 parses', () => {
    for (const e of events) {
        const raw = (e.날짜 || '').trim();
        if (!raw || raw === '-') continue;
        assert.ok(parseEventDate(raw),
            `row ${e.ID} (${e.이벤트명}): unparseable 날짜 "${raw}"`);
    }
});

test('deleted duration columns stay deleted', () => {
    for (const e of events) {
        assert.ok(!('복각까지 얼마나 걸림?' in e) && !('복각부터 상시까지?' in e),
            `row ${e.ID} still carries a deleted duration column`);
    }
});
