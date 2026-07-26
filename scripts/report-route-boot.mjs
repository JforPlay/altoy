/**
 * Advisory route-boot report for the largest ALtoy surfaces.
 *
 * Run after a build:
 *   npm run report:route-boot
 *   npm run report:route-boot -- --update-baseline
 *   npm run report:route-boot -- --target FLEET_SIM --json C:\tmp\boot.json
 *
 * The report serves dist/ from an isolated local server and opens every target
 * in a fresh browser context. It records same-origin HTML, JavaScript, CSS, and
 * JSON requests up to that route's ready signal. Image, font, media, and remote
 * requests are excluded to keep the result deterministic and focused on
 * application boot dependencies.
 *
 * Two cutoffs exist, chosen per route in route-boot-targets.mjs: a DOM signal for
 * the first useful view, or network idle for routes whose finding is an
 * unconditional load that races the first render rather than blocking it. Each
 * row prints its own signal, so read the two kinds separately.
 */

import {
    createReadStream,
    existsSync,
    readFileSync,
    statSync,
    writeFileSync,
} from 'node:fs';
import { createServer } from 'node:http';
import { brotliCompressSync, constants as zlibConstants, gzipSync } from 'node:zlib';
import { dirname, extname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { GLOBAL_DOCUMENT_MODULES, ROUTE_BOOT_TARGETS } from './route-boot-targets.mjs';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(SCRIPT_DIR, '..');
const DIST_DIR = join(ROOT, 'dist');
const BASE_PATH = '/altoy/';
const BASELINE_PATH = join(SCRIPT_DIR, 'route-boot-baseline.json');
const REPORT_SCHEMA_VERSION = 1;
const READY_TIMEOUT_MS = 45_000;
const SKIPPED_RESOURCE_TYPES = new Set(['image', 'font', 'media']);
const sizeCache = new Map();

const MIME_TYPES = new Map([
    ['.avif', 'image/avif'],
    ['.css', 'text/css; charset=utf-8'],
    ['.gif', 'image/gif'],
    ['.html', 'text/html; charset=utf-8'],
    ['.ico', 'image/x-icon'],
    ['.jpeg', 'image/jpeg'],
    ['.jpg', 'image/jpeg'],
    ['.js', 'text/javascript; charset=utf-8'],
    ['.json', 'application/json; charset=utf-8'],
    ['.mjs', 'text/javascript; charset=utf-8'],
    ['.png', 'image/png'],
    ['.svg', 'image/svg+xml'],
    ['.txt', 'text/plain; charset=utf-8'],
    ['.webp', 'image/webp'],
    ['.woff', 'font/woff'],
    ['.woff2', 'font/woff2'],
]);

function toPosix(value) {
    return value.split(sep).join('/');
}

function normalizePathname(pathname) {
    try {
        return decodeURIComponent(pathname);
    } catch {
        return pathname;
    }
}

export function distFileForPathname(pathname, distDir = DIST_DIR) {
    const decoded = normalizePathname(pathname);
    if (decoded !== BASE_PATH.slice(0, -1) && !decoded.startsWith(BASE_PATH)) {
        return null;
    }

    let localPath = decoded === BASE_PATH.slice(0, -1)
        ? ''
        : decoded.slice(BASE_PATH.length);
    if (!localPath || localPath.endsWith('/')) localPath += 'index.html';

    const candidate = resolve(distDir, localPath);
    const relativePath = relative(distDir, candidate);
    if (relativePath.startsWith('..') || isAbsolute(relativePath)) return null;

    if (existsSync(candidate) && statSync(candidate).isDirectory()) {
        return join(candidate, 'index.html');
    }
    return candidate;
}

function createDistServer() {
    return createServer((request, response) => {
        let pathname;
        try {
            pathname = new URL(request.url, 'http://127.0.0.1').pathname;
        } catch {
            response.writeHead(400).end('Bad request');
            return;
        }

        const file = distFileForPathname(pathname);
        if (!file || !existsSync(file) || !statSync(file).isFile()) {
            response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
            response.end('Not found');
            return;
        }

        response.writeHead(200, {
            'Cache-Control': 'no-store',
            'Content-Type': MIME_TYPES.get(extname(file).toLowerCase()) || 'application/octet-stream',
        });
        createReadStream(file).pipe(response);
    });
}

async function listen(server) {
    await new Promise((resolvePromise, reject) => {
        server.once('error', reject);
        server.listen(0, '127.0.0.1', resolvePromise);
    });
    const address = server.address();
    if (!address || typeof address === 'string') {
        throw new Error('Could not resolve the route-boot server address.');
    }
    return `http://127.0.0.1:${address.port}`;
}

async function closeServer(server) {
    await new Promise((resolvePromise) => server.close(resolvePromise));
}

function installReadyObserver(ready) {
    const matches = () => {
        if (ready.kind === 'count') {
            return document.querySelectorAll(ready.selector).length >= (ready.minimum || 1);
        }
        if (ready.kind === 'hidden') {
            const element = document.querySelector(ready.selector);
            if (!element) return false;
            return element.hidden
                || element.classList.contains('hidden')
                || getComputedStyle(element).display === 'none'
                || getComputedStyle(element).visibility === 'hidden';
        }
        return false;
    };

    let marked = false;
    const check = () => {
        if (marked || !matches()) return;
        marked = true;
        globalThis.__routeBootReady = true;
        globalThis.__reportRouteBootReady();
        observer.disconnect();
    };
    const observer = new MutationObserver(check);
    observer.observe(document, {
        attributes: true,
        childList: true,
        subtree: true,
        attributeFilter: ['class', 'hidden', 'style'],
    });
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', check, { once: true });
    } else {
        queueMicrotask(check);
    }
}

