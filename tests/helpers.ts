import { vi } from 'vitest'

export function mockJsonFetch(routes: Record<string, unknown>, status = 200) {
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
    const body = routes[url]
    return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
  })
}

export function mockWindowLocation(href = 'https://still-meditation-ashen.vercel.app/') {
  const url = new URL(href)
  Object.defineProperty(window, 'location', { configurable: true, value: url })
  return url
}
