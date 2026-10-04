import assert from 'node:assert/strict'
import { chromium, webkit } from 'playwright'
import { mkdir } from 'node:fs/promises'

const origin = process.env.STILL_TEST_ORIGIN || 'http://127.0.0.1:3217'
const output = process.env.STILL_SCREENSHOT_DIR || '/tmp/still-offline-viewport'
await mkdir(output, { recursive: true })
const user = { id: '00000000-0000-4000-8000-000000000002', name: 'Ada', email: 'fixture@test', timezone: 'UTC' }
const cases = [
  { name: 'iphone', width: 390, height: 844, top: 47, bottom: 34, initial: true },
  { name: 'iphone-browser', width: 390, height: 700, top: 0, bottom: 0, initial: true },
  { name: 'small-phone', width: 320, height: 568, top: 20, bottom: 0, initial: true },
  { name: 'large-text', width: 390, height: 844, top: 47, bottom: 34, textScale: 1.25 },
  { name: 'landscape', width: 844, height: 390, top: 0, bottom: 21 },
  { name: 'keyboard', width: 390, height: 844, top: 47, bottom: 34, initial: true, keyboard: true },
]
const engines = process.env.STILL_TEST_BROWSERS === 'chromium' ? { chromium } : { chromium, webkit }

// Unlike Locator.click(), this checks the current frame before any automatic scrolling.
async function actionGeometry(page, button) {
  return button.evaluate(element => {
    const box = element.getBoundingClientRect()
    const nav = document.querySelector('.bottom-nav').getBoundingClientRect()
    let top = visualViewport?.offsetTop ?? 0, bottom = (element.closest('[role=dialog]') ? Math.min(innerHeight, top + (visualViewport?.height ?? innerHeight)) : Math.min(innerHeight, nav.top)), left = 0, right = innerWidth
    for (let parent = element.parentElement; parent; parent = parent.parentElement) {
      const style = getComputedStyle(parent), rect = parent.getBoundingClientRect()
      if (/(auto|scroll|hidden|clip)/.test(style.overflowY)) { top = Math.max(top, rect.top); bottom = Math.min(bottom, rect.bottom) }
      if (/(auto|scroll|hidden|clip)/.test(style.overflowX)) { left = Math.max(left, rect.left); right = Math.min(right, rect.right) }
    }
    const x = (box.left + box.right) / 2, y = (box.top + box.bottom) / 2
    return {
      visible: box.top >= top && box.bottom <= bottom && box.left >= left && box.right <= right,
      hit: element.contains(document.elementFromPoint(x, y)),
      x, y, bounds: { top: box.top, bottom: box.bottom, clipTop: top, clipBottom: bottom },
    }
  })
}
async function tapAction(page, button, requireInitial) {
  await button.waitFor({ state: 'visible' })
  // Let React's parent activity callback and responsive layout settle before measuring touch coordinates.
  await page.evaluate(async () => {
    await document.fonts.ready
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(resolve))))
  })
  let geometry = await actionGeometry(page, button)
  if (requireInitial) assert(geometry.visible && geometry.hit, `Action initially clipped: ${JSON.stringify(geometry)}`)
  if (!geometry.visible || !geometry.hit) {
    // A real wheel gesture tests the user's scrolling path; never scrollIntoView() or locator auto-scroll.
    const modal = page.locator('.modal-backdrop [role=dialog]')
    const panel = await ((await modal.count()) ? modal : page.locator('.solo-practice-panel')).boundingBox()
    await page.mouse.move(panel.x + 10, panel.y + Math.min(panel.height / 2, 80))
    await page.mouse.wheel(0, 1500)
    await page.waitForTimeout(250)
    geometry = await actionGeometry(page, button)
  }
  if (!geometry.visible || !geometry.hit) {
    await page.screenshot({ path: `${output}/unreachable.png` })
    console.log(await page.locator('.solo-practice-panel').evaluate(element => ({ scrollTop: element.scrollTop, scrollHeight: element.scrollHeight, clientHeight: element.clientHeight, overflow: getComputedStyle(element).overflowY, rect: element.getBoundingClientRect().toJSON(), viewport: { height: innerHeight, visual: visualViewport.height, scale: visualViewport.scale } })))
  }
  assert(geometry.visible && geometry.hit, `Action unreachable after user scroll: ${JSON.stringify(geometry)}`)
  await page.touchscreen.tap(geometry.x, geometry.y)
}