function classifyPath(pathname, resourceType) {
    const extension = extname(normalizePathname(pathname)).toLowerCase();
    if (resourceType === 'document' || extension === '.html' || !extension) return 'html';
    if (extension === '.js' || extension === '.mjs') return 'js';
    if (extension === '.css') return 'css';
    if (extension === '.json') return 'json';
    return null;
}

function fileSizes(file) {
    if (sizeCache.has(file)) return sizeCache.get(file);
    const bytes = readFileSync(file);
    const sizes = {
        raw: bytes.byteLength,
        gzip: gzipSync(bytes, { level: 6 }).byteLength,
        brotli: brotliCompressSync(bytes, {
            params: {
                [zlibConstants.BROTLI_PARAM_QUALITY]: 5,
            },
        }).byteLength,
    };
    sizeCache.set(file, sizes);
    return sizes;
}

function emptyBytes() {
    return { count: 0, raw: 0, gzip: 0, brotli: 0 };
}

function addBytes(total, sizes) {
    total.count += 1;
    total.raw += sizes.raw;
    total.gzip += sizes.gzip;
    total.brotli += sizes.brotli;
}

function summarizeResources(resources) {
    const bytes = {
        html: emptyBytes(),
        js: emptyBytes(),
        css: emptyBytes(),
        json: emptyBytes(),
        total: emptyBytes(),
    };

    for (const resource of resources) {
        addBytes(bytes[resource.kind], resource.bytes);
        addBytes(bytes.total, resource.bytes);
    }
    return bytes;
}

function snapshotResource(resource) {
    return {
        path: resource.path,
        raw: resource.bytes.raw,
        gzip: resource.bytes.gzip,
        brotli: resource.bytes.brotli,
    };
}

