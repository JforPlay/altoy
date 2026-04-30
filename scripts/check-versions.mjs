#!/usr/bin/env node
/**
 * Verifies that the SW cache version and the IndexedDB data version stay in sync.
 *
 * The two caches (Service Worker + IndexedDB) are bumped together — bumping just
 * one leaves the other stale on first visit. This check fails the build when
 * they drift, so the dual-bump rule from CLAUDE.md "Cache & Data Versioning"
 * is enforced rather than relying on memory.
 */
import { readFileSync } from 'node:fs';

const utilsContent = readFileSync('public/js/utils.js', 'utf8');
const swContent = readFileSync('public/sw.js', 'utf8');

const dataVersion = utilsContent.match(/const\s+DATA_VERSION\s*=\s*['"]([^'"]+)['"]/)?.[1];
const cacheVersion = swContent.match(/const\s+CACHE_VERSION\s*=\s*['"]([^'"]+)['"]/)?.[1];

if (!dataVersion) {
    console.error('check-versions: DATA_VERSION not found in public/js/utils.js');
    process.exit(1);
}
if (!cacheVersion) {
    console.error('check-versions: CACHE_VERSION not found in public/sw.js');
    process.exit(1);
}

if (dataVersion !== cacheVersion) {
    console.error(
        `check-versions: VERSION MISMATCH\n` +
        `  public/js/utils.js DATA_VERSION = ${dataVersion}\n` +
        `  public/sw.js       CACHE_VERSION = ${cacheVersion}\n` +
        `\nBoth must be the same semver value. See CLAUDE.md "Cache & Data Versioning".`
    );
    process.exit(1);
}

console.log(`check-versions: OK (${dataVersion})`);
