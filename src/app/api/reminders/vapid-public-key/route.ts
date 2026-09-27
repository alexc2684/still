import { json } from '@/lib/http'
import { publicVapidKey } from '@/lib/reminders'

export async function GET() { const publicKey = publicVapidKey(); return publicKey ? json({ publicKey, vapidPublicKey: publicKey }) : json({ error: 'Push reminders are not configured' }, 503) }
