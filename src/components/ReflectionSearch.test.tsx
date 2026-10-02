import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import ReflectionSearch from './ReflectionSearch'
const result = { id: 'one', date: '2026-09-15', seconds: 600, afterNote: '<script>sleep</script>' }
const response = (results = [result], hasMore = false) => ({ ok: true, json: async () => ({ results, hasMore }) })
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })
function submit(value = 'sleep') {
  fireEvent.change(screen.getByRole('searchbox'), { target: { value } })
  fireEvent.submit(screen.getByRole('search'))
}
it('searches private history with POST, renders text safely and clears results', async () => {
  const fetch = vi.fn().mockResolvedValue(response()); vi.stubGlobal('fetch', fetch)
  render(<ReflectionSearch />)
  expect(screen.getByRole('button', { name: 'Search' })).toBeDisabled()
  submit(' sleep ')
  await screen.findByText('<script>sleep</script>')
  expect(document.querySelector('script')).toBeNull()
  expect(screen.getByText('September 15, 2026')).toBeInTheDocument()
  expect(screen.getByText('10 minutes practiced')).toBeInTheDocument()
  expect(fetch).toHaveBeenCalledWith('/api/journal/search', expect.objectContaining({ method: 'POST', body: '{"query":"sleep"}', cache: 'no-store' }))
  expect(screen.getByRole('status')).toHaveTextContent('1 matching reflections')
  fireEvent.click(screen.getByRole('button', { name: 'Clear' }))
  expect(screen.getByRole('searchbox')).toHaveValue(''); expect(screen.queryByText('<script>sleep</script>')).toBeNull()
})
it('explains empty and capped results', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(response([])).mockResolvedValueOnce(response([result], true)))
  render(<ReflectionSearch />); submit(); await screen.findByText(/No reflections found/)
  submit('calm'); await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Showing the 50 most recent matches'))
})
it('supports retry after network, HTTP, and malformed response failures', async () => {
  vi.stubGlobal('fetch', vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce({ ok: false }).mockResolvedValueOnce({ ok: true, json: async () => { throw new Error('invalid json') } }).mockResolvedValue(response()))
  render(<ReflectionSearch />)
  for (let i = 0; i < 3; i++) { submit(); await screen.findByRole('alert'); expect(screen.getByRole('button', { name: 'Search' })).toBeEnabled() }
  submit(); await screen.findByText('<script>sleep</script>'); expect(screen.queryByRole('alert')).toBeNull()
})
it.each([false, true])('ignores a cleared in-flight response (rejection: %s)', async reject => {
  let resolve!: (value: unknown) => void; let fail!: (reason: Error) => void
  vi.stubGlobal('fetch', vi.fn(() => new Promise((r, j) => { resolve = r; fail = j })))
  render(<ReflectionSearch />); submit()
  expect(screen.getByRole('status')).toHaveTextContent('Searching')
  fireEvent.click(screen.getByRole('button', { name: 'Clear' }))
  await act(async () => { if (reject) fail(new Error('offline')); else resolve(response()) })
  expect(screen.queryByText('<script>sleep</script>')).toBeNull(); expect(screen.queryByRole('alert')).toBeNull()
  expect(screen.getByRole('status')).toBeEmptyDOMElement()
})
it('ignores results after unmount', async () => {
  let resolve!: (value: unknown) => void
  vi.stubGlobal('fetch', vi.fn(() => new Promise(r => { resolve = r })))
  const view = render(<ReflectionSearch />); submit(); view.unmount()
  await act(async () => resolve(response()))
})
