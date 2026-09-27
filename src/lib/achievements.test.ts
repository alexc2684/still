import { describe, expect, it } from 'vitest'
import { achievementsFor, type AchievementSession } from './achievements'

const session = (id: string, completedAt: string, localDate: string, seconds = 60, extra: Partial<AchievementSession> = {}): AchievementSession => ({ id, completedAt, localDate, seconds, ...extra })
const kinds = (items: ReturnType<typeof achievementsFor>) => items.map((item) => item.kind)

describe('achievementsFor', () => {
  it('uses the target session prefix and only awards first sit once across same-day sits', () => {
    const history = [
      session('a', '2026-01-01T22:00:00Z', '2026-01-01'),
      session('b', '2026-01-01T23:00:00Z', '2026-01-01'),
      session('future', '2026-01-02T00:00:00Z', '2026-01-02'),
    ]
    expect(kinds(achievementsFor(history, 'a'))).toContain('first_sit')
    expect(kinds(achievementsFor(history, 'b'))).not.toContain('first_sit')
    expect(kinds(achievementsFor(history, 'a'))).not.toContain('2_day_streak')
    expect(achievementsFor(history, 'a').find((item) => item.kind === 'streak')?.label).toBe('1 day streak')
  })

  it('excludes later history when evaluating a target', () => {
    const history = [
      session('a', '2026-01-01T10:00:00Z', '2026-01-01', 60),
      session('b', '2026-01-02T10:00:00Z', '2026-01-02', 60),
    ]
    expect(kinds(achievementsFor(history, 'a'))).not.toContain('2_day_streak')
    expect(achievementsFor(history, 'a').find((item) => item.kind === 'streak')?.label).toBe('1 day streak')
  })

  it('uses stored local dates for timezone-safe streaks', () => {
    const history = [
      session('a', '2026-01-02T04:30:00Z', '2026-01-01'),
      session('b', '2026-01-03T04:30:00Z', '2026-01-02'),
    ]
    expect(achievementsFor(history, 'b').find((item) => item.kind === 'streak')?.label).toBe('2 day streak')
  })

  it('awards the 100-hour milestone only on the crossing row', () => {
    const history = [
      session('before', '2026-01-01T00:00:00Z', '2026-01-01', 359999),
      session('cross', '2026-01-02T00:00:00Z', '2026-01-02', 1),
      session('after', '2026-01-03T00:00:00Z', '2026-01-03', 1),
    ]
    expect(kinds(achievementsFor(history, 'cross'))).toContain('100_hours')
    expect(kinds(achievementsFor(history, 'after'))).not.toContain('100_hours')
  })

  it('counts weekly goals on calendar Monday-Sunday boundaries', () => {
    const history = [
      session('sun', '2026-01-04T12:00:00Z', '2026-01-04', 60, { goalDays: 2, goalMinutes: null }),
      session('mon', '2026-01-05T12:00:00Z', '2026-01-05', 60, { goalDays: 2, goalMinutes: null }),
    ]
    expect(kinds(achievementsFor(history, 'sun'))).not.toContain('days_goal')
    expect(kinds(achievementsFor(history, 'mon'))).not.toContain('days_goal')

    const mondayHistory = [
      session('mon1', '2026-01-05T12:00:00Z', '2026-01-05', 60, { goalDays: 2, goalMinutes: null }),
      session('tue', '2026-01-06T12:00:00Z', '2026-01-06', 60, { goalDays: 2, goalMinutes: null }),
    ]
    expect(kinds(achievementsFor(mondayHistory, 'tue'))).toContain('days_goal')
  })

  it('supports days-only snapshots, combined snapshots, and omits legacy unknown goals', () => {
    const daysOnly = [
      session('d1', '2026-01-05T12:00:00Z', '2026-01-05', 60, { goalDays: 2, goalMinutes: null }),
      session('d2', '2026-01-06T12:00:00Z', '2026-01-06', 60, { goalDays: 2, goalMinutes: null }),
    ]
    expect(kinds(achievementsFor(daysOnly, 'd2'))).toContain('days_goal')

    const combined = [
      session('c1', '2026-01-05T12:00:00Z', '2026-01-05', 60, { goalDays: 2, goalMinutes: 2 }),
      session('c2', '2026-01-06T12:00:00Z', '2026-01-06', 60, { goalDays: 2, goalMinutes: 2 }),
    ]
    expect(kinds(achievementsFor(combined, 'c2'))).toContain('weekly_goal')
    expect(kinds(achievementsFor(combined, 'c2'))).not.toContain('days_goal')
    expect(kinds(achievementsFor(combined, 'c2'))).not.toContain('minutes_goal')

    const legacy = [session('legacy', '2026-01-05T12:00:00Z', '2026-01-05', 60)]
    expect(kinds(achievementsFor(legacy, 'legacy'))).not.toContain('days_goal')
    expect(kinds(achievementsFor(legacy, 'legacy'))).not.toContain('minutes_goal')
    expect(kinds(achievementsFor(legacy, 'legacy'))).not.toContain('weekly_goal')
  })
})
