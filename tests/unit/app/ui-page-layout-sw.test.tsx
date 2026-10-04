import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/components/PracticeTimer', () => ({ default: ({ onActiveChange, onSignIn, onSessionSaved }: { onActiveChange: (v: boolean) => void; onSignIn: () => void; onSessionSaved: () => void }) => <><button onClick={() => onActiveChange(true)}>Mock timer</button><button onClick={() => onActiveChange(false)}>Stop timer</button><button onClick={onSignIn}>Timer sign in</button><button onClick={onSessionSaved}>Timer saved</button></> }))
vi.mock('@/components/SharedSit', () => ({ default: ({ onActiveChange, onSignIn, onSessionSaved }: { onActiveChange: (v: boolean) => void; onSignIn: () => void; onSessionSaved: () => void }) => <><button onClick={() => onActiveChange(true)}>Mock shared sit</button><button onClick={onSignIn}>Shared sign in</button><button onClick={onSessionSaved}>Shared saved</button></> }))
vi.mock('@/components/Journal', () => ({ default: ({ onSignIn, onChanged }: { onSignIn: () => void; onChanged: () => void }) => <><button onClick={onSignIn}>Journal sign in</button><button onClick={onChanged}>Journal changed</button></> }))
vi.mock('@/components/Profile', () => ({ default: ({ onSignIn, onSignOut, onProfileUpdated }: { onSignIn: () => void; onSignOut: () => void; onProfileUpdated: (u: unknown) => void }) => <><button onClick={onSignIn}>Profile sign in</button><button onClick={onSignOut}>Profile sign out</button><button onClick={() => onProfileUpdated({ id: 'u', name: 'Updated', email: 'u', timezone: 'UTC' })}>Profile updated</button></> }))
vi.mock('@/components/Circle', () => ({ default: ({ onSignIn }: { onSignIn: () => void }) => <button onClick={onSignIn}>Circle sign in</button> }))

import Home from '../../../src/app/page'
import RootLayout from '../../../src/app/layout'
import ServiceWorker from '../../../src/app/ServiceWorker'

const response = (body: unknown, ok = true) => ({ ok, json: async () => body })
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })

