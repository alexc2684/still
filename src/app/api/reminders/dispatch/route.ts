import { timingSafeEqual } from 'node:crypto'
import { dispatchReminders } from '@/lib/reminder-dispatch'

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
  try { let dryRun = false; const url = new URL(req.url); dryRun = url.searchParams.get('dryRun') === '1'; if (req.headers.get('content-type')?.includes('application/json')) { const body = await req.json().catch(() => ({})); dryRun ||= body?.dryRun === true } return Response.json(await dispatchReminders({ dryRun })) } catch (error) { console.error('Reminder dispatch failed', error); return Response.json({ error: 'Reminder dispatch failed' }, { status: 500 }) }
}

export async function GET(req: Request) { return POST(req) }
