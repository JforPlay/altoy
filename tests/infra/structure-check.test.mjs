import assert from 'node:assert/strict';
import test from 'node:test';

import {
    compareStructureFindings,
    extractGlobalAssignments,
    extractPageModulePaths,
    extractStaticModuleSpecifiers,
    featureDirectory,
    isLegacyGlobalPath,
} from '../../scripts/check-structure.mjs';

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
    const current = {
        findings: {
            multiModuleRoutes: [route(['/js/a.js', '/js/b.js', '/js/c.js'])],
            globalAssignments: [global],
            crossFeatureImports: [],
        },
    };
    const baseline = {
        findings: {
            multiModuleRoutes: [route(['/js/a.js', '/js/b.js'])],
            globalAssignments: [],
            crossFeatureImports: [removedImport],
        },
    };

    const comparison = compareStructureFindings(current, baseline);
    assert.equal(comparison.multiModuleRoutes.changed.length, 1);
    assert.deepEqual(comparison.globalAssignments.added, [global]);
    assert.deepEqual(comparison.crossFeatureImports.resolved, [removedImport]);
    assert.equal(comparison.globalAssignments.grandfathered.length, 0);
});
