import { beforeEach, afterEach, expect, it, vi } from 'vitest'
import { readOfflineAccount, rememberOfflineAccount, forgetOfflineAccount, readOutbox, queueOfflineJob, syncOfflineJobs } from '@/lib/offline-practice'
const user = { id: 'user-a', name: 'Ada', email: 'fixture@test', timezone: 'UTC' }
const online = (value: boolean) => vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(value)
beforeEach(() => { localStorage.clear(); online(true) })
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })
it('remembers a device account, rejects malformed snapshots, and forgets it on sign-out', () => {
  expect(readOfflineAccount()).toBeNull();rememberOfflineAccount(user, ['2026-10-01']);expect(readOfflineAccount()).toEqual({user,dates:['2026-10-01']});forgetOfflineAccount();expect(readOfflineAccount()).toBeNull()
  for (const raw of ['bad', '{}', '{"user":{"id":"a"}}', '{"user":{"id":"a","timezone":"UTC"},"dates":2}']) {localStorage.setItem('still:offline-account', raw);expect(readOfflineAccount()).toBeNull()}
})
it('keeps account queues separate, merges reflections, and surfaces storage failure', () => {
  queueOfflineJob(user.id,{id:'one'});queueOfflineJob(user.id,{id:'two'});queueOfflineJob(user.id,{id:'one',reflection:{afterNote:'private'}});expect(readOutbox(user.id)).toEqual([{id:'one',reflection:{afterNote:'private'}},{id:'two'}]);expect(readOutbox('other')).toEqual([])
  localStorage.setItem('still:outbox:other','{}');expect(()=>readOutbox('other')).toThrow('could not be read')
  vi.spyOn(Storage.prototype,'setItem').mockImplementation(()=>{throw new Error('quota')});expect(()=>queueOfflineJob(user.id,{id:'two'})).toThrow('quota')
})
it('does not send offline or signed out, mismatched, failed, or unreachable requests and retains pending data', async () => {
  queueOfflineJob(user.id,{id:'one',reflection:{afterNote:'private'}});const f=vi.fn();vi.stubGlobal('fetch',f);online(false);await syncOfflineJobs(user.id);expect(f).not.toHaveBeenCalled();online(true)
  for (const response of [Response.json({}, {status:401}), Response.json({user:{id:'other'}}), Response.json({user:null})]) {f.mockResolvedValueOnce(response);await expect(syncOfflineJobs(user.id)).rejects.toThrow('original account');expect(readOutbox(user.id)).toHaveLength(1)}
  f.mockResolvedValueOnce(Response.json({user})).mockResolvedValueOnce(Response.json({}, {status:500}));await expect(syncOfflineJobs(user.id)).rejects.toThrow('saved on this device')
  f.mockRejectedValueOnce(new Error('network'));await expect(syncOfflineJobs(user.id)).rejects.toThrow('network');expect(readOutbox(user.id)).toHaveLength(1)
})
it('uploads local sessions and reflection-only jobs and deduplicates concurrent sync calls', async () => {
  const practice={id:'one',startedAt:'2026-10-01T12:00:00.000Z',completedAt:'2026-10-01T12:01:00.000Z',plannedSeconds:60};queueOfflineJob(user.id,{id:'one',practice});queueOfflineJob(user.id,{id:'two',reflection:{afterNote:'private'}})
  const f=vi.fn(async (url:string)=>url==='/api/auth/me'?Response.json({user}):Response.json({}));vi.stubGlobal('fetch',f)
  const run=syncOfflineJobs(user.id);expect(syncOfflineJobs(user.id)).toBe(run);await run;expect(readOutbox(user.id)).toEqual([])
  expect(f).toHaveBeenCalledWith('/api/sessions/offline',expect.objectContaining({method:'POST',body:JSON.stringify({userId:user.id,...practice})}));expect(f).toHaveBeenCalledWith('/api/sessions/two/reflection',expect.objectContaining({method:'PATCH'}))
})
it('retains an edit made during upload', async () => {
  queueOfflineJob(user.id,{id:'one',reflection:{afterNote:'before'}})
  vi.stubGlobal('fetch',vi.fn(async (url:string)=>{if(url==='/api/auth/me')return Response.json({user});queueOfflineJob(user.id,{id:'one',reflection:{afterNote:'after'}});return Response.json({})}))
  await syncOfflineJobs(user.id);expect(readOutbox(user.id)[0].reflection).toEqual({afterNote:'after'})
})
it('can sync an empty reflection job without importing a session', async () => {
  queueOfflineJob(user.id,{id:'empty'});vi.stubGlobal('fetch',vi.fn(async(url:string)=>url==='/api/auth/me'?Response.json({user}):Response.json({})));await syncOfflineJobs(user.id);expect(readOutbox(user.id)).toEqual([])
})
