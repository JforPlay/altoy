import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
    compareStructureFindings,
    extractGlobalAssignments,
    extractPageModulePaths,
    extractStaticModuleSpecifiers,
    featureDirectory,
    isCrossFeatureEdge,
    isLegacyGlobalPath,
    scanStructure,
    stripJsComments,
} from '../../scripts/check-structure.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

test('page module extraction keeps local application modules only', () => {
    const source = `
        <script is:inline type="module" src={\`\${base}/js/skin/entry.js\`}></script>
        <script src="/altoy/js/skin/data.js" type='module'></script>
        <script type="module" src="https://example.com/js/remote.js"></script>
        <script src="/altoy/js/legacy.js"></script>
        <script type="module">import './inline.js';</script>
    `;

    assert.deepEqual(extractPageModulePaths(source), [
        '/js/skin/data.js',
        '/js/skin/entry.js',
    ]);
});

test('duplicate local module tags remain visible as multiple page entries', () => {
    const source = `
        <script type="module" src="/altoy/js/entry.js"></script>
        <script type="module" src="/altoy/js/entry.js"></script>
    `;

    assert.deepEqual(extractPageModulePaths(source), [
        '/js/entry.js',
        '/js/entry.js',
    ]);
});

test('global assignment extraction ignores reads and comparisons', () => {
    const source = `
        window.Legacy = {};
        globalThis.value ||= createValue();
        if (window.Legacy === expected) use(window.Legacy);
        const check = globalThis.value == null;
    `;

    assert.deepEqual(extractGlobalAssignments(source), [
        'globalThis.value',
        'window.Legacy',
    ]);
});

test('static import extraction covers imports, re-exports, and literal dynamic imports', () => {
    const source = `
        import './setup.js';
        import { value } from "../feature/value.js";
        export { other } from './other.mjs';
        const lazy = import('./lazy.js');
        import(\`./computed/\${name}.js\`);
    `;

    assert.deepEqual(extractStaticModuleSpecifiers(source), [
        '../feature/value.js',
        './lazy.js',
        './other.mjs',
        './setup.js',
    ]);
});

// Documentation must not register as structure: the drift gate below fails a
// build on any unrecorded finding, and a JSDoc `@type {import('...')}` pointing
// across features already exists in this tree.
test('comments are stripped without eating code inside string literals', () => {
    const source = `
        // window.Commented = 1;
        /** @type {import('../skin/skin.dates.js').Dates} */
        const url = 'https://example.com/js/a.js';
        window.Real = 1;
        import { thing } from '../equip/equip-code.js';
    `;

    assert.deepEqual(extractGlobalAssignments(source), ['window.Real']);
    assert.deepEqual(extractStaticModuleSpecifiers(source), ['../equip/equip-code.js']);
    assert.ok(stripJsComments(source).includes('https://example.com/js/a.js'));
});

test('commented-out script tags are not page entries', () => {
    const source = `
        <!-- <script type="module" src="/altoy/js/old.js"></script> -->
        <script type="module" src="/altoy/js/live.js"></script>
    `;

    assert.deepEqual(extractPageModulePaths(source), ['/js/live.js']);
});

// A shared root module reaching into a feature's private tree couples every page
// that loads it to that feature, so being a shared TARGET must not exempt it as
// a SOURCE.
test('cross-feature edges include shared root-level sources', () => {
    assert.equal(
        isCrossFeatureEdge('public/js/global.script.js', 'public/js/sync/drive-sync.ui.js'),
        true
    );
    assert.equal(
        isCrossFeatureEdge('public/js/skin/skin.data.js', 'public/js/equip/equip-code.js'),
        true
    );
    assert.equal(
        isCrossFeatureEdge('public/js/skin/skin.data.js', 'public/js/skin/skin.dates.js'),
        false
    );
    assert.equal(
        isCrossFeatureEdge('public/js/skin/skin.data.js', 'public/js/utils.js'),
        false
    );
    assert.equal(
        isCrossFeatureEdge('public/js/skin/skin.data.js', 'public/js/engine/damage/index.js'),
        false
    );
});

test('feature and legacy-global classification follows top-level ownership', () => {
    assert.equal(featureDirectory('public/js/skin/skin.data.js'), 'skin');
    assert.equal(featureDirectory('public/js/utils.js'), null);
    assert.equal(isLegacyGlobalPath('public/js/island/island.engine.js'), true);
    assert.equal(isLegacyGlobalPath('public/js/story-viewer/story-viewer.engine.js'), true);
    assert.equal(isLegacyGlobalPath('public/js/skin/skin.data.js'), false);
});

test('baseline comparison separates new, changed, grandfathered, and resolved debt', () => {
    const route = (modules) => ({
        id: 'multi-module-route:src/pages/test.astro',
        path: 'src/pages/test.astro',
        modules,
    });
    const global = {
        id: 'global-assignment:public/js/test.js:window.Test',
        path: 'public/js/test.js',
        global: 'window.Test',
    };
    const removedImport = {
        id: 'cross-feature-import:public/js/a/a.js->public/js/b/b.js',
        from: 'public/js/a/a.js',
        to: 'public/js/b/b.js',
        sourceFeature: 'a',
        targetFeature: 'b',
    };
    const legacyGlobal = {
        id: 'global-assignment:public/js/island/island.engine.js:window.IslandEngine',
        path: 'public/js/island/island.engine.js',
        global: 'window.IslandEngine',
    };
    const current = {
        findings: {
            multiModuleRoutes: [route(['/js/a.js', '/js/b.js', '/js/c.js'])],
            globalAssignments: [global],
            legacyGlobals: [legacyGlobal],
            crossFeatureImports: [],
        },
    };
    const baseline = {
        findings: {
            multiModuleRoutes: [route(['/js/a.js', '/js/b.js'])],
            globalAssignments: [],
            legacyGlobals: [legacyGlobal],
            crossFeatureImports: [removedImport],
        },
    };

    const comparison = compareStructureFindings(current, baseline);
    assert.equal(comparison.multiModuleRoutes.changed.length, 1);
    assert.deepEqual(comparison.globalAssignments.added, [global]);
    assert.deepEqual(comparison.legacyGlobals.grandfathered, [legacyGlobal]);
    assert.deepEqual(comparison.crossFeatureImports.resolved, [removedImport]);
    assert.equal(comparison.globalAssignments.grandfathered.length, 0);
});

// The advisory command runs with continue-on-error in CI, so only this test can
// fail a build when structural debt grows. Existing debt stays grandfathered;
// resolved and shrinking findings stay green so cleanup never needs a baseline
// update to pass.
test('committed baseline still covers the current tree', () => {
    const report = scanStructure(ROOT);
    const baseline = JSON.parse(
        readFileSync(join(ROOT, 'scripts', 'structure-baseline.json'), 'utf8')
    );

    assert.equal(
        baseline.schemaVersion,
        report.schemaVersion,
        'regenerate scripts/structure-baseline.json: npm run check:structure -- --update-baseline'
    );

    const comparison = compareStructureFindings(report, baseline);
    for (const [kind, section] of Object.entries(comparison)) {
        assert.deepEqual(
            section.added.map((entry) => entry.id),
            [],
            `new ${kind} debt; fix it or record it with --update-baseline`
        );
    }
    for (const { before, after } of comparison.multiModuleRoutes.changed) {
        assert.ok(
            after.modules.length <= before.modules.length,
            `${after.path} gained page module tags: ${after.modules.join(', ')}`
        );
    }
});
