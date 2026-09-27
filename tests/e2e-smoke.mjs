import { chromium } from 'playwright';
import assert from 'node:assert/strict';

const baseURL = process.env.STILL_BASE_URL ?? 'http://localhost:3000';
const stamp = Date.now();
const email = `still-browser-${stamp}@example.com`;
const password = 'still-browser-qa-123';
const screenshots = '/private/tmp';

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
try {
  await page.goto(baseURL, { waitUntil: 'networkidle' });
  const signup = await page.request.post(`${baseURL}/api/auth/signup`, { data: { name: 'Browser QA', email, password, timezone: 'UTC' } });
  if (!signup.ok()) throw new Error(`signup failed: ${signup.status()}`);
  await page.reload({ waitUntil: 'networkidle' });
  assert.equal(await page.getByLabel('Duration in minutes').inputValue(), '10', 'new timer default should be 10 minutes');
  const mobileNavBox = await page.locator('.bottom-nav').boundingBox();
  assert.ok(mobileNavBox && mobileNavBox.y + mobileNavBox.height <= 844, 'bottom nav must fit within mobile viewport');
  const narrow = await browser.newPage({ viewport: { width: 375, height: 667 }, deviceScaleFactor: 1 });
  await narrow.goto(baseURL, { waitUntil: 'networkidle' });
  const narrowNavBox = await narrow.locator('.bottom-nav').boundingBox();
  assert.ok(narrowNavBox && narrowNavBox.y + narrowNavBox.height <= 667, 'bottom nav must fit within narrow viewport');
  await narrow.screenshot({ path: `${screenshots}/still-narrow.png`, fullPage: true });
  await narrow.close();
  await page.getByLabel('Duration in minutes').fill('1');
  await page.getByRole('button', { name: /begin practice/i }).click();
  await page.screenshot({ path: `${screenshots}/still-mobile-running.png`, fullPage: true });
  await page.getByText('How did it feel?').waitFor({ timeout: 65_000 });
  await page.getByLabel('Notes').fill('before browser note\nduring browser note\nafter browser note');
  await page.getByRole('button', { name: /save reflection/i }).click();
  await page.getByRole('button', { name: 'Journal' }).click();
  await page.getByRole('heading', { name: 'Journal' }).waitFor();
  await page.getByText('Minutes practiced').waitFor();
  await page.screenshot({ path: `${screenshots}/still-mobile-journal.png`, fullPage: true });

  await page.getByRole('button', { name: 'Circle' }).click();
  await page.getByRole('heading', { name: 'People who sit.' }).waitFor();
  const post = page.locator('article.post').first();
  await post.getByRole('button', { name: /comments/ }).click();
  await page.locator('input[aria-label="Comment"]').waitFor();
  await page.locator('input[aria-label="Comment"]').fill('Browser QA comment');
  await post.getByRole('button', { name: 'Post' }).click();
  await page.getByText('Browser QA comment').waitFor();
  await post.getByRole('button', { name: /comments/ }).click();
  await page.screenshot({ path: `${screenshots}/still-mobile-circle.png`, fullPage: true });

  await page.getByRole('button', { name: 'Profile' }).click();
  await page.getByLabel('Weekly practice goal').selectOption('3');
  await page.getByRole('button', { name: /sign out/i }).click();
  await page.screenshot({ path: `${screenshots}/still-mobile-signed-out.png`, fullPage: true });

  const desktop = await browser.newPage({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 });
  await desktop.goto(baseURL, { waitUntil: 'networkidle' });
  await desktop.screenshot({ path: `${screenshots}/still-desktop.png`, fullPage: true });
  await desktop.close();
  console.log(JSON.stringify({ ok: true, email, screenshots }));
} finally {
  await browser.close();
}
