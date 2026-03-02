import sharp from 'sharp';
import { readdir, unlink } from 'fs/promises';
import { join, extname, basename } from 'path';

const DIRS = ['public/assets/img', 'public/assets/icon'];
const SKIP = new Set(['favicon.ico', 'arca.svg']);
const EXTENSIONS = new Set(['.png', '.jpg', '.jpeg']);

let converted = 0;
let skipped = 0;

for (const dir of DIRS) {
  const files = await readdir(dir);
  for (const file of files) {
    if (SKIP.has(file)) { skipped++; continue; }
    const ext = extname(file).toLowerCase();
    if (!EXTENSIONS.has(ext)) { skipped++; continue; }

    const input = join(dir, file);
    const output = join(dir, basename(file, ext) + '.webp');

    await sharp(input).webp({ quality: 85 }).toFile(output);
    await unlink(input);
    converted++;
    console.log(`${input} → ${output}`);
  }
}

console.log(`\nDone: ${converted} converted, ${skipped} skipped`);