async function measureTarget(browser, origin, target) {
    const context = await browser.newContext({
        serviceWorkers: 'block',
        viewport: { width: 1440, height: 1000 },
    });
    const page = await context.newPage();
    const requests = [];
    const responses = new Map();
    const problems = [];
    let sequence = 0;
    let readySequence = null;

    // A 'settle' target has no DOM signal, so every request up to network idle
    // counts as boot work; readySequence stays null and the cutoff below is the
    // full request list.
    const usesDomSignal = target.ready.kind !== 'settle';
    if (usesDomSignal) {
        await page.exposeFunction('__reportRouteBootReady', () => {
            if (readySequence === null) readySequence = sequence;
        });
        await page.addInitScript(installReadyObserver, target.ready);
    }

    await page.route('**/*', async (route) => {
        const request = route.request();
        let url;
        try {
            url = new URL(request.url());
        } catch {
            await route.abort();
            return;
        }
        if (url.origin !== origin || SKIPPED_RESOURCE_TYPES.has(request.resourceType())) {
            await route.abort();
            return;
        }
        await route.continue();
    });

    page.on('request', (request) => {
        let url;
        try {
            url = new URL(request.url());
        } catch {
            return;
        }
        if (url.origin !== origin) return;
        sequence += 1;
        requests.push({
            request,
            sequence,
            pathname: normalizePathname(url.pathname),
            resourceType: request.resourceType(),
        });
    });

    page.on('response', (response) => {
        let url;
        try {
            url = new URL(response.url());
        } catch {
            return;
        }
        if (url.origin !== origin) return;
        responses.set(response.request(), response.status());
    });

    const routeUrl = `${origin}${BASE_PATH}${target.path}`;
    try {
        const navigation = await page.goto(routeUrl, {
            waitUntil: 'domcontentloaded',
            timeout: READY_TIMEOUT_MS,
        });
        if (!navigation?.ok()) {
            problems.push(`navigation returned HTTP ${navigation?.status() ?? 'unknown'}`);
        }
        if (usesDomSignal) {
            await page.waitForFunction(() => globalThis.__routeBootReady === true, null, {
                timeout: READY_TIMEOUT_MS,
            });
        } else {
            await page.waitForLoadState('networkidle', { timeout: READY_TIMEOUT_MS });
        }
    } catch (error) {
        problems.push(`ready signal timed out or navigation failed: ${error.message}`);
    }

    if (readySequence === null) readySequence = sequence;
    const bootRequests = requests.filter((entry) => entry.sequence <= readySequence);

    await Promise.allSettled(bootRequests.map(({ request }) => request.response()));

    const documentModules = await page.evaluate(() => Array.from(
        document.querySelectorAll('script[type="module"][src]'),
        (script) => new URL(script.src).pathname
    )).catch(() => []);

    const unique = new Map();
    for (const entry of bootRequests) {
        const kind = classifyPath(entry.pathname, entry.resourceType);
        if (!kind) continue;
        const key = `${kind}:${entry.pathname}`;
        if (unique.has(key)) continue;

        const file = distFileForPathname(entry.pathname);
        if (!file || !existsSync(file)) {
            problems.push(`no dist file for ${entry.pathname}`);
            continue;
        }
        const status = responses.get(entry.request);
        if (status !== undefined && status >= 400) {
            problems.push(`HTTP ${status}: ${entry.pathname}`);
        }
        unique.set(key, {
            kind,
            path: entry.pathname,
            bytes: fileSizes(file),
        });
    }

    const resources = [...unique.values()].sort((a, b) => a.path.localeCompare(b.path));
    const byKind = (kind) => resources.filter((resource) => resource.kind === kind);
    const pageEntries = [...new Set(documentModules)]
        .filter((path) => !GLOBAL_DOCUMENT_MODULES.has(path))
        .sort();

    const result = {
        path: target.path,
        ready: target.ready.description,
        pageEntries,
        js: byKind('js').map(snapshotResource),
        css: byKind('css').map(snapshotResource),
        json: byKind('json').map(snapshotResource),
        bytes: summarizeResources(resources),
        problems: [...new Set(problems)],
    };

    await context.close();
    return result;
}

