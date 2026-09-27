import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const baseURL = process.env.STILL_BASE_URL ?? 'http://localhost:3700';
const stamp = Date.now();
const hostEmail = process.env.SHARED_HOST_EMAIL ?? `still-shared-browser-host-${stamp}@example.com`;
const guestEmail = process.env.SHARED_GUEST_EMAIL ?? `still-shared-browser-guest-${stamp}@example.com`;
const password = 'shared-browser-qa-123';
const browser = await chromium.launch({ headless: true });
const host = await browser.newContext({ viewport: { width: 393, height: 852 } });
const guest = await browser.newContext({ viewport: { width: 393, height: 852 } });
const hostPage = await host.newPage();
const guestPage = await guest.newPage();
try {
  const hostLogin = await host.request.post(`${baseURL}/api/auth/login`, { data: { email: hostEmail, password } });
  const guestLogin = await guest.request.post(`${baseURL}/api/auth/login`, { data: { email: guestEmail, password } });
  assert.equal(hostLogin.status(), 200); assert.equal(guestLogin.status(), 200);
  const roomResponse = await host.request.post(`${baseURL}/api/shared-sits`, { data: { plannedSeconds: 60 } });
  const token = (await roomResponse.json()).room.inviteToken;
  assert.ok(token);
  assert.equal((await guest.request.post(`${baseURL}/api/shared-sits/${token}/join`)).status(), 200);
  await hostPage.goto(`${baseURL}/?sit=${token}`, { waitUntil: 'networkidle' });
  await guestPage.goto(`${baseURL}/?sit=${token}`, { waitUntil: 'networkidle' });
  await hostPage.getByRole('button', { name: /start shared sit/i }).waitFor();
  await guestPage.reload({ waitUntil: 'networkidle' });
  await hostPage.getByRole('button', { name: /start shared sit/i }).click();
  await hostPage.getByText('Be here, together.').waitFor();
  await guestPage.getByText('Be here, together.').waitFor();
  await guestPage.reload({ waitUntil: 'networkidle' });
  await guestPage.getByText('Be here, together.').waitFor();
  await hostPage.screenshot({ path: '/private/tmp/still-shared-host-running.png', fullPage: true });
  await guestPage.screenshot({ path: '/private/tmp/still-shared-guest-running.png', fullPage: true });
  await hostPage.getByText('How did it feel?').waitFor({ timeout: 70_000 });
  await guestPage.getByText('How did it feel?').waitFor({ timeout: 70_000 });
  await hostPage.screenshot({ path: '/private/tmp/still-shared-host-reflection.png', fullPage: true });
  await guestPage.screenshot({ path: '/private/tmp/still-shared-guest-reflection.png', fullPage: true });
  console.log(JSON.stringify({ ok: true, hostEmail, guestEmail, token, screenshots: ['/private/tmp/still-shared-host-running.png', '/private/tmp/still-shared-guest-running.png', '/private/tmp/still-shared-host-reflection.png', '/private/tmp/still-shared-guest-reflection.png'] }));
} finally { await browser.close(); }
