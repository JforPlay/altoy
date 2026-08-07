/**
 * Smoke layer: every catalog page boots clean in a real browser.
 *
 * Why this exists: public/js/** is served unbundled — nothing resolves its
 * import graph at build time, so a typo'd import path or a runtime throw in
 * page init ships green through `npm test` + `astro build` and only fails in
 * the browser. This spec loads every PAGE_CATALOG page (plus the homepage)
 * from `astro preview` and fails on:
 *   - uncaught JS exceptions during load/init
 *   - same-origin non-image HTTP failures (renamed JSON, broken script path)
 *   - console.error emitted by our own (same-origin) code
 *
 * Deliberately NOT gated on: external hosts (CDN images/audio/Firebase — not
 * this deploy's problem) and image 404s (IMG_FALLBACKS in utils.js handles
 * those by design). It asserts nothing about content correctness — boot-only.
 *
 * Run: `npm run test:smoke` (needs a prior `npm run build` for dist/).
 */
import { test, expect } from '@playwright/test';
import { PAGE_CATALOG } from '../../public/js/pages.catalog.js';

const IMAGE_EXT_RE = /\.(png|jpe?g|gif|webp|avif|svg|ico)(\?|#|$)/i;

// './' resolves against baseURL to the /altoy/ homepage.
const TARGETS = [
    { key: 'HOME', path: './' },
    ...PAGE_CATALOG.map(({ key, path }) => ({ key, path })),
];

for (const { key, path } of TARGETS) {
    test(`${key} boots clean (${path})`, async ({ page, baseURL }) => {
        const origin = new URL(baseURL).origin;
        const problems = [];

        page.on('pageerror', err => {
            problems.push(`uncaught exception: ${err.message}`);
        });

        page.on('response', res => {
            let url;
            try { url = new URL(res.url()); } catch { return; }
            if (url.origin !== origin) return;
            if (IMAGE_EXT_RE.test(url.pathname)) return;
            if (res.status() >= 400) problems.push(`HTTP ${res.status()}: ${url.pathname}`);
        });

        page.on('requestfailed', req => {
            let url;
            try { url = new URL(req.url()); } catch { return; }
            if (url.origin !== origin) return;
            if (IMAGE_EXT_RE.test(url.pathname)) return;
            problems.push(`request failed: ${url.pathname} (${req.failure()?.errorText})`);
        });

        page.on('console', msg => {
            if (msg.type() !== 'error') return;
            const src = msg.location()?.url ?? '';
            // Only our own code's console.error. Network-layer chatter
            // (resource 404s, CORS rejections — e.g. the Cloudflare Insights
            // beacon refusing localhost) is attributed to the page itself, so
            // filter by text; the response/requestfailed handlers above own
            // network gating.
            if (!src.startsWith(origin)) return;
            if (/Failed to load resource|blocked by CORS policy|net::ERR_/.test(msg.text())) return;
            problems.push(`console.error: ${msg.text()}`);
        });

        // loadingbg / comic-viewer / island-misc list their images through the
        // unauthenticated GitHub contents API (60 req/hr per IP). CI runners
        // share IPs, so the call intermittently fails at the network layer and
        // the pages' catch logs a console.error — an external outage, not a
        // boot regression. Serve an empty listing so boot stays deterministic.
        await page.route('https://api.github.com/**', route =>
            route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }));

        const response = await page.goto(path, { waitUntil: 'load' });
        expect(response.ok(), `page load returned ${response.status()}`).toBe(true);

        // Page init runs on DOMContentLoaded and fetches data JSON; give it a
        // bounded settle window (local static server — fetches resolve fast).
        // Smoke tradeoff: errors thrown after this window aren't caught.
        await page.waitForTimeout(2000);

        expect(problems).toEqual([]);
    });
}
