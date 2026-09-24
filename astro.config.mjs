import { rm, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { defineConfig } from 'astro/config';

// https://astro.build/config
// CF_PAGES is auto-set by Cloudflare Pages during builds
const isCloudflare = !!process.env.CF_PAGES;
// console.log('[astro.config] CF_PAGES =', process.env.CF_PAGES, '→ isCloudflare =', isCloudflare);

/**
 * Files under public/data/ that are BUILD INPUTS, not served assets.
 *
 * `data:split` (and the two sheet-sync scripts) read them and write the chunks
 * the browser actually fetches; no page ever requests the master. They live in
 * public/ only because that is where the WSL pipeline deploys and where the
 * split scripts expect them — so Astro copies ~96 MB into dist/ and every
 * deploy uploads it for nothing.
 *
 * Verified 2026-09-22: exact-basename search across src/ + public/js/ finds no
 * reference to any of them; the only readers are in scripts/.
 *
 * Adding a file here is safe ONLY if nothing in src/ or public/js/ fetches it
 * AND nothing outside the repo fetches its Pages URL. The two sheet feeds
 * (hearing_catalog.csv, skin_label_worklist.csv) have external readers — the
 * Google Sheets — which read them from raw.githubusercontent on main, not
 * from the deployed site (they 404'd there after this list first shipped).
 */
const BUILD_ONLY_DATA = [
    'data/story-viewer/main_story_data.json',      // -> main_story_chapters/ + main_story_index.json
    'data/story-viewer/event_story_data.json',     // -> event_story_chunks/ + event_story_index.json
    'data/skin/skin_voiceline_data.json',          // -> skin_characters/ + skin_voiceline_index.json
    'data/skin/skin_labels.json',                  // sync-skin-labels.mjs
    'data/skin/skin_label_worklist.csv',           // sync-skin-labels.mjs
    'data/skin/skin_labels_attributes.csv',        // sync-skin-labels.mjs
    'data/equip/hearing_catalog.csv',              // sync-equip-hearing.mjs
];

/** Drop the build-input masters from dist/ once the static copy is done. */
const pruneBuildOnlyData = () => ({
    name: 'altoy:prune-build-only-data',
    hooks: {
        'astro:build:done': async ({ dir, logger }) => {
            const root = fileURLToPath(dir);
            let freed = 0;
            for (const rel of BUILD_ONLY_DATA) {
                const path = join(root, rel);
                try {
                    freed += (await stat(path)).size;
                    await rm(path);
                } catch {
                    // Absent is fine: a build:no-minify run skips data:split, and
                    // the sheet CSVs only exist after their sync script has run.
                }
            }
            logger.info(`pruned ${(freed / 1e6).toFixed(1)} MB of build-input data from dist/`);
        },
    },
});

export default defineConfig({
    integrations: [pruneBuildOnlyData()],

    site: isCloudflare ? 'https://altoy.pages.dev' : 'https://jforplay.github.io',
    base: isCloudflare ? '/' : '/altoy',

    // Build configuration
    build: {
        assets: '_assets'
    },

    // Development server
    server: {
        port: 4321
    },

    // Output static files for GitHub Pages
    output: 'static'
});