for (const [engineName, engine] of Object.entries(engines)) {
  const browser = await engine.launch({ headless: true })
  try {
    for (const scenario of cases.filter(item => !process.env.STILL_TEST_CASE || item.name === process.env.STILL_TEST_CASE)) {
      // Playwright mobile WebKit cannot swipe or wheel. Touch-enabled desktop WebKit
      // uses the same phone-sized CSS viewport and permits native wheel fallback; no programmatic scroll.
      const context = await browser.newContext({ viewport: { width: scenario.width, height: scenario.height }, isMobile: engineName !== 'webkit', hasTouch: true, serviceWorkers: 'allow' })
      try {
        // Substitute real CSS env() values to exercise notch/home-indicator insets in desktop browser runners.
        await context.route('**/*.css*', async route => {
          const response = await route.fetch()
          const css = (await response.text())
            .replace(/env\(safe-area-inset-top(?:,\s*0px)?\)/g, `${scenario.top}px`)
            .replace(/env\(safe-area-inset-bottom(?:,\s*0px)?\)/g, `${scenario.bottom}px`)
          await route.fulfill({ response, body: css })
        })
        await context.route('**/api/**', route => route.fulfill({ json: new URL(route.request().url()).pathname === '/api/auth/me' ? { user } : { sessions: [], practiceDates: [] } }))
        const page = await context.newPage()
        await page.goto(origin)
        await page.getByRole('button', { name: 'Ada', exact: true }).waitFor()
        if (scenario.initial) {
          const online = await actionGeometry(page, page.getByRole('button', { name: /Begin practice/ }))
          assert(online.visible && online.hit, `Online action clipped: ${JSON.stringify(online)}`)
        }
        if (scenario.textScale) {
          // Enlarge text without CSS zoom, which incorrectly scales 100dvh itself in desktop mobile emulation.
          const selectors = ['body', '.offline-notice', '.offline-notice .text-button', '.practice-mode button', '.eyebrow', '.timer-page-heading', '.timer-dial-center strong', '.timer-dial-center span', '.primary-button', '.secondary-button', '.text-button', '.sound-preview']
          const sizes = await page.evaluate(selectors => selectors.map(selector => {
            let element = document.querySelector(selector), probe
            if (!element) { probe = document.createElement('button'); probe.className = selector.split(' ').at(-1).slice(1); document.body.append(probe); element = probe }
            const size = parseFloat(getComputedStyle(element).fontSize)
            probe?.remove()
            return { selector, size }
          }), selectors)
          await page.addStyleTag({ content: sizes.map(({ selector, size }) => `${selector} { font-size: ${size * scenario.textScale}px !important; }`).join('\n') })
        }
        await context.setOffline(true)
        await page.getByText(/Offline ·/).waitFor()
        await page.screenshot({ path: `${output}/${engineName}-${scenario.name}-ready.png` })
        await tapAction(page, page.getByRole('button', { name: /Begin practice/ }), scenario.initial)
        await page.getByRole('button', { name: 'Pause', exact: true }).waitFor()
        await tapAction(page, page.getByRole('button', { name: 'Pause', exact: true }))
        await page.getByRole('button', { name: 'Resume', exact: true }).waitFor()
        await tapAction(page, page.getByRole('button', { name: 'Resume', exact: true }))
        await page.getByRole('button', { name: 'Pause', exact: true }).waitFor()
        // Resizing the visible browser viewport must also preserve a reachable control.
        await page.setViewportSize({ width: scenario.width, height: Math.max(320, scenario.height - 100) })
        await tapAction(page, page.getByRole('button', { name: 'Pause', exact: true }))
        await tapAction(page, page.getByRole('button', { name: /End session early/ }))
        await page.getByRole('dialog', { name: 'Why are you ending early?' }).waitFor()
        if (scenario.keyboard) await page.evaluate(() => { Object.defineProperty(visualViewport, 'height', { configurable: true, value: 340 }); visualViewport.dispatchEvent(new Event('resize')) })
        await page.screenshot({ path: `${output}/${engineName}-${scenario.name}-early-popup.png` })
        await page.getByRole('textbox').fill('Not ending yet')
        await tapAction(page, page.getByRole('button', { name: 'Resume sit', exact: true }), scenario.keyboard)
        await page.getByRole('button', { name: 'Resume', exact: true }).waitFor()
        if (scenario.keyboard) await page.evaluate(() => { delete visualViewport.height; visualViewport.dispatchEvent(new Event('resize')) })
        assert.equal(await page.locator('.timer-dial').getAttribute('data-phase'), 'paused')
        assert.equal(await page.evaluate(() => localStorage.getItem('still:outbox:00000000-0000-4000-8000-000000000002')), null)
        await tapAction(page, page.getByRole('button', { name: /End session early/ }))
        await page.getByRole('dialog', { name: 'Why are you ending early?' }).waitFor()
        assert.equal(await page.getByRole('textbox').inputValue(), '')
        if (scenario.keyboard) await page.evaluate(() => { Object.defineProperty(visualViewport, 'height', { configurable: true, value: 340 }); visualViewport.dispatchEvent(new Event('resize')) })
        const reason = scenario.initial ? 'Need to leave' : ''
        await page.getByRole('textbox').fill(reason)
        await tapAction(page, page.getByRole('button', { name: 'End session', exact: true }), scenario.keyboard)
        await page.getByText('How did it feel?').waitFor()
        assert.equal(await page.getByRole('textbox').inputValue(), reason ? `Ended early: ${reason}` : '')
        await page.screenshot({ path: `${output}/${engineName}-${scenario.name}-early-reflection.png` })
        await tapAction(page, page.getByRole('button', { name: /Save reflection/ }))
        await page.getByRole('button', { name: /Begin practice/ }).waitFor()
        const job = await page.evaluate(() => JSON.parse(localStorage.getItem('still:outbox:00000000-0000-4000-8000-000000000002'))[0])
        assert(job.practice.endedEarly && job.practice.elapsedSeconds < job.practice.plannedSeconds)
        assert.equal(await page.evaluate(() => localStorage.getItem('still:practice:00000000-0000-4000-8000-000000000002')), null)
        console.log(`PASS ${engineName} ${scenario.name}: offline controls, early-ending popup, resume-to-pause, and reflection reachable using actual touch coordinates`)
      } catch (error) {
        await context.pages()[0]?.screenshot({ path: `${output}/${engineName}-${scenario.name}-failure.png` }).catch(() => undefined)
        throw error
      } finally { await context.close() }
    }
  } finally { await browser.close() }
}
