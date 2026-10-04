import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import Journal from '../../../src/components/Journal'
import Circle from '../../../src/components/Circle'

const response = (value: unknown, ok = true, status = ok ? 200 : 500) => ({ ok, status, json: async () => {
  const body = value as any
  return { date: '2026-09-20', summary: { totalSessions: body.sessions?.filter((s: any) => s.completedAt).length ?? 0, totalMinutes: Math.round((body.sessions ?? []).reduce((n: number, s: any) => n + (s.elapsedSeconds || s.plannedSeconds), 0) / 60) }, ...body }
} })
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })

describe('Journal', () => {
  const session = { id: 's1', startedAt: '2026-09-20T10:00:00Z', completedAt: '2026-09-20T10:20:00Z', plannedSeconds: 1200, elapsedSeconds: 1200, beforeMood: 2, afterMood: 4, afterNote: 'Felt clear' }
  function mockJournal(ok = true) {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.startsWith('/api/sessions?')) return response(ok ? { sessions: [session], practiceDates: ['2026-09-20', '2026-09-19'] } : {}, ok)
      if (url === '/api/auth/me') return response({ user: { timezone: 'UTC' } })
      if (url.includes('/reflection')) return response({})
      return response({})
    }))
  }
  it('shows calendar and streak, navigates months, edits moods/notes, and deletes after confirmation', async () => {
    mockJournal(); const user = userEvent.setup(); const changed = vi.fn(); vi.stubGlobal('confirm', vi.fn(() => true))
    render(<Journal onChanged={changed} />)
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Journal' })).toBeInTheDocument())
    expect(screen.getByText('1', { selector: '.journal-summary strong' })).toBeInTheDocument()
    expect(screen.getByText('20', { selector: '.journal-summary strong' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Previous month' })); await user.click(screen.getByRole('button', { name: 'Next month' }))
    await user.click(screen.getByRole('button', { name: /edit reflection/i }))
    await user.click(screen.getAllByRole('button', { name: '5 of 5' })[2])
    const notes = screen.getByRole('textbox', { name: 'Notes' }); await user.clear(notes); await user.type(notes, 'New note')
    await user.click(screen.getByRole('button', { name: 'Save reflection' }))
    await waitFor(() => expect(changed).toHaveBeenCalled())
    await user.click(screen.getByRole('button', { name: /delete session/i }))
    await waitFor(() => expect(vi.mocked(fetch)).toHaveBeenCalledWith('/api/sessions/s1', expect.objectContaining({ method: 'DELETE' })))
  })
  it('renders signed-out and load-error outcomes', async () => {
    const signIn = vi.fn(); render(<Journal signedIn={false} onSignIn={signIn} />)
    await userEvent.setup().click(screen.getByRole('button', { name: /sign in to still/i })); expect(signIn).toHaveBeenCalled()
    mockJournal(false); render(<Journal />)
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Unable to load your journal.'))
  })

  it('handles unauthorized loading, canceled deletes, save failures, and empty completed history', async () => {
    const user = userEvent.setup(); const signIn = vi.fn()
    vi.stubGlobal('fetch', vi.fn(async (url: string) => url.startsWith('/api/sessions?') ? response({}, true, 401) : response({ user: { timezone: 'UTC' } })))
    render(<Journal onSignIn={signIn} />); await waitFor(() => expect(screen.getByText('Keep your practice close.')).toBeInTheDocument()); await user.click(screen.getByRole('button', { name: /sign in to still/i })); expect(signIn).toHaveBeenCalled()
    const completed = { ...session, beforeMood: null, duringMood: null, afterMood: null, beforeNote: null, duringNote: null, afterNote: null }
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      if (url.startsWith('/api/sessions?')) return response({ sessions: [completed], practiceDates: [] })
      if (url === '/api/auth/me') return response({ user: { timezone: 'UTC' } })
      if (url.includes('/reflection')) return response({ error: 'Reflection rejected' }, false)
      if (init?.method === 'DELETE') return response({}, false)
      return response({})
    }))
    vi.stubGlobal('confirm', vi.fn(() => false)); render(<Journal />); await waitFor(() => expect(screen.getByRole('button', { name: /add reflection/i })).toBeInTheDocument())
    await user.click(screen.getByRole('button', { name: /add reflection/i })); await user.click(screen.getByRole('button', { name: 'Cancel' })); await user.click(screen.getByRole('button', { name: /delete session/i })); expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    vi.mocked(confirm).mockReturnValue(true); await user.click(screen.getByRole('button', { name: /delete session/i })); await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Unable to delete that session.'))
    await user.click(screen.getByRole('button', { name: /add reflection/i })); await user.click(screen.getByRole('button', { name: 'Save reflection' })); await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Reflection rejected'))
  })

  it('renders an empty journal when no sessions have completed', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => url.startsWith('/api/sessions?') ? response({ sessions: [{ ...session, completedAt: null }], practiceDates: [] }) : response({ user: { timezone: 'UTC' } })))
    render(<Journal />); await waitFor(() => expect(screen.getByText('No practice recorded for this day.')).toBeInTheDocument())
  })

  it('uses response fallbacks for malformed reflection JSON and optional session fields', async () => {
    const user = userEvent.setup(); const fallback = { ...session, completedAt: '2026-09-20T10:20:00Z', elapsedSeconds: null, beforeMood: null, duringMood: null, afterMood: null, beforeNote: null, duringNote: null, afterNote: null }
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.startsWith('/api/sessions?')) return response({ sessions: [fallback], practiceDates: [] })
      if (url === '/api/auth/me') return response({}, false)
      return { ok: false, json: async () => { throw new Error('bad json') } }
    }))
    render(<Journal />); await waitFor(() => expect(screen.getByRole('button', { name: /add reflection/i })).toBeInTheDocument())
    await user.click(screen.getByRole('button', { name: /add reflection/i })); await user.click(screen.getByRole('button', { name: 'Save reflection' })); await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Unable to save reflection.'))
  })

  it('accepts a successful reflection whose response JSON is malformed', async () => {
    const user = userEvent.setup(); const item = { ...session, beforeMood: null, duringMood: null, afterMood: null, beforeNote: null, duringNote: null, afterNote: null }
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      if (url.startsWith('/api/sessions?')) return response({ sessions: [item], practiceDates: [] })
      if (url === '/api/auth/me') return response({ user: { timezone: 'UTC' } })
      if (init?.method === 'PATCH') return { ok: true, json: async () => { throw new Error('bad json') } }
      return response({})
    }))
    render(<Journal />); await waitFor(() => expect(screen.getByRole('button', { name: /add reflection/i })).toBeInTheDocument()); await user.click(screen.getByRole('button', { name: /add reflection/i })); await user.click(screen.getByRole('button', { name: 'Save reflection' })); await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument())
  })

  it('accepts missing optional load fields and leaves unrelated entries unchanged', async () => {
    const user = userEvent.setup(); const first = { ...session, beforeMood: null, duringMood: null, afterMood: null, beforeNote: null, duringNote: null, afterNote: null }; const second = { ...first, id: 's2' }
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      if (url.startsWith('/api/sessions?')) return response({ sessions: [first, second] })
      if (url === '/api/auth/me') return response({}, false)
      if (init?.method === 'PATCH') return response({})
      return response({})
    }))
    render(<Journal />); await waitFor(() => expect(screen.getAllByRole('button', { name: /add reflection/i })).toHaveLength(2)); await user.click(screen.getAllByRole('button', { name: /add reflection/i })[0]); await user.click(screen.getByRole('button', { name: 'Save reflection' })); await waitFor(() => expect(screen.getAllByText('Add reflection')).toHaveLength(2))
  })

  it('covers current-day streaks and non-Error load/update failures', async () => {
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'UTC' }).format(new Date()); const user = userEvent.setup()
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      if (url.startsWith('/api/sessions?')) return response({ sessions: [{ ...session, beforeMood: null, duringMood: null, afterMood: null, beforeNote: null, duringNote: null, afterNote: null }], practiceDates: [today] })
      if (url === '/api/auth/me') return response({}, false)
      if (init?.method === 'PATCH') throw 'offline'
      return response({})
    }))
    render(<Journal />); await waitFor(() => expect(screen.getAllByText('1', { selector: '.journal-summary strong' }).length).toBeGreaterThan(0)); await user.click(screen.getByRole('button', { name: /add reflection/i })); await user.click(screen.getByRole('button', { name: 'Save reflection' })); await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Unable to save reflection.'))
  })

  it('handles a missing session payload and non-Error load rejection', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => { if (url.startsWith('/api/sessions?')) return response({}); throw 'offline' }))
    render(<Journal />); await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Unable to load your journal.'))
  })

  it('falls back when session arrays and profile timezone are null', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => url.startsWith('/api/sessions?') ? response({ sessions: null, practiceDates: null }) : response({ user: { timezone: '' } })))
    render(<Journal />); await waitFor(() => expect(screen.getByText('No practice recorded for this day.')).toBeInTheDocument())
  })
})

