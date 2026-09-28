import { describe, expect, it, vi } from 'vitest'

const validSubscription = () => ({ endpoint: 'https://fcm.googleapis.com/fcm/send/example', keys: { p256dh: Buffer.concat([Buffer.from([4]), Buffer.alloc(64, 1)]).toString('base64url'), auth: Buffer.alloc(16, 2).toString('base64url') } })

describe('reminder settings and web push validation', () => {
  it('reads settings with defaults and rejects unknown users', async () => {
    vi.resetModules()
    const query = vi.fn().mockResolvedValueOnce([])
    vi.doMock('../../../src/lib/db', () => ({ sql: () => query }))
    vi.doMock('web-push', () => ({ default: { setVapidDetails: vi.fn() } }))
    const reminders = await import('../../../src/lib/reminders')
    await expect(reminders.reminderSettings('missing')).rejects.toMatchObject({ status: 401 })
    query.mockResolvedValueOnce([{ timezone: 'America/New_York', enabled: 1, hour: '19', days: [1, 3] }])
    process.env.VAPID_PUBLIC_KEY = 'public'
    await expect(reminders.reminderSettings('u')).resolves.toEqual({ enabled: true, hour: 19, days: [1, 3], timezone: 'America/New_York', vapidPublicKey: 'public' })
  })

  it('validates key lengths, endpoint restrictions, and VAPID configuration', async () => {
    vi.resetModules()
    const setVapidDetails = vi.fn()
    vi.doMock('../../../src/lib/db', () => ({ sql: () => vi.fn() }))
    vi.doMock('web-push', () => ({ default: { setVapidDetails } }))
    const reminders = await import('../../../src/lib/reminders')
    delete process.env.VAPID_PUBLIC_KEY
    expect(reminders.publicVapidKey()).toBeNull()
    process.env.VAPID_PUBLIC_KEY = 'public'
    expect(reminders.validatePushSubscription(validSubscription())).toMatchObject({ endpoint: expect.stringContaining('fcm') })
    for (const endpoint of ['https://web.push.apple.com/x', 'https://sub.push.apple.com/x', 'https://updates.push.services.mozilla.com/x', 'https://sub.push.services.mozilla.com/x']) {
      expect(reminders.validatePushSubscription({ ...validSubscription(), endpoint })).toMatchObject({ endpoint })
    }
    for (const bad of [null, {}, { ...validSubscription(), endpoint: 'http://fcm.googleapis.com/x' }, { ...validSubscription(), endpoint: 'https://example.test/x' }, { ...validSubscription(), endpoint: 'https://u:p@fcm.googleapis.com/x' }, { ...validSubscription(), endpoint: 'https://fcm.googleapis.com:444/x' }, { ...validSubscription(), endpoint: 'not a url' }, { ...validSubscription(), keys: { p256dh: 'bad', auth: 'bad' } }]) expect(() => reminders.validatePushSubscription(bad)).toThrow('Invalid push subscription')
    const NativeURL = globalThis.URL
    vi.stubGlobal('URL', class { constructor() { throw new Error('bad URL') } })
    expect(() => reminders.validatePushSubscription(validSubscription())).toThrow('Invalid push subscription')
    vi.stubGlobal('URL', NativeURL)
    const decodable = validSubscription()
    const from = vi.spyOn(Buffer, 'from').mockImplementationOnce(() => { throw new Error('decoder failure') })
    expect(() => reminders.validatePushSubscription(decodable)).toThrow('Invalid push subscription')
    from.mockRestore()
    delete process.env.VAPID_PUBLIC_KEY
    delete process.env.VAPID_PRIVATE_KEY
    expect(() => reminders.configureWebPush()).toThrow('VAPID keys are not configured')
    process.env.VAPID_PUBLIC_KEY = 'pub'; process.env.VAPID_PRIVATE_KEY = 'priv'; delete process.env.VAPID_SUBJECT
    expect(reminders.configureWebPush()).toBeDefined()
    expect(setVapidDetails).toHaveBeenCalledWith('https://still-meditation-ashen.vercel.app', 'pub', 'priv')
  })
})

