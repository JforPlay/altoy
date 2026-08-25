/**
 * Guards for fleet-sim curated presets (R4). Each assertion locks a claim the
 * release makes by construction:
 *   - the 추천 편성 button is gated on the file: an empty preset file ships no
 *     dead entry point, a populated one reveals it
 *   - a preset row is built from the code, not from what the author typed —
 *     ship names and the fleet count come out of the decode
 *   - 불러오기 IS the share-restore path, so the author's damage target comes
 *     along; a per-boss build whose numbers point elsewhere is worthless
 *   - a multi-fleet preset restores every fleet
 *   - a code that no longer decodes is dropped rather than offered as a load
 *     that would clear the user's fleet
 *   - folded in from the icebox: the save library can rename and overwrite in
 *     place, and both survive a reload
 *
 * Preset payloads are stubbed rather than read from src/data: the shipped file
 * is empty (the user authors it), and pinning the suite to its contents would
 * break the moment they add a row.
 */
import { test, expect } from '@playwright/test';

const PAGE = 'simulators/fleet-sim/';

/** 애리조나 (10504) alone, with 브리스톨·META T3 as the damage target. */
const CODE_ARIZONA = 'eyJzIjpbeyJnIjoxMDUwNCwibCI6MTIwLCJhIjoibG92ZSIsImUiOltudWxsLG51bGwsbnVsbCxudWxsLG51bGxdLCJzcCI6bnVsbH0sbnVsbCxudWxsLG51bGwsbnVsbCxudWxsXSwidCI6eyJrIjoibWV0YSIsImIiOiI5NzAxMTIiLCJ0aSI6M319';
/** Two fleets: 유니콘 (20603) then 애리조나 (10504), no target. */
const CODE_TWO_FLEETS = 'eyJmIjpbW3siZyI6MjA2MDMsImwiOjEyMCwiYSI6ImxvdmUiLCJlIjpbbnVsbCxudWxsLG51bGwsbnVsbCxudWxsXSwic3AiOm51bGx9LG51bGwsbnVsbCxudWxsLG51bGwsbnVsbF0sW3siZyI6MTA1MDQsImwiOjEyMCwiYSI6ImxvdmUiLCJlIjpbbnVsbCxudWxsLG51bGwsbnVsbCxudWxsXSwic3AiOm51bGx9LG51bGwsbnVsbCxudWxsLG51bGwsbnVsbF1dLCJhZiI6MH0=';

const PRESETS = [
    { id: 'bristol-t3', name: '브리스톨 T3 · 전함', bossId: '970112', tier: 3, note: '테스트용 메모', code: CODE_ARIZONA },
    { id: 'two-fleets', name: '2함대 편성', code: CODE_TWO_FLEETS },
];

const rows = (page) => page.locator('#preset-list .save-slot-item');
const tabs = (page) => page.locator('#fleet-tabs [data-action="switch-fleet"]');
const slot0 = (page) => page.locator('.ship-card[data-slot="0"]');

/** Serve a preset file. Must run before goto — the button is gated at boot. */
async function stubPresets(page, presets) {
    await page.route('**/data/fleet_sim_presets.json', (route) => route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ version: 1, presets }),
    }));
}

async function shipName(page) {
    return (await slot0(page).locator('.ship-name').textContent()).trim();
}

test('an empty preset file leaves no button behind', async ({ page }) => {
    await stubPresets(page, []);
    await page.goto(PAGE);
    // Wait for boot: the button is revealed after loadAllData resolves.
    await expect(page.locator('#save-load-btn')).toBeVisible();
    await expect(page.locator('#preset-btn')).toBeHidden();
});

test('presets render from their code, not from what the author typed', async ({ page }) => {
    await stubPresets(page, PRESETS);
    await page.goto(PAGE);

    await page.locator('#preset-btn').click();
    await expect(rows(page)).toHaveCount(2);

    const first = rows(page).nth(0);
    await expect(first.locator('.save-slot-name')).toHaveText('브리스톨 T3 · 전함');
    // Neither of these is in the JSON — both come out of decoding the code.
    await expect(first.locator('.save-slot-ships')).toHaveText('애리조나');
    await expect(first.locator('.save-slot-meta')).toHaveText('1척');
    await expect(first.locator('.preset-note')).toHaveText('테스트용 메모');
    await expect(first.locator('.save-slot-boss-tier')).toHaveText('T3');

    // The count is across every fleet the preset carries, not just the first.
    await expect(rows(page).nth(1).locator('.save-slot-meta')).toHaveText('2척 · 2함대');
});

