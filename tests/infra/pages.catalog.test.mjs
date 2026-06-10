/**
 * Integrity tests for public/js/pages.catalog.js — the single source of truth
 * for internal pages (LINKS map, Ctrl+K search, and the Layout.astro mega-menu
 * via NAV_STRUCTURE). Layout.astro already throws at build on an unknown nav
 * key; these tests catch the same drift (plus catalog↔filesystem drift)
 * straight from `npm test`, without a build.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { PAGE_CATALOG, PAGE_BY_KEY, NAV_STRUCTURE } from '../../public/js/pages.catalog.js';

const PAGES_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', 'src', 'pages');

test('every catalog entry carries the full metadata contract', () => {
    for (const page of PAGE_CATALOG) {
        for (const prop of ['key', 'path', 'name', 'description', 'icon', 'category']) {
            assert.ok(typeof page[prop] === 'string' && page[prop].length > 0,
                `${page.key || JSON.stringify(page)}: "${prop}" must be a non-empty string`);
        }
        assert.match(page.key, /^[A-Z0-9_]+$/, `${page.key}: key must be SCREAMING_SNAKE_CASE`);
        assert.match(page.path, /^[a-z0-9/-]+\/$/,
            `${page.key}: path must be lowercase, site-relative (no leading slash), with a trailing slash`);
    }
});

test('catalog keys and paths are unique', () => {
    const keys = PAGE_CATALOG.map((p) => p.key);
    const paths = PAGE_CATALOG.map((p) => p.path);
    assert.equal(new Set(keys).size, keys.length, 'duplicate key in PAGE_CATALOG');
    assert.equal(new Set(paths).size, paths.length, 'duplicate path in PAGE_CATALOG');
});

test('PAGE_BY_KEY mirrors PAGE_CATALOG', () => {
    assert.equal(PAGE_BY_KEY.size, PAGE_CATALOG.length);
    for (const page of PAGE_CATALOG) {
        assert.equal(PAGE_BY_KEY.get(page.key), page);
    }
});

test('every NAV_STRUCTURE key resolves in the catalog (Layout.astro build-throw, testable here)', () => {
    for (const menu of NAV_STRUCTURE) {
        for (const column of menu.columns) {
            for (const key of column.keys) {
                assert.ok(PAGE_BY_KEY.has(key), `NAV_STRUCTURE references unknown catalog key "${key}" (menu "${menu.label}")`);
            }
        }
    }
});

test('nav placement is exactly one menu slot per catalog page', () => {
    // CLAUDE.md: adding a page = a PAGE_CATALOG entry AND its key in NAV_STRUCTURE.
    // If a page is ever intentionally search-only, exempt it here explicitly.
    const navKeys = NAV_STRUCTURE.flatMap((m) => m.columns.flatMap((c) => c.keys));
    assert.equal(new Set(navKeys).size, navKeys.length, 'a key appears in NAV_STRUCTURE more than once');
    const missing = PAGE_CATALOG.map((p) => p.key).filter((k) => !navKeys.includes(k));
    assert.deepEqual(missing, [], 'catalog pages missing from the navbar');
});

test('every catalog path has a real src/pages .astro file behind it', () => {
    for (const page of PAGE_CATALOG) {
        const stem = page.path.replace(/\/$/, '');
        const asFile = join(PAGES_DIR, `${stem}.astro`);
        const asIndex = join(PAGES_DIR, stem, 'index.astro');
        assert.ok(existsSync(asFile) || existsSync(asIndex),
            `${page.key}: no page file for path "${page.path}" (looked for ${stem}.astro and ${stem}/index.astro)`);
    }
});
