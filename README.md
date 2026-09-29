# Still

Still is a meditation timer and social practice log deployed as a Next.js PWA.

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
requires an initial user gesture. Start and end bells are supported while the
page is active; iOS playback mode is requested when available, but background or
locked-screen audio still needs on-device verification and is not guaranteed by
a web PWA.

Phone practice reminders are opt-in. The browser asks for notification
permission only after the user taps Enable in Profile. Delivery runs hourly on
the free public-repository GitHub Actions runner and is best effort around the
chosen local hour; it does not promise exact-minute delivery.
