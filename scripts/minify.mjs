/**
 * Post-build script to minify JavaScript files in dist/scripts
 * Run after `astro build` to minify all JS files
 */
import { readdir, readFile, writeFile, stat } from 'fs/promises';
import { join } from 'path';
import { minify } from 'terser';

const DIST_SCRIPTS = './dist/scripts';

// Terser options for optimal minification
const terserOptions = {
    compress: {
        drop_console: false, // Keep console.log for debugging
        drop_debugger: true,
        passes: 2
    },
    mangle: true,
    format: {
        comments: false
    }
};

async function getAllJsFiles(dir) {
    const files = [];
    const entries = await readdir(dir, { withFileTypes: true });

    for (const entry of entries) {
        const fullPath = join(dir, entry.name);
        if (entry.isDirectory()) {
            files.push(...await getAllJsFiles(fullPath));
        } else if (entry.name.endsWith('.js')) {
            files.push(fullPath);
        }
    }
    return files;
}

async function minifyFile(filePath) {
    try {
        const code = await readFile(filePath, 'utf-8');
        const originalSize = Buffer.byteLength(code, 'utf-8');

        const result = await minify(code, terserOptions);

        if (result.code) {
            await writeFile(filePath, result.code);
            const newSize = Buffer.byteLength(result.code, 'utf-8');
            const savings = ((1 - newSize / originalSize) * 100).toFixed(1);
            console.log(`  ✓ ${filePath} (${savings}% smaller)`);
            return { original: originalSize, minified: newSize };
        }
    } catch (error) {
        console.error(`  ✗ ${filePath}: ${error.message}`);
    }
    return { original: 0, minified: 0 };
}

async function main() {
    console.log('\n📦 Minifying JavaScript files...\n');

    try {
        const files = await getAllJsFiles(DIST_SCRIPTS);
        console.log(`Found ${files.length} JavaScript files\n`);

        let totalOriginal = 0;
        let totalMinified = 0;

        for (const file of files) {
            const { original, minified } = await minifyFile(file);
            totalOriginal += original;
            totalMinified += minified;
        }

        const totalSavings = ((1 - totalMinified / totalOriginal) * 100).toFixed(1);
        console.log(`\n✅ Done! Total savings: ${(totalOriginal / 1024).toFixed(1)}KB → ${(totalMinified / 1024).toFixed(1)}KB (${totalSavings}% smaller)\n`);
    } catch (error) {
        console.error('Error during minification:', error);
        process.exit(1);
    }
}

main();
