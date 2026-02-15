import { defineConfig } from 'astro/config';

// https://astro.build/config
export default defineConfig({
    // GitHub Pages configuration
    site: 'https://jforplay.github.io',
    base: '/altoy',

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
