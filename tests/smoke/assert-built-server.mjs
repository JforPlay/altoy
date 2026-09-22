/**
 * globalSetup: refuse to run the smoke suite against `astro dev`.
 *
 * `playwright.config.mjs` serves dist/ via `npm run preview` on port 4321 — the same
 * port `astro dev` uses — with `reuseExistingServer: !CI`. Leave a dev server up and
 * Playwright silently adopts it, so every spec exercises the DEV pipeline: `npm run
 * build` before the run buys nothing, a dist-only regression cannot be seen, and the
 * suite still reports all green. Nothing else in the stack notices, because a dev
 * server answers every request perfectly well.
 *
 * The tell is Vite's HMR client, which dev injects into every page and preview never
 * does. One fetch of the base URL, before any spec runs, turns a silently-wrong run
 * into a loud one.
 *
 * Runs after `webServer` has come up (Playwright's own ordering), so what it fetches
 * is whatever actually answered on that port — the reused server included, which is
 * the entire point.
 */

const DEV_MARKERS = ['/@vite/client', 'astro-dev-toolbar'];

export default async function assertBuiltServer(config) {
    const baseURL = config.projects?.[0]?.use?.baseURL;
    if (!baseURL) return;

    let html;
    try {
        html = await (await fetch(baseURL)).text();
    } catch (err) {
        // Not this guard's job to diagnose an unreachable server — Playwright's
        // own webServer timeout gives a better message than we can here.
        console.warn(`[smoke] could not probe ${baseURL} (${err.message}); skipping dev-server check`);
        return;
    }

    const marker = DEV_MARKERS.find((m) => html.includes(m));
    if (!marker) return;

    const port = new URL(baseURL).port || '(default)';
    throw new Error(
        `The smoke suite is pointed at an 'astro dev' server, not the built site.\n`
        + `  ${baseURL} served ${marker}, which only a dev server emits.\n\n`
        + `playwright.config.mjs uses reuseExistingServer outside CI, so a dev server\n`
        + `already listening on :${port} is adopted instead of 'npm run preview' over dist/.\n`
        + `Every spec would then test the dev pipeline and pass regardless of the build.\n\n`
        + `Stop the dev server on :${port} and re-run (agents: use :4399 for your own servers).`
    );
}
