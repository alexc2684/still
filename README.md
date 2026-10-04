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

## Offline practice

Open Still and sign in once while connected, then solo practice works offline,
including reopening the app, recovering a running timer, completing a sit, and
saving a private reflection. Journal shows locally completed sits and any
history previously opened on that device; editing old journal entries requires
a connection. Together, Circle, sign-in, and profile changes require a connection.

Completed sessions and reflections stay in a per-account browser outbox and
sync when Still is open and connected again. An expired login requires signing
back into the original account; another account cannot receive the outbox.
Retries reuse the session UUID, and the server records the original completion
date in the account's timezone. Offline records remain on the device until an
acknowledged upload; clearing browser/site data removes unsynced practice.
The timer refuses to start offline if it cannot save its recovery state.

The service worker caches the shell and its build-specific JavaScript/CSS on
installation, excludes API responses and RSC requests from caching, and retains
only Still's own current shell cache. Test offline behavior against a production
build, not the dev server:

```bash
npm run build
npm run start -- --hostname 127.0.0.1 --port 3217
npx playwright install chromium webkit
npm run test:browser:offline
```

The browser regression uses fixture API responses and performs no real database
writes. Phone background/locked-screen bell behavior still needs device checks.

The mobile layout regression checks whole-button visibility, clipping ancestors,
fixed-navigation overlap, hit-testing, and coordinate-based touch in Chromium
and WebKit. It covers phone safe areas, narrow/short viewports, larger text,
landscape, and viewport changes. CI runs it against the production build and
retains viewport screenshots, including failures, for review. The original
offline reload/reflection/sync regression also runs in this command.
