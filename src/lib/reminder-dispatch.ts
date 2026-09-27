import { sql } from './db'
import { configureWebPush } from './reminders'

export type DueRow = { userId: string; subscriptionId: string; endpoint: string; p256dh: string; auth: string; reminderDate: string; daysDone: number; minutesDone: number; weeklyTarget: number | null; weeklyMinutesTarget: number | null }
type PushTransport = (row: DueRow, payload: string) => Promise<void>

export type DispatchResult = { due: number; sent: number; failed: number; removed: number; skipped: number }

export function shouldRetryLedger(status: string, attempts: number, claimedAt: Date, now = Date.now()) { return status === 'failed' && attempts < 3 || status === 'sending' && attempts < 3 && now - claimedAt.getTime() >= 15 * 60 * 1000 }
export function pushFailureAction(statusCode: number | undefined) { return statusCode === 404 || statusCode === 410 ? 'remove' : 'retry' }

export function dueWindow(localNow: Date, reminderHour: number, reminderDate: Date) {
  const scheduled = new Date(reminderDate)
  scheduled.setHours(reminderHour, 0, 0, 0)
  return localNow.getTime() >= scheduled.getTime() && localNow.getTime() < scheduled.getTime() + 90 * 60 * 1000
}

async function claim(row: DueRow) {
  const inserted = await sql()(`INSERT INTO reminder_delivery_ledger(user_id,subscription_id,local_date,reminder_type,status,attempts,claimed_at) VALUES($1,$2,$3,'practice','sending',1,now()) ON CONFLICT(user_id,subscription_id,local_date,reminder_type) DO NOTHING RETURNING id`, [row.userId, row.subscriptionId, row.reminderDate])
  if (inserted[0]) return inserted[0].id as string
  const retried = await sql()(`UPDATE reminder_delivery_ledger SET status='sending',attempts=attempts+1,claimed_at=now(),last_error=NULL WHERE user_id=$1 AND subscription_id=$2 AND local_date=$3 AND reminder_type='practice' AND (status='failed' AND attempts<3 OR status='sending' AND attempts<3 AND claimed_at < now()-interval '15 minutes') RETURNING id`, [row.userId, row.subscriptionId, row.reminderDate])
  return retried[0]?.id as string | undefined
}

export async function dueReminders(): Promise<DueRow[]> {
  return await sql()(`WITH clock AS (SELECT now() AS utc_now), users_local AS (SELECT u.id AS user_id,u.timezone,u.weekly_target,u.weekly_minutes_target,r.reminder_hour,r.reminder_days,ps.id AS subscription_id,ps.endpoint,ps.p256dh,ps.auth,(clock.utc_now AT TIME ZONE u.timezone) AS local_now FROM users u JOIN reminder_settings r ON r.user_id=u.id AND r.enabled=true JOIN push_subscriptions ps ON ps.user_id=u.id CROSS JOIN clock), scheduled AS (SELECT *,CASE WHEN local_now >= date_trunc('day',local_now)+reminder_hour*interval '1 hour' THEN date_trunc('day',local_now) ELSE date_trunc('day',local_now)-interval '1 day' END AS scheduled_day FROM users_local) SELECT user_id AS "userId",subscription_id AS "subscriptionId",endpoint,p256dh,auth,to_char(scheduled_day::date,'YYYY-MM-DD') AS "reminderDate",COALESCE((SELECT count(DISTINCT ms.completed_local_date)::int FROM meditation_sessions ms WHERE ms.user_id=scheduled.user_id AND ms.completed_local_date >= date_trunc('week',scheduled_day)::date AND ms.completed_local_date <= scheduled_day::date AND ms.completed_at IS NOT NULL),0) AS "daysDone",COALESCE((SELECT floor(sum(ms.elapsed_seconds)/60)::int FROM meditation_sessions ms WHERE ms.user_id=scheduled.user_id AND ms.completed_local_date >= date_trunc('week',scheduled_day)::date AND ms.completed_local_date <= scheduled_day::date AND ms.completed_at IS NOT NULL),0) AS "minutesDone",weekly_target AS "weeklyTarget",weekly_minutes_target AS "weeklyMinutesTarget" FROM scheduled WHERE reminder_days @> ARRAY[((extract(DOW FROM scheduled_day)::int + 6) % 7)::smallint] AND local_now >= scheduled_day + reminder_hour*interval '1 hour' AND local_now < scheduled_day + reminder_hour*interval '1 hour' + interval '90 minutes' AND NOT EXISTS (SELECT 1 FROM meditation_sessions today WHERE today.user_id=scheduled.user_id AND today.completed_local_date=scheduled_day::date AND today.completed_at IS NOT NULL) AND ((weekly_target IS NOT NULL AND (SELECT count(DISTINCT ms.completed_local_date) FROM meditation_sessions ms WHERE ms.user_id=scheduled.user_id AND ms.completed_local_date >= date_trunc('week',scheduled_day)::date AND ms.completed_local_date <= scheduled_day::date AND ms.completed_at IS NOT NULL) < weekly_target) OR (weekly_minutes_target IS NOT NULL AND (SELECT COALESCE(sum(ms.elapsed_seconds),0) FROM meditation_sessions ms WHERE ms.user_id=scheduled.user_id AND ms.completed_local_date >= date_trunc('week',scheduled_day)::date AND ms.completed_local_date <= scheduled_day::date AND ms.completed_at IS NOT NULL) < weekly_minutes_target*60))`, []) as DueRow[]
}

export async function dispatchReminders({ dryRun = false, transport }: { dryRun?: boolean; transport?: PushTransport } = {}): Promise<DispatchResult> {
  const rows = await dueReminders()
  const result: DispatchResult = { due: rows.length, sent: 0, failed: 0, removed: 0, skipped: 0 }
  if (dryRun || !rows.length) return result
  const push = transport ? null : configureWebPush()
  for (const row of rows) {
    const ledgerId = await claim(row)
    if (!ledgerId) { result.skipped++; continue }
    try {
      const payload = JSON.stringify({ title: 'A moment for Still', body: row.weeklyTarget || row.weeklyMinutesTarget ? `${row.daysDone} days and ${row.minutesDone} minutes this week. Make a little room today.` : 'Make a little room for your practice today.', icon: '/icons/icon-192.png', badge: '/icons/icon-192.png', tag: `practice-${row.reminderDate}`, renotify: false, url: '/' })
      if (transport) await transport(row, payload); else await push!.sendNotification({ endpoint: row.endpoint, keys: { p256dh: row.p256dh, auth: row.auth } }, payload)
      await sql()(`UPDATE reminder_delivery_ledger SET status='sent',sent_at=now() WHERE id=$1`, [ledgerId]); result.sent++
    } catch (error: any) {
      if (pushFailureAction(error?.statusCode) === 'remove') { await sql()(`DELETE FROM push_subscriptions WHERE id=$1`, [row.subscriptionId]); result.removed++ } else { result.failed++ }
      await sql()(`UPDATE reminder_delivery_ledger SET status='failed',last_error=$2 WHERE id=$1`, [ledgerId, String(error?.statusCode || error?.message || 'push failed').slice(0, 240)])
    }
  }
  return result
}
