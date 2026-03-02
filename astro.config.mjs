import { defineConfig } from 'astro/config';

// https://astro.build/config
// CF_PAGES is auto-set by Cloudflare Pages during builds
const isCloudflare = !!process.env.CF_PAGES;
// console.log('[astro.config] CF_PAGES =', process.env.CF_PAGES, '→ isCloudflare =', isCloudflare);

export default defineConfig({
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