test('loading a preset brings the authored damage target with it', async ({ page }) => {
    await stubPresets(page, PRESETS);
    await page.goto(PAGE);

    await page.locator('#preset-btn').click();
    await rows(page).nth(0).locator('.preset-load').click();
    await expect(page.locator('#presetModal')).toBeHidden();

    expect(await shipName(page)).toBe('애리조나');
    // A per-boss build whose damage panel points at the default preset target
    // would report numbers for a fight the preset is not about.
    await expect(page.locator('.dmg-target-name')).toContainText('브리스톨');
});

test('a multi-fleet preset restores every fleet', async ({ page }) => {
    await stubPresets(page, PRESETS);
    await page.goto(PAGE);

    await page.locator('#preset-btn').click();
    await rows(page).nth(1).locator('.save-slot-info').click();

    await expect(tabs(page)).toHaveCount(2);
    expect(await shipName(page)).toBe('유니콘');
    await tabs(page).nth(1).click();
    expect(await shipName(page)).toBe('애리조나');
});

test('a preset whose code no longer decodes is dropped, not offered', async ({ page }) => {
    await stubPresets(page, [
        { id: 'broken', name: '깨진 코드', code: 'not-a-payload!!' },
        { id: 'empty', name: '빈 편성', code: btoa('{"s":[null,null]}') },
        PRESETS[0],
    ]);
    await page.goto(PAGE);

    await page.locator('#preset-btn').click();
    // Offering either would be a 불러오기 that silently clears the user's fleet.
    await expect(rows(page)).toHaveCount(1);
    await expect(rows(page).locator('.save-slot-name')).toHaveText('브리스톨 T3 · 전함');
});

// ===== Folded in from the icebox: rename + overwrite in place =====

/** Put a named ship in slot 0. By name, not index — roster order gives no
 *  stable index for a specific ship. */
async function addNamedShip(page, name) {
    await slot0(page).locator('.ship-card-add').click();
    await expect(page.locator('#ship-picker-grid .picker-item').first()).toBeVisible();
    await page.locator('#ship-picker-search').fill(name);
    await page.locator('#ship-picker-grid .picker-item', { hasText: name }).first().click();
    await expect(slot0(page).locator('.equip-slot').first()).toBeVisible();
}

async function saveAs(page, name) {
    await page.locator('#save-load-btn').click();
    await page.locator('#save-name-input').fill(name);
    await page.locator('#save-btn').click();
    await expect(page.locator('#save-slot-list .save-slot-item')).toHaveCount(1);
}

test('a save can be renamed in place', async ({ page }) => {
    await page.goto(PAGE);
    await addNamedShip(page, '유니콘');
    await saveAs(page, '원래 이름');

    page.once('dialog', (d) => d.accept('바뀐 이름'));
    await page.locator('.save-slot-rename').click();
    await expect(page.locator('#save-slot-list .save-slot-name')).toHaveText('바뀐 이름');

    // Reload so the assertion reads storage, not the live list.
    await page.goto(PAGE);
    await page.locator('#save-load-btn').click();
    await expect(page.locator('#save-slot-list .save-slot-name')).toHaveText('바뀐 이름');
});

test('overwriting replaces the fleet but keeps the name and the slot', async ({ page }) => {
    await page.goto(PAGE);
    await addNamedShip(page, '유니콘');
    await saveAs(page, '덮어쓸 편성');
    await page.locator('#saveLoadModal .modal-close').click();

    // Two fleets now, where the save has one — a merged record would keep the
    // old shape; the record is replaced instead.
    await page.locator('[data-action="add-fleet"]').click();
    await addNamedShip(page, '애리조나');

    await page.locator('#save-load-btn').click();
    page.once('dialog', (d) => d.accept());
    await page.locator('.save-slot-overwrite').click();
    await expect(page.locator('#save-slot-list .save-slot-item')).toHaveCount(1);
    await expect(page.locator('#save-slot-list .save-slot-name')).toHaveText('덮어쓸 편성');
    await expect(page.locator('#save-slot-list .save-slot-meta')).toContainText('2함대');

    await page.goto(PAGE);
    await page.locator('#save-load-btn').click();
    await page.locator('#save-slot-list .save-slot-info').click();
    await expect(tabs(page)).toHaveCount(2);
    expect(await shipName(page)).toBe('유니콘');
    await tabs(page).nth(1).click();
    expect(await shipName(page)).toBe('애리조나');
});
