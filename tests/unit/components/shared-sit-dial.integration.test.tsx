import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import SharedSit from '@/components/SharedSit'

const fetchMock = vi.fn()
vi.stubGlobal('fetch', fetchMock)
vi.mock('@/lib/bowl', () => ({ playBowl: vi.fn(), unlockBowlAudio: vi.fn() }))
vi.mock('@/components/Avatar', () => ({ default: ({ name }: { name: string }) => <span>{name}</span> }))
vi.mock('@/components/PrivateReflection', () => ({ default: () => <div /> }))

const response = (body: unknown, ok = true) => ({ ok, json: vi.fn().mockResolvedValue(body) })
const baseRoom = (overrides: Record<string, unknown> = {}) => ({ id: 'room', inviteToken: 'token', status: 'waiting', plannedSeconds: 600, hostUserId: 'u1', isHost: true, isMember: true, participantCount: 1, ownSessionId: null, members: [{ userId: 'u1', name: 'Host', avatarKey: null }], ...overrides })

describe('SharedSit real TimerDial integration', () => {
  beforeEach(() => { fetchMock.mockReset(); localStorage.clear(); Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' }); Object.defineProperty(navigator, 'wakeLock', { configurable: true, value: { request: vi.fn().mockResolvedValue({ release: vi.fn().mockResolvedValue(undefined) }) } }) })
  afterEach(() => cleanup())

  it('renders a 600-second waiting room as 10:00', async () => {
    fetchMock.mockResolvedValueOnce(response({ room: baseRoom() }))
    render(<SharedSit user={{ id: 'u1', name: 'Host' }} onSignIn={vi.fn()} initialToken="token" />)
    await waitFor(() => expect(screen.getByText('10:00')).toBeInTheDocument())
    expect(screen.queryByText('600:00')).not.toBeInTheDocument()
  })

  it('keeps a future-start room at ten minutes after the three-second countdown', async () => {
    vi.useFakeTimers(); const start = Date.now(); fetchMock.mockResolvedValueOnce(response({ room: baseRoom({ status: 'running', startedAt: new Date(start + 3000).toISOString(), endsAt: new Date(start + 603000).toISOString() }) }))
    render(<SharedSit user={{ id: 'u1', name: 'Host' }} onSignIn={vi.fn()} initialToken="token" />); await act(async () => { await Promise.resolve() }); expect(screen.getByText('10:03')).toBeInTheDocument(); await act(async () => { vi.advanceTimersByTime(3000); await Promise.resolve() }); expect(screen.getByText('10:00')).toBeInTheDocument(); expect(fetchMock.mock.calls.some(([url]) => String(url).endsWith('/complete'))).toBe(false); vi.useRealTimers()
  })
})
