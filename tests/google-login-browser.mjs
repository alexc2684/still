import assert from 'node:assert/strict'
import { chromium } from 'playwright'
const browser=await chromium.launch({headless:true})
const output=process.env.STILL_SCREENSHOTS||'/tmp'
try {
 for (const [width,height] of [[393,852],[375,667],[1440,1000]]) {
  const page=await browser.newPage({viewport:{width,height}});page.setDefaultTimeout(10000)
  await page.route('**/api/auth/me',route=>route.fulfill({status:401,body:'{}'}))
  await page.route('**/api/auth/google/start',route=>route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:'Google sign-in is temporarily unavailable. Please use email for now.'})}))
  await page.goto('http://localhost:3217/?sit=invite',{waitUntil:'domcontentloaded'})
  await page.getByRole('button',{name:/Sign in to join/}).click()
  await page.getByRole('button',{name:'Continue with Google'}).waitFor()
  await page.screenshot({path:`${output}/google-login-${width}-${height}.png`})
  await page.getByRole('button',{name:'Continue with Google'}).click()
  await page.getByRole('alert').waitFor()
  assert.ok(await page.getByRole('button',{name:/Sign in →/}).isEnabled())
  await page.getByRole('button',{name:'New to Still? Create an account'}).click()
  await page.getByRole('button',{name:'Continue with Google'}).waitFor()
  await page.getByRole('button',{name:/Create account/}).scrollIntoViewIfNeeded()
  assert.ok(await page.getByRole('button',{name:/Create account/}).isVisible())
  await page.screenshot({path:`${output}/google-signup-${width}-${height}.png`})
  await page.getByRole('button',{name:'Close sign in'}).click()
  // Mock the provider redirect rather than using real credentials/accounts in tests.
  await page.route('**/api/auth/google/start',async route=>{
   assert.equal(route.request().postDataJSON().returnTo,'/?sit=invite')
   await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({url:'https://accounts.google.com/mock-consent'})})
  })
  await page.route('https://accounts.google.com/mock-consent',route=>route.fulfill({status:200,body:'Mock Google consent'}))
  await page.getByRole('button',{name:/Sign in to join/}).click()
  await page.getByRole('button',{name:'Continue with Google'}).click()
  await page.waitForURL('https://accounts.google.com/mock-consent')
  await page.close()
 }
 console.log('Google login/signup controls, unavailable fallback, invite preservation, and mocked redirect passed.')
} finally {await browser.close()}
