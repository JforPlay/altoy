/**
 * check-css-tokens.mjs
 * Finds `var(--token)` references that no stylesheet loaded on that page defines.
 *
 * WHY this exists: a custom property that resolves to nothing is not an error —
 * the declaration is dropped and the element silently inherits instead. For a
 * `color:` that means text falls back to the UA black and disappears against a
 * dark background, which only shows up by looking at the page. It is invisible
 * to the build, to `npm test`, and to code review, and it has bitten this repo
 * repeatedly (`--text-color` on boss-viewer: the token is real, but it is only
 * defined inside juustagram.css and the story-viewer sheets, neither of which
 * that page loads).
 *
 * Scope is deliberately narrow to stay quiet and trustworthy:
 *   - Only references WITHOUT a fallback are checked. `var(--x, 1rem)` is safe by
 *     construction and is how the component `--*` hooks are meant to be consumed.
 *   - Only page-owned sheets are scanned. The globals in src/styles/components/
 *     are the vocabulary, not the consumers.
 *   - A token counts as defined if ANY sheet on that page declares it, or if JS
 *     sets it at runtime via setProperty (island/map do this).
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/** Recursively list files under `dir` whose name ends with `ext`. */
function walk(dir, ext, out = []) {
    for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) walk(full, ext, out);
        else if (entry.endsWith(ext)) out.push(full);
    }
    return out;
}

const read = (file) => {
    try {
        return readFileSync(file, 'utf8');
    } catch {
        return '';
    }
};

/** Strip comments so a commented-out rule can't count as a definition or a use. */
const stripComments = (css) => css.replace(/\/\*[\s\S]*?\*\//g, '');

/** CSS import specifiers in an .astro frontmatter, resolved to absolute paths. */
export function extractStyleImports(source, fromFile) {
    const dir = dirname(fromFile);
    return [...source.matchAll(/^\s*import\s+['"]([^'"]+\.css)['"]/gm)]
        .map((m) => resolve(dir, m[1]));
}

/**
 * `@import './x.css'` targets inside a stylesheet, resolved to absolute paths.
 * Both spellings count: every sheet in this repo writes the `url()` form, and
 * missing it made the tokens those sheets import look undefined.
 */
function extractCssImports(css, fromFile) {
    const dir = dirname(fromFile);
    return [...css.matchAll(/@import\s+(?:url\(\s*)?['"]([^'"]+)['"]/g)].map((m) => resolve(dir, m[1]));
}

/** A sheet plus everything it @imports, transitively. */
function expand(files, seen = new Set()) {
    for (const file of files) {
        if (seen.has(file)) continue;
        seen.add(file);
        expand(extractCssImports(read(file), file), seen);
    }
    return seen;
}

/** Custom properties DECLARED in a stylesheet (`--x: value`). */
export function extractTokenDefinitions(css) {
    return new Set([...stripComments(css).matchAll(/(--[\w-]+)\s*:/g)].map((m) => m[1]));
}

/**
 * Custom properties REFERENCED with no fallback (`var(--x)` but not `var(--x, y)`).
 * A fallback makes the reference safe whether or not the token is defined.
 */
export function extractUnguardedTokenUses(css) {
    return new Set(
        [...stripComments(css).matchAll(/var\(\s*(--[\w-]+)\s*([,)])/g)]
            .filter((m) => m[2] === ')')
            .map((m) => m[1])
    );
}

/**
 * Tokens supplied at runtime rather than by a stylesheet — legitimately absent
 * from every sheet. Two forms: `el.style.setProperty('--x', …)` and an inline
 * `style="--x: …"` written into rendered markup (island's per-rank colors).
 */
export function extractRuntimeTokens(source) {
    return new Set([
        ...[...source.matchAll(/setProperty\(\s*['"`](--[\w-]+)/g)].map((m) => m[1]),
        ...[...source.matchAll(/style\s*=\s*["'`][^"'`]*?(--[\w-]+)\s*:/g)].map((m) => m[1]),
    ]);
}

function runtimeTokens(root) {
    const defined = new Set();
    const sources = [
        ...walk(join(root, 'public', 'js'), '.js'),
        ...walk(join(root, 'src', 'pages'), '.astro'),
        ...walk(join(root, 'src', 'components'), '.astro'),
    ];
    for (const file of sources) {
        for (const token of extractRuntimeTokens(read(file))) defined.add(token);
    }
    return defined;
}

/**
 * Scan every page for unresolvable token references.
 * @returns {Array<{page: string, sheet: string, token: string}>} sorted findings
 */
export function scanCssTokens(root = ROOT) {
    const styleRoot = join(root, 'src', 'styles');
    const globalSheets = expand(
        extractStyleImports(read(join(root, 'src', 'layouts', 'Layout.astro')),
            join(root, 'src', 'layouts', 'Layout.astro'))
    );
    // theme.css holds the token scale and is pulled in via the global chain, but
    // read it explicitly so a refactor of that chain can't silently empty the
    // vocabulary and turn this check into a no-op.
    const baseline = new Set([...globalSheets, join(styleRoot, 'theme.css')]);
    const runtime = runtimeTokens(root);

    const findings = [];
    for (const page of walk(join(root, 'src', 'pages'), '.astro')) {
        const pageSheets = expand(extractStyleImports(read(page), page));
        const sheets = expand([...pageSheets, ...baseline]);

        const defined = new Set(runtime);
        for (const sheet of sheets) {
            for (const token of extractTokenDefinitions(read(sheet))) defined.add(token);
        }

        for (const sheet of pageSheets) {
            for (const token of extractUnguardedTokenUses(read(sheet))) {
                if (!defined.has(token)) {
                    findings.push({
                        page: relative(root, page).replace(/\\/g, '/'),
                        sheet: relative(root, sheet).replace(/\\/g, '/'),
                        token,
                    });
                }
            }
        }
    }
    // One line per (sheet, token): a shared sheet imported by ten pages is one bug.
    const unique = new Map();
    for (const f of findings) {
        const key = `${f.sheet}\u0000${f.token}`;
        if (!unique.has(key)) unique.set(key, f);
    }
    return [...unique.values()].sort(
        (a, b) => a.sheet.localeCompare(b.sheet) || a.token.localeCompare(b.token)
    );
}

// pathToFileURL, not string concatenation: on Windows a bare `file://C:\…` does
// not match import.meta.url's `file:///C:/…`, so the CLI would silently no-op.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    // Mirrors tests/infra/css-tokens.test.mjs: known debt is listed but does not
    // fail, so this exits non-zero only on something newly introduced.
    const baseline = new Set(JSON.parse(read(join(ROOT, 'scripts', 'css-token-baseline.json')) || '[]'));
    const findings = scanCssTokens();
    const isNew = (f) => !baseline.has(`${f.sheet} var(${f.token})`);

    for (const f of findings) {
        const line = `${f.sheet}: var(${f.token}) is not defined on ${f.page}`;
        if (isNew(f)) console.error(`NEW  ${line}`);
        else console.log(`     ${line}`);
    }
    const added = findings.filter(isNew).length;
    console.log(`check-css-tokens: ${added} new, ${findings.length - added} baselined`);
    process.exit(added === 0 ? 0 : 1);
}
