import assert from 'node:assert/strict'
import { chromium } from 'playwright'
const output = process.env.STILL_SCREENSHOTS || '/tmp'
const browser = await chromium.launch({ headless: true })
try {
  for (const [width, height] of [[375, 812], [375, 667], [1440, 1000]]) {
    const page = await browser.newPage({ viewport: { width, height } })
    page.setDefaultTimeout(10000)
    await page.route('**/api/**', async route => {
      const url = new URL(route.request().url()); let body = {}
      if (url.pathname === '/api/auth/me') body = { user: { id: 'dial-fixture', name: 'Alex', timezone: 'UTC' } }
      if (url.pathname === '/api/sessions') body = { sessions: [], practiceDates: [] }
      if (url.pathname === '/api/sessions/start') body = { session: { id: 'dial-session', startedAt: new Date().toISOString(), plannedSeconds: route.request().postDataJSON().plannedSeconds } }
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) })
    })
    await page.goto('http://localhost:3217', { waitUntil: 'domcontentloaded' })
    const dial = page.locator('.practice-timer-card .timer-dial')
    await page.getByRole('button', { name: /Begin practice/ }).waitFor()
    const slider = page.getByRole('slider', { name: 'Duration in minutes' })
    await slider.focus(); await page.keyboard.press('ArrowRight')
    assert.equal(await slider.getAttribute('aria-valuenow'), '11')
    const box = await dial.boundingBox()
    await page.mouse.move(box.x + box.width / 2, box.y + box.height * .05)
    await page.mouse.down()
    await page.mouse.move(box.x + box.width * .95, box.y + box.height / 2, { steps: 15 })
    await page.mouse.up()
    assert.notEqual(await slider.getAttribute('aria-valuenow'), '11')
    await dial.getByLabel('Duration', { exact: true }).fill('20')
    await dial.getByLabel('Duration', { exact: true }).blur()
    await page.waitForTimeout(500)
    await page.screenshot({ path: `${output}/dial-idle-${width}-${height}.png`, fullPage: true })
    const cta = await page.getByRole('button', { name: /Begin practice/ }).boundingBox()
    const nav = await page.locator('.bottom-nav').boundingBox()
    assert.ok(cta.y + cta.height <= nav.y - 8, 'Start control must clear bottom navigation')
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
    await page.getByRole('button', { name: /Begin practice/ }).click()
    await page.getByRole('button', { name: 'Pause', exact: true }).waitFor()
    assert.equal(await dial.locator('.timer-dial-aura').evaluate(el => getComputedStyle(el).animationName), 'dial-breathe')
    await page.screenshot({ path: `${output}/dial-active-${width}-${height}.png`, fullPage: true })
    await page.getByRole('button', { name: 'Pause', exact: true }).click()
    assert.equal(await dial.locator('.timer-dial-aura').evaluate(el => getComputedStyle(el).animationPlayState), 'paused')
    await page.screenshot({ path: `${output}/dial-paused-${width}-${height}.png`, fullPage: true })
    await page.getByRole('button', { name: 'Resume', exact: true }).click()
    await page.emulateMedia({ reducedMotion: 'reduce' })
    assert.equal(await dial.locator('.timer-dial-aura').evaluate(el => getComputedStyle(el).animationName), 'none')
    await page.close()
  }
  console.log('Dial keyboard and number controls, start/pause/resume, motion preferences, and layouts passed.')
} finally { await browser.close() }
