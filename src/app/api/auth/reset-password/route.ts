import { z } from 'zod'
import { cookies } from 'next/headers'
import { json, originGuard } from '@/lib/http'
import { authRateLimit } from '@/lib/rate-limit'
import { resetPassword } from '@/lib/password-reset'

const input = z.object({ token: z.string().regex(/^[A-Za-z0-9_-]{43}$/), password: z.string().min(8).max(128) })
export async function POST(request: Request) {
  try {
    await originGuard()
    const parsed = input.safeParse(await request.json())
    if (!parsed.success) return json({ error: 'Use a valid reset link and a password between 8 and 128 characters.' }, 400)
    const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown'
    if (!(await authRateLimit(`reset-password:${ip}`))) return json({ error: 'Too many attempts. Try again in 15 minutes.' }, 429)
    if (!(await resetPassword(parsed.data.token, parsed.data.password))) return json({ error: 'This reset link has expired or already been used. Request a new link.' }, 400)
    ;(await cookies()).delete(process.env.SESSION_COOKIE_NAME || 'still_session')
    return json({ message: 'Your password has been reset. Sign in with your new password.' })
  } catch (error) {
    if (error instanceof Response) return error
    if (error instanceof SyntaxError) return json({ error: 'Invalid reset request.' }, 400)
    return json({ error: 'Unable to reset your password. Please try again.' }, 500)
  }
}
