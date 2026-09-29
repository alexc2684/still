import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import CircleMembers from '@/components/CircleMembers'
import AddSitParticipant from '@/components/AddSitParticipant'
import Circle from '@/components/Circle'
import SharedSit from '@/components/SharedSit'
const members = [{ userId: 'host', name: 'Host' }, { userId: 'friend', name: 'Friend', avatarKey: null }]
const response = (body: unknown, status = 200) => Response.json(body, { status })
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); localStorage.clear() })
it('expands and collapses the Circle count to show its members', async () => {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => response(url === '/api/feed' ? { feed: [], memberCount: 2 } : { members })))
  render(<Circle signedIn onSignIn={vi.fn()} />)
  const toggle = await screen.findByRole('button', { name: '2 people in your circle' })
  expect(toggle).toHaveAttribute('aria-expanded', 'false'); fireEvent.click(toggle)
  await screen.findByRole('list', { name: 'People in your circle' }); expect(screen.getByText('Friend')).toBeInTheDocument()
  fireEvent.click(toggle); expect(screen.queryByRole('list')).not.toBeInTheDocument()
})
it('retries member loading, excludes existing participants, and disables selection during saving', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(response({}, 500)).mockResolvedValueOnce(response({ members })))
  const choose = vi.fn(); const view = render(<CircleMembers excludeIds={['host']} onSelect={choose} disabled />)
  await screen.findByRole('alert'); fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
  const friend = await screen.findByRole('button', { name: /Friend/ }); expect(friend).toBeDisabled(); expect(screen.queryByText('Host')).not.toBeInTheDocument()
  view.rerender(<CircleMembers excludeIds={['host']} onSelect={choose} />)
  fireEvent.click(friend); expect(choose).toHaveBeenCalledWith(members[1])
  view.rerender(<CircleMembers excludeIds={['host', 'friend']} />); expect(screen.getByText('No more people to show.')).toBeInTheDocument()
})
it.each([false, true])('ignores late member requests after closing the list', async reject => {
  let done!: (v: any) => void
  vi.stubGlobal('fetch', vi.fn(() => new Promise((resolve, fail) => { done = reject ? fail : resolve })))
  const view = render(<CircleMembers />); view.unmount()
  await act(async () => done(reject ? new Error('offline') : response({ members })))
  expect(screen.queryByRole('alert')).not.toBeInTheDocument()
})
it('adds a person once, reports success, refreshes the sit and can close the picker', async () => {
  const refresh = vi.fn().mockResolvedValue(undefined)
  const fetcher = vi.fn(async (url: string) => response(url === '/api/circle/members' ? { members } : { member: members[1] }, url === '/api/circle/members' ? 200 : 201)); vi.stubGlobal('fetch', fetcher)
  render(<AddSitParticipant sitKey="room" memberIds={['host']} onAdded={refresh} />)
  fireEvent.click(screen.getByRole('button', { name: 'Add participant' }))
  fireEvent.click(await screen.findByRole('button', { name: /Friend/ }))
  await screen.findByText('Friend was added to the sit.')
  expect(refresh).toHaveBeenCalledTimes(1); expect(screen.queryByRole('button', { name: /Friend/ })).not.toBeInTheDocument()
  expect(fetcher).toHaveBeenCalledWith('/api/shared-sits/room/participants', expect.objectContaining({ method: 'POST', body: JSON.stringify({ userId: 'friend' }) }))
  fireEvent.click(screen.getByRole('button', { name: 'Close participant list' })); expect(screen.queryByRole('list')).not.toBeInTheDocument()
})
it('allows retry after server or network errors without hiding the selected person', async () => {
  let count = 0
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (url === '/api/circle/members') return response({ members })
    count++; if (count === 3) throw 'offline'
    return response(count === 1 ? { error: 'This sit is full' } : {}, 409)
  }))
  const refresh = vi.fn(); render(<AddSitParticipant sitKey="room" memberIds={['host']} onAdded={refresh} />)
  fireEvent.click(screen.getByRole('button', { name: 'Add participant' }))
  fireEvent.click(await screen.findByRole('button', { name: /Friend/ })); await screen.findByText('This sit is full')
  fireEvent.click(screen.getByRole('button', { name: /Friend/ })); await screen.findByText('Unable to add participant.')
  await waitFor(() => expect(screen.getByRole('button', { name: /Friend/ })).not.toBeDisabled())
  fireEvent.click(screen.getByRole('button', { name: /Friend/ })); await waitFor(() => expect(count).toBe(3))
  expect(refresh).not.toHaveBeenCalled()
})
it('lets hosts add someone from a completed Circle post', async () => {
  const post = { id: 'p', userId: 'host', authorName: 'Host', sharedSitId: 'room', canAddParticipants: true, participants: [members[0]], completedAt: new Date().toISOString(), elapsedSeconds: 600, kudos: 0, comments: 0 }
  const fetcher = vi.fn(async (url: string) => response(url === '/api/feed' ? { feed: [post], memberCount: 2 } : url === '/api/circle/members' ? { members } : {})); vi.stubGlobal('fetch', fetcher)
  render(<Circle signedIn userId="host" onSignIn={vi.fn()} />)
  fireEvent.click(await screen.findByRole('button', { name: 'Add participant' }))
  fireEvent.click(await screen.findByRole('button', { name: /Friend/ }))
  await waitFor(() => expect(fetcher.mock.calls.filter(([url]) => url === '/api/feed')).toHaveLength(2))
})
it('adds a participant from the completed Together screen and reloads its membership', async () => {
  const room = { id: 'room', inviteToken: 'abc', status: 'completed', plannedSeconds: 600, hostUserId: 'host', members: [members[0]] }
  const fetcher = vi.fn(async (url: string) => response(url === '/api/circle/members' ? { members } : url.endsWith('/participants') ? {} : { room })); vi.stubGlobal('fetch', fetcher)
  render(<SharedSit user={{ id: 'host', name: 'Host' }} initialToken="abc" onSignIn={vi.fn()} />)
  fireEvent.click(await screen.findByRole('button', { name: 'Add participant' }))
  fireEvent.click(await screen.findByRole('button', { name: /Friend/ }))
  await waitFor(() => expect(fetcher.mock.calls.filter(([url]) => url === '/api/shared-sits/abc')).toHaveLength(2))
})
it('keeps participant controls usable when a feed snapshot omits its participant list', async () => {
  const post = { id: 'p', userId: 'host', authorName: 'Host', sharedSitId: 'room', canAddParticipants: true, completedAt: new Date().toISOString(), elapsedSeconds: 600, kudos: 0, comments: 0 }
  vi.stubGlobal('fetch', vi.fn(async (url: string) => response(url === '/api/feed' ? { feed: [post], memberCount: 2 } : { members })))
  render(<Circle signedIn userId="host" onSignIn={vi.fn()} />)
  fireEvent.click(await screen.findByRole('button', { name: 'Add participant' }))
  expect(await screen.findByRole('button', { name: /Friend/ })).toBeEnabled()
})
it('does not load or display Circle membership for an anonymous visitor', () => {
  const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher)
  render(<Circle signedIn={false} onSignIn={vi.fn()} />)
  expect(screen.getByText('Find your circle')).toBeInTheDocument()
  expect(screen.queryByRole('list', { name: 'People in your circle' })).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: /people in your circle/ })).not.toBeInTheDocument()
  expect(fetcher).not.toHaveBeenCalled()
})
