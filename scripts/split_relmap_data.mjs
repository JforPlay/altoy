/**
 * Build the 함순이 관계도 data (public/data/relmap/, git-ignored):
 * - relmap_graph.json    — nodes with baked layout, links, nations, classes, provinces (page boot)
 * - relmap_evidence.json — quotes, partner lists and story refs per link (first selection)
 *
 * Runs in `npm run data:split` after split_story_data.mjs, whose
 * story_actor_index.json it reads. All logic lives in relmap-graph.mjs.
 *
 * Usage: node scripts/split_relmap_data.mjs
 */
import fs from 'fs';
import { buildRelmap } from './relmap-graph.mjs';

const OUT_DIR = 'public/data/relmap';
const read = (file) => JSON.parse(fs.readFileSync(file, 'utf-8'));

const voicelines = read('public/data/skin/skin_voiceline_data.json');
if (!voicelines.some((e) => (e['함대 특수대사'] || []).some((x) => Array.isArray(x.partners)))) {
    throw new Error('relmap: no 함대 특수대사 entry has "partners" — run the WSL pipeline (Task 1)');
}
const full = read('public/data/ship_info_data.json');
const shipTags = Object.fromEntries((Array.isArray(full) ? full : Object.values(full)).map((s) => [s.gid, s.tag_list || []]));

const { graph, evidence, warnings } = buildRelmap({
    ships: read('public/data/ship_info_lite.json'),
    shipTags,
    voicelines,
    actorIndex: read('public/data/story-viewer/story_actor_index.json'),
    juusPosts: Object.values(read('public/data/juustagram_data.json')),
    nations: read('public/data/mapping/nationality_mapping.json'),
    classNames: read('src/data/relmap_class_names.json'),
    aliases: read('src/data/relmap_aliases.json'),
});

fs.mkdirSync(OUT_DIR, { recursive: true });
const write = (name, data) => {
    const json = JSON.stringify(data);
    fs.writeFileSync(`${OUT_DIR}/${name}`, json);
    return `${name} ${(json.length / 1024).toFixed(0)} KB`;
};
const sizes = [write('relmap_graph.json', graph), write('relmap_evidence.json', evidence)];
const isolated = graph.nodes.filter((n) => n[6] === 0).length;
console.log(
    `[relmap] ${graph.nodes.length} shipgirls (${isolated} unlinked), ${graph.links.length} links, `
    + `${graph.classes.length} classes, ${graph.provinces.length} provinces → ${sizes.join(', ')}`,
);
for (const w of warnings) console.warn(`[relmap] warning: ${w}`);
