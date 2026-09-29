import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AVATAR_KEYS, validAvatarKey } from '../../../src/lib/avatar'
import { combineJournalNotes } from '../../../src/components/journalNotes'
import { addDays, bestStreak, mondayStart, streak } from '../../../src/lib/practice-stats'
import { currentStreak, dateInTimezone, streakFromDates } from '../../../src/lib/streak'
import { inviteToken } from '../../../src/lib/shared-sits'
import { hashPassword, token, tokenHash, verifyPassword } from '../../../src/lib/security'

describe('small pure helpers', () => {
  it('validates the complete avatar key set', () => {
    expect(AVATAR_KEYS).toHaveLength(6)
    expect(AVATAR_KEYS.every(validAvatarKey)).toBe(true)
    expect(validAvatarKey('leaf')).toBe(true)
    expect(validAvatarKey('LEAF')).toBe(false)
    expect(validAvatarKey(null)).toBe(false)
    expect(validAvatarKey(1)).toBe(false)
  })

  it('combines journal notes while preserving the simple after-only form', () => {
    expect(combineJournalNotes({ afterNote: 'quiet' })).toBe('quiet')
    expect(combineJournalNotes({ beforeNote: '', duringNote: null, afterNote: null })).toBe('')
    expect(combineJournalNotes({ beforeNote: 'start', duringNote: 'middle', afterNote: 'end' })).toBe('Before: start\n\nDuring: middle\n\nAfter: end')
    expect(combineJournalNotes({ beforeNote: 'start', afterNote: '' })).toBe('Before: start')
  })

  it('handles practice date boundaries and duplicate dates', () => {
    expect(streak(['2026-09-25'], '2026-09-26')).toBe(1)
    expect(streak(['2026-09-26', '2026-09-26'], '2026-09-26')).toBe(1)
    expect(streak([], '2026-09-26')).toBe(0)
    expect(bestStreak([])).toBe(0)
    expect(bestStreak(['2026-09-20', '2026-09-21', '2026-09-23'])).toBe(2)
    expect(mondayStart('2026-09-21')).toBe('2026-09-21')
    expect(mondayStart('2026-09-27')).toBe('2026-09-21')
    expect(addDays('2026-09-30', 1)).toBe('2026-10-01')
    expect(addDays('2026-09-30', -1)).toBe('2026-09-29')
  })

  it('uses timezone and local-date streak semantics', () => {
    expect(dateInTimezone(new Date('2026-01-02T04:30:00Z'), 'America/New_York')).toBe('2026-01-01')
    expect(streakFromDates(['2026-09-26', '2026-09-25', '2026-09-23'], '2026-09-26')).toBe(2)
    expect(streakFromDates([], '2026-09-26')).toBe(0)
    expect(currentStreak(['2026-09-25'], '2026-09-26')).toBe(1)
    expect(currentStreak([], '2026-09-26')).toBe(0)
    expect(currentStreak(['2026-09-26'], '2026-09-26')).toBe(1)
  })

  it('creates URL-safe invite and session tokens and hashes deterministically', async () => {
    const invite = inviteToken()
    const sessionToken = token()
    expect(invite).toMatch(/^[A-Za-z0-9_-]+$/)
    expect(invite.length).toBeGreaterThan(40)
    expect(sessionToken).toMatch(/^[A-Za-z0-9_-]+$/)
    expect(tokenHash('abc')).toBe(tokenHash('abc'))
    expect(tokenHash('abc')).not.toBe(tokenHash('abd'))
    const encoded = await hashPassword('correct horse battery staple')
    expect(encoded).toMatch(/^scrypt\$[^$]+\$[0-9a-f]+$/)
    expect(await verifyPassword('correct horse battery staple', encoded)).toBe(true)
    expect(await verifyPassword('wrong', encoded)).toBe(false)
    expect(await verifyPassword('wrong', 'malformed')).toBe(false)
    expect(await verifyPassword('wrong', 'scrypt$salt$00')).toBe(false)
  })
})

