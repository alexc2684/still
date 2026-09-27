import webpush from 'web-push'
import { sql } from './db'

export const DEFAULT_REMINDER_HOUR = 19
export const DEFAULT_REMINDER_DAYS = [0, 1, 2, 3, 4, 5, 6]

export type ReminderSettings = { enabled: boolean; hour: number; days: number[]; timezone: string; vapidPublicKey: string | null }

export function publicVapidKey() { return process.env.VAPID_PUBLIC_KEY || null }

export async function reminderSettings(userId: string): Promise<ReminderSettings> {
  const rows = await sql()(`SELECT u.timezone, COALESCE(r.enabled,false) AS enabled, COALESCE(r.reminder_hour,19) AS hour, COALESCE(r.reminder_days,ARRAY[0,1,2,3,4,5,6]::smallint[]) AS days FROM users u LEFT JOIN reminder_settings r ON r.user_id=u.id WHERE u.id=$1`, [userId])
  if (!rows[0]) throw new Response('Unauthorized', { status: 401 })
  return { enabled: Boolean(rows[0].enabled), hour: Number(rows[0].hour), days: (rows[0].days as number[]).map(Number), timezone: rows[0].timezone, vapidPublicKey: publicVapidKey() }
}

function allowedPushEndpoint(value: string) {
  try {
    const url = new URL(value)
    if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443')) return false
    const host = url.hostname.toLowerCase()
    return host === 'fcm.googleapis.com' || host === 'web.push.apple.com' || host.endsWith('.push.apple.com') || host === 'updates.push.services.mozilla.com' || host.endsWith('.push.services.mozilla.com')
  } catch { return false }
}

const encoded = /^[A-Za-z0-9_-]+$/
export function validatePushSubscription(value: unknown) {
  if (!value || typeof value !== 'object') throw new Error('Invalid push subscription')
  const body = value as Record<string, unknown>
  const keys = body.keys as Record<string, unknown> | undefined
  if (typeof body.endpoint !== 'string' || body.endpoint.length > 2048 || !allowedPushEndpoint(body.endpoint) || !keys || typeof keys.p256dh !== 'string' || typeof keys.auth !== 'string' || !encoded.test(keys.p256dh) || !encoded.test(keys.auth)) throw new Error('Invalid push subscription')
  let p256dh: Buffer, auth: Buffer
  try { p256dh = Buffer.from(keys.p256dh, 'base64url'); auth = Buffer.from(keys.auth, 'base64url') } catch { throw new Error('Invalid push subscription') }
  if (p256dh.length !== 65 || p256dh[0] !== 4 || auth.length !== 16) throw new Error('Invalid push subscription')
  return { endpoint: body.endpoint, p256dh: keys.p256dh, auth: keys.auth }
}

export function configureWebPush() {
  const publicKey = process.env.VAPID_PUBLIC_KEY
  const privateKey = process.env.VAPID_PRIVATE_KEY
  if (!publicKey || !privateKey) throw new Error('VAPID keys are not configured')
  webpush.setVapidDetails(process.env.VAPID_SUBJECT || 'https://still-meditation-ashen.vercel.app', publicKey, privateKey)
  return webpush
}
