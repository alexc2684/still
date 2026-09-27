import { z } from 'zod'
import { requireUser, json, originGuard } from '@/lib/http'
import { reminderSettings, DEFAULT_REMINDER_HOUR, publicVapidKey } from '@/lib/reminders'
import { sql } from '@/lib/db'

const input = z.object({ enabled: z.boolean().optional(), hour: z.number().int().min(0).max(23).optional(), days: z.array(z.number().int().min(0).max(6)).min(1).max(7).optional() }).strict().superRefine((value, ctx) => { if (value.days && new Set(value.days).size !== value.days.length) ctx.addIssue({ code: 'custom', path: ['days'], message: 'Days must be unique' }) })

export async function GET() { try { const user = await requireUser(); const settings = await reminderSettings(user.id); return json({ settings, ...settings }) } catch (error) { return error instanceof Response ? error : json({ error: 'Unable to load reminder settings' }, 500) } }

export async function PATCH(req: Request) { try { await originGuard(); const user = await requireUser(); const body = input.parse(await req.json()); const current = await reminderSettings(user.id); const days = (body.days ?? current.days).sort((a, b) => a - b); await sql()(`INSERT INTO reminder_settings(user_id,enabled,reminder_hour,reminder_days,updated_at) VALUES($1,$2,$3,$4,now()) ON CONFLICT(user_id) DO UPDATE SET enabled=EXCLUDED.enabled,reminder_hour=EXCLUDED.reminder_hour,reminder_days=EXCLUDED.reminder_days,updated_at=now()`, [user.id, body.enabled ?? current.enabled, body.hour ?? current.hour ?? DEFAULT_REMINDER_HOUR, days]); const settings = await reminderSettings(user.id); return json({ settings, ...settings }) } catch (error) { if (error instanceof Response) return error; if (error instanceof z.ZodError) return json({ error: 'Invalid reminder settings' }, 400); return json({ error: 'Unable to save reminder settings' }, 500) } }

export async function HEAD() { return new Response(null, { status: publicVapidKey() ? 200 : 503 }) }
