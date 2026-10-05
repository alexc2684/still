import { timingSafeEqual } from 'node:crypto'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function authorized(req: Request) {
  const expected = process.env.CRON_SECRET
  const actual = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '')
  if (!expected || !actual) return false
  const a = Buffer.from(actual)
  const b = Buffer.from(expected)
  return a.length === b.length && timingSafeEqual(a, b)
}

export async function POST(req: Request) {
  if (!authorized(req)) return new Response('Unauthorized', { status: 401 })
  return Response.json({ due: 0, sent: 0, failed: 0, removed: 0, skipped: 0, retired: true })
}

export async function GET(req: Request) { return POST(req) }
