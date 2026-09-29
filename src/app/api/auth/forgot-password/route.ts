import { z } from 'zod'
import { json, originGuard } from '@/lib/http'
import { authRateLimit } from '@/lib/rate-limit'
import { requestPasswordReset } from '@/lib/password-reset'

const input = z.object({ email: z.string().trim().email().max(254).transform(value => value.toLowerCase()) })
export async function POST(request: Request) {
  try {
    await originGuard()
    const parsed = input.safeParse(await request.json())
    if (!parsed.success) return json({ error: 'Enter a valid email address.' }, 400)
    const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown'
    const allowed = await authRateLimit(`forgot-password:${ip}`, 5)
    const emailAllowed = await authRateLimit(`forgot-password-email:${parsed.data.email}`, 3)
    if (!allowed || !emailAllowed) return json({ error: 'Too many requests. Try again in 15 minutes.' }, 429)
    await requestPasswordReset(parsed.data.email)
    return json({ message: 'If an account exists for that email, you’ll receive a password reset link shortly.' })
  } catch (error) {
    if (error instanceof Response) return error
    if (error instanceof SyntaxError) return json({ error: 'Enter a valid email address.' }, 400)
    return json({ error: 'Password reset is temporarily unavailable. Please try again later.' }, 503)
  }
}