describe('reminder dispatch', () => {
  it('returns due rows and exits cleanly for dry runs and empty queues', async () => {
    vi.resetModules()
    const query = vi.fn()
      .mockResolvedValueOnce([{ userId: 'u', subscriptionId: 's', endpoint: 'e', p256dh: 'p', auth: 'a', reminderDate: '2026-09-27', daysDone: 1, minutesDone: 2, weeklyTarget: 7, weeklyMinutesTarget: null }])
      .mockResolvedValueOnce([])
    vi.doMock('../../../src/lib/db', () => ({ sql: () => query }))
    vi.doMock('web-push', () => ({ default: { setVapidDetails: vi.fn(), sendNotification: vi.fn() } }))
    const dispatch = await import('../../../src/lib/reminder-dispatch')
    await expect(dispatch.dueReminders()).resolves.toHaveLength(1)
    await expect(dispatch.dispatchReminders({ dryRun: true })).resolves.toEqual({ due: 0, sent: 0, failed: 0, removed: 0, skipped: 0 })
  })

  it('claims, sends, marks sent, skips duplicate claims, and handles retries/removal', async () => {
    vi.resetModules()
    const query = vi.fn()
      .mockResolvedValueOnce([{ userId: 'u', subscriptionId: 's', endpoint: 'e', p256dh: 'p', auth: 'a', reminderDate: '2026-09-27', daysDone: 1, minutesDone: 2, weeklyTarget: 7, weeklyMinutesTarget: null }])
      .mockResolvedValueOnce([{ id: 'ledger-1' }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ userId: 'u', subscriptionId: 's2', endpoint: 'e2', p256dh: 'p', auth: 'a', reminderDate: '2026-09-28', daysDone: 0, minutesDone: 0, weeklyTarget: null, weeklyMinutesTarget: 10 }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
    vi.doMock('../../../src/lib/db', () => ({ sql: () => query }))
    vi.doMock('web-push', () => ({ default: { setVapidDetails: vi.fn(), sendNotification: vi.fn() } }))
    const dispatch = await import('../../../src/lib/reminder-dispatch')
    const transport = vi.fn().mockRejectedValueOnce(Object.assign(new Error('gone'), { statusCode: 410 }))
    expect(await dispatch.dispatchReminders({ transport })).toMatchObject({ due: 1, sent: 0, failed: 0, removed: 1 })
    expect(transport).toHaveBeenCalledWith(expect.objectContaining({ userId: 'u' }), expect.stringContaining('A moment for Still'))
  })

  it('reclaims a failed ledger and marks ordinary failures for retry', async () => {
    vi.resetModules()
    const query = vi.fn()
      .mockResolvedValueOnce([{ userId: 'u', subscriptionId: 's', endpoint: 'e', p256dh: 'p', auth: 'a', reminderDate: '2026-09-27', daysDone: 0, minutesDone: 0, weeklyTarget: null, weeklyMinutesTarget: null }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: 'retry-ledger' }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
    vi.doMock('../../../src/lib/db', () => ({ sql: () => query }))
    vi.doMock('web-push', () => ({ default: { setVapidDetails: vi.fn(), sendNotification: vi.fn() } }))
    const dispatch = await import('../../../src/lib/reminder-dispatch')
    const transport = vi.fn().mockRejectedValueOnce(Object.assign(new Error('temporary'), { statusCode: 503 }))
    expect(await dispatch.dispatchReminders({ transport })).toMatchObject({ due: 1, failed: 1, removed: 0 })
    expect(query.mock.calls[2][0]).toContain('UPDATE reminder_delivery_ledger')
  })

  it('skips an already claimed ledger and can use the native web-push transport', async () => {
    vi.resetModules()
    const sendNotification = vi.fn().mockResolvedValue(undefined)
    const query = vi.fn()
      .mockResolvedValueOnce([{ userId: 'u', subscriptionId: 's', endpoint: 'e', p256dh: 'p', auth: 'a', reminderDate: '2026-09-27', daysDone: 0, minutesDone: 0, weeklyTarget: null, weeklyMinutesTarget: null }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
    vi.doMock('../../../src/lib/db', () => ({ sql: () => query }))
    vi.doMock('web-push', () => ({ default: { setVapidDetails: vi.fn(), sendNotification } }))
    const dispatch = await import('../../../src/lib/reminder-dispatch')
    process.env.VAPID_PUBLIC_KEY = 'pub'; process.env.VAPID_PRIVATE_KEY = 'priv'
    expect(await dispatch.dispatchReminders()).toMatchObject({ due: 1, skipped: 1 })
    expect(sendNotification).not.toHaveBeenCalled()

    vi.resetModules()
    const secondQuery = vi.fn()
      .mockResolvedValueOnce([{ userId: 'u', subscriptionId: 's', endpoint: 'e', p256dh: 'p', auth: 'a', reminderDate: '2026-09-27', daysDone: 0, minutesDone: 0, weeklyTarget: 1, weeklyMinutesTarget: null }])
      .mockResolvedValueOnce([{ id: 'ledger' }])
      .mockResolvedValueOnce([])
    vi.doMock('../../../src/lib/db', () => ({ sql: () => secondQuery }))
    vi.doMock('web-push', () => ({ default: { setVapidDetails: vi.fn(), sendNotification } }))
    const nativeDispatch = await import('../../../src/lib/reminder-dispatch')
    expect(await nativeDispatch.dispatchReminders()).toMatchObject({ due: 1, sent: 1 })
    expect(sendNotification).toHaveBeenCalledWith(expect.objectContaining({ endpoint: 'e' }), expect.stringContaining('days and'))
  })

  it('records message and fallback errors without leaking unbounded error text', async () => {
    vi.resetModules()
    const query = vi.fn()
      .mockResolvedValueOnce([
        { userId: 'u', subscriptionId: 's1', endpoint: 'e1', p256dh: 'p', auth: 'a', reminderDate: '2026-09-27', daysDone: 0, minutesDone: 0, weeklyTarget: null, weeklyMinutesTarget: null },
        { userId: 'u', subscriptionId: 's2', endpoint: 'e2', p256dh: 'p', auth: 'a', reminderDate: '2026-09-28', daysDone: 0, minutesDone: 0, weeklyTarget: null, weeklyMinutesTarget: null },
      ])
      .mockResolvedValueOnce([{ id: 'l1' }]).mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: 'l2' }]).mockResolvedValueOnce([])
    vi.doMock('../../../src/lib/db', () => ({ sql: () => query }))
    vi.doMock('web-push', () => ({ default: { setVapidDetails: vi.fn(), sendNotification: vi.fn() } }))
    const dispatch = await import('../../../src/lib/reminder-dispatch')
    const transport = vi.fn().mockRejectedValueOnce(new Error('temporary message')).mockRejectedValueOnce({})
    expect(await dispatch.dispatchReminders({ transport })).toMatchObject({ due: 2, failed: 2 })
    expect(query.mock.calls.filter((call) => String(call[0]).includes("SET status='failed'")).length).toBe(2)
  })

  it('covers retry predicates, push action, and scheduler boundaries', async () => {
    const { dueWindow, pushFailureAction, shouldRetryLedger } = await import('../../../src/lib/reminder-dispatch')
    const now = Date.parse('2026-09-27T20:00:00Z')
    expect(shouldRetryLedger('sending', 2, new Date(now - 15 * 60 * 1000), now)).toBe(true)
    expect(shouldRetryLedger('sending', 2, new Date(now - 1), now)).toBe(false)
    expect(shouldRetryLedger('failed', 3, new Date(now - 3600000), now)).toBe(false)
    expect(pushFailureAction(404)).toBe('remove')
    expect(pushFailureAction(undefined)).toBe('retry')
    const scheduled = new Date('2026-09-27T19:00:00')
    expect(dueWindow(new Date('2026-09-27T19:00:00'), 19, scheduled)).toBe(true)
    expect(dueWindow(new Date('2026-09-27T20:30:00'), 19, scheduled)).toBe(false)
  })
})
