import { chromium } from 'playwright'

const baseURL=process.env.STILL_BASE_URL??'http://127.0.0.1:3217'
const browser=await chromium.launch({headless:true})
const context=await browser.newContext({viewport:{width:390,height:844},deviceScaleFactor:1})
const user={id:'00000000-0000-4000-8000-000000000002',name:'Ada',email:'fixture@test',timezone:'UTC'}
await context.route('**/api/**',route=>{const path=new URL(route.request().url()).pathname;if(path==='/api/auth/me')return route.fulfill({json:{user}});if(path.endsWith('/complete'))return route.fulfill({json:{session:{id:'overtime-visual'}}});return route.fulfill({json:{sessions:[],practiceDates:[],summary:{totalSessions:0,totalMinutes:0}}})})
const page=await context.newPage()
await page.goto(baseURL,{waitUntil:'networkidle'})
await page.evaluate(({id})=>{const now=Date.now();localStorage.setItem(`still:practice:${id}`,JSON.stringify({sessionId:'overtime-visual',startedAt:new Date(now-605000).toISOString(),deadlineMs:now-5000,plannedSeconds:600,plannedBellPlayed:true}))},{id:user.id})
await page.reload({waitUntil:'networkidle'})
await page.getByText('+00:05',{exact:true}).waitFor()
await page.getByRole('button',{name:'Stop',exact:true}).waitFor()
await page.screenshot({path:'artifacts/sit-overtime-mobile.png',fullPage:false})
await page.getByRole('button',{name:'Stop',exact:true}).click()
await page.getByRole('dialog').waitFor()
await page.screenshot({path:'artifacts/sit-overtime-reflection-mobile.png',fullPage:false})
console.log(JSON.stringify({screenshots:['artifacts/sit-overtime-mobile.png','artifacts/sit-overtime-reflection-mobile.png']}))
await browser.close()
