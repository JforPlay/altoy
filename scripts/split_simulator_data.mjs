/**
 * Split large simulator data files into chunks for on-demand loading.
 *
 * Input:
 *   data/sim/weapon_property.json  (20MB, ~52K entries)
 *   data/sim/barrage_template.json (10MB, ~26K entries)
 *   data/sim/bullet_template.json  (19MB, ~19K entries)
 *
 * Output:
 *   data/sim/weapon_chunks/chunk_index.json  — maps weapon ID → chunk number
 *   data/sim/weapon_chunks/chunk_XX.json     — denormalized: weapons + referenced barrage + bullet data
 *
 * Strategy:
 *   - Sort weapons by numeric ID, group into chunks of CHUNK_SIZE
 *   - For each weapon, resolve inheritance (base) and collect all referenced barrage_IDs and bullet_IDs
 *   - Each chunk file contains { weapons: {}, barrages: {}, bullets: {} }
 *   - Index file maps every weapon ID to its chunk number for O(1) lookup
 *
 * Usage: node scripts/split_simulator_data.mjs
 */
import fs from 'fs';
import path from 'path';

const CHUNK_SIZE = 500;
const DATA_DIR = path.join('public', 'data', 'sim');
const OUTPUT_DIR = path.join(DATA_DIR, 'weapon_chunks');
const INDEX_FILE = path.join(OUTPUT_DIR, 'chunk_index.json');

// Read source data
console.log('Reading source data...');
const weaponData = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'weapon_property.json'), 'utf-8'));
const barrageData = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'barrage_template.json'), 'utf-8'));
const bulletData = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'bullet_template.json'), 'utf-8'));

console.log(`Weapons: ${Object.keys(weaponData).length}`);
console.log(`Barrages: ${Object.keys(barrageData).length}`);
console.log(`Bullets: ${Object.keys(bulletData).length}`);

// Create output directory
if (fs.existsSync(OUTPUT_DIR)) {
    // Clean existing chunks
    const existing = fs.readdirSync(OUTPUT_DIR);
    existing.forEach(f => fs.unlinkSync(path.join(OUTPUT_DIR, f)));
} else {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
}

// Sort weapon IDs numerically
const weaponIds = Object.keys(weaponData).sort((a, b) => Number(a) - Number(b));

/**
 * Collect all barrage and bullet IDs referenced by a weapon (including base weapon).
 * Also follows shrapnel chains in bullet extra_param.
 */
function collectReferencedIds(weaponId, collectedBarrages, collectedBullets, visitedWeapons = new Set()) {
    if (visitedWeapons.has(weaponId)) return;
    visitedWeapons.add(weaponId);

    const weapon = weaponData[weaponId];
    if (!weapon) return;

    // If weapon has a base, collect from base too
    if (weapon.base) {
        collectReferencedIds(String(weapon.base), collectedBarrages, collectedBullets, visitedWeapons);
    }

    // Collect barrage IDs
    const barrageIds = weapon.barrage_ID || [];
    barrageIds.forEach(id => {
        collectedBarrages.add(String(id));
        // Check barrage for transform_ID chains
        const barrage = barrageData[String(id)];
        if (barrage?.transform_ID) {
            collectBarrageChain(String(barrage.transform_ID), collectedBarrages, collectedBullets);
        }
    });

    // Collect bullet IDs
    const bulletIds = weapon.bullet_ID || [];
    bulletIds.forEach(id => {
        const bulletId = String(id);
        collectedBullets.add(bulletId);
        // Check bullet for shrapnel (recursive weapon/barrage/bullet references)
        collectShrapnelIds(bulletId, collectedBarrages, collectedBullets);
    });
}

/**
 * Follow barrage transform chains
 */
function collectBarrageChain(barrageId, collectedBarrages, collectedBullets) {
    if (collectedBarrages.has(barrageId)) return;
    collectedBarrages.add(barrageId);

    const barrage = barrageData[barrageId];
    if (!barrage) return;

    if (barrage.transform_ID) {
        collectBarrageChain(String(barrage.transform_ID), collectedBarrages, collectedBullets);
    }
}

/**
 * Follow bullet shrapnel chains
 */
