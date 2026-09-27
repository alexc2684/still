import { z } from 'zod'
import { sql } from '@/lib/db'
import { requireUser, json, originGuard } from '@/lib/http'

const body = z.object({ elapsedSeconds: z.number().int().nonnegative(), beforeMood: z.number().int().min(1).max(5).nullable().optional(), duringMood: z.number().int().min(1).max(5).nullable().optional(), afterMood: z.number().int().min(1).max(5).nullable().optional(), beforeNote: z.string().max(2000).nullable().optional(), duringNote: z.string().max(2000).nullable().optional(), afterNote: z.string().max(2000).nullable().optional() })

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await originGuard()
    const user = await requireUser()
    const parsed = body.parse(await req.json())
    const { id } = await params
    const db = sql()
    const session = (await db('SELECT * FROM meditation_sessions WHERE id=$1 AND user_id=$2', [id, user.id]))[0]
    if (!session) return json({ error: 'Not found' }, 404)
    if (session.shared_sit_id) return json({ error: 'Use the shared sit completion endpoint' }, 409)
    if (session.completed_at) return json({ session, idempotent: true })
    const elapsed = Math.min(parsed.elapsedSeconds, session.planned_seconds, Math.max(0, Math.floor((Date.now() - new Date(session.started_at).getTime()) / 1000)))
    if (elapsed < session.planned_seconds) return json({ error: 'Session must reach its planned duration', elapsedSeconds: elapsed }, 422)
    const rows = await db(`WITH updated AS (UPDATE meditation_sessions m SET elapsed_seconds=$1,completed_at=now(),completed_local_date=(now() AT TIME ZONE $3)::date,goal_days_snapshot=u.weekly_target,goal_minutes_snapshot=u.weekly_minutes_target FROM users u WHERE m.id=$2 AND m.user_id=u.id AND m.completed_at IS NULL RETURNING m.*), reflection AS (INSERT INTO reflections(session_id,before_mood,during_mood,after_mood,before_note,during_note,after_note) SELECT $2,$4,$5,$6,$7,$8,$9 FROM updated ON CONFLICT(session_id) DO UPDATE SET before_mood=EXCLUDED.before_mood,during_mood=EXCLUDED.during_mood,after_mood=EXCLUDED.after_mood,before_note=EXCLUDED.before_note,during_note=EXCLUDED.during_note,after_note=EXCLUDED.after_note) SELECT updated.*,updated.completed_local_date::text AS completed_date_text FROM updated`, [elapsed, id, user.timezone, parsed.beforeMood ?? null, parsed.duringMood ?? null, parsed.afterMood ?? null, parsed.beforeNote ?? null, parsed.duringNote ?? null, parsed.afterNote ?? null])
    if (!rows[0]) {
      const existing = (await db('SELECT *,completed_local_date::text AS completed_date_text FROM meditation_sessions WHERE id=$1 AND user_id=$2', [id, user.id]))[0]
      return json({ session: existing, idempotent: true })
    }
    const completed = { ...rows[0], completed_local_date: rows[0].completed_date_text }
    return json({ session: completed, practiceDate: rows[0].completed_date_text })
  } catch (error) {
    return error instanceof Response ? error : json({ error: 'Unable to complete session' }, 400)
  }
}
