import { requireUser, json } from '@/lib/http'
import { sql } from '@/lib/db'
import { achievementsFor, type AchievementSession } from '@/lib/achievements'

export async function GET() {
  try {
    const viewer = await requireUser()
    const db = sql()
    const rows = await db(`WITH completed_members AS (SELECT m.id,m.user_id AS "userId",u.name AS "authorName",u.avatar_key AS "authorAvatarKey",m.completed_at AS "completedAt",m.planned_seconds AS "plannedSeconds",m.elapsed_seconds AS "elapsedSeconds",m.name AS "sessionName",m.shared_sit_id AS "sharedSitId",ss.host_user_id AS "hostUserId" FROM meditation_sessions m JOIN users u ON u.id=m.user_id LEFT JOIN shared_sits ss ON ss.id=m.shared_sit_id WHERE m.completed_at IS NOT NULL AND (m.shared_sit_id IS NULL OR ss.status='completed')), canonical_shared AS (SELECT DISTINCT ON ("sharedSitId") * FROM completed_members WHERE "sharedSitId" IS NOT NULL ORDER BY "sharedSitId",("userId"="hostUserId") DESC,"completedAt",id), posts AS (SELECT id,"userId","authorName","authorAvatarKey","completedAt","plannedSeconds","elapsedSeconds","sessionName",NULL::uuid AS "sharedSitId" FROM completed_members WHERE "sharedSitId" IS NULL UNION ALL SELECT id,"userId","authorName","authorAvatarKey","completedAt","plannedSeconds","elapsedSeconds","sessionName","sharedSitId" FROM canonical_shared) SELECT p.id,p."userId",p."authorName",p."authorAvatarKey",p."completedAt",p."plannedSeconds",p."elapsedSeconds",p."sessionName",p."sharedSitId",CASE WHEN p."sharedSitId" IS NULL THEN '[]'::json ELSE COALESCE((SELECT json_agg(json_build_object('userId',cm."userId",'name',cm."authorName",'avatarKey',cm."authorAvatarKey",'sessionId',cm.id) ORDER BY cm."completedAt",cm.id) FROM completed_members cm WHERE cm."sharedSitId"=p."sharedSitId"),'[]'::json) END AS participants,(SELECT COUNT(*)::int FROM completed_members cm WHERE cm."sharedSitId"=p."sharedSitId") AS "participantCount",(COUNT(DISTINCT k.user_id))::int AS kudos,(COUNT(DISTINCT c.id))::int AS comments,COALESCE(BOOL_OR(k.user_id=$1),false) AS "viewerHasKudosed" FROM posts p LEFT JOIN kudos k ON k.session_id=p.id LEFT JOIN comments c ON c.session_id=p.id GROUP BY p.id,p."userId",p."authorName",p."authorAvatarKey",p."completedAt",p."plannedSeconds",p."elapsedSeconds",p."sessionName",p."sharedSitId" ORDER BY p."completedAt" DESC LIMIT 100`, [viewer.id])

    const userIds = [...new Set(rows.flatMap((row: any) => [row.userId, ...(row.participants || []).map((participant: any) => participant.userId)]).filter(Boolean))]
    const historyRows = userIds.length
      ? await db(`SELECT id,user_id AS "userId",completed_at AS "completedAt",completed_local_date::text AS "localDate",elapsed_seconds AS seconds,goal_days_snapshot AS "goalDays",goal_minutes_snapshot AS "goalMinutes" FROM meditation_sessions WHERE completed_at IS NOT NULL AND user_id=ANY($1::uuid[]) ORDER BY completed_at,id`, [userIds])
      : []
    const histories: Record<string, AchievementSession[]> = {}
    for (const history of historyRows as AchievementSession[]) (histories[history.userId!] ||= []).push(history)
    const historyFor = (userId: string) => histories[userId] || []

    const [{ memberCount }] = await db(`SELECT COUNT(*)::int AS "memberCount" FROM users`)
    return json({ memberCount, feed: rows.map((row: any) => {
      const participants = (row.participants || []).map((participant: any) => ({
        userId: participant.userId,
        name: participant.name,
        avatarKey: participant.avatarKey,
        achievements: achievementsFor(historyFor(participant.userId), participant.sessionId),
      }))
      if (row.sharedSitId) return { ...row, participants }
      return { ...row, achievements: achievementsFor(historyFor(row.userId), row.id) }
    }) })
  } catch (error) {
    return error instanceof Response ? error : json({ error: 'Unable to load feed' }, 500)
  }
}
