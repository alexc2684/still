import { requireUser, json } from '@/lib/http'
import { sql } from '@/lib/db'

export async function GET() {
  try {
    await requireUser()
    const members = await sql()(`SELECT id AS "userId",name,avatar_key AS "avatarKey" FROM users ORDER BY lower(name),id`)
    return json({ members })
  } catch (error) {
    return error instanceof Response ? error : json({ error: 'Unable to load circle members.' }, 500)
  }
}
