<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## Testing policy

Every new feature must include focused unit and regression tests, including
failure paths and security/data-protection boundaries. Run `npm run test:coverage`
and `npm run build` before pushing. Coverage is configured to include all
handwritten runtime TypeScript/JavaScript, service-worker, migration, and
configuration code with 100% statements, branches, functions, and lines per
file. Do not add coverage-ignore pragmas or exclude runtime modules to make a
threshold pass. Keep credentials, production data, and real push delivery out
of tests; mock external services and use fixtures only.

## UI copy

Keep interface copy functional and minimal. Omit motivational filler, poetic
taglines, and instructions that repeat what the controls already communicate.
Use short labels and status text only when they help someone understand the
current state or next action.

For every new user-facing feature, capture and show screenshots of the
implemented UI before calling it complete. Include key states and mobile when
applicable; report any capture blocker instead of claiming visual verification.
