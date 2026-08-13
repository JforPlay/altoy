import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';

import { ROUTE_BOOT_TARGETS } from '../../scripts/route-boot-targets.mjs';
import {
    classifyPath,
    compareSnapshots,
    distBuildMode,
    distFileForPathname,
    formatBytes,
} from '../../scripts/report-route-boot.mjs';

test('route boot targets have unique keys and durable ready signals', () => {
    assert.equal(ROUTE_BOOT_TARGETS.length, 14);
    assert.equal(new Set(ROUTE_BOOT_TARGETS.map(({ key }) => key)).size, ROUTE_BOOT_TARGETS.length);
    for (const target of ROUTE_BOOT_TARGETS) {
        assert.match(target.key, /^[A-Z0-9_]+$/);
        assert.ok(target.path.endsWith('/'));
        assert.ok(['count', 'hidden', 'event-count'].includes(target.ready.kind));
        assert.ok(target.ready.selector);
        assert.ok(target.ready.description);
        assert.ok(['ready', 'networkidle'].includes(target.cutoff || 'ready'));
        if (target.ready.storage) {
            assert.equal(typeof target.ready.storage.key, 'string');
            assert.ok(target.ready.storage.key);
            assert.equal(typeof target.ready.storage.value, 'string');
        }
        if (target.ready.kind === 'event-count') {
            assert.ok(target.ready.trigger);
            assert.ok(target.ready.event);
        }
    }
    const targetsByKey = new Map(ROUTE_BOOT_TARGETS.map((target) => [target.key, target]));
    for (const key of [
        'SHIPGIRL_INFO',
        'SHIPGIRL_STATS',
        'ISLAND_RESTAURANT',
        'PRIVACY',
        'EQUIP_SKIN',
        'MAP_VIEWER',
        'SKIN_DETAIL',
        'CROSS_FLEET_BARRAGES',
        'SIM_AIRCRAFT',
    ]) {
        assert.equal(targetsByKey.get(key)?.cutoff, 'networkidle');
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

test('build mode is detected from the served copy of utils.js', () => {
    const root = mkdtempSync(join(tmpdir(), 'altoy-build-mode-'));
    const dist = join(root, 'dist');
    mkdirSync(join(root, 'public', 'js'), { recursive: true });
    mkdirSync(join(dist, 'js'), { recursive: true });
    writeFileSync(join(root, 'public', 'js', 'utils.js'), 'export const a = 1;\n');

    assert.equal(distBuildMode(dist, root), 'unknown');

    writeFileSync(join(dist, 'js', 'utils.js'), 'export const a = 1;\n');
    assert.equal(distBuildMode(dist, root), 'unminified');

    writeFileSync(join(dist, 'js', 'utils.js'), 'export const a=1');
    assert.equal(distBuildMode(dist, root), 'minified');
});

test('snapshot comparison flags a build-mode switch but grandfathers unstamped baselines', () => {
    const snapshot = (buildMode) => ({
        schemaVersion: 4,
        ...(buildMode ? { buildMode } : {}),
        targets: { TEST: route() },
    });

    assert.deepEqual(
        compareSnapshots(snapshot('minified'), snapshot('unminified')),
        [{ kind: 'build-mode-changed', before: 'unminified', after: 'minified' }]
    );
    assert.deepEqual(compareSnapshots(snapshot('unminified'), snapshot('unminified')), []);
    // A snapshot predating the field cannot be attributed to a mode after the fact.
    assert.deepEqual(compareSnapshots(snapshot('minified'), snapshot(null)), []);
});

test('resource classification never promotes an intentionally skipped request to HTML', () => {
    assert.equal(classifyPath('/altoy/assets/extensionless-image', 'image'), null);
    assert.equal(classifyPath('/altoy/assets/extensionless-font', 'font'), null);
    assert.equal(classifyPath('/altoy/assets/extensionless-media', 'media'), null);
    assert.equal(classifyPath('/altoy/api/status', 'fetch'), null);
    assert.equal(classifyPath('/altoy/shipgirl/shipgirl-info/', 'document'), 'html');
});

function resource(path, raw = 20) {
    return {
        path,
        raw,
        gzip: raw - 5,
        brotli: raw - 10,
    };
}

function route({
    raw = 100,
    readyRaw = raw,
    path = 'test/',
    ready = 'test ready',
    cutoff = 'ready',
    pageEntries = ['/altoy/js/test-entry.js'],
    html = ['/altoy/test/'],
    js = ['/altoy/js/test.js'],
    css = ['/altoy/test.css'],
    json = ['/altoy/data/test.json'],
} = {}) {
    return {
        path,
        ready,
        cutoff,
        pageEntries,
        html: html.map((entry) => resource(entry)),
        js: js.map((entry) => resource(entry)),
        css: css.map((entry) => resource(entry)),
        json: json.map((entry) => resource(entry)),
        bytesAtReady: {
            total: {
                raw: readyRaw,
                gzip: readyRaw - 10,
                brotli: readyRaw - 20,
            },
        },
        bytes: {
            total: {
                raw,
                gzip: raw - 10,
                brotli: raw - 20,
            },
        },
    };
}

test('snapshot comparison reports aggregate bytes and every resource request set', () => {
    const baseline = {
        schemaVersion: 3,
        targets: {
            TEST: route({
                raw: 100,
                pageEntries: ['/altoy/js/old-entry.js'],
                html: ['/altoy/old/'],
                js: ['/altoy/js/old.js'],
                css: ['/altoy/old.css'],
                json: ['/altoy/data/old.json'],
            }),
        },
    };
    const current = {
        schemaVersion: 3,
        targets: {
            TEST: route({
                raw: 140,
                pageEntries: ['/altoy/js/new-entry.js'],
                html: ['/altoy/new/'],
                js: ['/altoy/js/new.js'],
                css: ['/altoy/new.css'],
                json: ['/altoy/data/new.json'],
            }),
        },
    };

    const [delta] = compareSnapshots(current, baseline);
    assert.equal(delta.key, 'TEST');
    assert.equal(delta.kind, 'changed');
    assert.equal(delta.rawDelta, 40);
    assert.equal(delta.gzipDelta, 40);
    assert.equal(delta.brotliDelta, 40);
    assert.equal(delta.readyRawDelta, 40);
    assert.equal(delta.readyGzipDelta, 40);
    assert.equal(delta.readyBrotliDelta, 40);
    assert.deepEqual(delta.entryChanges, {
        added: ['/altoy/js/new-entry.js'],
        removed: ['/altoy/js/old-entry.js'],
    });
    assert.deepEqual(delta.resourceChanges.html.added, ['/altoy/new/']);
    assert.deepEqual(delta.resourceChanges.js.added, ['/altoy/js/new.js']);
    assert.deepEqual(delta.resourceChanges.css.added, ['/altoy/new.css']);
    assert.deepEqual(delta.resourceChanges.json.added, ['/altoy/data/new.json']);
});

test('snapshot comparison catches equal-byte replacements, metadata, and resized resources', () => {
    const baselineRoute = route({ readyRaw: 80 });
    const currentRoute = route({
        readyRaw: 60,
        ready: 'new ready signal',
        cutoff: 'networkidle',
        pageEntries: ['/altoy/js/new-entry.js'],
        js: ['/altoy/js/new.js'],
    });
    currentRoute.css[0] = resource('/altoy/test.css', 25);

    const [delta] = compareSnapshots(
        { schemaVersion: 3, targets: { TEST: currentRoute } },
        { schemaVersion: 3, targets: { TEST: baselineRoute } }
    );

    assert.equal(delta.rawDelta, 0);
    assert.equal(delta.readyRawDelta, -20);
    assert.equal(delta.readyGzipDelta, -20);
    assert.equal(delta.readyBrotliDelta, -20);
    assert.deepEqual(delta.metadataChanges, [
        { field: 'ready', before: 'test ready', after: 'new ready signal' },
        { field: 'cutoff', before: 'ready', after: 'networkidle' },
    ]);
    assert.deepEqual(delta.resourceChanges.js.added, ['/altoy/js/new.js']);
    assert.deepEqual(delta.resourceChanges.js.removed, ['/altoy/js/test.js']);
    assert.deepEqual(delta.resourceChanges.css.resized, [{
        path: '/altoy/test.css',
        rawDelta: 5,
        gzipDelta: 5,
        brotliDelta: 5,
    }]);
});

test('snapshot comparison reports schema changes and removed routes', () => {
    assert.deepEqual(
        compareSnapshots(
            { schemaVersion: 3, targets: {} },
            { schemaVersion: 2, targets: { REMOVED: route() } }
        ),
        [
            { kind: 'schema-changed', before: 2, after: 3 },
            { key: 'REMOVED', kind: 'removed-route' },
        ]
    );
});

test('formatBytes keeps report output compact', () => {
    assert.equal(formatBytes(512), '512 B');
    assert.equal(formatBytes(1536), '1.5 KiB');
    assert.equal(formatBytes(2 * 1024 * 1024), '2.00 MiB');
    assert.equal(formatBytes(-1536), '-1.5 KiB');
});
