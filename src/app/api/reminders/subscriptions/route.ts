import { z } from 'zod'
import { requireUser, json, originGuard } from '@/lib/http'
import { sql } from '@/lib/db'
import { validatePushSubscription } from '@/lib/reminders'

const removeInput = z.object({ endpoint: z.string().url().max(2048) }).strict()

export async function POST(req: Request) { try { await originGuard(); const user = await requireUser(); const subscription = validatePushSubscription(await req.json()); await sql()(`INSERT INTO push_subscriptions(user_id,endpoint,p256dh,auth,updated_at) VALUES($1,$2,$3,$4,now()) ON CONFLICT(user_id,endpoint) DO UPDATE SET p256dh=EXCLUDED.p256dh,auth=EXCLUDED.auth,updated_at=now()`, [user.id, subscription.endpoint, subscription.p256dh, subscription.auth]); return json({ ok: true }, 201) } catch (error) { if (error instanceof Response) return error; return json({ error: 'Invalid push subscription' }, 400) } }

export async function DELETE(req: Request) { try { await originGuard(); const user = await requireUser(); const { endpoint } = removeInput.parse(await req.json()); await sql()(`DELETE FROM push_subscriptions WHERE user_id=$1 AND endpoint=$2`, [user.id, endpoint]); return json({ ok: true }) } catch (error) { if (error instanceof Response) return error; return error instanceof z.ZodError ? json({ error: 'Invalid subscription endpoint' }, 400) : json({ error: 'Unable to remove subscription' }, 500) } }
