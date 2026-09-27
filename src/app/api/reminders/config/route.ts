import { json } from '@/lib/http'
import { publicVapidKey } from '@/lib/reminders'

export async function GET() { const vapidPublicKey = publicVapidKey(); return json({ configured: Boolean(vapidPublicKey), vapidPublicKey }) }
