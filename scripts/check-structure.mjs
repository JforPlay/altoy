/**
 * Advisory structure guard for Astro page entries and unbundled browser modules.
 *
 * The reviewed baseline records existing legacy debt. The command reports:
 *   - Astro routes with more than one local page-level module script;
 *   - new window/globalThis assignments outside legacy story/island surfaces;
 *   - window/globalThis assignments inside those frozen legacy surfaces, kept as
 *     their own baselined kind so an 11th one is still visible;
 *   - imports into another feature's private tree, from a sibling feature or
 *     from a shared root-level module.
 *
 * Only `src/pages` is walked, so the shared Layout module tag present on every
 * route is not counted against a route's page-level entry budget. Astro and
 * JavaScript syntax trees keep comments, strings, templates, and regular
 * expressions from registering as executable structure.
 *
 * Findings are advisory. A baseline match is explicitly grandfathered; new,
 * changed, and resolved findings are separated so later page work cannot hide
 * structural movement inside the existing totals.
 *
 * Usage:
 *   npm run check:structure
 *   npm run check:structure -- --update-baseline
 *   npm run check:structure -- --json C:\tmp\structure.json
 */

import {
    existsSync,
    readFileSync,
    readdirSync,
    statSync,
    writeFileSync,
} from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { parse as parseAstro } from '@astrojs/compiler/sync';
import { parse as parseJavaScript } from 'acorn';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(SCRIPT_DIR, '..');
const BASELINE_PATH = join(SCRIPT_DIR, 'structure-baseline.json');
const SCHEMA_VERSION = 2;
const FINDING_KINDS = Object.freeze([
    'multiModuleRoutes',
    'globalAssignments',
    'legacyGlobals',
    'crossFeatureImports',
]);

const LEGACY_GLOBAL_PREFIXES = Object.freeze([
    'public/js/island/',
    'public/js/story-viewer/',
]);

// Root-level modules and engine/ are shared TARGETS: importing them is not a
// boundary crossing. Being shared does not exempt them as a SOURCE — a root
// facade reaching into one feature's private tree couples every page that loads
// it to that feature, so those edges are reported with a null sourceFeature.
const SHARED_TARGET_DIRECTORIES = new Set(['engine']);

function toPosix(value) {
    return value.split(sep).join('/');
}

function toRelative(root, absolutePath) {
    return toPosix(relative(root, absolutePath));
}

function walk(directory, extensions, output = []) {
    for (const name of readdirSync(directory)) {
        const path = join(directory, name);
        if (statSync(path).isDirectory()) {
            walk(path, extensions, output);
        } else if (extensions.some((extension) => name.endsWith(extension))) {
            output.push(path);
        }
    }
    return output;
}

function visitSyntaxTree(node, visitor) {
    if (!node || typeof node !== 'object' || typeof node.type !== 'string') return;
    visitor(node);
    for (const value of Object.values(node)) {
        if (Array.isArray(value)) {
            for (const child of value) visitSyntaxTree(child, visitor);
        } else {
            visitSyntaxTree(value, visitor);
        }
    }
}

