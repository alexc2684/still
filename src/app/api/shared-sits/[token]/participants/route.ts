import { z } from 'zod'
import { requireUser, originGuard, json } from '@/lib/http'
import { sql } from '@/lib/db'

const input = z.object({ userId: z.string().uuid() })

export async function POST(request: Request, { params }: { params: Promise<{ token: string }> }) {
  try {
    await originGuard()
    const viewer = await requireUser()
    const { token } = await params
    const parsed = input.safeParse(await request.json())
    if (!parsed.success) return json({ error: 'Choose a person from your circle.' }, 400)
    const db = sql()
    // Both the room invitation and its public feed ID can identify a sit. Neither grants edit permission.
    const [room] = await db(`SELECT id,host_user_id AS "hostUserId",status FROM shared_sits WHERE invite_token=$1 OR id::text=$1`, [token])
    if (!room) return json({ error: 'Sit not found.' }, 404)
    if (room.hostUserId !== viewer.id) return json({ error: 'Only the host can add participants.' }, 403)
    if (room.status !== 'completed') return json({ error: 'Participants can only be added after the sit is completed.' }, 409)
    // Serializable isolation protects the capacity check from concurrent additions.
    // Conflicts never overwrite another session, its reflection, or an existing participant.
    const rows = await sql('Serializable')(`WITH locked AS (
      SELECT * FROM shared_sits WHERE id=$1 AND host_user_id=$2 AND status='completed' FOR UPDATE
    ), made AS (
      INSERT INTO meditation_sessions(user_id,shared_sit_id,started_at,completed_at,completed_local_date,planned_seconds,elapsed_seconds,goal_days_snapshot,goal_minutes_snapshot)
      SELECT u.id,s.id,s.started_at,s.ends_at,(s.ends_at AT TIME ZONE u.timezone)::date,s.planned_seconds,s.planned_seconds,u.weekly_target,u.weekly_minutes_target
      FROM locked s JOIN users u ON u.id=$3
      WHERE s.started_at IS NOT NULL AND s.ends_at<=now()
        AND (SELECT COUNT(*) FROM shared_sit_members m WHERE m.shared_sit_id=s.id AND m.left_at IS NULL)<20
        AND NOT EXISTS (SELECT 1 FROM shared_sit_members m WHERE m.shared_sit_id=s.id AND m.user_id=u.id AND m.left_at IS NULL)
      ON CONFLICT DO NOTHING RETURNING id,user_id,shared_sit_id
    ), linked AS (
      INSERT INTO shared_sit_members(shared_sit_id,user_id,meditation_session_id)
      SELECT shared_sit_id,user_id,id FROM made
      ON CONFLICT(shared_sit_id,user_id) DO UPDATE SET meditation_session_id=EXCLUDED.meditation_session_id,left_at=NULL
      RETURNING user_id
    ) SELECT user_id AS "userId" FROM linked`, [room.id, viewer.id, parsed.data.userId])
    if (!rows.length) return json({ error: 'This person is already recorded, is unavailable, or the sit is full (20 participants).' }, 409)
    return json({ member: rows[0] }, 201)
  } catch (error) {
    return error instanceof Response ? error : json({ error: 'Unable to add participant.' }, 400)
  }
}
