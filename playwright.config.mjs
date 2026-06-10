// Playwright config for the smoke layer (tests/smoke/) — see that spec for scope.
// Serves the BUILT site via `astro preview`, so `npm run build` (or
// build:no-minify) must have produced dist/ first. CI runs it in deploy.yml
// between build and artifact upload.
import { defineConfig } from '@playwright/test';

const PORT = 4321;
const BASE_URL = `http://localhost:${PORT}/altoy/`;

export default defineConfig({
    testDir: 'tests/smoke',
    fullyParallel: true,
    forbidOnly: !!process.env.CI,
    // One retry absorbs transient flake (slow first paint, OS hiccup);
    // a page that genuinely fails to boot still blocks the deploy.
    retries: process.env.CI ? 1 : 0,
    reporter: process.env.CI ? 'github' : 'list',
    use: {
        baseURL: BASE_URL,
        // Full Chromium in new-headless mode — the default headless shell has
        // no GL at all, and pixi.js pages (skin-sd-viewer) need WebGL to boot.
        channel: 'chromium',
        // The SW (sw.js) would stale-while-revalidate-cache responses across
        // tests and mask 404s — smoke must always hit the real dist/ files.
        serviceWorkers: 'block',
        trace: 'retain-on-failure',
        // Headless Chromium has no GPU; allow software (SwiftShader) WebGL so
        // pixi.js pages (skin-sd-viewer) boot like they do in real browsers.
        launchOptions: { args: ['--enable-unsafe-swiftshader'] },
    },
    webServer: {
        command: 'npm run preview',
        url: BASE_URL,
        reuseExistingServer: !process.env.CI,
        timeout: 30_000,
    },
});
