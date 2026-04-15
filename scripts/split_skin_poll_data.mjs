/**
 * Extract lightweight poll data from skin_voiceline_data.json.
 * Keeps only the 9 fields needed for the skin poll/voting page.
 *
 * Input:  public/data/skin/skin_voiceline_data.json  (~20 MB, 80+ fields per skin)
 * Output: public/data/skin/skin_poll_data.json        (~200 KB, 9 fields per skin)
 *
 * Usage: node scripts/split_skin_poll_data.mjs
 */
import fs from 'fs';

const INPUT  = 'public/data/skin/skin_voiceline_data.json';
const OUTPUT = 'public/data/skin/skin_poll_data.json';

const FIELDS = [
    '클뜯 id',
    '함순이 이름',
    '한글 함순이 + 스킨 이름',
    '깔끔한 일러',
    '전체 일러',
    'ASMR 일러',
    '스킨 타입 - 한글',
    '스킨 태그',
    '진영',
    '레어도',
];

const rawData = fs.readFileSync(INPUT, 'utf-8');
const data    = JSON.parse(rawData);

const result  = {};
let skipped   = 0;
let included  = 0;

for (const [id, skin] of Object.entries(data)) {
    // Skip skins missing required identity fields
    if (!skin['한글 함순이 + 스킨 이름'] || !skin['함순이 이름'] || !skin['클뜯 id']) {
        skipped++;
        continue;
    }

    const entry = {};
    for (const field of FIELDS) {
        entry[field] = skin[field] ?? null;
    }
    result[id] = entry;
    included++;
}

const outputJson = JSON.stringify(result, null, 4);
fs.writeFileSync(OUTPUT, outputJson);

console.log(`--- Summary ---`);
console.log(`Total skins in input : ${Object.keys(data).length}`);
console.log(`Included             : ${included}`);
console.log(`Skipped (incomplete) : ${skipped}`);
console.log(`Input size           : ${(rawData.length / 1024 / 1024).toFixed(2)} MB`);
console.log(`Output size          : ${(outputJson.length / 1024).toFixed(1)} KB`);
console.log(`Written to           : ${OUTPUT}`);
