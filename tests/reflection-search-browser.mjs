import assert from 'node:assert/strict'
import { chromium } from 'playwright'
const browser = await chromium.launch({ headless: true })
try {
  for (const width of [375, 1440]) {
    const page = await browser.newPage({ viewport: { width, height: 900 } })
    await page.route('**/api/**', async route => {
      const url = new URL(route.request().url())
      let body = {}
      if (url.pathname === '/api/auth/me') body = { user: { id: 'fixture', name: 'Test', timezone: 'UTC' } }
      if (url.pathname === '/api/sessions') body = { date: '2026-10-01', sessions: [], practiceDates: [], summary: { totalSessions: 3, totalMinutes: 30 } }
      if (url.pathname === '/api/journal/search') {
        assert.equal(route.request().method(), 'POST')
        assert.equal(route.request().postDataJSON().query, 'sleep')
        body = { results: [{ id: 'fixture-session', date: '2026-09-20', seconds: 600, afterNote: 'I noticed how much easier it was to settle before sleep. A little space at the end of the day.' }], hasMore: false }
      }
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) })
    })
    page.setDefaultTimeout(10000)
    await page.goto('http://localhost:3217', { waitUntil: 'domcontentloaded' })
    await page.getByRole('button', { name: /Journal/ }).click()
    await page.getByRole('searchbox').fill('sleep')
    await page.getByRole('button', { name: 'Search', exact: true }).click()
    await page.getByText(/I noticed how much easier/).waitFor()
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true)
    await page.screenshot({ path: `/tmp/still-search-${width}.png`, fullPage: true })
    await page.getByRole('button', { name: 'Clear', exact: true }).click()
    assert.equal(await page.getByRole('searchbox').inputValue(), '')
    await page.close()
  }
  console.log('Search, clear, and responsive layout passed at 375px and 1440px.')
} finally { await browser.close() }
