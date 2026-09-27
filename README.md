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
npm test
npm run build
vercel --prod
```

The linked Vercel project is `still-meditation`. Its Neon resource is the free
plan resource `still-db`, connected to development, preview, and production.

## PWA behavior

The timer uses elapsed wall-clock time so it does not drift when a tab is
backgrounded. Browser audio requires an initial user gesture. The end bell is
supported while the page is active; iOS background or locked-screen audio needs
on-device verification and is not guaranteed by a web PWA.