describe('Circle', () => {
  const post = { id: 'p1', userId: 'u1', authorName: 'Ada', completedAt: new Date().toISOString(), elapsedSeconds: 60, sessionName: 'Quiet sit', kudos: 2, comments: 1, viewerHasKudosed: false, achievements: [{ kind: 'first_session', label: 'First sit' }] }
  it('loads achievements, toggles kudos, comments, and deletes own comments', async () => {
    const user = userEvent.setup(); const calls: string[] = []
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      calls.push(`${init?.method ?? 'GET'} ${url}`)
      if (url === '/api/feed') return response({ feed: [post] })
      if (url.endsWith('/kudos')) return response({ kudosed: true })
      if (url.endsWith('/comments') && !init?.method) return response({ comments: [{ id: 'c1', userId: 'u1', name: 'Ada', body: 'Thank you', createdAt: new Date().toISOString() }] })
      if (url.endsWith('/comments') && init?.method === 'POST') return response({ comment: { id: 'c2', userId: 'u1', name: 'Ada', body: 'Nice', createdAt: new Date().toISOString() } })
      if (url === '/api/comments/c1') return response({})
      return response({})
    }))
    render(<Circle signedIn onSignIn={vi.fn()} userId="u1" />)
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Circle' })).toBeInTheDocument())
    expect(screen.getByText('First sit')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /give kudos/i })); await waitFor(() => expect(screen.getByRole('button', { name: /remove kudos/i })).toBeInTheDocument())
    await user.click(screen.getByRole('button', { name: /1 comments/i })); await waitFor(() => expect(screen.getByText('Thank you')).toBeInTheDocument())
    await user.click(screen.getByRole('button', { name: /1 comments/i })); await user.click(screen.getByRole('button', { name: /1 comments/i })); await waitFor(() => expect(screen.getByText('Thank you')).toBeInTheDocument())
    await user.click(screen.getByRole('button', { name: 'Delete comment' })); await waitFor(() => expect(screen.queryByText('Thank you')).not.toBeInTheDocument())
    const input = screen.getByRole('textbox', { name: 'Comment' }); await user.type(input, 'Nice'); await user.click(screen.getByRole('button', { name: 'Post comment' }))
    await waitFor(() => expect(screen.getByText('Nice')).toBeInTheDocument()); expect(calls.some(call => call.includes('POST /api/sessions/p1/comments'))).toBe(true)
  })
  it('offers sign-in and reports feed errors', async () => {
    const signIn = vi.fn(); render(<Circle signedIn={false} onSignIn={signIn} />); await userEvent.setup().click(screen.getByRole('button', { name: /sign in/i })); expect(signIn).toHaveBeenCalled()
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response({}, false)))
    render(<Circle signedIn onSignIn={vi.fn()} />); await waitFor(() => expect(screen.getByText('Couldn’t load the circle')).toBeInTheDocument()); expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument()
  })

  it('shows inline failures for kudos, comment loading/posting, and deletion', async () => {
    const user = userEvent.setup(); const item = { ...post, comments: 1 }
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      if (url === '/api/feed') return response({ feed: [item] })
      if (url.endsWith('/kudos')) return response({}, false)
      if (url.endsWith('/comments') && !init?.method) return response({}, false)
      if (url.endsWith('/comments') && init?.method === 'POST') return response({}, false)
      if (url === '/api/comments/c1') return response({}, false)
      return response({})
    }))
    render(<Circle signedIn onSignIn={vi.fn()} userId="u1" />); await waitFor(() => expect(screen.getByRole('button', { name: /give kudos/i })).toBeInTheDocument())
    await user.click(screen.getByRole('button', { name: /give kudos/i })); await waitFor(() => expect(screen.getByText('Could not update kudos')).toBeInTheDocument())
    await user.click(screen.getByRole('button', { name: /1 comments/i })); await waitFor(() => expect(screen.getByText('Could not load comments')).toBeInTheDocument())
    const input = screen.getByRole('textbox', { name: 'Comment' }); await user.type(input, 'Hi'); await user.click(screen.getByRole('button', { name: 'Post comment' })); await waitFor(() => expect(screen.getByText('Could not add comment')).toBeInTheDocument())
  })

  it('handles quiet feeds, retry, cached comments, and input guards', async () => {
    const user = userEvent.setup(); let feedCalls = 0
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      if (url === '/api/feed') { feedCalls++; return feedCalls === 1 ? response({ feed: [] }) : response({}, false) }
      if (url.endsWith('/comments') && !init?.method) return response({ comments: [] })
      return response({})
    }))
    render(<Circle signedIn onSignIn={vi.fn()} />); await waitFor(() => expect(screen.getByText('Your circle is quiet')).toBeInTheDocument()); await user.click(screen.getByRole('button', { name: 'Refresh feed' })); await waitFor(() => expect(screen.getByText('Couldn’t load the circle')).toBeInTheDocument()); await user.click(screen.getByRole('button', { name: 'Try again' }))
  })

  it('renders shared participants and achievement categories, then reports refresh/delete errors', async () => {
    const user = userEvent.setup(); let feedCalls = 0
    const shared = { ...post, sharedSitId: 'room', participantCount: 2, participants: [{ userId: 'u1', name: 'Ada', achievements: [{ kind: 'goal', label: 'Goal' }, { kind: '100_hours', label: 'Hour' }, { kind: 'streak', label: 'Streak' }, { kind: 'other', label: 'Other' }] }, { userId: 'u2', name: 'Bea', achievements: [] }] }
    const variants = { ...post, id: 'p2', sessionName: null, sharedSitId: null, participants: undefined, participantCount: undefined, achievements: [{ kind: 'first', label: 'First' }, { kind: 'minutes', label: 'Minutes' }, { kind: 'streak', label: 'Days' }] }
    const noBadges = { ...post, id: 'p3', achievements: undefined, participants: [] }
    const hourPost = { ...post, id: 'p4', sessionName: 'One breath', elapsedSeconds: 60, completedAt: new Date(Date.now() - 2 * 3600000).toISOString(), sharedSitId: 'room2', participantCount: 0, participants: [{ userId: 'u3', name: 'Cy' }] }
    const dayPost = { ...post, id: 'p5', sessionName: 'Long sit', completedAt: new Date(Date.now() - 3 * 86400000).toISOString(), achievements: [] }
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      if (url === '/api/feed') { feedCalls++; return feedCalls === 1 ? response({ feed: [shared, variants, noBadges, hourPost, dayPost] }) : response({}, false) }
      if (url.endsWith('/comments') && !init?.method) return response({ comments: [{ id: 'c1', userId: 'u1', name: 'Ada', body: 'x', createdAt: new Date().toISOString() }] })
      if (url === '/api/comments/c1') return response({}, false)
      return response({})
    }))
    render(<Circle signedIn onSignIn={vi.fn()} userId="u1" />); await waitFor(() => expect(screen.getByLabelText('2 participants')).toBeInTheDocument()); expect(screen.getByText(/Ada · Goal/)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Refresh feed' })); await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Could not load the circle')); await user.click(screen.getByRole('button', { name: 'Retry' }))
    await user.click(screen.getAllByRole('button', { name: /1 comments/i })[0]); await waitFor(() => expect(screen.getByText('x')).toBeInTheDocument()); await user.click(screen.getByRole('button', { name: 'Delete comment' })); await waitFor(() => expect(screen.getByText('Could not delete comment')).toBeInTheDocument())
  })
})