export function compareSnapshots(current, baseline) {
    const deltas = [];
    if (!baseline?.targets) return deltas;

    for (const [key, route] of Object.entries(current.targets)) {
        const previous = baseline.targets[key];
        if (!previous) {
            deltas.push({ key, kind: 'new-route' });
            continue;
        }
        const previousJson = new Set(previous.json.map((entry) => entry.path));
        const currentJson = new Set(route.json.map((entry) => entry.path));
        const addedJson = [...currentJson].filter((path) => !previousJson.has(path)).sort();
        const removedJson = [...previousJson].filter((path) => !currentJson.has(path)).sort();
        const rawDelta = route.bytes.total.raw - previous.bytes.total.raw;
        const gzipDelta = route.bytes.total.gzip - previous.bytes.total.gzip;
        const brotliDelta = route.bytes.total.brotli - previous.bytes.total.brotli;
        if (addedJson.length || removedJson.length || rawDelta || gzipDelta || brotliDelta) {
            deltas.push({
                key,
                kind: 'changed',
                rawDelta,
                gzipDelta,
                brotliDelta,
                addedJson,
                removedJson,
            });
        }
    }
    return deltas;
}

export function formatBytes(value) {
    if (!Number.isFinite(value)) return 'n/a';
    const sign = value < 0 ? '-' : '';
    const absolute = Math.abs(value);
    if (absolute < 1024) return `${value} B`;
    if (absolute < 1024 * 1024) return `${sign}${(absolute / 1024).toFixed(1)} KiB`;
    return `${sign}${(absolute / 1024 / 1024).toFixed(2)} MiB`;
}

function formatSignedBytes(value) {
    if (value === 0) return '0 B';
    return `${value > 0 ? '+' : ''}${formatBytes(value)}`;
}

function printReport(report, baseline) {
    console.log('\nRoute boot report (cutoff is per-row; see each route\'s ready signal)');
    console.log('Route'.padEnd(20)
        + 'Entries'.padStart(9)
        + 'JS'.padStart(6)
        + 'CSS'.padStart(6)
        + 'JSON'.padStart(7)
        + 'Raw'.padStart(12)
        + 'Gzip'.padStart(12)
        + 'Brotli'.padStart(12));

    for (const [key, route] of Object.entries(report.targets)) {
        console.log(key.padEnd(20)
            + String(route.pageEntries.length).padStart(9)
            + String(route.js.length).padStart(6)
            + String(route.css.length).padStart(6)
            + String(route.json.length).padStart(7)
            + formatBytes(route.bytes.total.raw).padStart(12)
            + formatBytes(route.bytes.total.gzip).padStart(12)
            + formatBytes(route.bytes.total.brotli).padStart(12));
        console.log(`  ready: ${route.ready}`);
        console.log(`  JSON: ${route.json.map((entry) => entry.path).join(', ') || '(none)'}`);
        if (route.problems.length) {
            for (const problem of route.problems) console.log(`  problem: ${problem}`);
        }
    }

    const deltas = compareSnapshots(report, baseline);
    if (!baseline?.targets) {
        console.log('\nNo baseline found. Use --update-baseline after reviewing this report.');
    } else if (deltas.length === 0) {
        console.log('\nBaseline comparison: no request or byte changes.');
    } else {
        console.log('\nBaseline comparison (advisory):');
        for (const delta of deltas) {
            if (delta.kind === 'new-route') {
                console.log(`  ${delta.key}: new route`);
                continue;
            }
            console.log(
                `  ${delta.key}: raw ${formatSignedBytes(delta.rawDelta)}, `
                + `gzip ${formatSignedBytes(delta.gzipDelta)}, `
                + `brotli ${formatSignedBytes(delta.brotliDelta)}`
            );
            if (delta.addedJson.length) console.log(`    JSON added: ${delta.addedJson.join(', ')}`);
            if (delta.removedJson.length) console.log(`    JSON removed: ${delta.removedJson.join(', ')}`);
        }
    }
}

