import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const baseURL = process.env.STILL_BASE_URL ?? 'http://localhost:3900';
const hostEmail = process.env.SHARED_HOST_EMAIL;
const guestEmail = process.env.SHARED_GUEST_EMAIL;
const password = process.env.SHARED_PASSWORD ?? 'shared-browser-qa-123';
const browser = await chromium.launch({ headless: true });
const hostContext = await browser.newContext({ viewport: { width: 393, height: 852 } });
const guestContext = await browser.newContext({ viewport: { width: 393, height: 852 } });
const host = await hostContext.newPage();
const guest = await guestContext.newPage();
try {
  assert.ok(hostEmail && guestEmail);
  assert.equal((await host.request.post(`${baseURL}/api/auth/login`, { data: { email: hostEmail, password } })).status(), 200);
  await host.goto(baseURL, { waitUntil: 'networkidle' });
  await host.getByRole('button', { name: 'Together' }).click();
  await host.getByRole('button', { name: /create private sit/i }).click();
  await host.getByRole('button', { name: /share invitation/i }).waitFor();
  const inviteURL = host.url();
  assert.match(inviteURL, /[?&]sit=/);
  await guest.goto(inviteURL, { waitUntil: 'networkidle' });
  await guest.getByRole('button', { name: /sign in to join/i }).click();
  await guest.getByLabel('Email').fill(guestEmail);
  await guest.getByLabel('Password').fill(password);
  await guest.locator('.auth-modal button[type="submit"]').click();
  await guest.getByRole('button', { name: /join this sit/i }).click();
  await guest.getByText('Waiting for your people.').waitFor();
  await host.getByText('Waiting for your people.').waitFor();
  await host.screenshot({ path: '/private/tmp/still-shared-invite-host.png', fullPage: true });
  await guest.screenshot({ path: '/private/tmp/still-shared-invite-guest.png', fullPage: true });
  await host.getByRole('button', { name: /cancel sit/i }).click();
  await host.getByRole('button', { name: /ok|cancel/i }).first().click().catch(() => undefined);
  console.log(JSON.stringify({ ok: true, inviteURL, screenshots: ['/private/tmp/still-shared-invite-host.png', '/private/tmp/still-shared-invite-guest.png'] }));
} finally { await browser.close(); }
