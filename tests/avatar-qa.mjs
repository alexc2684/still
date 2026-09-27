import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const baseURL = process.env.STILL_BASE_URL ?? 'http://localhost:3300';
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 393, height: 852 }, deviceScaleFactor: 1 });
await page.addInitScript(() => {
  let avatarKey = null;
  const user = () => ({ id: 'avatar-visual', name: 'K', email: 'avatar@example.com', timezone: 'UTC', weeklyTarget: 5, avatarKey });
  const original = window.fetch;
  window.fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : input.url;
    if (url.endsWith('/api/auth/me')) return new Response(JSON.stringify({ user: user() }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    if (url.endsWith('/api/sessions')) return new Response(JSON.stringify({ sessions: [], practiceDates: [] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    if (url.endsWith('/api/profile') && init?.method === 'PATCH') { avatarKey = JSON.parse(String(init.body)).avatarKey ?? null; return new Response(JSON.stringify({ user: user() }), { status: 200, headers: { 'Content-Type': 'application/json' } }); }
    return original(input, init);
  };
});
try {
  await page.goto(baseURL, { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: 'Profile' }).click();
  await page.getByRole('heading', { name: 'K' }).waitFor();
  const options = page.locator('.avatar-options button');
  assert.equal(await options.count(), 7, 'initials plus six avatar choices');
  for (const key of ['leaf', 'moon', 'sun', 'waves', 'mountain', 'flower']) {
    await page.getByRole('button', { name: `Use ${key} avatar` }).click();
    await page.getByText('Avatar saved.').waitFor();
    assert.equal(await page.getByRole('button', { name: `Use ${key} avatar` }).getAttribute('class'), 'selected');
  }
  await page.getByRole('button', { name: 'Use initials' }).click();
  await page.getByText('Avatar saved.').waitFor();
  assert.equal(await page.getByRole('button', { name: 'Use initials' }).getAttribute('class'), 'selected');
  await page.reload({ waitUntil: 'networkidle' });
  await page.getByRole('button', { name: 'Profile' }).click();
  assert.equal(await page.getByRole('button', { name: 'Use initials' }).getAttribute('class'), 'selected');
  await page.screenshot({ path: '/private/tmp/still-avatar-picker.png', fullPage: true });
  console.log(JSON.stringify({ ok: true, screenshot: '/private/tmp/still-avatar-picker.png' }));
} finally { await browser.close(); }
