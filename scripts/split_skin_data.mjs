/**
 * Split skin_voiceline_data.json into:
 * - skin_voiceline_index.json (character names + skin names only, for search)
 * - skin_voiceline_characters/{character_name_hash}.json (full skin data per character)
 *
 * Usage: node scripts/split_skin_data.mjs
 */
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

const INPUT = 'public/data/skin/skin_voiceline_data.json';
const OUTPUT_DIR = 'public/data/skin/skin_characters';
const INDEX_FILE = 'public/data/skin/skin_voiceline_index.json';

// Read the full data
const rawData = fs.readFileSync(INPUT, 'utf-8');
const data = JSON.parse(rawData);

// Create output directory
if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
}

// Group skins by character name
const characterGroups = {};
const allEntries = Object.values(data);

allEntries.forEach((skin, idx) => {
    const charName = skin['함순이 이름'] || 'Unknown';
    if (!characterGroups[charName]) {
        characterGroups[charName] = [];
    }
    characterGroups[charName].push(skin);
});

// Create a short hash for filenames (avoids Korean chars in URLs)
function nameToHash(name) {
    return crypto.createHash('md5').update(name).digest('hex').slice(0, 8);
}

// Build index and write per-character files
const index = {
    characters: {},  // charName -> { hash, skinCount, skins: [{name, clientId}] }
    totalSkins: allEntries.length
};

let totalCharSize = 0;

for (const [charName, skins] of Object.entries(characterGroups)) {
    const hash = nameToHash(charName);

    // Index entry: lightweight metadata + filter fields for random skin feature
    index.characters[charName] = {
        hash,
        skinCount: skins.length,
        skins: skins.map(s => ({
            name: s['한글 함순이 + 스킨 이름'] || '',
            clientId: s['클뜯 id'] || '',
            rarity: s['레어도'] || '',
            type: s['스킨 타입 - 한글'] || '',
            tag: s['스킨 태그'] || '',
            nation: s['진영'] || ''
        }))
    };

    // Write full character data
    const charPath = path.join(OUTPUT_DIR, `${hash}.json`);
    const charJson = JSON.stringify(skins);
    fs.writeFileSync(charPath, charJson);
    totalCharSize += charJson.length;
}

// Write index file
const indexJson = JSON.stringify(index);
fs.writeFileSync(INDEX_FILE, indexJson);

console.log(`--- Summary ---`);
console.log(`Total characters: ${Object.keys(characterGroups).length}`);
console.log(`Total skins: ${allEntries.length}`);
console.log(`Index file: ${(indexJson.length / 1024).toFixed(1)} KB`);
console.log(`Total character files: ${(totalCharSize / 1024 / 1024).toFixed(2)} MB`);
console.log(`Original file: ${(rawData.length / 1024 / 1024).toFixed(2)} MB`);
console.log(`\nFiles written to: ${OUTPUT_DIR}/`);
console.log(`Index written to: ${INDEX_FILE}`);