describe('bowl audio', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.stubGlobal('performance', { now: () => 1000 })
  })

  it('unlocks and plays through the browser audio graph, then throttles', async () => {
    const calls: string[] = []
    class Node {
      gain = { value: 0, setValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() }
      frequency = { setValueAtTime: vi.fn() }
      connect(target: unknown) { calls.push('connect'); return target }
      start = vi.fn(() => calls.push('start'))
      stop = vi.fn(() => calls.push('stop'))
      type = ''
      buffer: unknown
    }
    class AudioContextMock {
      currentTime = 2; sampleRate = 1000; destination = {}
      resume = vi.fn(async () => undefined)
      createOscillator = vi.fn(() => new Node())
      createGain = vi.fn(() => new Node())
      createBuffer = vi.fn(() => ({ getChannelData: () => new Float32Array(90) }))
      createBufferSource = vi.fn(() => new Node())
      createBiquadFilter = vi.fn(() => new Node())
    }
    vi.stubGlobal('window', { AudioContext: AudioContextMock })
    const bowl = await import('../../../src/lib/bowl')
    bowl.unlockBowlAudio()
    bowl.playBowl()
    bowl.playBowl()
    expect(calls.filter((call) => call === 'start').length).toBeGreaterThan(1)
  })

  it('silently handles missing audio and restricted audio graphs', async () => {
    vi.stubGlobal('window', {})
    const bowl = await import('../../../src/lib/bowl')
    expect(() => bowl.unlockBowlAudio()).not.toThrow()
    expect(() => bowl.playBowl()).not.toThrow()
    vi.resetModules()
    vi.stubGlobal('window', undefined)
    const serverBowl = await import('../../../src/lib/bowl')
    expect(() => serverBowl.playBowl()).not.toThrow()
    vi.resetModules()
    class BrokenContext { currentTime = 0; destination = {}; resume = vi.fn(); createOscillator = vi.fn(() => { throw new Error('blocked') }) }
    vi.stubGlobal('window', { AudioContext: BrokenContext })
    const broken = await import('../../../src/lib/bowl')
    expect(() => broken.unlockBowlAudio()).not.toThrow()
    expect(() => broken.playBowl()).not.toThrow()
    vi.resetModules()
    class ThrowingContext {
      currentTime = 0; destination = {}
      resume = vi.fn()
      createOscillator = vi.fn(() => ({ connect: () => { throw new Error('blocked') } }))
      createGain = vi.fn(() => ({ gain: {}, connect: () => ({}) }))
    }
    vi.stubGlobal('window', { AudioContext: ThrowingContext })
    vi.stubGlobal('performance', undefined)
    const throwing = await import('../../../src/lib/bowl')
    expect(() => throwing.playBowl()).not.toThrow()
  })

  it('requests playback mode, tolerates audio-session and resume failures, and allows forced strikes', async () => {
    const audioSession = { type: 'ambient' }; vi.stubGlobal('navigator', { audioSession })
    let starts = 0
    class AudioContextMock {
      currentTime = 0; destination = {}; sampleRate = 1000
      resume = vi.fn(() => Promise.reject(new Error('denied')))
      createOscillator = vi.fn(() => ({ frequency: { setValueAtTime: vi.fn() }, connect: (x: unknown) => x, start: () => { starts++ }, stop: vi.fn(), type: '' }))
      createGain = vi.fn(() => ({ gain: { value: 0, setValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() }, connect: (x: unknown) => x }))
      createBuffer = vi.fn(() => ({ getChannelData: () => new Float32Array(90) }))
      createBufferSource = vi.fn(() => ({ connect: (x: unknown) => x, start: () => { starts++ }, stop: vi.fn(), buffer: null }))
      createBiquadFilter = vi.fn(() => ({ frequency: { setValueAtTime: vi.fn() }, connect: (x: unknown) => x, type: '' }))
    }
    vi.stubGlobal('window', { AudioContext: AudioContextMock }); const bowl = await import('../../../src/lib/bowl'); bowl.unlockBowlAudio(); await Promise.resolve(); bowl.playBowl(); const once = starts; bowl.playBowl(); expect(starts).toBe(once); bowl.playBowl(true); expect(starts).toBeGreaterThan(once); expect(audioSession.type).toBe('playback')
    vi.resetModules(); const rejecting = {}; Object.defineProperty(rejecting, 'type', { set() { throw new Error('blocked') } }); vi.stubGlobal('navigator', { audioSession: rejecting }); class SyncResumeContext extends AudioContextMock { resume = vi.fn(() => { throw new Error('blocked') }) }; vi.stubGlobal('window', { AudioContext: SyncResumeContext }); const restricted = await import('../../../src/lib/bowl'); expect(() => restricted.unlockBowlAudio()).not.toThrow()
    vi.resetModules(); vi.stubGlobal('navigator', undefined); vi.stubGlobal('window', {}); const noNavigator = await import('../../../src/lib/bowl'); expect(() => noNavigator.playBowl()).not.toThrow()
  })
})
