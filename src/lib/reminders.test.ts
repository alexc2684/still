import { describe, expect, it } from 'vitest'
import { dueWindow, pushFailureAction, shouldRetryLedger } from './reminder-dispatch'
import { validatePushSubscription } from './reminders'

describe('reminder delivery gates', () => {
  it('accepts the scheduler window and rejects duplicate-hour sends', () => {
    const scheduled = new Date('2026-09-27T19:00:00')
    expect(dueWindow(new Date('2026-09-27T19:17:00'), 19, scheduled)).toBe(true)
    expect(dueWindow(new Date('2026-09-27T20:29:00'), 19, scheduled)).toBe(true)
    expect(dueWindow(new Date('2026-09-27T20:30:00'), 19, scheduled)).toBe(false)
  })

  it('accepts supported push services and rejects arbitrary endpoints', () => {
    const valid = { endpoint: 'https://fcm.googleapis.com/fcm/send/example', keys: { p256dh: Buffer.concat([Buffer.from([4]), Buffer.alloc(64, 1)]).toString('base64url'), auth: Buffer.alloc(16, 2).toString('base64url') } }
    expect(validatePushSubscription(valid)).toEqual({ endpoint: valid.endpoint, p256dh: valid.keys.p256dh, auth: valid.keys.auth })
    expect(() => validatePushSubscription({ ...valid, endpoint: 'https://example.com/collect' })).toThrow('Invalid push subscription')
  })

  it('does not reclaim sent ledgers and bounds retries for mocked push failures', () => {
    const now = Date.parse('2026-09-27T20:00:00Z')
    expect(shouldRetryLedger('sent', 1, new Date(now - 3600000), now)).toBe(false)
    expect(shouldRetryLedger('failed', 2, new Date(now - 3600000), now)).toBe(true)
    expect(shouldRetryLedger('failed', 3, new Date(now - 3600000), now)).toBe(false)
    expect(pushFailureAction(410)).toBe('remove')
    expect(pushFailureAction(503)).toBe('retry')
  })
})
