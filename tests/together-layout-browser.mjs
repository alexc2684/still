import assert from 'node:assert/strict'
import { chromium } from 'playwright'
const browser = await chromium.launch({ headless: true })
const output = process.env.STILL_SCREENSHOTS || '/tmp'
try {
 for (const [width,height] of [[393,852],[375,667],[375,568],[1440,1000]]) {
  const page = await browser.newPage({ viewport: {width,height} }); page.setDefaultTimeout(10000)
  let status = 'waiting'
  const room = () => ({ id: 'fixture', inviteToken: 'fixture-token', status, plannedSeconds: 600, hostUserId: 'host', isMember: true, participantCount: 1, ownSessionId: 'fixture-session', members: [{userId:'host',name:'Alex'}], serverNow: new Date().toISOString(), startedAt: new Date().toISOString(), endsAt: new Date(Date.now()+600000).toISOString() })
  await page.route('**/api/**', async route => {
   const path = new URL(route.request().url()).pathname; let body = {}
   if(path==='/api/auth/me') body={user:{id:'host',name:'Alex',timezone:'UTC'}}
   if(path==='/api/sessions') body={sessions:[],practiceDates:[]}
   if(path.includes('/shared-sits')) { if(path.endsWith('/start')) status='running'; body={room:room()} }
   await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(body)})
  })
  await page.goto('http://localhost:3217', {waitUntil:'domcontentloaded'})
  await page.getByRole('button',{name:'Together',exact:true}).click()
  const create=page.getByRole('button',{name:/Create private sit/}); await create.waitFor()
  const dial=page.locator('.shared-sit-card .timer-dial'); const d=await dial.boundingBox(); const c=await create.boundingBox(); const nav=await page.locator('.bottom-nav').boundingBox()
  assert.ok(Math.abs(c.x+c.width/2-(d.x+d.width/2))<2,'Create button centered with dial')
  assert.ok(c.y-d.y-d.height>=16 && c.y-d.y-d.height<=32,'Consistent dial/button spacing')
  assert.ok(c.y+c.height<nav.y-8,'Create control visible above navigation')
  await page.mouse.wheel(0,500); await page.waitForTimeout(100)
  assert.equal(await page.evaluate(()=>scrollY),0)
  assert.equal(await page.locator('.shared-sit-card').evaluate(el=>el.scrollHeight<=el.clientHeight),true)
  await page.screenshot({path:`${output}/together-create-${width}-${height}.png`})
  await create.click()
  const start=page.getByRole('button',{name:/Start shared sit/}); await start.waitFor(); await start.scrollIntoViewIfNeeded()
  await page.screenshot({path:`${output}/together-waiting-${width}-${height}.png`})
  await start.click(); await page.getByRole('heading',{name:'Be here, together.'}).waitFor()
  await page.screenshot({path:`${output}/together-running-${width}-${height}.png`})
  assert.equal(await page.evaluate(()=>scrollY),0)
  await page.close()
 }
 console.log('Together setup alignment, spacing, fixed screen, create/start flow, and mobile/desktop states passed.')
} finally { await browser.close() }
