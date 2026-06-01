/**
 * check-orphans.mjs
 * Static import-graph guard for the un-bundled public/js tree.
 *
 * Because public/js is served as-is (no bundler), nothing normally flags a module that
 * is referenced by NOTHING (dead weight shipped to users) or an import/`<script src>`
 * that points at a file that doesn't exist (a runtime-only 404). This script builds the
 * reference graph from `.astro` script tags + JS import statements and reports both:
 *   - ORPHANS:  a public/js/*.js referenced by no .astro and no other module.
 *   - DANGLING: a reference whose target file does not exist.
 *
 * Advisory by design — NOT wired into the default `build`, because a computed dynamic
 * import (`import(`./x/${name}.js`)`) is invisible to static analysis and could false-
 * positive a deploy. Run manually / in CI: `npm run check:orphans`.
 * Intentional orphans (documentation-only / harness-only) live in ALLOWLIST below.
 */

import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, relative, join, sep } from 'node:path';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(SCRIPT_DIR, '..');

/** Files that are deliberately referenced by nothing (documented in their own headers). */
const ALLOWLIST = new Set([
    'public/js/types.js',                                  // JSDoc typedefs, imported nowhere by design
    'public/js/simulators/physics/bullets/missile.js',     // harness-only, deliberately unregistered
    'public/js/simulators/physics/bullets/scale.js',       // harness-only, deliberately unregistered
]);

/** Recursively collect files with one of the given extensions. */
function walk(dir, exts, out = []) {
    for (const name of readdirSync(dir)) {
        const full = join(dir, name);
        if (statSync(full).isDirectory()) walk(full, exts, out);
        else if (exts.some((e) => name.endsWith(e))) out.push(full);
    }
    return out;
}

/** Absolute path → repo-relative posix path. */
const toRel = (abs) => relative(ROOT, abs).split(sep).join('/');

const jsFiles = walk(join(ROOT, 'public', 'js'), ['.js']).map(toRel);
const jsSet = new Set(jsFiles);
const astroFiles = existsSync(join(ROOT, 'src')) ? walk(join(ROOT, 'src'), ['.astro']) : [];

const referenced = new Set();
const dangling = []; // { ref, from }

/** Record a reference to a public/js file (and flag it if the target is missing). */
function addRef(absPath, fromRel) {
    const rel = toRel(absPath);
    if (!rel.startsWith('public/js/') || !rel.endsWith('.js')) return;
    referenced.add(rel);
    if (!jsSet.has(rel)) dangling.push({ ref: rel, from: fromRel });
}

/** Extract references from one file's text. */
function scan(absFile) {
    const text = readFileSync(absFile, 'utf8');
    const fromRel = toRel(absFile);
    const baseDir = dirname(absFile);

    // Absolute public refs, e.g. <script src={`${base}/js/foo/bar.js`}> → /js/foo/bar.js
    for (const m of text.matchAll(/\/js\/[A-Za-z0-9_./-]+\.js/g)) {
        addRef(join(ROOT, 'public', m[0]), fromRel);
    }
    // ES import / side-effect import / dynamic import with a STATIC string specifier.
    for (const m of text.matchAll(/(?:from\s*|import\s*|import\(\s*)['"]([^'"]+\.js)['"]/g)) {
        const spec = m[1];
        if (spec.startsWith('.') || spec.includes('public/js/')) {
            addRef(resolve(baseDir, spec), fromRel);
        }
        // bare specifiers (node_modules) are ignored
    }
}

[...jsFiles.map((r) => join(ROOT, r)), ...astroFiles].forEach(scan);

const orphans = jsFiles.filter((f) => !referenced.has(f) && !ALLOWLIST.has(f));

let failed = false;
if (dangling.length) {
    failed = true;
    console.error(`\n✗ ${dangling.length} DANGLING reference(s) — target file does not exist:`);
    for (const d of dangling) console.error(`  - ${d.ref}  (referenced from ${d.from})`);
}
if (orphans.length) {
    failed = true;
    console.error(`\n✗ ${orphans.length} ORPHAN module(s) — referenced by no .astro page and no import:`);
    for (const o of orphans) console.error(`  - ${o}`);
    console.error('  Fix: wire it into a page/import or delete it. If intentional, add it to ALLOWLIST in scripts/check-orphans.mjs.');
}

if (failed) process.exit(1);
console.log(`✓ import-graph clean: ${jsFiles.length} js files, ${referenced.size} referenced, ${ALLOWLIST.size} allowlisted, 0 orphans, 0 dangling.`);
