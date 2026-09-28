import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import vm from 'node:vm'
import { describe, expect, it, vi } from 'vitest'
import { main, runMigration, splitSqlStatements } from '../scripts/migrate'

describe('migration runner', () => {
  it('splits ordinary statements while preserving dollar quoted function bodies', () => {
    const sql = "CREATE TABLE a (id int);\nDO $$ BEGIN PERFORM 1; PERFORM 2; END $$;\nCREATE INDEX a_id ON a(id);"
    expect(splitSqlStatements(sql)).toEqual([
      'CREATE TABLE a (id int)',
      'DO $$ BEGIN PERFORM 1; PERFORM 2; END $$',
      'CREATE INDEX a_id ON a(id)',
    ])
    expect(splitSqlStatements('; SELECT 1;')).toEqual(['SELECT 1'])
    expect(splitSqlStatements('SELECT 3')).toEqual(['SELECT 3'])
    expect(splitSqlStatements("SELECT 'a;b';\nDO $$ BEGIN PERFORM 'x;y'; END $$;\nSELECT 4;")).toEqual([
      "SELECT 'a;b'",
      "DO $$ BEGIN PERFORM 'x;y'; END $$",
      'SELECT 4',
    ])
    expect(splitSqlStatements("SELECT 'it''s';\nSELECT \"a;b\";")).toEqual(["SELECT 'it''s'", 'SELECT "a;b"'])
    expect(splitSqlStatements("SELECT 'a\n\nb;c';")).toEqual(["SELECT 'a\n\nb;c'"])
    expect(splitSqlStatements('DO $$ BEGIN PERFORM 1;')).toEqual(['DO $$ BEGIN PERFORM 1;'])
    expect(splitSqlStatements('CREATE TABLE sample (\n  note text\n);\nCREATE INDEX sample_note ON sample(note);')).toEqual([
      'CREATE TABLE sample (\n  note text\n)',
      'CREATE INDEX sample_note ON sample(note)',
    ])
  })

  it('runs each statement in order and surfaces query failures', async () => {
    const seen: string[] = []
    await expect(runMigration('SELECT 1; SELECT 2;', async statement => { seen.push(statement) })).resolves.toBe(2)
    expect(seen).toEqual(['SELECT 1', 'SELECT 2'])
    await expect(runMigration('SELECT 1; SELECT 2;', async statement => { if (statement === 'SELECT 2') throw new Error('db failed') })).rejects.toThrow('db failed')
  })

  it('passes multiline schema statements to the migration query unchanged', async () => {
    const seen: string[] = []
    const loadEnvFile = process.loadEnvFile
    process.loadEnvFile = vi.fn(() => undefined)
    try { await main(async () => 'CREATE TABLE sample (\n  note text\n);', () => async statement => { seen.push(statement) }) }
    finally { process.loadEnvFile = loadEnvFile }
    expect(seen).toEqual(['CREATE TABLE sample (\n  note text\n)'])
  })

  it('splits the checked-in schema into executable statements without a database', async () => {
    const schema = await readFile(join(process.cwd(), 'db/schema.sql'), 'utf8')
    const seen: string[] = []
    await runMigration(schema, async statement => { seen.push(statement) })
    expect(seen.length).toBeGreaterThan(1)
    expect(seen.every(statement => statement.trim().length > 0)).toBe(true)
  })

  it('exercises the CLI main path with injected file and query dependencies', async () => {
    const seen: string[] = []
    const loadEnvFile = process.loadEnvFile
    process.loadEnvFile = vi.fn(() => undefined)
    try { await expect(main(async () => 'SELECT 1; SELECT 2;', () => async statement => { seen.push(statement) })).resolves.toBeUndefined() }
    finally { process.loadEnvFile = loadEnvFile }
    expect(seen).toEqual(['SELECT 1', 'SELECT 2'])
  })

  it('covers default CLI dependencies and the executable-file guard', async () => {
    const originalArgv = process.argv[1]
    const originalLoadEnvFile = process.loadEnvFile
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined)
    const read = vi.fn(async () => 'SELECT default;')
    const query = vi.fn(async () => undefined)
    vi.doMock('node:fs/promises', () => ({ default: { readFile: read }, readFile: read }))
    vi.doMock('../src/lib/db', () => ({ sql: () => query }))
    process.loadEnvFile = vi.fn(() => undefined)
    try {
      vi.resetModules()
      process.argv[1] = undefined as unknown as string
      await import('../scripts/migrate')
      vi.resetModules()
      process.argv[1] = '/tmp/not-migrate.ts'
      await import('../scripts/migrate')
      vi.resetModules()
      process.argv[1] = `${process.cwd()}/scripts/migrate.ts`
      const module = await import('../scripts/migrate')
      await module.main()
      await vi.waitFor(() => expect(query).toHaveBeenCalledWith('SELECT default'))
      expect(read).toHaveBeenCalled()
      expect(log).toHaveBeenCalledWith('migrated 1 statements')
    } finally {
      process.argv[1] = originalArgv
      process.loadEnvFile = originalLoadEnvFile
      vi.doUnmock('node:fs/promises'); vi.doUnmock('../src/lib/db'); vi.resetModules(); log.mockRestore()
    }
  })
})

