/**
 * css-tokens.test.mjs
 * Gates `var(--token)` references that resolve to nothing on the pages that use them.
 *
 * The failure this prevents is silent: an undefined custom property makes the
 * whole declaration invalid at computed-value time, so the element inherits
 * instead. A `color:` becomes the UA black — invisible on a dark page — while
 * the build, the type checks and the smoke suite all stay green. Only a human
 * looking at the page catches it.
 *
 * `scripts/css-token-baseline.json` records the pre-existing offenders so this
 * fails on NEW ones. The baseline is a ratchet: it must shrink, never grow.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    scanCssTokens, extractStyleImports, extractTokenDefinitions,
    extractUnguardedTokenUses, extractRuntimeTokens,
} from '../../scripts/check-css-tokens.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const BASELINE_PATH = join(ROOT, 'scripts', 'css-token-baseline.json');
const baseline = new Set(JSON.parse(readFileSync(BASELINE_PATH, 'utf8')));
const current = scanCssTokens(ROOT).map((f) => `${f.sheet} var(${f.token})`);

test('no page references a custom property nothing on that page defines', () => {
    const added = current.filter((entry) => !baseline.has(entry));
    assert.deepEqual(added, [],
        `New unresolvable token reference(s). The declaration will be dropped and the\n`
        + `element will inherit instead — for a color that means invisible text.\n`
        + `Use a token theme.css actually defines, or give the reference a fallback:\n`
        + `  ${added.join('\n  ')}`);
});

test('the baseline has no stale entries — it only ratchets down', () => {
    const currentSet = new Set(current);
    const fixed = [...baseline].filter((entry) => !currentSet.has(entry));
    assert.deepEqual(fixed, [],
        `Fixed token reference(s) still listed as debt. Remove them from\n`
        + `scripts/css-token-baseline.json so the ratchet holds:\n  ${fixed.join('\n  ')}`);
});

// ===== Unit coverage for the scanner itself =====

test('a reference with a fallback is not reported — that is the component hook contract', () => {
    assert.deepEqual([...extractUnguardedTokenUses('a{gap:var(--x, 1rem);color:var(--y)}')], ['--y']);
});

test('commented-out rules count as neither a definition nor a use', () => {
    assert.equal(extractTokenDefinitions('/* --dead: red; */ a{color:blue}').size, 0);
    assert.equal(extractUnguardedTokenUses('/* a{color:var(--dead)} */').size, 0);
});

test('definitions are found wherever they are declared', () => {
    assert.deepEqual(
        [...extractTokenDefinitions(':root{--a:1px}\nbody.dark-mode{--b:2px}')].sort(),
        ['--a', '--b']);
});

test('runtime-supplied tokens are recognised from setProperty and inline style', () => {
    assert.ok(extractRuntimeTokens("el.style.setProperty('--rank', c)").has('--rank'));
    assert.ok(extractRuntimeTokens('`<div style="--rank-color: ${c}">`').has('--rank-color'));
});

test('style imports resolve relative to the importing file', () => {
    const imports = extractStyleImports(
        `import Layout from '../../layouts/Layout.astro';\nimport '../../styles/boss/boss.style.css';`,
        join(ROOT, 'src', 'pages', 'map', 'boss-viewer.astro'));
    assert.deepEqual(imports, [join(ROOT, 'src', 'styles', 'boss', 'boss.style.css')]);
});

test('the scan reaches real pages — a passing run means coverage, not an empty sweep', () => {
    // Guards against a refactor that silently makes the scanner find no sheets.
    const defs = extractTokenDefinitions(readFileSync(join(ROOT, 'src', 'styles', 'theme.css'), 'utf8'));
    assert.ok(defs.has('--text-primary'), 'theme.css no longer defines --text-primary');
    assert.ok(defs.size > 100, `theme.css yielded only ${defs.size} tokens`);
});