function collectShrapnelIds(bulletId, collectedBarrages, collectedBullets) {
    const bullet = bulletData[bulletId];
    if (!bullet?.extra_param?.shrapnel) return;

    const shrapnel = bullet.extra_param.shrapnel;
    for (const key in shrapnel) {
        if (!isNaN(key) && shrapnel[key]) {
            const entry = shrapnel[key];
            if (entry.barrage_ID) {
                const bId = String(entry.barrage_ID);
                if (!collectedBarrages.has(bId)) {
                    collectedBarrages.add(bId);
                    collectBarrageChain(bId, collectedBarrages, collectedBullets);
                }
            }
            if (entry.bullet_ID) {
                const buId = String(entry.bullet_ID);
                if (!collectedBullets.has(buId)) {
                    collectedBullets.add(buId);
                    collectShrapnelIds(buId, collectedBarrages, collectedBullets);
                }
            }
        }
    }
}

// Build chunks
const weaponToChunk = {};  // weaponId -> chunk number
let chunkNum = 0;
let totalChunkSize = 0;

for (let i = 0; i < weaponIds.length; i += CHUNK_SIZE) {
    const chunkWeaponIds = weaponIds.slice(i, i + CHUNK_SIZE);

    // Collect all weapons (including bases), barrages, and bullets for this chunk
    const chunkWeapons = {};
    const chunkBarrageIds = new Set();
    const chunkBulletIds = new Set();

    chunkWeaponIds.forEach(wId => {
        // Map this weapon to its chunk
        weaponToChunk[wId] = chunkNum;

        // Add weapon data
        chunkWeapons[wId] = weaponData[wId];

        // Also include the base weapon in the chunk if it exists
        if (weaponData[wId]?.base) {
            const baseId = String(weaponData[wId].base);
            chunkWeapons[baseId] = weaponData[baseId];
            // Map base to this chunk too (if not already mapped)
            if (!(baseId in weaponToChunk)) {
                weaponToChunk[baseId] = chunkNum;
            }
        }

        // Collect referenced barrage/bullet IDs
        collectReferencedIds(wId, chunkBarrageIds, chunkBulletIds);
    });

    // Build chunk data
    const chunkBarrages = {};
    chunkBarrageIds.forEach(id => {
        if (barrageData[id]) chunkBarrages[id] = barrageData[id];
    });

    const chunkBullets = {};
    chunkBulletIds.forEach(id => {
        if (bulletData[id]) chunkBullets[id] = bulletData[id];
    });

    const chunk = {
        weapons: chunkWeapons,
        barrages: chunkBarrages,
        bullets: chunkBullets
    };

    const chunkJson = JSON.stringify(chunk);
    const chunkPath = path.join(OUTPUT_DIR, `chunk_${String(chunkNum).padStart(3, '0')}.json`);
    fs.writeFileSync(chunkPath, chunkJson);
    totalChunkSize += chunkJson.length;

    console.log(`  Chunk ${chunkNum}: ${chunkWeaponIds.length} weapons, ${chunkBarrageIds.size} barrages, ${chunkBulletIds.size} bullets (${(chunkJson.length / 1024).toFixed(1)} KB)`);

    chunkNum++;
}

// Write index
const indexData = {
    chunkCount: chunkNum,
    weaponToChunk,
    totalWeapons: weaponIds.length
};

const indexJson = JSON.stringify(indexData);
fs.writeFileSync(INDEX_FILE, indexJson);

console.log(`\n--- Summary ---`);
console.log(`Total chunks: ${chunkNum}`);
console.log(`Index file: ${(indexJson.length / 1024).toFixed(1)} KB`);
console.log(`Total chunk files: ${(totalChunkSize / 1024 / 1024).toFixed(2)} MB`);
console.log(`Original weapon: ${(fs.statSync(path.join(DATA_DIR, 'weapon_property.json')).size / 1024 / 1024).toFixed(2)} MB`);
console.log(`Original barrage: ${(fs.statSync(path.join(DATA_DIR, 'barrage_template.json')).size / 1024 / 1024).toFixed(2)} MB`);
console.log(`Original bullet: ${(fs.statSync(path.join(DATA_DIR, 'bullet_template.json')).size / 1024 / 1024).toFixed(2)} MB`);
console.log(`\nFiles written to: ${OUTPUT_DIR}/`);
