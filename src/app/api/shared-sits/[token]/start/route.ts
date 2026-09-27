import { requireUser, json, originGuard } from '@/lib/http'
import { sql } from '@/lib/db'
import { roomSnapshot } from '@/lib/shared-room'

export async function POST(req: Request, { params }: { params: Promise<{ token: string }> }) {
  try {
    await originGuard()
    const user = await requireUser()
    const { token } = await params
    const db = sql()
    const roomRows = await db(`SELECT s.id,s.status,s.host_user_id AS "hostUserId",s.planned_seconds AS "plannedSeconds",COUNT(m.user_id) FILTER (WHERE m.left_at IS NULL)::int AS "memberCount" FROM shared_sits s LEFT JOIN shared_sit_members m ON m.shared_sit_id=s.id WHERE s.invite_token=$1 GROUP BY s.id`, [token])
    if (!roomRows[0]) return json({ error: 'Room not found' }, 404)
    const room = roomRows[0]
    if (room.hostUserId !== user.id) return json({ error: 'Only the host can start this sit' }, 403)
    if (room.status !== 'waiting') return json({ error: 'This sit has already started' }, 409)
    if (room.memberCount > 20) return json({ error: 'A shared sit can have at most 20 people' }, 409)
    const rows = await db(`WITH locked AS (SELECT s.* FROM shared_sits s JOIN shared_sit_members host_member ON host_member.shared_sit_id=s.id AND host_member.user_id=$2 AND host_member.left_at IS NULL WHERE s.invite_token=$1 AND s.status='waiting' FOR UPDATE), started AS (UPDATE shared_sits s SET status='running',started_at=now()+interval '3 seconds',ends_at=now()+interval '3 seconds'+s.planned_seconds*interval '1 second' FROM locked l WHERE s.id=l.id RETURNING s.*), made AS (INSERT INTO meditation_sessions(user_id,shared_sit_id,started_at,planned_seconds) SELECT m.user_id,s.id,s.started_at,s.planned_seconds FROM shared_sit_members m JOIN started s ON s.id=m.shared_sit_id WHERE m.left_at IS NULL RETURNING id,user_id,shared_sit_id), linked AS (UPDATE shared_sit_members m SET meditation_session_id=made.id FROM made WHERE m.shared_sit_id=made.shared_sit_id AND m.user_id=made.user_id RETURNING m.shared_sit_id) SELECT s.id,s.status,s.planned_seconds AS "plannedSeconds",s.started_at AS "startedAt",s.ends_at AS "endsAt" FROM started s`, [token, user.id])
    if (!rows[0]) return json({ error: 'This sit has already started' }, 409)
    return json({ room: await roomSnapshot(token, user.id) })
  } catch (error) {
    return error instanceof Response ? error : json({ error: 'Unable to start room' }, 400)
  }
}
