import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import Circle from '../../../src/components/Circle'

const response = (value: unknown, ok = true) => ({ ok, status: ok ? 200 : 500, json: async () => value })
const basePost = {
  id: 'p1', userId: 'u1', authorName: 'Ada', completedAt: new Date().toISOString(),
  elapsedSeconds: 60, sessionName: 'Quiet sit', kudos: 2, comments: 1,
  viewerHasKudosed: false, achievements: [],
}

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })

describe('Circle final coverage', () => {
  it('uses an empty feed when the feed property is absent and handles a primitive feed rejection', async () => {
    const fetch = vi.fn().mockResolvedValueOnce(response({})).mockRejectedValueOnce('offline')
    vi.stubGlobal('fetch', fetch)
    render(<Circle signedIn onSignIn={vi.fn()} />)
    await waitFor(() => expect(screen.getByText('Your circle is quiet')).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: 'Refresh feed' }))
    await waitFor(() => expect(screen.getByText('Couldn’t load the circle')).toBeInTheDocument())
  })

  it('updates only the clicked kudos and handles an un-kudos response and primitive failure', async () => {
    const first = { ...basePost }
    const second = { ...basePost, id: 'p2', kudos: 4, viewerHasKudosed: true }
    const fetch = vi.fn(async (url: string) => {
      if (url === '/api/feed') return response({ feed: [first, second] })
      if (url.endsWith('/p1/kudos')) return response({ kudosed: false })
      throw 'kudos offline'
    })
    vi.stubGlobal('fetch', fetch)
    const user = userEvent.setup()
    render(<Circle signedIn onSignIn={vi.fn()} />)
    await waitFor(() => expect(screen.getAllByText('Kudos')).toHaveLength(2))
    const buttons = screen.getAllByRole('button', { name: /kudos/i })
    await user.click(buttons[0])
    await waitFor(() => expect(screen.getAllByRole('button', { name: /kudos/i })[0]).toHaveTextContent('1'))
    expect(screen.getAllByRole('button', { name: /kudos/i })[1]).toHaveTextContent('4')
  })

  it('guards a second kudos request while the first request is pending', async () => {
    let resolve: ((value: unknown) => void) | undefined
    const fetch = vi.fn((url: string) => url === '/api/feed'
      ? Promise.resolve(response({ feed: [basePost] }))
      : new Promise(r => { resolve = r }))
    vi.stubGlobal('fetch', fetch)
    render(<Circle signedIn onSignIn={vi.fn()} />)
    await waitFor(() => expect(screen.getByRole('button', { name: /give kudos/i })).toBeInTheDocument())
    const button = screen.getByRole('button', { name: /give kudos/i }); fireEvent.click(button); expect(button).toBeDisabled()
    expect(fetch.mock.calls.filter(([url]) => String(url).endsWith('/kudos'))).toHaveLength(1)
    resolve?.(response({ kudosed: true })); await waitFor(() => expect(screen.getByRole('button', { name: /remove kudos/i })).toBeInTheDocument())
  })

  it('covers primitive kudos rejection directly', async () => {
    const fetch = vi.fn(async (url: string) => url === '/api/feed' ? response({ feed: [basePost] }) : Promise.reject('offline'))
    vi.stubGlobal('fetch', fetch)
    const user = userEvent.setup()
    render(<Circle signedIn onSignIn={vi.fn()} />)
    await waitFor(() => expect(screen.getByRole('button', { name: /give kudos/i })).toBeInTheDocument())
    await user.click(screen.getByRole('button', { name: /give kudos/i }))
    await waitFor(() => expect(screen.getByText('Could not update kudos')).toBeInTheDocument())
  })

  it('falls back for undefined comments, caches them on reopen, and handles primitive load failure', async () => {
    const fetch = vi.fn(async (url: string) => {
      if (url === '/api/feed') return response({ feed: [basePost] })
      if (url.endsWith('/p1/comments')) return response({ comments: undefined })
      throw 'unexpected'
    })
    vi.stubGlobal('fetch', fetch)
    const user = userEvent.setup()
    render(<Circle signedIn onSignIn={vi.fn()} />)
    await waitFor(() => expect(screen.getByRole('button', { name: /1 comments/i })).toBeInTheDocument())
    const comments = screen.getByRole('button', { name: /1 comments/i })
    await user.click(comments); await waitFor(() => expect(screen.getByRole('textbox', { name: 'Comment' })).toBeInTheDocument())
    await user.click(comments); await user.click(comments)
    expect(fetch.mock.calls.filter(([url]) => url.endsWith('/p1/comments')).length).toBe(1)

    const failing = vi.fn(async (url: string) => url === '/api/feed' ? response({ feed: [basePost] }) : Promise.reject('comments offline'))
    vi.stubGlobal('fetch', failing)
    render(<Circle signedIn onSignIn={vi.fn()} />)
    await waitFor(() => expect(screen.getAllByRole('button', { name: /1 comments/i }).length).toBeGreaterThan(0))
    await user.click(screen.getAllByRole('button', { name: /1 comments/i }).at(-1)!)
    await waitFor(() => expect(screen.getByText('Could not load comments')).toBeInTheDocument())
  })

  it('adds a comment while comments are loading, preserves other posts, validates long input, and handles primitive failure', async () => {
    const deferred: { resolve?: (value: unknown) => void } = {}
    const first = { ...basePost }
    const second = { ...basePost, id: 'p2', comments: 0 }
    const fetch = vi.fn((url: string, init?: RequestInit) => {
      if (url === '/api/feed') return Promise.resolve(response({ feed: [first, second] }))
      if (url.endsWith('/p1/comments') && !init?.method) return new Promise(resolve => { deferred.resolve = resolve })
      if (url.endsWith('/p1/comments') && init?.method === 'POST') return Promise.resolve(response({ comment: { id: 'c2', userId: 'u1', name: 'Ada', body: 'hello', createdAt: new Date().toISOString() } }))
      return Promise.resolve(response({}))
    })
    vi.stubGlobal('fetch', fetch)
    const user = userEvent.setup()
    render(<Circle signedIn onSignIn={vi.fn()} userId="u1" />)
    await waitFor(() => expect(screen.getAllByRole('button', { name: /comments/i })).toHaveLength(2))
    await user.click(screen.getAllByRole('button', { name: /comments/i })[0])
    const input = screen.getAllByRole('textbox', { name: 'Comment' })[0]
    await user.type(input, 'hello'); await user.click(screen.getAllByRole('button', { name: 'Post comment' })[0])
    await waitFor(() => expect(screen.getByText('hello')).toBeInTheDocument())
    deferred.resolve?.(response({ comments: [] }))

    const failing = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === '/api/feed') return response({ feed: [basePost] })
      if (init?.method === 'POST') throw 'post offline'
      return response({ comments: [] })
    })
    vi.stubGlobal('fetch', failing)
    render(<Circle signedIn onSignIn={vi.fn()} />)
    await waitFor(() => expect(screen.getAllByRole('button', { name: /1 comments/i }).length).toBeGreaterThan(0))
    await user.click(screen.getAllByRole('button', { name: /1 comments/i }).at(-1)!)
    const secondInput = screen.getAllByRole('textbox', { name: 'Comment' }).at(-1)!; await user.type(secondInput, 'x'); await user.click(screen.getAllByRole('button', { name: 'Post comment' }).at(-1)!)
    await waitFor(() => expect(screen.getAllByText('Could not add comment').length).toBeGreaterThan(0))
  })

  it('rejects an oversized autofill value through the public input events', async () => {
    const comment = { id: 'c1', userId: 'u1', name: 'Ada', body: 'existing', createdAt: new Date().toISOString() }
    const fetch = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === '/api/feed') return response({ feed: [{ ...basePost, comments: 1 }] })
      if (url.endsWith('/comments') && !init?.method) return response({ comments: [comment] })
      if (init?.method === 'POST') return response({ comment: { ...comment, id: 'new' } })
      return response({})
    })
    vi.stubGlobal('fetch', fetch)
    const user = userEvent.setup(); render(<Circle signedIn onSignIn={vi.fn()} userId="u1" />)
    await waitFor(() => expect(screen.getByRole('button', { name: /1 comments/i })).toBeInTheDocument())
    await user.click(screen.getByRole('button', { name: /1 comments/i })); await waitFor(() => expect(screen.getByText('existing')).toBeInTheDocument())
    const input = screen.getByRole('textbox', { name: 'Comment' }); input.removeAttribute('maxlength'); await user.click(input); await user.paste('x'.repeat(501))
    await waitFor(() => expect(input).toHaveValue('x'.repeat(501))); expect(screen.getByRole('button', { name: 'Post comment' })).not.toBeDisabled(); await user.click(screen.getByRole('button', { name: 'Post comment' }))
    expect(fetch.mock.calls.filter(([, init]) => (init as RequestInit | undefined)?.method === 'POST')).toHaveLength(0); expect(screen.getByText('existing')).toBeInTheDocument()
  })

  it('deletes two comments while preserving the other comment and post, then reports primitive failure', async () => {
    const comments = [
      { id: 'c1', userId: 'u1', name: 'Ada', body: 'one', createdAt: new Date().toISOString() },
      { id: 'c2', userId: 'u1', name: 'Ada', body: 'two', createdAt: new Date().toISOString() },
    ]
    const posts = [basePost, { ...basePost, id: 'p2', comments: 1 }]
    const fetch = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === '/api/feed') return response({ feed: posts })
      if (url.endsWith('/comments') && !init?.method) return response({ comments: url.includes('p1') ? comments : [comments[0]] })
      if (init?.method === 'DELETE') return response({})
      return response({})
    })
    vi.stubGlobal('fetch', fetch)
    const user = userEvent.setup(); render(<Circle signedIn onSignIn={vi.fn()} userId="u1" />)
    await waitFor(() => expect(screen.getAllByRole('button', { name: /comments/i })).toHaveLength(2))
    await user.click(screen.getAllByRole('button', { name: /1 comments/i })[0]); await waitFor(() => expect(screen.getByText('one')).toBeInTheDocument())
    await user.click(screen.getAllByRole('button', { name: 'Delete comment' })[0]); await waitFor(() => expect(screen.getByText('two')).toBeInTheDocument())
    await user.click(screen.getByRole('button', { name: 'Delete comment' })); await waitFor(() => expect(screen.queryByText('two')).not.toBeInTheDocument())
    const failing = vi.fn(async (url: string, init?: RequestInit) => { if (url === '/api/feed') return response({ feed: [basePost] }); if (init?.method === 'DELETE') throw 'delete offline'; return response({ comments }) })
    vi.stubGlobal('fetch', failing); render(<Circle signedIn onSignIn={vi.fn()} userId="u1" />); await waitFor(() => expect(screen.getAllByRole('button', { name: /1 comments/i }).length).toBeGreaterThan(0)); await user.click(screen.getAllByRole('button', { name: /1 comments/i }).at(-1)!); await waitFor(() => expect(screen.getAllByText('one').length).toBeGreaterThan(0)); await user.click(screen.getAllByRole('button', { name: 'Delete comment' }).at(-1)!); await waitFor(() => expect(screen.getAllByText('Could not delete comment').length).toBeGreaterThan(0))
  })

  it('guards duplicate comment submissions and deletions while pending', async () => {
    let resolvePost: ((value: unknown) => void) | undefined; let resolveDelete: ((value: unknown) => void) | undefined
    const comment = { id: 'c1', userId: 'u1', name: 'Ada', body: 'one', createdAt: new Date().toISOString() }
    const fetch = vi.fn((url: string, init?: RequestInit) => {
      if (url === '/api/feed') return Promise.resolve(response({ feed: [basePost] }))
      if (url.endsWith('/comments') && !init?.method) return Promise.resolve(response({ comments: [comment] }))
      if (init?.method === 'POST') return new Promise(r => { resolvePost = r })
      if (init?.method === 'DELETE') return new Promise(r => { resolveDelete = r })
      return Promise.resolve(response({}))
    })
    vi.stubGlobal('fetch', fetch); const user = userEvent.setup(); render(<Circle signedIn onSignIn={vi.fn()} userId="u1" />)
    await waitFor(() => expect(screen.getByRole('button', { name: /1 comments/i })).toBeInTheDocument()); await user.click(screen.getByRole('button', { name: /1 comments/i })); await waitFor(() => expect(screen.getByText('one')).toBeInTheDocument())
    const del = screen.getByRole('button', { name: 'Delete comment' }); fireEvent.click(del); expect(del).toBeDisabled(); expect(fetch.mock.calls.filter(([, init]) => (init as RequestInit | undefined)?.method === 'DELETE')).toHaveLength(1); resolveDelete?.(response({}));
    const input = screen.getByRole('textbox', { name: 'Comment' }); await user.type(input, 'new'); const postButton = screen.getByRole('button', { name: 'Post comment' }); fireEvent.click(postButton); expect(postButton).toBeDisabled(); expect(fetch.mock.calls.filter(([, init]) => (init as RequestInit | undefined)?.method === 'POST')).toHaveLength(1); resolvePost?.(response({ comment }));
  })

  it('renders optional session and participant fields with no achievements', async () => {
    const shared = { ...basePost, id: 'shared', sessionName: null, sharedSitId: 'sit', participantCount: undefined, participants: undefined }
    const fallback = { ...basePost, id: 'fallback', elapsedSeconds: 120, sessionName: null, sharedSitId: null, participants: [{ userId: 'u2', name: 'Bea' }], achievements: [] }
    vi.stubGlobal('fetch', vi.fn(async (url: string) => url === '/api/feed' ? response({ feed: [shared, fallback] }) : response({ comments: [] })))
    render(<Circle signedIn onSignIn={vi.fn()} />)
    await waitFor(() => expect(screen.getByLabelText('0 participants')).toBeInTheDocument())
    expect(screen.getByText('Sat together')).toBeInTheDocument(); expect(screen.getAllByText((_, element) => element?.textContent?.includes('1 minute') ?? false).length).toBeGreaterThan(0)
    expect(screen.queryByLabelText('Achievements')).not.toBeInTheDocument()
  })
})
