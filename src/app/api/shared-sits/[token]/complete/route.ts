import { requireUser, json, originGuard } from '@/lib/http'
import { sql } from '@/lib/db'

export async function POST(req: Request, { params }: { params: Promise<{ token: string }> }) {
  try {
    await originGuard()
    const user = await requireUser()
    const { token } = await params
    const db = sql()
    const current = await db(`SELECT s.id,s.status,s.ends_at AS "endsAt",m.meditation_session_id AS "sessionId" FROM shared_sits s JOIN shared_sit_members m ON m.shared_sit_id=s.id AND m.user_id=$2 AND m.left_at IS NULL WHERE s.invite_token=$1`, [token, user.id])
    if (!current[0]) return json({ error: 'You are not an active member of this sit' }, 403)
    if (current[0].status === 'cancelled') return json({ error: 'This sit was cancelled' }, 409)
    if (current[0].status === 'completed') return json({ ok: true, idempotent: true, sessionId: current[0].sessionId })
    if (current[0].status !== 'running') return json({ error: 'This sit has not started' }, 409)
    if (new Date(current[0].endsAt).getTime() > Date.now()) return json({ error: 'This sit is still in progress', endsAt: current[0].endsAt }, 422)
    const rows = await db(`WITH locked AS (SELECT s.* FROM shared_sits s JOIN shared_sit_members me ON me.shared_sit_id=s.id AND me.user_id=$2 AND me.left_at IS NULL WHERE s.invite_token=$1 FOR UPDATE OF s), finished AS (UPDATE shared_sits s SET status='completed' FROM locked l WHERE s.id=l.id AND s.status='running' AND s.ends_at<=now() RETURNING s.id,s.ends_at), updated AS (UPDATE meditation_sessions ms SET completed_at=f.ends_at,completed_local_date=(f.ends_at AT TIME ZONE u.timezone)::date,elapsed_seconds=ms.planned_seconds,goal_days_snapshot=u.weekly_target,goal_minutes_snapshot=u.weekly_minutes_target FROM finished f JOIN shared_sit_members m ON m.shared_sit_id=f.id AND m.left_at IS NULL JOIN users u ON u.id=m.user_id WHERE ms.id=m.meditation_session_id AND ms.completed_at IS NULL RETURNING ms.id,ms.user_id) SELECT id AS "sessionId" FROM updated WHERE user_id=$2`, [token, user.id])
    if (rows[0]) return json({ ok: true, sessionId: rows[0].sessionId })
    const retry = await db(`SELECT s.status,m.meditation_session_id AS "sessionId" FROM shared_sits s JOIN shared_sit_members m ON m.shared_sit_id=s.id AND m.user_id=$2 AND m.left_at IS NULL WHERE s.invite_token=$1`, [token, user.id])
    if (retry[0]?.status === 'completed') return json({ ok: true, idempotent: true, sessionId: retry[0].sessionId })
    return json({ error: 'This sit could not be completed' }, 409)
  } catch (error) {
    return error instanceof Response ? error : json({ error: 'Unable to complete room' }, 400)
  }
}
