import { requireUser, json } from '@/lib/http'
import { sql } from '@/lib/db'
import { z } from 'zod'

export async function GET(request: Request) {
  try {
    const user = await requireUser()
    const db = sql()
    const requestedDate = new URL(request.url).searchParams.get('date')
    const date = requestedDate === 'today'
      ? new Intl.DateTimeFormat('en-CA', { timeZone: user.timezone }).format(new Date())
      : requestedDate
    if (date && !z.iso.date().safeParse(date).success) return json({ error: 'Invalid date' }, 400)
    const rows = await db(`SELECT m.id,m.started_at AS "startedAt",m.completed_at AS "completedAt",m.completed_local_date::text AS "completedLocalDate",m.planned_seconds AS "plannedSeconds",m.elapsed_seconds AS "elapsedSeconds",m.name,r.before_mood AS "beforeMood",r.during_mood AS "duringMood",r.after_mood AS "afterMood",r.before_note AS "beforeNote",r.during_note AS "duringNote",r.after_note AS "afterNote" FROM meditation_sessions m LEFT JOIN reflections r ON r.session_id=m.id WHERE m.user_id=$1 ${date ? 'AND m.completed_at IS NOT NULL AND COALESCE(m.completed_local_date, (m.completed_at AT TIME ZONE $3)::date)=$2::date' : ''} ORDER BY m.started_at DESC ${date ? '' : 'LIMIT 200'}`, date ? [user.id, date, user.timezone] : [user.id])
    const dates = await db(`SELECT DISTINCT COALESCE(completed_local_date, (completed_at AT TIME ZONE $2)::date)::text AS date FROM meditation_sessions WHERE user_id=$1 AND completed_at IS NOT NULL ORDER BY date DESC`, [user.id, user.timezone])
    const [summary] = await db(`SELECT COUNT(*)::int AS "totalSessions", ROUND(COALESCE(SUM(COALESCE(elapsed_seconds,planned_seconds)),0)/60.0)::int AS "totalMinutes" FROM meditation_sessions WHERE user_id=$1 AND completed_at IS NOT NULL`, [user.id])
    return json({ sessions: rows, practiceDates: dates.map((row: { date: string }) => row.date), date, summary })
  } catch (error) {
    return error instanceof Response ? error : json({ error: 'Unable to load history' }, 500)
  }
}
