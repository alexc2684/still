# Still

Still is a meditation timer and social practice log deployed as a Next.js PWA.
Circle membership includes registered accounts only; anonymous visitors are not
counted or listed. Registered accounts remain members when signed out.

For a shared practice, open **Together** from Practice, create a sit, and share
the invitation link with friends. Friends sign in with their existing Still
account, open the link, and choose **Join**. The host starts the sit when ready;
each participant receives a private reflection afterward. The invitation link
joins a shared session and is not a passwordless authentication mechanism.

## Local setup

Install dependencies and copy the Vercel-provided environment file:

```bash
npm install
vercel env pull .env.local
npm run db:migrate
npm run dev
```

The local environment needs `DATABASE_URL` for the Neon Postgres connection. The
other `DATABASE_*`, `POSTGRES_*`, and `PG*` values are provider aliases generated
by Vercel; keep `.env.local` private and never commit credentials.

## Checks and deployment

```bash
npm run lint
npm run test:unit
npm run test:regression
npm test
npm run test:coverage
npm run build
```

Coverage uses Vitest with the V8 provider and a 100% statements, branches,
functions, and lines threshold per runtime file. Tests run in jsdom with the
Testing Library setup; external databases, push transports, notification
permissions, and production data are mocked at their boundaries.

The linked Vercel project is `still-meditation`. Its Neon resource is the free
plan resource `still-db`, connected to development, preview, and production.
Pushes to the linked main branch trigger Vercel's automatic deployment; a
separate manual production deployment is not required.

## PWA behavior

The timer uses elapsed wall-clock time so it does not drift when a tab is
backgrounded, and solo sessions can be paused and resumed. Browser audio
requires an initial user gesture. The completion bell is supported while the
page is active; iOS playback mode is requested when available, but background or
locked-screen audio still needs on-device verification and is not guaranteed by
a web PWA.

Phone practice reminders are opt-in. The browser asks for notification
permission only after the user taps Enable in Profile. Delivery runs hourly on
the free public-repository GitHub Actions runner and is best effort around the
chosen local hour; it does not promise exact-minute delivery.

## Password reset

Run `npm run db:migrate` before releasing password reset. Configure `APP_URL`
with the canonical app origin, `RESEND_API_KEY` with a Resend sending key, and
`AUTH_EMAIL_FROM` with a sender on a verified domain (for example,
`Still <hello@example.com>`). Email is sent using the
[Resend email API](https://resend.com/docs/api-reference/emails/send-email).
Missing configuration produces a temporary-unavailability message; reset links
are never returned by the API or logged. Links expire after 30 minutes. A
successful reset invalidates all outstanding links and existing login sessions.

## Google sign-in

Google sign-in and sign-up use the same **Continue with Google** button. Existing
Google accounts are identified by their immutable Google subject. Verified Gmail
and Google Workspace emails can reuse an existing Still account without losing
sessions or reflections. An external email already used by a password account is
not automatically linked; use its existing email/password login.

Before enabling Google in production:

1. Create a **Web application** OAuth client in Google Cloud, with the consent
   screen configured for Still and the `openid`, `email`, and `profile` scopes.
2. Authorize the exact redirect URI
   `https://still-meditation-ashen.vercel.app/api/auth/google/callback`.
3. Set `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, and the canonical `APP_URL` in
   Vercel's production environment. Keep the secret server-side.
4. Run `npm run db:migrate` against Still's production database before enabling
   the credentials, then redeploy and exercise both a new and existing account.

For local testing, use `APP_URL=http://localhost:3217` and authorize the matching
`http://localhost:3217/api/auth/google/callback` URI in Google Cloud. An incomplete
configuration returns a friendly unavailability message and retains email login.
OAuth attempts expire after ten minutes and use a browser-bound state cookie,
PKCE, nonce verification, and one-time server-side consumption. Provider access
and refresh tokens are not stored.
