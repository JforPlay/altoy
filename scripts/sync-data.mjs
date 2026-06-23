/**
 * sync-data.mjs
 * Copy the hand-maintained JSON data from its single editing home (src/data) into
 * public/data, where it is served as a static asset and fetched at runtime.
 *
 * Why this exists: a handful of data files are edited by hand (event timeline, shipgirl
 * birthdays) and the user wants them to live alongside src/data/updates.txt — one folder.
 * But unlike updates.txt (a build-time `?raw` import inlined into the homepage), these
 * files are pulled at runtime via `fetchJSONWithCache('data/...')`, and Astro only serves
 * `public/` at runtime — never `src/`. So src/data is the SOURCE you edit, and this script
 * mirrors each file into its real public/data location. The runtime consumers, the
 * IndexedDB cache, and check-data-shape all keep reading from public/data, untouched.
 *
 * Both the src/data source and the public/data copy are committed (the copy is generated;
 * edit only the src/data side). This script keeps them identical.
 *
 * Runs automatically before `dev`/`start` (predev/prestart) and at the head of `build`.
 * Run manually: `npm run data:sync`
 */
import { copyFileSync, existsSync, mkdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(SCRIPT_DIR, '..');

// src/data source  →  public/data destination (served at runtime).
// Add a hand-maintained data file here to manage it from src/data.
const MAPPINGS = [
    { src: 'src/data/kr_event_timeline.json',   dest: 'public/data/kr_event_timeline.json' },
    { src: 'src/data/shipgirl_birthday_data.json', dest: 'public/data/shipgirl/shipgirl_birthday_data.json' },
];

let copied = 0;
for (const { src, dest } of MAPPINGS) {
    const srcPath = join(ROOT, src);
    const destPath = join(ROOT, dest);

    // Fail loud: a missing source means the editing home moved or a typo crept into MAPPINGS.
    if (!existsSync(srcPath)) {
        console.error(`[sync-data] MISSING source: ${src}`);
        process.exit(1);
    }

    mkdirSync(dirname(destPath), { recursive: true });
    copyFileSync(srcPath, destPath);
    copied++;
    console.log(`[sync-data] ${src} → ${dest} (${statSync(destPath).size} bytes)`);
}

console.log(`[sync-data] ${copied}/${MAPPINGS.length} file(s) synced.`);
