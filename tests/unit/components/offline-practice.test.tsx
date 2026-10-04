import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, afterEach, expect, it, vi } from 'vitest'
import PracticeTimer from '@/components/PracticeTimer'
import Journal from '@/components/Journal'
const user={id:'offline-fixture',name:'Ada'}
beforeEach(()=>{localStorage.clear();vi.spyOn(navigator,'onLine','get').mockReturnValue(false);vi.stubGlobal('fetch',vi.fn())})
afterEach(()=>{cleanup();vi.restoreAllMocks();vi.unstubAllGlobals()})
it('starts and cancels a local sit without a network call, and refuses to start when storage is full',async()=>{
  render(<PracticeTimer user={user}/>);fireEvent.click(screen.getByRole('button',{name:/Begin practice/}));await screen.findByRole('button',{name:'Pause'});expect(JSON.parse(localStorage.getItem('still:practice:offline-fixture')!).local).toBe(true);fireEvent.click(screen.getByRole('button',{name:'Pause'}));fireEvent.click(screen.getByRole('button',{name:/End session early/}));fireEvent.click(screen.getByRole('button',{name:'End session'}));fireEvent.click(await screen.findByRole('button',{name:/Save reflection/}));await screen.findByRole('button',{name:/Begin practice/});expect(localStorage.getItem('still:practice:offline-fixture')).toBeNull();expect(fetch).not.toHaveBeenCalled()
  vi.spyOn(Storage.prototype,'setItem').mockImplementation(()=>{throw new Error('storage full')});fireEvent.click(screen.getByRole('button',{name:/Begin practice/}));await screen.findByRole('alert');expect(screen.getByRole('alert')).toHaveTextContent('storage full')
})
it('recovers and completes offline, saves a private reflection, and keeps a new session independent',async()=>{
  const startedAt=new Date(Date.now()-65000).toISOString();localStorage.setItem('still:practice:offline-fixture',JSON.stringify({local:true,sessionId:'local-id',startedAt,deadlineMs:Date.now()-5000,plannedSeconds:60}));const saved=vi.fn();render(<PracticeTimer user={user} onSessionSaved={saved}/>);await screen.findByText('well done');expect(fetch).not.toHaveBeenCalled();fireEvent.click(screen.getByRole('button',{name:/Record reflection/}));fireEvent.change(screen.getByRole('textbox'),{target:{value:'private reflection'}});fireEvent.click(screen.getByRole('button',{name:/Save reflection/}));await waitFor(()=>expect(screen.queryByRole('dialog')).toBeNull());expect(JSON.parse(localStorage.getItem('still:outbox:offline-fixture')!)[0].reflection.afterNote).toBe('private reflection');expect(screen.getByRole('button',{name:/Begin practice/})).toBeInTheDocument();expect(screen.queryByRole('button',{name:/Record reflection|Edit reflection/})).toBeNull();expect(localStorage.getItem('still:reflection-session:offline-fixture')).toBeNull();expect(localStorage.getItem('still:reflection:offline-fixture')).toBeNull();expect(screen.queryByText(/Saved on this device/)).toBeNull();expect(saved).toHaveBeenCalled()
})
it('queues a reflection while online if its parent session has not synced',async()=>{
  vi.spyOn(navigator,'onLine','get').mockReturnValue(true);localStorage.setItem('still:reflection-session:offline-fixture','pending');localStorage.setItem('still:outbox:offline-fixture',JSON.stringify([{id:'pending'}]));render(<PracticeTimer user={user}/>);fireEvent.click(await screen.findByRole('button',{name:/Record reflection/}));await screen.findByRole('dialog');fireEvent.click(screen.getByRole('button',{name:/Save reflection/}));await waitFor(()=>expect(screen.queryByRole('dialog')).toBeNull());expect(fetch).not.toHaveBeenCalled()
})
it('retains a server-started session when offline completion cannot be written',async()=>{
  const now=Date.now();localStorage.setItem('still:practice:offline-fixture',JSON.stringify({sessionId:'server-id',startedAt:new Date(now-65000).toISOString(),deadlineMs:now-5000,plannedSeconds:60}));vi.spyOn(Storage.prototype,'setItem').mockImplementation(()=>{throw new Error('quota')});render(<PracticeTimer user={user}/>);await screen.findByRole('alert');expect(screen.getByRole('alert')).toHaveTextContent('quota');expect(screen.getByRole('button',{name:'Retry save'})).toBeInTheDocument();expect(fetch).not.toHaveBeenCalled()
})
it('shows an offline journal with local completions and cached history, disabling server mutations',async()=>{
  localStorage.setItem('still:outbox:offline-fixture',JSON.stringify([{id:'local-id',practice:{id:'local-id',startedAt:new Date(Date.now()-65000).toISOString(),completedAt:new Date(Date.now()-5000).toISOString(),plannedSeconds:60},reflection:{afterNote:'Private offline note'}}]));localStorage.setItem('still:journal:offline-fixture',JSON.stringify({sessions:[{id:'old',startedAt:new Date(Date.now()-65000).toISOString(),completedAt:new Date(Date.now()-5000).toISOString(),plannedSeconds:120}],practiceDates:['2026-01-01']}));render(<Journal userId={user.id} offline accountTimezone="UTC"/>);await screen.findByText('Private offline note');expect(screen.getAllByRole('button',{name:'Delete session and reflection'}).every(button=>(button as HTMLButtonElement).disabled)).toBe(true);expect(fetch).not.toHaveBeenCalled()
})
it('handles missing offline history and preserves malformed data for recovery',async()=>{
  render(<Journal userId={user.id} offline/>);await screen.findByText('No practice recorded for this day.');cleanup();localStorage.setItem('still:journal:offline-fixture','bad');render(<Journal userId={user.id} offline/>);await screen.findByText(/Unable to read your saved journal/);cleanup();render(<Journal offline/>);await screen.findByText('offline')
})
it('saves per-account online journal snapshots with absent arrays',async()=>{
  vi.stubGlobal('fetch',vi.fn(async()=>Response.json({user:{timezone:'UTC'},date:'2026-10-04',summary:{totalSessions:0,totalMinutes:0}})));render(<Journal userId={user.id}/>);await screen.findByText('No practice recorded for this day.');expect(JSON.parse(localStorage.getItem('still:journal:offline-fixture')!)).toEqual({sessions:[],practiceDates:[],date:'2026-10-04',summary:{totalSessions:0,totalMinutes:0}})
})
it('never carries an active offline session into a different account',async()=>{
  const view=render(<PracticeTimer user={user}/>);fireEvent.click(screen.getByRole('button',{name:/Begin practice/}));await screen.findByRole('button',{name:'Pause'});view.rerender(<PracticeTimer user={{id:'different-account'}}/>);await screen.findByRole('button',{name:/Begin practice/});expect(screen.queryByRole('button',{name:/End session early/})).toBeNull();expect(localStorage.getItem('still:practice:offline-fixture')).not.toBeNull();expect(localStorage.getItem('still:practice:different-account')).toBeNull()
})
it('keeps offline date selection, cached totals, and local completions consistent',async()=>{
  const month = new Date().toISOString().slice(0,7), first=`${month}-01`, second=`${month}-02`
  const session={id:'cached',startedAt:`${first}T12:00:00.000Z`,completedAt:`${first}T12:01:00.000Z`,completedLocalDate:first,plannedSeconds:60,elapsedSeconds:60,afterNote:'Cached first day'}
  const snapshot={sessions:[session],practiceDates:[first],summary:{totalSessions:4,totalMinutes:20}}
  localStorage.setItem('still:journal:offline-fixture',JSON.stringify(snapshot));localStorage.setItem(`still:journal:offline-fixture:${first}`,JSON.stringify(snapshot))
  localStorage.setItem('still:outbox:offline-fixture',JSON.stringify([{id:'cached',practice:{id:'cached',startedAt:session.startedAt,completedAt:session.completedAt,plannedSeconds:60},reflection:{afterNote:'Local first day'}},{id:'next',practice:{id:'next',startedAt:`${second}T12:00:00.000Z`,completedAt:`${second}T12:02:00.000Z`,plannedSeconds:120},reflection:{afterNote:'Local second day'}}]))
  render(<Journal userId={user.id} offline/>);await screen.findByRole('button',{name:first});fireEvent.click(screen.getByRole('button',{name:first}));await screen.findByText('Local first day');expect(screen.getByText('Total sessions').previousElementSibling).toHaveTextContent('5')
  fireEvent.click(screen.getByRole('button',{name:second}));await screen.findByText('Local second day');expect(screen.queryByText('Local first day')).toBeNull()
})
it('keeps saved reflections in the outbox and gives the next sit its own recoverable draft',async()=>{
  const first={local:true,sessionId:'first',startedAt:new Date(Date.now()-65000).toISOString(),deadlineMs:Date.now()-5000,plannedSeconds:60}
  localStorage.setItem('still:practice:offline-fixture',JSON.stringify(first))
  const view=render(<PracticeTimer user={user}/>)
  fireEvent.click(await screen.findByRole('button',{name:/Record reflection/}))
  fireEvent.change(screen.getByRole('textbox'),{target:{value:'First reflection'}})
  fireEvent.click(screen.getByRole('button',{name:/Save reflection/}))
  await screen.findByRole('button',{name:/Begin practice/})
  fireEvent.click(screen.getByRole('button',{name:/Begin practice/}))
  await screen.findByRole('button',{name:'Pause'})
  const second=JSON.parse(localStorage.getItem('still:practice:offline-fixture')!)
  expect(second.sessionId).not.toBe('first')
  view.unmount()
  localStorage.setItem('still:practice:offline-fixture',JSON.stringify({...second,startedAt:new Date(Date.now()-65000).toISOString(),deadlineMs:Date.now()-5000}))
  render(<PracticeTimer user={user}/>)
  fireEvent.click(await screen.findByRole('button',{name:/Record reflection/}))
  expect(screen.getByRole('textbox')).toHaveValue('')
  fireEvent.change(screen.getByRole('textbox'),{target:{value:'Second draft'}})
  await waitFor(()=>expect(JSON.parse(localStorage.getItem('still:reflection:offline-fixture')!).notes).toBe('Second draft'))
  expect(JSON.parse(localStorage.getItem('still:outbox:offline-fixture')!)[0].reflection.afterNote).toBe('First reflection')
})
