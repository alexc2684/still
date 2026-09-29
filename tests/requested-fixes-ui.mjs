import assert from 'node:assert/strict'
import { chromium } from 'playwright'

const browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_CHANNEL ? { channel: process.env.PLAYWRIGHT_CHANNEL } : {}) })
const base = process.env.STILL_BASE_URL || 'http://127.0.0.1:3000'
const user = { id: 'test-user', name: 'Test User', email: 'test@example.com', timezone: 'UTC', weeklyTarget: 5 }
const today = new Date().toISOString().slice(0, 10)
const previous = new Date(`${today}T12:00:00Z`); previous.setUTCDate(previous.getUTCDate() - 1)
const yesterday = previous.toISOString().slice(0, 10)
const session = (id, date, note) => ({ id, startedAt: `${date}T12:00:00Z`, completedAt: `${date}T12:10:00Z`, completedLocalDate: date, plannedSeconds: 600, elapsedSeconds: 600, afterNote: note })
const history = [session('one', today, 'Today reflection'), session('two', yesterday, 'Yesterday first'), session('three', yesterday, 'Yesterday second')]
const json = (route, body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) })
try {
  const page = await browser.newPage({ viewport: { width: 393, height: 852 } })
  await page.route('**/api/auth/me', route => json(route, { user }))
  await page.route('**/api/sessions?*', async route => {
    const requested = new URL(route.request().url()).searchParams.get('date')
    const date = requested === 'today' ? today : requested
    await json(route, { sessions: history.filter(s => s.completedLocalDate === date), date, practiceDates: [today, yesterday], summary: { totalSessions: 3, totalMinutes: 30 } })
  })
  await page.route('**/api/sessions', route => json(route, { sessions: history, practiceDates: [today, yesterday] }))
  await page.route('**/api/feed', route => json(route, { feed: [], memberCount: 1234 }))
  await page.goto(base)
  await page.locator('.timer-dial-duration:visible').waitFor()
  for (const viewport of [{ width: 393, height: 852 }, { width: 375, height: 667 }, { width: 1440, height: 1000 }]) {
    await page.setViewportSize(viewport)
    const dial = await page.locator('.timer-dial:visible svg').boundingBox()
    const label = await page.locator('.timer-dial-duration:visible').boundingBox()
    assert.ok(label.y >= dial.y + dial.height + 15, 'Duration clears the timer circle')
    await page.screenshot({ path: `/private/tmp/still-practice-${viewport.width}.png`, fullPage: true })
  }
  await page.setViewportSize({ width: 393, height: 852 })
  await page.getByRole('button', { name: /Journal/ }).click()
  await page.getByText('Today reflection', { exact: true }).waitFor()
  assert.equal(await page.locator('.journal-entry').count(), 1)
  // Yesterday can be in the previous month.
  if (yesterday.slice(0, 7) !== today.slice(0, 7)) await page.getByRole('button', { name: 'Previous month' }).click()
  await page.getByRole('button', { name: yesterday, exact: true }).click()
  await page.getByText('Yesterday second', { exact: true }).waitFor()
  assert.equal(await page.locator('.journal-entry').count(), 2)
  assert.equal(await page.getByText('Today reflection', { exact: true }).count(), 0)
  assert.equal(await page.getByRole('button', { name: yesterday, exact: true }).getAttribute('aria-pressed'), 'true')
  await page.screenshot({ path: '/private/tmp/still-journal-selected.png', fullPage: true })
  await page.getByRole('button', { name: /Circle/ }).click()
  await page.getByText('1,234 people in the circle.').waitFor()
  await page.screenshot({ path: '/private/tmp/still-circle-count.png', fullPage: true })

  const auth = await browser.newPage({ viewport: { width: 393, height: 852 } })
  await auth.route('**/api/auth/me', route => json(route, {}, 401))
  await auth.route('**/api/auth/forgot-password', route => {
    assert.equal(route.request().postDataJSON().email, user.email)
    return json(route, { message: 'If an account exists for that email, you’ll receive a password reset link shortly.' })
  })
  await auth.goto(base)
  await auth.getByRole('button', { name: /Journal/ }).click()
  await auth.getByRole('button', { name: /Sign in to Still/ }).click()
  await auth.getByRole('button', { name: 'Forgot password?' }).click()
  await auth.getByRole('textbox', { name: 'Email', exact: true }).fill(user.email)
  await auth.getByRole('button', { name: /Send reset link/ }).click()
  await auth.getByRole('status').waitFor()
  await auth.screenshot({ path: '/private/tmp/still-forgot-password.png', fullPage: true })
  let resetCalls = 0
  await auth.route('**/api/auth/reset-password', route => {
    resetCalls++
    assert.equal(route.request().postDataJSON().token, 'a'.repeat(43))
    return json(route, resetCalls === 1 ? { error: 'This reset link has expired or already been used. Request a new link.' } : { message: 'Your password has been reset.' }, resetCalls === 1 ? 400 : 200)
  })
  await auth.goto(`${base}/reset-password#token=${'a'.repeat(43)}`)
  await auth.getByLabel('New password', { exact: true }).fill('new secure password')
  assert.equal(new URL(auth.url()).hash, '', 'secret removed from the address bar')
  await auth.getByLabel('Confirm new password', { exact: true }).fill('different password')
  await auth.getByRole('button', { name: 'Reset password', exact: false }).click()
  await auth.getByText('Your passwords do not match.').waitFor()
  assert.equal(resetCalls, 0)
  await auth.getByLabel('Confirm new password', { exact: true }).fill('new secure password')
  await auth.getByRole('button', { name: 'Reset password', exact: false }).click()
  await auth.getByRole('alert').filter({ hasText: 'expired' }).waitFor()
  await auth.getByRole('button', { name: 'Reset password', exact: false }).click()
  await auth.getByRole('heading', { name: 'Your password is reset.' }).waitFor()
  await auth.screenshot({ path: '/private/tmp/still-reset-success.png', fullPage: true })
  console.log('Passed: timer spacing at three sizes; selected-day reflections; Circle count; forgot password; mismatch, expired link, and reset success UI.')
} finally { await browser.close() }