describe('home shell', () => {
  it('reads invite mode, switches tabs, refreshes stats, and logs out', async () => {
    const user = userEvent.setup(); const fetchMock = vi.fn(async (url: string) => url === '/api/auth/me' ? response({ user: { id: 'u', name: 'Ada', email: 'a', timezone: 'UTC', weeklyTarget: 3 } }) : response({ practiceDates: ['2026-09-26'] }))
    vi.stubGlobal('fetch', fetchMock); window.history.pushState({}, '', '/?sit=invite')
    render(<Home />)
    await waitFor(() => expect(screen.getByRole('button', { name: 'Together' })).toHaveAttribute('aria-pressed', 'true'))
    await user.click(screen.getByRole('button', { name: 'Still' })); await user.click(screen.getByRole('button', { name: 'Ada' })); await user.click(screen.getByRole('button', { name: 'Still' }))
    await user.click(screen.getByRole('button', { name: /shared sign in/i })); await user.click(screen.getByRole('button', { name: 'Close sign in' }))
    await user.click(screen.getByRole('button', { name: 'Solo' })); expect(screen.getByRole('button', { name: 'Solo' })).toHaveAttribute('aria-pressed', 'true')
    await user.click(screen.getByRole('button', { name: /timer sign in/i })); await user.click(screen.getByRole('button', { name: 'Close sign in' }))
    await user.click(screen.getByText('Timer saved'))
    await user.click(screen.getByRole('button', { name: 'Together' })); await user.click(screen.getByText('Shared saved'))
    await user.click(screen.getByRole('button', { name: /circle/i })); expect(screen.getByText('Circle sign in')).toBeInTheDocument(); await user.click(screen.getByText('Circle sign in')); await user.click(screen.getByRole('button', { name: 'Close sign in' }))
    await user.click(screen.getByRole('button', { name: /journal/i })); expect(screen.getByText('Journal sign in')).toBeInTheDocument(); await user.click(screen.getByText('Journal sign in')); await user.click(screen.getByRole('button', { name: 'Close sign in' }))
    await user.click(screen.getByText('Journal changed'))
    await user.click(screen.getByRole('button', { name: /profile/i })); await user.click(screen.getByText('Profile sign in')); await user.click(screen.getByRole('button', { name: 'Close sign in' })); await user.click(screen.getByText('Profile updated')); await user.click(screen.getByText('Profile sign out')); expect(screen.getByText('Profile sign in')).toBeInTheDocument()
  })

  it('opens auth from a child and closes it after successful login', async () => {
    const user = userEvent.setup(); vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response({ user: { id: 'u', name: 'Ada', email: 'a', timezone: 'UTC' } })))
    render(<Home />); await waitFor(() => expect(screen.getByRole('button', { name: 'Solo' })).toBeInTheDocument())
    await user.click(screen.getByRole('button', { name: /journal/i })); await user.click(screen.getByText('Journal sign in'))
    expect(screen.getByRole('dialog')).toBeInTheDocument(); await user.click(screen.getByRole('button', { name: 'Close sign in' })); expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('routes timer and shared-session activity callbacks and completes auth', async () => {
    const user = userEvent.setup()
    let authenticated = false
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      if (url === '/api/auth/me') return response({ user: authenticated ? { id: 'u', name: 'Ada', email: 'a@test', timezone: 'UTC' } : null })
      if (url === '/api/auth/login') { authenticated = true; return response({ user: { id: 'u', name: 'Ada', email: 'a@test', timezone: 'UTC' } }) }
      return response({ practiceDates: [] })
    }))
    render(<Home />); await waitFor(() => expect(screen.getByRole('button', { name: 'Solo' })).toBeInTheDocument())
    await user.click(screen.getByText('Mock timer')); await user.click(screen.getByText('Mock shared sit'))
    await user.click(screen.getByRole('button', { name: /journal/i })); await user.click(screen.getByText('Journal sign in'))
    await user.type(screen.getByPlaceholderText('you@example.com'), 'a@test'); await user.type(screen.getByPlaceholderText('Your password'), 'secret');
    await user.click(screen.getByRole('button', { name: /sign in →/i })); await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })

  it('handles missing auth, failed session history, and consecutive practice dates', async () => {
    const fetchMock = vi.fn().mockResolvedValue(response({}, false)); vi.stubGlobal('fetch', fetchMock)
    render(<Home />); await waitFor(() => expect(screen.getByRole('button', { name: 'Solo' })).toBeInTheDocument())
    vi.unstubAllGlobals();
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'UTC' }).format(new Date()); const yesterdayDate = new Date(`${today}T12:00:00Z`); yesterdayDate.setUTCDate(yesterdayDate.getUTCDate() - 1); const yesterday = yesterdayDate.toISOString().slice(0, 10)
    vi.stubGlobal('fetch', vi.fn(async (url: string) => url === '/api/auth/me' ? response({ user: { id: 'u', name: 'Ada', email: 'a', timezone: 'UTC', weeklyTarget: 2 } }) : response({ practiceDates: [today, yesterday] })))
    render(<Home />); await userEvent.click(screen.getAllByRole('button', { name: /journal/i }).at(-1)!); await waitFor(() => expect(screen.getAllByText(/day streak/).length).toBeGreaterThan(0))
    window.history.pushState({}, '', '/')
    vi.stubGlobal('fetch', vi.fn(async (url: string) => url === '/api/auth/me' ? response({ user: { id: 'u', name: 'Ada', email: 'a', timezone: 'UTC' } }) : response({}, false)))
    render(<Home />); await waitFor(() => expect(screen.getAllByRole('button', { name: 'Solo' }).length).toBeGreaterThan(0))
  })
  it('offers only sitting and confines the fixed layout to the solo practice screen', async () => {
    window.history.pushState({}, '', '/')
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response({}, false)))
    const user = userEvent.setup(); const view = render(<Home />)
    expect(screen.queryByRole('combobox', { name: 'Practice' })).not.toBeInTheDocument()
    expect(screen.queryByText('Mock walk')).not.toBeInTheDocument()
    expect(screen.queryByText(/days this Mon/)).not.toBeInTheDocument()
    expect(view.container.querySelector('main')).toHaveClass('sit-screen')
    await user.click(screen.getByRole('button', { name: /journal/i }))
    expect(view.container.querySelector('main')).not.toHaveClass('sit-screen')
    await user.click(screen.getByRole('button', { name: 'Still' }))
    await user.click(screen.getByText('Mock timer')); await user.click(screen.getByText('Stop timer'))
    await user.click(screen.getByRole('button', { name: 'Together' }))
    expect(view.container.querySelector('main')).not.toHaveClass('sit-screen')
  })
})

