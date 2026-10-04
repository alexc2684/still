import { z } from 'zod'
import { sql } from '@/lib/db'
import { requireUser, json, originGuard } from '@/lib/http'

const mood = z.number().int().min(1).max(5).nullable().optional()
const input = z.object({
  userId: z.string().uuid(), id: z.string().uuid(), startedAt: z.string().datetime(), completedAt: z.string().datetime(),
  plannedSeconds: z.number().int().min(60).max(7200),
  reflection: z.object({ beforeMood: mood, duringMood: mood, afterMood: mood, afterNote: z.string().max(6500) }).optional(),
})

export async function POST(req: Request) {
  try {
    await originGuard()
    const user = await requireUser()
    const b = input.parse(await req.json())
    if (b.userId !== user.id) return json({ error: 'Account mismatch' }, 403)
    const start = Date.parse(b.startedAt), end = Date.parse(b.completedAt)
    if (end > Date.now() + 5000 || end - start < b.plannedSeconds * 1000) return json({ error: 'Invalid practice duration' }, 422)
    const r = b.reflection
    // One atomic statement: retries use the same UUID; other owners and shared sits cannot be changed.
    const rows = await sql()(`WITH saved AS (
      INSERT INTO meditation_sessions(id,user_id,started_at,completed_at,completed_local_date,planned_seconds,elapsed_seconds,goal_days_snapshot,goal_minutes_snapshot)
      SELECT $1,u.id,$3::timestamptz,$4::timestamptz,($4::timestamptz AT TIME ZONE u.timezone)::date,$5,$5,u.weekly_target,u.weekly_minutes_target FROM users u WHERE u.id=$2
      ON CONFLICT(id) DO UPDATE SET completed_at=COALESCE(meditation_sessions.completed_at,EXCLUDED.completed_at),completed_local_date=COALESCE(meditation_sessions.completed_local_date,EXCLUDED.completed_local_date),elapsed_seconds=EXCLUDED.elapsed_seconds,goal_days_snapshot=COALESCE(meditation_sessions.goal_days_snapshot,EXCLUDED.goal_days_snapshot),goal_minutes_snapshot=COALESCE(meditation_sessions.goal_minutes_snapshot,EXCLUDED.goal_minutes_snapshot)
      WHERE meditation_sessions.user_id=EXCLUDED.user_id AND meditation_sessions.shared_sit_id IS NULL AND meditation_sessions.started_at=EXCLUDED.started_at AND meditation_sessions.planned_seconds=EXCLUDED.planned_seconds
      RETURNING id
    ), reflected AS (
      INSERT INTO reflections(session_id,before_mood,during_mood,after_mood,after_note)
      SELECT id,$6,$7,$8,$9 FROM saved WHERE $10
      ON CONFLICT(session_id) DO UPDATE SET before_mood=EXCLUDED.before_mood,during_mood=EXCLUDED.during_mood,after_mood=EXCLUDED.after_mood,before_note=NULL,during_note=NULL,after_note=EXCLUDED.after_note
    ) SELECT id FROM saved`, [b.id, user.id, b.startedAt, b.completedAt, b.plannedSeconds, r?.beforeMood ?? null, r?.duringMood ?? null, r?.afterMood ?? null, r?.afterNote ?? null, Boolean(r)])
    return rows[0] ? json({ id: rows[0].id }) : json({ error: 'Session conflict' }, 409)
  } catch (error) { return error instanceof Response ? error : json({ error: 'Unable to sync practice' }, 400) }
}
