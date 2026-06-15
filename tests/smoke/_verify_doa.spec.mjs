import { test, expect } from '@playwright/test';

test('DOA/collab juustagram authors resolve (no Unknown ID)', async ({ page }) => {
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

  await page.goto('juustagram/', { waitUntil: 'networkidle' });
  // Tsukushi = post 640 (ins ship_group 10993 → gid 1060013)
  const btn = page.locator('button[data-post-id="640"]');
  await btn.waitFor({ state: 'attached', timeout: 15000 });
  await btn.scrollIntoViewIfNeeded();
  await btn.click();

  const name = page.locator('.post-author .author-korean-name');
  await expect(name).toBeVisible({ timeout: 10000 });
  const text = (await name.textContent())?.trim();
  console.log('Tsukushi post author name =>', JSON.stringify(text));

  const sub = (await page.locator('.post-author .author-username').textContent())?.trim();
  console.log('subtitle =>', JSON.stringify(sub));

  const icon = page.locator('.post-author .author-icon');
  console.log('author icon src =>', await icon.getAttribute('src'));

  expect(text).toBe('츠쿠시');
  expect(text).not.toContain('Unknown');
  expect(errors.filter((e) => !/Failed to load resource|net::ERR_/.test(e))).toEqual([]);
});
