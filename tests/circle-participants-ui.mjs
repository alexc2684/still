import assert from 'node:assert/strict'
import { chromium } from 'playwright'
const base = process.env.STILL_BASE_URL || 'http://127.0.0.1:3001'
const browser = await chromium.launch({ headless: true, channel: 'chrome' })
const host = { id: 'host', name: 'Alex', email: 'fixture@example.com', timezone: 'UTC' }
const friend = { userId: 'friend', name: 'Jamie', avatarKey: null }
const people = [{ userId: host.id, name: host.name }, friend]
let added = false
const room = () => ({ id: 'room', inviteToken: 'abc', hostUserId: 'host', status: 'completed', plannedSeconds: 600, members: added ? people : [people[0]], isMember: true })
const post = () => ({ id: 'session', userId: 'host', authorName: 'Alex', sharedSitId: 'room', canAddParticipants: true, completedAt: new Date().toISOString(), elapsedSeconds: 600, kudos: 0, comments: 0, participants: room().members, participantCount: room().members.length })
const json = (route, body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) })
try {
  const page = await browser.newPage({ viewport: { width: 393, height: 852 } })
  await page.route('**/api/auth/me', route => json(route, { user: host }))
  await page.route('**/api/sessions', route => json(route, { sessions: [], practiceDates: [] }))
  await page.route('**/api/feed', route => json(route, { feed: [post()], memberCount: 2 }))
  await page.route('**/api/circle/members', route => json(route, { members: people }))
  await page.route('**/api/shared-sits/abc', route => json(route, { room: room() }))
  await page.route('**/api/shared-sits/room/participants', route => {
    assert.deepEqual(route.request().postDataJSON(), { userId: 'friend' }); added = true
    return json(route, { member: friend }, 201)
  })
  await page.goto(base)
  await page.getByRole('button', { name: /Circle/ }).click()
  const toggle = page.getByRole('button', { name: '2 people in your circle', exact: true })
  await toggle.click()
  await page.getByRole('list', { name: 'People in your circle' }).waitFor()
  await page.screenshot({ path: '/private/tmp/still-circle-people.png', fullPage: true })
  await toggle.click()
  await page.getByRole('button', { name: 'Add participant', exact: true }).click()
  await page.getByRole('button', { name: /Jamie/ }).click()
  await page.getByText('Jamie was added to the sit.').waitFor()
  await page.locator('.shared-participants').getByText('Alex, Jamie', { exact: true }).waitFor()
  await page.screenshot({ path: '/private/tmp/still-circle-added.png', fullPage: true })
  added = false
  await page.goto(`${base}/?sit=abc`)
  await page.getByRole('heading', { name: 'The sit is complete.' }).waitFor()
  await page.getByRole('button', { name: 'Add participant', exact: true }).click()
  await page.getByRole('button', { name: /Jamie/ }).click()
  await page.locator('.shared-members').getByText('Jamie', { exact: true }).waitFor()
  await page.screenshot({ path: '/private/tmp/still-together-added.png', fullPage: true })
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true)
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.screenshot({ path: '/private/tmp/still-together-added-desktop.png', fullPage: true })
  console.log('Passed Circle expansion, adding participants through Circle and Together, and mobile overflow checks.')
} finally { await browser.close() }
