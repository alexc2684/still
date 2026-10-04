import { sql } from './db'
import { hashPassword, token, tokenHash } from './security'

export function resetEmailConfig() {
  const { RESEND_API_KEY: apiKey, AUTH_EMAIL_FROM: from, APP_URL: appUrl } = process.env
  if (!apiKey || !from || !appUrl) throw new Error('Password reset email is not configured')
  const url = new URL(appUrl)
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname))) throw new Error('APP_URL must use HTTPS')
  return { apiKey, from, origin: url.origin }
}

export async function requestPasswordReset(email: string) {
  const config = resetEmailConfig()
  const db = sql()
  const [user] = await db('SELECT id,password_hash FROM users WHERE email=$1', [email])
  if (!user) return
  const rawToken = token()
  const digest = tokenHash(rawToken)
  // Tying the token to the current password invalidates all outstanding links after a reset.
  await db(`INSERT INTO password_reset_tokens(user_id,token_hash,password_hash_snapshot,expires_at) VALUES($1,$2,$3,now()+interval '30 minutes')`, [user.id, digest, user.password_hash])
  const link = new URL('/reset-password', config.origin)
  // A fragment keeps the secret out of HTTP access logs and referrer headers.
  link.hash = new URLSearchParams({ token: rawToken }).toString()
  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${config.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: config.from, to: [email], subject: 'Reset your Still password', text: `Reset your Still password using this link:\n\n${link}\n\nThis link expires in 30 minutes and can only be used once. If you did not request a reset, you can ignore this email.` }),
      signal: AbortSignal.timeout(10000),
    })
    if (!response.ok) throw new Error('Password reset email delivery failed')
  } catch {
    await db('DELETE FROM password_reset_tokens WHERE token_hash=$1', [digest])
    // Keep the public response identical for registered and unregistered addresses.
    console.error('Password reset email delivery failed')
  }
}

export async function resetPassword(rawToken: string, password: string) {
  const passwordHash = await hashPassword(password)
  // One statement atomically changes the password, consumes the link, and revokes sessions.
  // The password snapshot predicate also prevents concurrent reset links from both succeeding.
  const rows = await sql()(`WITH changed AS (
    UPDATE users u SET password_hash=$2 FROM password_reset_tokens r
    WHERE r.token_hash=$1 AND r.user_id=u.id AND r.expires_at>now()
      AND r.password_hash_snapshot=u.password_hash
    RETURNING u.id
  ), consumed AS (
    DELETE FROM password_reset_tokens WHERE user_id IN (SELECT id FROM changed)
  ), revoked AS (
    DELETE FROM sessions WHERE user_id IN (SELECT id FROM changed)
  ) SELECT id FROM changed`, [tokenHash(rawToken), passwordHash])
  return rows.length > 0
}