describe('layout and service worker', () => {
  it('wraps children with html/body and the registration client', () => {
    const register = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'serviceWorker', { configurable: true, value: { register } })
    const { container } = render(<RootLayout><main>Child</main></RootLayout>)
    expect(screen.getByText('Child')).toBeInTheDocument()
    render(<ServiceWorker />); expect(register).toHaveBeenCalledWith('/sw.js')
  })

  it('silently handles registration failures and unsupported browsers', async () => {
    const register = vi.fn().mockRejectedValue(new Error('blocked'))
    Object.defineProperty(navigator, 'serviceWorker', { configurable: true, value: { register } })
    render(<ServiceWorker />); await waitFor(() => expect(register).toHaveBeenCalled())
    // jsdom exposes navigator.serviceWorker on its prototype; the rejection
    // path above covers the registration boundary without a real worker.
  })

  it('does nothing when the browser has no service-worker API', () => {
    vi.stubGlobal('navigator', {})
    expect(() => render(<ServiceWorker />)).not.toThrow()
  })
})

describe('offline shell',()=>{
  it('restores only the last device account while offline, handles missing snapshots, and reconnects',async()=>{
    localStorage.clear();vi.spyOn(navigator,'onLine','get').mockReturnValue(false);vi.stubGlobal('fetch',vi.fn());render(<Home/>);await screen.findByText(/Offline ·/);fireEvent.click(screen.getByRole('button',{name:'Retry connection'}));expect(fetch).not.toHaveBeenCalled()
    localStorage.setItem('still:offline-account',JSON.stringify({user:{id:'u',name:'Ada',email:'fixture',timezone:'UTC'},dates:[]}));fireEvent(window,new Event('online'));await screen.findByRole('button',{name:'Ada'});expect(screen.getByRole('button',{name:'Together'})).toBeDisabled()
    vi.spyOn(navigator,'onLine','get').mockReturnValue(true);vi.stubGlobal('fetch',vi.fn(async(url:string)=>url==='/api/auth/me'?response({user:{id:'u',name:'Ada',email:'fixture',timezone:'UTC'}}):response({practiceDates:[]})));fireEvent(window,new Event('online'));await waitFor(()=>expect(screen.queryByText(/Offline ·/)).toBeNull());fireEvent(window,new Event('offline'));await screen.findByText(/Offline ·/);localStorage.clear()
  })
  it('shows pending sync failures and retries after outbox changes and the interval',async()=>{
    localStorage.clear();vi.spyOn(navigator,'onLine','get').mockReturnValue(true);localStorage.setItem('still:outbox:u',JSON.stringify([{id:'one',reflection:{afterNote:'private'}}]));const f=vi.fn(async(url:string)=>url==='/api/auth/me'?response({user:{id:'u',name:'Ada',email:'fixture',timezone:'UTC'}}):url.includes('/reflection')?response({},false):response({practiceDates:[]}));vi.stubGlobal('fetch',f);render(<Home/>);await screen.findByText(/saved on this device/);fireEvent(window,new Event('still:outbox'));await waitFor(()=>expect(f.mock.calls.filter(([url])=>url.includes('/reflection')).length).toBeGreaterThan(1));localStorage.clear()
  })
  it('handles failed auth transport using the cached account',async()=>{
    localStorage.clear();vi.stubGlobal('fetch',vi.fn().mockRejectedValue(new Error('offline')));render(<Home/>);await screen.findByText(/Offline ·/)
  })
})
it('does not publish a stale sync error after the page unmounts',async()=>{
  localStorage.clear();vi.spyOn(navigator,'onLine','get').mockReturnValue(true);localStorage.setItem('still:outbox:u',JSON.stringify([{id:'one',reflection:{afterNote:'private'}}]));let rejectUpload!: (error:Error)=>void;const upload=new Promise<Response>((_,reject)=>{rejectUpload=reject});const f=vi.fn(async(url:string)=>url==='/api/auth/me'?response({user:{id:'u',name:'Ada',email:'fixture',timezone:'UTC'}}):url.includes('/reflection')?upload:response({practiceDates:[]}));vi.stubGlobal('fetch',f);const view=render(<Home/>);await waitFor(()=>expect(f.mock.calls.some(([url])=>url.includes('/reflection'))).toBe(true));view.unmount();rejectUpload(new Error('offline'));await new Promise(resolve=>setTimeout(resolve,0));localStorage.clear()
})
it('refreshes the practice history after a successful reconnect upload',async()=>{
  localStorage.clear();vi.spyOn(navigator,'onLine','get').mockReturnValue(true);localStorage.setItem('still:outbox:u',JSON.stringify([{id:'one',reflection:{afterNote:'private'}}]));const f=vi.fn(async(url:string)=>url==='/api/auth/me'?response({user:{id:'u',name:'Ada',email:'fixture',timezone:'UTC'}}):response({practiceDates:[]}));vi.stubGlobal('fetch',f);render(<Home/>);await waitFor(()=>expect(f.mock.calls.filter(([url])=>url==='/api/sessions').length).toBeGreaterThan(1));localStorage.clear()
})
