import { beforeEach, expect, it, vi } from 'vitest'
const h=vi.hoisted(()=>({db:vi.fn(),user:vi.fn(),origin:vi.fn()}))
vi.mock('@/lib/db',()=>({sql:()=>h.db}))
vi.mock('@/lib/http',()=>({requireUser:h.user,originGuard:h.origin,json:(data:unknown,status=200)=>Response.json(data,{status})}))
import { POST } from '@/app/api/sessions/offline/route'
const id='00000000-0000-4000-8000-000000000001', userId='00000000-0000-4000-8000-000000000002'
const payload={id,userId,startedAt:'2026-01-01T12:00:00.000Z',completedAt:'2026-01-01T12:01:00.000Z',plannedSeconds:60}
const request=(body:unknown)=>new Request('https://still.test/api/sessions/offline',{method:'POST',body:JSON.stringify(body)})
beforeEach(()=>{vi.resetAllMocks();h.user.mockResolvedValue({id:userId});h.db.mockResolvedValue([{id}])})
it('imports atomically with stable IDs, account ownership, duration, and private reflections',async()=>{
  expect((await POST(request(payload))).status).toBe(200)
  const query=h.db.mock.calls[0][0];expect(query).toContain('ON CONFLICT(id)');expect(query).toContain('meditation_sessions.user_id=EXCLUDED.user_id');expect(query).toContain('shared_sit_id IS NULL');expect(h.db.mock.calls[0][1].slice(5,10)).toEqual([null,null,null,null,false])
  expect((await POST(request({...payload,reflection:{beforeMood:1,duringMood:2,afterMood:3,afterNote:'private'}}))).status).toBe(200);expect(h.db.mock.calls[1][1].slice(5,10)).toEqual([1,2,3,'private',true])
  expect((await POST(request({...payload,reflection:{afterNote:''}}))).status).toBe(200)
  h.db.mockResolvedValueOnce([]);expect((await POST(request(payload))).status).toBe(409)
})
it('rejects auth, origins, account changes, malformed input, impossible duration, and database failure',async()=>{
  h.user.mockRejectedValueOnce(new Response('auth',{status:401}));expect((await POST(request(payload))).status).toBe(401)
  h.origin.mockRejectedValueOnce(new Response('origin',{status:403}));expect((await POST(request(payload))).status).toBe(403)
  expect((await POST(request({...payload,userId:id}))).status).toBe(403)
  for(const extra of [{id:'invalid'},{plannedSeconds:0},{plannedSeconds:7201},{completedAt:payload.startedAt},{completedAt:new Date(Date.now()+10000).toISOString()},{reflection:{afterMood:6,afterNote:'x'}},{reflection:{afterNote:'x'.repeat(6501)}}]) expect((await POST(request({...payload,...extra}))).status).toBe(extra.completedAt?422:400)
  h.db.mockRejectedValueOnce(new Error('db'));expect((await POST(request(payload))).status).toBe(400)
})
it('imports early endings with actual time, including zero seconds, without changing a previously saved duration',async()=>{
  for (const elapsedSeconds of [0,10]) {
    const result=await POST(request({...payload,completedAt:'2026-01-01T12:00:10.000Z',elapsedSeconds,endedEarly:true,reflection:{afterNote:'Ended early: Doorbell'}}));expect(result.status).toBe(200);expect(h.db.mock.calls.at(-1)![1][10]).toBe(elapsedSeconds)
  }
  expect(h.db.mock.calls.at(-1)![0]).toContain('CASE WHEN meditation_sessions.completed_at IS NULL')
  for(const extra of [{endedEarly:false,elapsedSeconds:10},{endedEarly:true,elapsedSeconds:61},{endedEarly:true,elapsedSeconds:-1},{endedEarly:true,elapsedSeconds:11,completedAt:'2026-01-01T12:00:10.000Z'},{endedEarly:true,elapsedSeconds:0,completedAt:'2026-01-01T11:59:59.000Z'}]) expect((await POST(request({...payload,...extra}))).status).toBe(extra.elapsedSeconds===-1?400:422)
})
it('imports overtime only when the recorded wall time proves the full elapsed duration',async()=>{
  const overtime={...payload,completedAt:'2026-01-01T12:01:10.000Z',elapsedSeconds:70}
  expect((await POST(request(overtime))).status).toBe(200);expect(h.db.mock.calls.at(-1)![1][10]).toBe(70)
  expect((await POST(request({...overtime,completedAt:'2026-01-01T12:01:09.000Z'}))).status).toBe(422)
})