export function extractPageModulePaths(text) {
    const modules = [];
    const { ast } = parseAstro(text, {});
    visitSyntaxTree(ast, (node) => {
        if (node.type !== 'element' || node.name.toLowerCase() !== 'script') return;
        const type = node.attributes.find((attribute) => attribute.name === 'type');
        const sourceAttribute = node.attributes.find((attribute) => attribute.name === 'src');
        if (type?.value.toLowerCase() !== 'module' || !sourceAttribute) return;
        if (/^(?:https?:)?\/\//i.test(sourceAttribute.value)) return;
        const source = sourceAttribute.value.match(/\/js\/[A-Za-z0-9_./-]+\.m?js\b/i);
        if (source) modules.push(source[0]);
    });
    return modules.sort();
}

function staticStringValue(node) {
    if (node?.type === 'Literal' && typeof node.value === 'string') return node.value;
    if (node?.type === 'TemplateLiteral' && node.expressions.length === 0) {
        return node.quasis[0]?.value.cooked ?? node.quasis[0]?.value.raw ?? null;
    }
    return null;
}

function assignedGlobalName(node) {
    if (node?.type !== 'MemberExpression') return null;
    if (node.object?.type !== 'Identifier') return null;
    if (node.object.name !== 'window' && node.object.name !== 'globalThis') return null;
    const property = node.computed
        ? staticStringValue(node.property)
        : node.property?.type === 'Identifier'
            ? node.property.name
            : null;
    return property && /^[A-Za-z_$][\w$]*$/.test(property)
        ? `${node.object.name}.${property}`
        : null;
}

function analyzeBrowserModule(text) {
    const assignments = new Set();
    const specifiers = new Set();
    const ast = parseJavaScript(text, {
        allowHashBang: true,
        ecmaVersion: 'latest',
        sourceType: 'module',
    });
    visitSyntaxTree(ast, (node) => {
        if (node.type === 'AssignmentExpression' || node.type === 'UpdateExpression') {
            const globalName = assignedGlobalName(node.type === 'AssignmentExpression'
                ? node.left
                : node.argument);
            if (globalName) assignments.add(globalName);
        }

        let source = null;
        if (
            node.type === 'ImportDeclaration'
            || node.type === 'ExportNamedDeclaration'
            || node.type === 'ExportAllDeclaration'
        ) {
            source = staticStringValue(node.source);
        } else if (node.type === 'ImportExpression') {
            source = staticStringValue(node.source);
        }
        if (source && /\.m?js$/.test(source)) specifiers.add(source);
    });
    return {
        assignments: [...assignments].sort(),
        specifiers: [...specifiers].sort(),
    };
}

export function extractGlobalAssignments(text) {
    return analyzeBrowserModule(text).assignments;
}

export function extractStaticModuleSpecifiers(text) {
    return analyzeBrowserModule(text).specifiers;
}

export function featureDirectory(path) {
    const match = path.match(/^public\/js\/([^/]+)\//);
    return match?.[1] || null;
}

export function isLegacyGlobalPath(path) {
    return LEGACY_GLOBAL_PREFIXES.some((prefix) => path.startsWith(prefix));
}

function isPublicBrowserModule(path) {
    return path.startsWith('public/js/') && /\.m?js$/.test(path);
}

export function isCrossFeatureEdge(fromPath, toPath) {
    if (!isPublicBrowserModule(toPath)) return false;
    const targetFeature = featureDirectory(toPath);
    if (!targetFeature || SHARED_TARGET_DIRECTORIES.has(targetFeature)) return false;
    return targetFeature !== featureDirectory(fromPath);
}

function emptyFindings() {
    return Object.fromEntries(FINDING_KINDS.map((kind) => [kind, []]));
}

function sortFindings(findings) {
    for (const kind of FINDING_KINDS) {
        findings[kind].sort((left, right) => left.id.localeCompare(right.id));
    }
    return findings;
}

export function scanStructure(root = ROOT) {
    const findings = emptyFindings();
    const pagesDirectory = join(root, 'src', 'pages');
    const browserDirectory = join(root, 'public', 'js');
    const pageFiles = existsSync(pagesDirectory) ? walk(pagesDirectory, ['.astro']) : [];
    const browserFiles = existsSync(browserDirectory) ? walk(browserDirectory, ['.js', '.mjs']) : [];

    for (const pageFile of pageFiles) {
        const path = toRelative(root, pageFile);
        const modules = extractPageModulePaths(readFileSync(pageFile, 'utf8'));
        if (modules.length <= 1) continue;
        findings.multiModuleRoutes.push({
            id: `multi-module-route:${path}`,
            path,
            modules,
        });
    }

    for (const browserFile of browserFiles) {
        const path = toRelative(root, browserFile);
        const text = readFileSync(browserFile, 'utf8');
        // Acorn reports a line and column but no file, and this scan runs inside a
        // blocking test over every browser module, so the failure has to name itself.
        let analysis;
        try {
            analysis = analyzeBrowserModule(text);
        } catch (error) {
            throw new Error(`${path}: ${error.message}`);
        }
        for (const globalName of analysis.assignments) {
            const finding = {
                id: `global-assignment:${path}:${globalName}`,
                path,
                global: globalName,
            };
            const kind = isLegacyGlobalPath(path) ? 'legacyGlobals' : 'globalAssignments';
            findings[kind].push(finding);
        }

        const sourceFeature = featureDirectory(path);
        for (const specifier of analysis.specifiers) {
            if (!specifier.startsWith('.')) continue;
            const targetPath = toRelative(root, resolve(dirname(browserFile), specifier));
            if (!isCrossFeatureEdge(path, targetPath)) continue;
            findings.crossFeatureImports.push({
                id: `cross-feature-import:${path}->${targetPath}`,
                from: path,
                to: targetPath,
                sourceFeature,
                targetFeature: featureDirectory(targetPath),
            });
        }
    }

    return {
        schemaVersion: SCHEMA_VERSION,
        findings: sortFindings(findings),
    };
}

function findingMap(entries = []) {
    return new Map(entries.map((entry) => [
        typeof entry === 'string' ? entry : entry.id,
        entry,
    ]));
}

export function compareStructureFindings(current, baseline) {
    const comparison = {};
    for (const kind of FINDING_KINDS) {
        const currentById = findingMap(current?.findings?.[kind]);
        const baselineById = findingMap(baseline?.findings?.[kind]);
        const added = [];
        const grandfathered = [];
        const changed = [];
        const resolved = [];

        for (const [id, entry] of currentById) {
            const previous = baselineById.get(id);
            if (!previous) {
                added.push(entry);
            } else if (
                typeof previous !== 'string'
                && JSON.stringify(previous) !== JSON.stringify(entry)
            ) {
                changed.push({ before: previous, after: entry });
            } else {
                grandfathered.push(entry);
            }
        }
        for (const [id, entry] of baselineById) {
            if (!currentById.has(id)) resolved.push(entry);
        }

        comparison[kind] = { added, grandfathered, changed, resolved };
    }
    return comparison;
}

function findingLabel(kind, finding) {
    if (typeof finding === 'string') return finding;
    if (kind === 'multiModuleRoutes') {
        return `${finding.path} (${finding.modules.length}: ${finding.modules.join(', ')})`;
    }
    if (kind === 'globalAssignments' || kind === 'legacyGlobals') {
        return `${finding.path} (${finding.global})`;
    }
    return `${finding.from} -> ${finding.to}`;
}

function printComparison(report, baseline) {
    const comparison = compareStructureFindings(report, baseline);
    const labels = {
        multiModuleRoutes: 'routes with multiple page modules',
        globalAssignments: 'non-legacy browser global assignments',
        legacyGlobals: 'allowlisted story/island global assignments (frozen surface)',
        crossFeatureImports: 'cross-feature private imports',
    };

    console.log('\nStructure check (advisory; existing snapshot debt is grandfathered)');
    for (const kind of FINDING_KINDS) {
        const section = comparison[kind];
        const currentCount = report.findings[kind].length;
        console.log(
            `\n${labels[kind]}: ${currentCount} current; `
            + `${section.grandfathered.length} grandfathered, `
            + `${section.added.length} new, `
            + `${section.changed.length} changed, `
            + `${section.resolved.length} resolved`
        );
        const grandfatheredIds = new Set(section.grandfathered.map((entry) => entry.id));
        const addedIds = new Set(section.added.map((entry) => entry.id));
        const changedIds = new Set(section.changed.map(({ after }) => after.id));
        for (const finding of report.findings[kind]) {
            const status = addedIds.has(finding.id)
                ? 'NEW'
                : changedIds.has(finding.id)
                    ? 'CHANGED'
                    : grandfatheredIds.has(finding.id)
                        ? 'grandfathered'
                        : 'current';
            console.log(`  [${status}] ${findingLabel(kind, finding)}`);
        }
        for (const finding of section.resolved) {
            console.log(`  [resolved] ${findingLabel(kind, finding)}`);
        }
    }
    if (!baseline?.findings) {
        console.log('No reviewed baseline found. Review the findings before --update-baseline.');
    }
}

function parseArgs(argv) {
    const options = {
        help: false,
        jsonPath: null,
        updateBaseline: false,
    };
    for (let index = 0; index < argv.length; index += 1) {
        const argument = argv[index];
        if (argument === '--help' || argument === '-h') {
            options.help = true;
        } else if (argument === '--json') {
            const value = argv[index + 1];
            if (!value || value.startsWith('--')) {
                throw new Error('--json requires a value.');
            }
            options.jsonPath = value;
            index += 1;
        } else if (argument === '--update-baseline') {
            options.updateBaseline = true;
        } else {
            throw new Error(`Unknown argument: ${argument}`);
        }
    }
    return options;
}

function printHelp() {
    console.log(`Usage: node scripts/check-structure.mjs [options]

Options:
  --json PATH        Write the current structure report to PATH
  --update-baseline  Replace scripts/structure-baseline.json after review
  --help, -h         Show this help`);
}

function baselineSnapshot(report) {
    return {
        schemaVersion: report.schemaVersion,
        findings: report.findings,
    };
}

function run() {
    const options = parseArgs(process.argv.slice(2));
    if (options.help) {
        printHelp();
        return;
    }

    const report = scanStructure();
    let baseline = existsSync(BASELINE_PATH)
        ? JSON.parse(readFileSync(BASELINE_PATH, 'utf8'))
        : null;
    if (baseline && baseline.schemaVersion !== report.schemaVersion) {
        if (!options.updateBaseline) {
            throw new Error(
                `Structure baseline schema ${baseline.schemaVersion} does not match `
                + `report schema ${report.schemaVersion}.`
            );
        }
        console.log(
            `Baseline schema ${baseline.schemaVersion} superseded by `
            + `${report.schemaVersion}; every finding is reported as new.`
        );
        baseline = null;
    }
    printComparison(report, baseline);

    if (options.jsonPath) {
        const outputPath = resolve(ROOT, options.jsonPath);
        writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`);
        console.log(`\nWrote report: ${toPosix(relative(ROOT, outputPath))}`);
    }
    if (options.updateBaseline) {
        writeFileSync(
            BASELINE_PATH,
            `${JSON.stringify(baselineSnapshot(report), null, 2)}\n`
        );
        console.log(`\nUpdated baseline: ${toPosix(relative(ROOT, BASELINE_PATH))}`);
    }
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : null;
if (invokedPath === import.meta.url) {
    try {
        run();
    } catch (error) {
        console.error(`structure check failed: ${error.message}`);
        process.exitCode = 1;
    }
}
