import { z } from 'zod'
import { sql } from '@/lib/db'
import { json, originGuard, requireUser } from '@/lib/http'

const searchInput = z.object({ query: z.string().trim().min(1).max(200) })

export async function POST(request: Request) {
  try {
    await originGuard()
    const user = await requireUser()
    const input = searchInput.safeParse(await request.json().catch(() => null))
    if (!input.success) return json({ error: 'Enter a search between 1 and 200 characters.' }, 400)
    // Literal substring matching: %, _ and SQL syntax remain ordinary search text.
    // POST keeps private search terms out of URLs and browser history.
    const rows = await sql()(`SELECT m.id,
      COALESCE(m.completed_local_date, (m.completed_at AT TIME ZONE $3)::date)::text AS date,
      COALESCE(NULLIF(m.elapsed_seconds, 0), m.planned_seconds) AS seconds,
      r.before_note AS "beforeNote", r.during_note AS "duringNote", r.after_note AS "afterNote"
      FROM meditation_sessions m JOIN reflections r ON r.session_id=m.id
      WHERE m.user_id=$1 AND m.completed_at IS NOT NULL
      AND strpos(lower(concat_ws(E'\\n', r.before_note, r.during_note, r.after_note)), lower($2)) > 0
      ORDER BY m.completed_at DESC, m.id DESC LIMIT 51`, [user.id, input.data.query, user.timezone])
    return json({ results: rows.slice(0, 50), hasMore: rows.length > 50 })
  } catch (error) {
    return error instanceof Response ? error : json({ error: 'Unable to search your reflections. Please try again.' }, 500)
  }
}