function parseArgs(argv) {
    const options = {
        targetKeys: [],
        updateBaseline: false,
        jsonPath: null,
        help: false,
    };

    for (let index = 0; index < argv.length; index += 1) {
        const arg = argv[index];
        if (arg === '--update-baseline') {
            options.updateBaseline = true;
        } else if (arg === '--target') {
            options.targetKeys.push(argv[++index]);
        } else if (arg === '--json') {
            options.jsonPath = argv[++index];
        } else if (arg === '--help' || arg === '-h') {
            options.help = true;
        } else {
            throw new Error(`Unknown argument: ${arg}`);
        }
    }
    if (options.targetKeys.includes(undefined) || options.jsonPath === undefined) {
        throw new Error('--target and --json require a value.');
    }
    if (options.updateBaseline && options.targetKeys.length) {
        throw new Error('--update-baseline requires the complete target set; omit --target.');
    }
    return options;
}

function printHelp() {
    console.log(`Usage: node scripts/report-route-boot.mjs [options]

Options:
  --target KEY       Measure one target; may be repeated
  --json PATH        Write the current report to PATH
  --update-baseline  Replace scripts/route-boot-baseline.json
  --help, -h         Show this help

Requires a current dist/ produced by npm run build or npm run build:no-minify.`);
}

async function run() {
    const options = parseArgs(process.argv.slice(2));
    if (options.help) {
        printHelp();
        return;
    }
    if (!existsSync(join(DIST_DIR, 'index.html'))) {
        throw new Error('dist/ is missing. Run npm run build:no-minify or npm run build first.');
    }

    const knownKeys = new Set(ROUTE_BOOT_TARGETS.map((target) => target.key));
    const unknownKeys = options.targetKeys.filter((key) => !knownKeys.has(key));
    if (unknownKeys.length) {
        throw new Error(`Unknown target(s): ${unknownKeys.join(', ')}`);
    }
    const selectedTargets = options.targetKeys.length
        ? ROUTE_BOOT_TARGETS.filter((target) => options.targetKeys.includes(target.key))
        : ROUTE_BOOT_TARGETS;

    // Imported here, not at module scope, so `npm test` can load this file's pure
    // helpers without pulling in Playwright.
    const { chromium } = await import('@playwright/test');

    const server = createDistServer();
    const origin = await listen(server);
    let browser;
    try {
        browser = await chromium.launch({
            channel: 'chromium',
            headless: true,
            args: ['--enable-unsafe-swiftshader'],
        });
        const targets = {};
        for (const target of selectedTargets) {
            process.stdout.write(`Measuring ${target.key}... `);
            targets[target.key] = await measureTarget(browser, origin, target);
            console.log('done');
        }

        const report = {
            schemaVersion: REPORT_SCHEMA_VERSION,
            basePath: BASE_PATH,
            targets,
        };
        const baseline = existsSync(BASELINE_PATH)
            ? JSON.parse(readFileSync(BASELINE_PATH, 'utf8'))
            : null;
        printReport(report, baseline);

        // Validate before writing: an incomplete measurement must never be stored
        // as the reviewed baseline.
        const routeProblems = Object.entries(targets)
            .flatMap(([key, route]) => route.problems.map((problem) => `${key}: ${problem}`));
        if (routeProblems.length) {
            throw new Error(`Route boot measurement was incomplete:\n${routeProblems.join('\n')}`);
        }

        if (options.jsonPath) {
            const outputPath = resolve(ROOT, options.jsonPath);
            writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`);
            console.log(`\nWrote report: ${toPosix(relative(ROOT, outputPath))}`);
        }
        if (options.updateBaseline) {
            writeFileSync(BASELINE_PATH, `${JSON.stringify(report, null, 2)}\n`);
            console.log(`\nUpdated baseline: ${toPosix(relative(ROOT, BASELINE_PATH))}`);
        }
    } finally {
        if (browser) await browser.close();
        await closeServer(server);
    }
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : null;
if (invokedPath === import.meta.url) {
    run().catch((error) => {
        console.error(`route-boot report failed: ${error.message}`);
        process.exitCode = 1;
    });
}
