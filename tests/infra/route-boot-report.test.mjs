import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';

import { ROUTE_BOOT_TARGETS } from '../../scripts/route-boot-targets.mjs';
import {
    compareSnapshots,
    distFileForPathname,
    formatBytes,
} from '../../scripts/report-route-boot.mjs';

test('route boot targets have unique keys, paths, and durable ready signals', () => {
    assert.equal(ROUTE_BOOT_TARGETS.length, 6);
    assert.equal(new Set(ROUTE_BOOT_TARGETS.map(({ key }) => key)).size, ROUTE_BOOT_TARGETS.length);
    assert.equal(new Set(ROUTE_BOOT_TARGETS.map(({ path }) => path)).size, ROUTE_BOOT_TARGETS.length);
    for (const target of ROUTE_BOOT_TARGETS) {
        assert.match(target.key, /^[A-Z0-9_]+$/);
        assert.ok(target.path.endsWith('/'));
        assert.ok(['count', 'hidden'].includes(target.ready.kind));
        assert.ok(target.ready.selector);
        assert.ok(target.ready.description);
    }
});

test('dist path resolution stays inside dist and maps route directories to index.html', () => {
    const root = mkdtempSync(join(tmpdir(), 'altoy-route-boot-'));
    mkdirSync(join(root, 'shipgirl', 'shipgirl-info'), { recursive: true });
    writeFileSync(join(root, 'shipgirl', 'shipgirl-info', 'index.html'), '<!doctype html>');

    assert.equal(
        distFileForPathname('/altoy/shipgirl/shipgirl-info/', root),
        join(root, 'shipgirl', 'shipgirl-info', 'index.html')
    );
    assert.equal(distFileForPathname('/outside/file.js', root), null);
    assert.equal(distFileForPathname('/altoy/../../outside.js', root), null);
});

test('snapshot comparison reports byte and JSON request changes without enforcing them', () => {
    const route = (raw, jsonPaths) => ({
        json: jsonPaths.map((path) => ({ path })),
        bytes: { total: { raw, gzip: raw - 10, brotli: raw - 20 } },
    });
    const baseline = { targets: { FLEET_SIM: route(100, ['/altoy/data/a.json']) } };
    const current = { targets: { FLEET_SIM: route(140, ['/altoy/data/b.json']) } };

    assert.deepEqual(compareSnapshots(current, baseline), [{
        key: 'FLEET_SIM',
        kind: 'changed',
        rawDelta: 40,
        gzipDelta: 40,
        brotliDelta: 40,
        addedJson: ['/altoy/data/b.json'],
        removedJson: ['/altoy/data/a.json'],
    }]);
});

test('formatBytes keeps report output compact', () => {
    assert.equal(formatBytes(512), '512 B');
    assert.equal(formatBytes(1536), '1.5 KiB');
    assert.equal(formatBytes(2 * 1024 * 1024), '2.00 MiB');
    assert.equal(formatBytes(-1536), '-1.5 KiB');
});
