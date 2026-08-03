/**
 * Global search 장비 section: equipment must be findable by name AND by the
 * curator 별명 (equip_hearing.json), and the 장비 연구 sub-link must appear only
 * for equips that actually sit in a research tree.
 *
 * A Playwright spec rather than a node test because the section is assembled
 * from three lazily-fetched datasets inside the live modal — the contract under
 * test is the wiring, not a DOM-free unit.
 *
 * Fixtures are derived from the committed data (never build artifacts) and are
 * chosen to match exactly one equip, so the 6-row section cap can't hide them.
 */
import { readFileSync } from 'node:fs';
import { test, expect } from '@playwright/test';
import { seedFuse } from './helpers.mjs';

const read = (path) => JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8'));

const lite = read('../../public/data/equip/equip_data_lite.json');
const commentary = read('../../public/data/equip/equip_hearing.json').entries;
const upgradeTemplates = read('../../public/data/equip/equip_upgrade_template.json');

const treeIds = new Set();
for (const template of Object.values(upgradeTemplates)) {
    for (const [, , equipId] of template.equipments || []) treeIds.add(equipId);
}

// Mirrors the record shape global-search.js builds from these same files.
const records = lite.map(equip => ({
    id: equip.id,
    name: equip.name,
    alias: String(commentary[equip.id]?.alias || '').split(',').map(a => a.trim()).filter(Boolean),
}));

/** How many equips a query would match under substring rules (the Fuse stub's behaviour). */
function matchCount(query) {
    const needle = query.toLowerCase();
    return records.filter(({ name, alias }) =>
        [name, ...alias].some(value => value.toLowerCase().includes(needle))).length;
}

const findUnique = (predicate, pick) => {
    for (const record of records) {
        const query = predicate(record) ? pick(record) : null;
        if (query && query.length >= 2 && matchCount(query) === 1) return { record, query };
    }
    return null;
};

const nicknamed = findUnique(r => r.alias.length > 0, r => r.alias[0]);
const inTree = findUnique(r => treeIds.has(r.id), r => r.name);
const notInTree = findUnique(r => !treeIds.has(r.id), r => r.name);

for (const [label, fixture] of Object.entries({ nicknamed, inTree, notInTree })) {
    if (!fixture) throw new Error(`global-search: no unambiguous ${label} equip fixture in committed data`);
}

/** Open the palette on the homepage and search, returning the 장비 rows. */
async function searchEquip(page, query) {
    await seedFuse(page);
    await page.goto('.', { waitUntil: 'domcontentloaded' });
    await page.locator('.global-search-trigger').first().click();
    await page.locator('#global-search-input').fill(query);
    return page.locator('#global-search-results .global-search-ship')
        .filter({ has: page.locator('a[href*="equip-viewer"]') });
}

test('장비 section finds equipment by 별명', async ({ page }) => {
    const rows = await searchEquip(page, nicknamed.query);
    const row = rows.filter({ hasText: nicknamed.record.name });

    await expect(row).toHaveCount(1);
    await expect(page.locator('#global-search-results .global-search-section', { hasText: '장비' })).toBeVisible();
    await expect(row.locator('.global-search-item-desc')).toHaveText(`별명: ${nicknamed.record.alias.join(', ')}`);
    await expect(row.locator('a[title="장비 DB"]'))
        .toHaveAttribute('href', new RegExp(`equip-viewer/\\?equip=${nicknamed.record.id}$`));
});

test('장비 연구 sub-link appears only for equips in a research tree', async ({ page }) => {
    const treeRows = await searchEquip(page, inTree.query);
    const treeRow = treeRows.filter({ hasText: inTree.record.name });
    await expect(treeRow.locator('.global-search-ship-link')).toHaveCount(2);
    await expect(treeRow.locator('a[title="장비 연구"]'))
        .toHaveAttribute('href', new RegExp(`equip-upgrade/\\?equip=${inTree.record.id}$`));

    const plainRows = await searchEquip(page, notInTree.query);
    const plainRow = plainRows.filter({ hasText: notInTree.record.name });
    await expect(plainRow.locator('.global-search-ship-link')).toHaveCount(1);
});