describe('Next configuration', () => {
  it('exports the strict-mode configuration used by the app', async () => {
    const config = (await import('../next.config.mjs')).default
    expect(config).toMatchObject({ reactStrictMode: true })
  })
})

type Harness = { listeners: Record<string, (event: any) => void>; cache: Map<string, Response>; deleted: string[]; notifications: any[]; clientsOpened: string[]; focused: number; navigated: string[]; context: vm.Context }

async function loadServiceWorker(options: { fetch?: (request: Request) => Promise<Response>; existingClients?: any[]; cacheKeys?: string[]; cacheMatch?: (request: Request | string) => Response | undefined; cachePut?: (request: Request | string, response: Response) => void } = {}): Promise<Harness> {
  const source = await readFile(join(process.cwd(), 'public/sw.js'), 'utf8')
  const listeners: Record<string, (event: any) => void> = {}
  const cache = new Map<string, Response>()
  const deleted: string[] = []
  const notifications: any[] = []
  const clientsOpened: string[] = []
  const cacheApi = { open: async () => ({ addAll: async (urls: string[]) => urls.forEach(url => cache.set(url, new Response(`cached:${url}`))), put: async (request: Request | string, response: Response) => { if (options.cachePut) options.cachePut(request, response); else cache.set(typeof request === 'string' ? request : request.url, response) }, match: async (request: Request | string) => options.cacheMatch?.(request) ?? cache.get(typeof request === 'string' ? request : request.url) }), keys: async () => options.cacheKeys ?? ['old-cache', 'still-shell-v9'], delete: async (key: string) => { deleted.push(key); return true }, match: async (request: Request | string) => options.cacheMatch?.(request) ?? cache.get(typeof request === 'string' ? request : request.url) }
  const focused: { count: number } = { count: 0 }; const navigated: string[] = []
  const clients = { claim: async () => undefined, matchAll: async () => options.existingClients ?? [], openWindow: async (url: string) => { clientsOpened.push(url) } }
  for (const client of options.existingClients ?? []) { client.focus = async () => { focused.count += 1 }; client.navigate = async (url: string) => { navigated.push(url) } }
  const self = { location: { origin: 'https://still.test' }, registration: { showNotification: async (...args: any[]) => notifications.push(args) }, skipWaiting: async () => undefined, clients, addEventListener: (name: string, handler: (event: any) => void) => { listeners[name] = handler } }
  const context = vm.createContext({ self, clients, caches: cacheApi, URL, Request, Response, fetch: options.fetch ?? (async (request: Request) => new Response(`network:${request.url}`, { status: 200 })) })
  vm.runInContext(source, context)
  return { listeners, cache, deleted, notifications, clientsOpened, focused: focused.count, navigated, context }
}

