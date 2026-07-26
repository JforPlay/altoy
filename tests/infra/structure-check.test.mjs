import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
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
        window['Bracketed'] = {};
        globalThis.counter++;
        if (window.Legacy === expected) use(window.Legacy);
        const check = globalThis.value == null;
    `;

    assert.deepEqual(extractGlobalAssignments(source), [
        'globalThis.counter',
        'globalThis.value',
        'window.Bracketed',
        'window.Legacy',
    ]);
});

test('static import extraction covers imports, re-exports, and literal dynamic imports', () => {
    const source = `
        import './setup.js';
        import { value } from "../feature/value.js";
        export { other } from './other.mjs';
        export * from './all.js';
        const lazy = import('./lazy.js');
        const literalTemplate = import(\`./literal-template.js\`);
        import(\`./computed/\${name}.js\`);
    `;

    assert.deepEqual(extractStaticModuleSpecifiers(source), [
        '../feature/value.js',
        './all.js',
        './lazy.js',
        './literal-template.js',
        './other.mjs',
        './setup.js',
    ]);
});

// Documentation and literal data must not register as structure: the drift gate
// below fails a build on any unrecorded finding, and JSDoc import types already
// exist in this tree.
test('JavaScript extraction follows syntax through comments, literals, and regexes', () => {
    const source = [
        '// window.Commented = 1;',
        "/** @type {import('../skin/skin.dates.js').Dates} */",
        `const prose = "window.StringExample = 1; import('../skin/private.js')";`,
        'const template = `globalThis.TemplateExample = 1; import("../equip/private.js")`;',
        String.raw`const urlPattern = /https?:\/\//; window.AfterRegex = 1; import './after-regex.js';`,
        "const dynamic = `${import('./template-expression.js')}`;",
        'window.Real = 1;',
        "import { thing } from '../equip/equip-code.js';",
    ].join('\n');

    assert.deepEqual(extractGlobalAssignments(source), [
        'window.AfterRegex',
        'window.Real',
    ]);
    assert.deepEqual(extractStaticModuleSpecifiers(source), [
        '../equip/equip-code.js',
        './after-regex.js',
        './template-expression.js',
    ]);
});

test('Astro extraction ignores module tags in comments and expression strings', () => {
    const source = `
        ---
        const frontmatterExample =
            '<script type="module" src="/altoy/js/frontmatter-example.js"></script>';
        ---
        <!-- <script type="module" src="/altoy/js/old.js"></script> -->
        {\`<script type="module" src="/altoy/js/expression-example.js"></script>\`}
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

// A parser reports a line and column but no file. The scan covers every browser
// module and runs inside the blocking test below, so an unparseable one that does
// not name itself leaves nothing to search for.
test('an unparseable browser module names itself', () => {
    const root = mkdtempSync(join(tmpdir(), 'structure-check-'));
    try {
        mkdirSync(join(root, 'public', 'js'), { recursive: true });
        writeFileSync(join(root, 'public', 'js', 'broken.js'), 'const broken = (\n');
        assert.throws(() => scanStructure(root), /^Error: public\/js\/broken\.js: /);
    } finally {
        rmSync(root, { recursive: true, force: true });
    }
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