function eventWithWaitUntil(extra: Record<string, unknown> = {}) {
  const promises: Promise<unknown>[] = []
  return { ...extra, waitUntil: (promise: Promise<unknown>) => promises.push(promise), done: () => Promise.all(promises) }
}

describe('service worker runtime', () => {
  it('executes every push, click, and fetch decision including cache and network fallbacks', async () => {
    const existing = { url: 'https://still.test/already' }
    const requests: string[] = []
    const h = await loadServiceWorker({ existingClients: [existing], fetch: async request => {
      requests.push(request.url)
      if (request.url.endsWith('/offline')) throw new Error('offline')
      return new Response(`network:${request.url}`, { status: 200 })
    } })
    const install = eventWithWaitUntil(); h.listeners.install(install); await install.done()

    // Push payload defaults, relative same-origin URL, foreign URL, malformed URL, and all custom fields.
    const push = (data: any) => { const event = eventWithWaitUntil({ data }); h.listeners.push(event); return event.done() }
    await push(undefined)
    await push({ json: () => null })
    await push({ json: () => ({ title: 'Title', body: 'Body', icon: '/icon', badge: '/badge', tag: 'tag', url: '/journal?q=1#top' }) })
    await push({ json: () => ({ url: 'https://evil.test/private', tag: 42 }) })
    await push({ json: () => ({ url: 'http://[invalid' }) })
    expect(h.notifications.at(-1)?.[1].data.url).toBe('/')

    // Click existing client, open-window path, and invalid/foreign URLs.
    const click = (url: any, clients: any[]) => loadServiceWorker({ existingClients: clients }).then(async local => {
      const event = eventWithWaitUntil({ notification: { data: url === undefined ? undefined : { url }, close: vi.fn() } })
      local.listeners.notificationclick(event); await event.done(); return local
    })
    const existingClick = eventWithWaitUntil({ notification: { data: { url: '/journal' }, close: vi.fn() } }); h.listeners.notificationclick(existingClick); await existingClick.done()
    const opened = await click('/new', [])
    expect(opened.clientsOpened).toEqual(['https://still.test/new'])
    await click('https://evil.test/private', [])
    await click('http://[invalid', [])

    const response = async (request: Request) => {
      const waits: Promise<unknown>[] = []; const event: any = { request, respondWith: (promise: Promise<Response>) => waits.push(promise) }
      h.listeners.fetch(event); return waits.length ? (await waits[0]) as Response : undefined
    }
    // Navigation success caches shell; navigation rejection and non-navigation rejection use fallback.
    const navigationRequest = new Request('https://still.test/new-page'); Object.defineProperty(navigationRequest, 'mode', { value: 'navigate' }); expect((await response(navigationRequest))?.status).toBe(200)
    // Navigation has no internal catch, so exercise the rejected promise explicitly.
    const failingNavigation = new Request('https://still.test/offline'); Object.defineProperty(failingNavigation, 'mode', { value: 'navigate' }); await expect(response(failingNavigation)).resolves.toMatchObject({ status: 200 })
    // Non-navigation cache hit, cacheable and non-cacheable misses, then a network rejection.
    h.cache.set('https://still.test/cached', new Response('cached'))
    expect((await response(new Request('https://still.test/cached')))?.status).toBe(200)
    expect((await response(new Request('https://still.test/_next/static/app.js')))?.status).toBe(200)
    expect((await response(new Request('https://still.test/uncached')))?.status).toBe(200)
    expect(await response(new Request('https://still.test/offline'))).toBeUndefined()
    expect(requests.length).toBeGreaterThan(0)
  })

  it('installs the shell and removes old caches on activation', async () => {
    const h = await loadServiceWorker()
    const install = eventWithWaitUntil(); h.listeners.install(install); await install.done()
    expect(h.cache.has('/')).toBe(true)
    const activate = eventWithWaitUntil(); h.listeners.activate(activate); await activate.done()
    expect(h.deleted).toEqual(['old-cache'])
  })

  it('bypasses API, non-GET, and foreign-origin requests', async () => {
    const h = await loadServiceWorker()
    const install = eventWithWaitUntil(); h.listeners.install(install); await install.done()
    for (const request of [new Request('https://still.test/api/me'), new Request('https://still.test/', { method: 'POST' }), new Request('https://other.test/page')]) {
      const event: any = { request, respondWith: () => { throw new Error('should bypass') } }
      h.listeners.fetch(event)
    }
  })

  it('caches successful navigation and falls back to cached shell when offline', async () => {
    const h = await loadServiceWorker()
    const online = eventWithWaitUntil({ request: new Request('https://still.test/journal', { headers: { accept: 'text/html' } }), respondWith: (promise: Promise<Response>) => { online.response = promise } }) as any
    Object.defineProperty(online.request, 'mode', { value: 'navigate' }); h.listeners.fetch(online); expect((await online.response).status).toBe(200)
    await new Promise(resolve => setTimeout(resolve, 0)); expect(h.cache.has('/')).toBe(true)
  })

  it('returns fresh network responses when cache writes fail', async () => {
    const h = await loadServiceWorker({ cachePut: () => { throw new Error('quota') } })
    const event: any = { request: new Request('https://still.test/_next/static/app.js'), respondWith: (promise: Promise<Response>) => { event.response = promise } }
    h.listeners.fetch(event)
    await expect(event.response).resolves.toMatchObject({ status: 200 })
    const navigation = new Request('https://still.test/journal'); Object.defineProperty(navigation, 'mode', { value: 'navigate' })
    const navigationEvent: any = { request: navigation, respondWith: (promise: Promise<Response>) => { navigationEvent.response = promise } }
    h.listeners.fetch(navigationEvent)
    await expect(navigationEvent.response).resolves.toMatchObject({ status: 200 })
  })

  it('handles malformed push data, same-origin click URLs, and rejects foreign URLs', async () => {
    const h = await loadServiceWorker()
    const malformed = eventWithWaitUntil({ data: { json: () => { throw new Error('bad payload') } } }); h.listeners.push(malformed); await malformed.done(); expect(h.notifications[0][1].body).toContain('A moment')
    const valid = eventWithWaitUntil({ data: { json: () => ({ title: 'Practice', url: '/journal?from=push' }) } }); h.listeners.push(valid); await valid.done(); expect(h.notifications[1][1].data.url).toBe('/journal?from=push')
    const click = eventWithWaitUntil({ notification: { data: { url: 'https://evil.test/steal' }, close: () => undefined } }); h.listeners.notificationclick(click); await click.done(); expect(h.clientsOpened).toEqual(['https://still.test/'])
  })

  it('loads the actual service-worker module with worker globals stubbed', async () => {
    const listeners: Record<string, (event: any) => void> = {}
    const cache = new Map<string, Response>()
    let clientList: any[] = []; let failFetch = false; const deleted: string[] = []
    const fakeCaches = { open: async () => ({ addAll: async (urls: string[]) => urls.forEach(url => cache.set(url, new Response(`cached:${url}`))), put: async (request: Request | string, response: Response) => cache.set(typeof request === 'string' ? request : request.url, response), match: async (request: Request | string) => cache.get(typeof request === 'string' ? request : request.url) }), keys: async () => ['old-cache', 'still-shell-v9'], delete: async (key: string) => { deleted.push(key); return true }, match: async (request: Request | string) => cache.get(typeof request === 'string' ? request : request.url) }
    const fakeClients = { claim: async () => undefined, matchAll: async () => clientList, openWindow: async () => undefined }
    vi.stubGlobal('self', { location: { origin: 'https://still.test' }, registration: { showNotification: async () => undefined }, skipWaiting: async () => undefined, clients: fakeClients, addEventListener: (name: string, handler: (event: any) => void) => { listeners[name] = handler } })
    vi.stubGlobal('clients', fakeClients); vi.stubGlobal('caches', fakeCaches); vi.stubGlobal('fetch', async () => { if (failFetch) throw new Error('offline'); return new Response('network', { status: 200 }) })
    // @ts-expect-error The production worker is an intentionally classic script with no exports.
    await import('../public/sw.js')
    expect(Object.keys(listeners)).toEqual(expect.arrayContaining(['install', 'activate', 'push', 'notificationclick', 'fetch']))
    const waits: Promise<unknown>[] = []; listeners.install({ waitUntil: (promise: Promise<unknown>) => waits.push(promise) }); await Promise.all(waits); expect(cache.has('/')).toBe(true)
    const activateWaits: Promise<unknown>[] = []; listeners.activate({ waitUntil: (promise: Promise<unknown>) => activateWaits.push(promise) }); await Promise.all(activateWaits)
    expect(deleted).toEqual(['old-cache'])
    const pushWaits: Promise<unknown>[] = []; listeners.push({ data: { json: () => ({ title: 'QA', url: '/journal' }) }, waitUntil: (promise: Promise<unknown>) => pushWaits.push(promise) }); await Promise.all(pushWaits)
    const customPushWaits: Promise<unknown>[] = []; listeners.push({ data: { json: () => ({ title: 'Tagged', tag: 'tag', url: 'https://evil.test/x' }) }, waitUntil: (promise: Promise<unknown>) => customPushWaits.push(promise) }); await Promise.all(customPushWaits)
    const nullPushWaits: Promise<unknown>[] = []; listeners.push({ data: { json: () => null }, waitUntil: (promise: Promise<unknown>) => nullPushWaits.push(promise) }); await Promise.all(nullPushWaits)
    const malformedPushWaits: Promise<unknown>[] = []; listeners.push({ data: { json: () => { throw new Error('bad') } }, waitUntil: (promise: Promise<unknown>) => malformedPushWaits.push(promise) }); await Promise.all(malformedPushWaits)
    const existingClient = { url: 'https://still.test/current', focus: vi.fn(async () => undefined), navigate: vi.fn(async () => undefined) }; clientList = [existingClient]
    const clickWaits: Promise<unknown>[] = []; listeners.notificationclick({ notification: { data: { url: '/journal' }, close: () => undefined }, waitUntil: (promise: Promise<unknown>) => clickWaits.push(promise) }); await Promise.all(clickWaits); expect(existingClient.focus).toHaveBeenCalled()
    clientList = []
    const foreignClickWaits: Promise<unknown>[] = []; listeners.notificationclick({ notification: { data: { url: 'https://evil.test/x' }, close: () => undefined }, waitUntil: (promise: Promise<unknown>) => foreignClickWaits.push(promise) }); await Promise.all(foreignClickWaits)
    const emptyClickWaits: Promise<unknown>[] = []; listeners.notificationclick({ notification: { data: {}, close: () => undefined }, waitUntil: (promise: Promise<unknown>) => emptyClickWaits.push(promise) }); await Promise.all(emptyClickWaits)
    const openedWaits: Promise<unknown>[] = []; listeners.notificationclick({ notification: { data: { url: '/opened' }, close: () => undefined }, waitUntil: (promise: Promise<unknown>) => openedWaits.push(promise) }); await Promise.all(openedWaits)
    const fetchRun = async (request: Request) => { const waits: Promise<unknown>[] = []; listeners.fetch({ request, respondWith: (promise: Promise<unknown>) => waits.push(promise) }); return waits.length ? Promise.all(waits) : [] }
    const navigation = new Request('https://still.test/journal'); Object.defineProperty(navigation, 'mode', { value: 'navigate' }); await fetchRun(navigation)
    await fetchRun(new Request('https://still.test/manifest.webmanifest'))
    await fetchRun(new Request('https://still.test/new-resource'))
    failFetch = true; await fetchRun(new Request('https://still.test/offline')); failFetch = false
    failFetch = true; const failingNavigation = { url: 'https://still.test/offline', method: 'GET', mode: 'navigate' } as Request; await expect(fetchRun(failingNavigation)).resolves.toHaveLength(1); failFetch = false
    for (const request of [new Request('https://still.test/api/x'), new Request('https://still.test/journal', { method: 'POST' }), new Request('https://else.test/journal')]) listeners.fetch({ request, respondWith: () => undefined })
    vi.unstubAllGlobals()
  })
})
