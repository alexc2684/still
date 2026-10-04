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

## Lesson: offline banner hid Begin practice (2026-10-04)

The offline release added a tall banner above a viewport-sized Sit screen.
The dial still used viewport height rather than the space left after the
banner, selector, header, safe areas, and bottom navigation. The page and
content used `overflow: hidden`, so Begin practice was clipped and users could
not scroll to it.

Why this escaped review: the browser test checked saving and state transitions
using `Locator.click()`. Playwright automatically scrolled a hidden-overflow
ancestor and reached a button a finger could not reach. A full-page screenshot
was captured but the clipped lower action was not treated as a failed review.
The test used one desktop-runner mobile viewport without iPhone safe-area
insets. Unit tests and 100% JavaScript coverage did not check CSS geometry.
The integration with newer main layout changes was re-tested functionally,
without an explicit assertion that its primary action remained reachable.

Required prevention for layout/status/banner changes:

- Test the final merged production build. Run `npm run test:browser:offline`;
  this is also required in GitHub CI. A functional pass or coverage percentage
  alone is not evidence of layout usability.
- Before locator auto-scroll, assert the entire primary action is inside the
  visible viewport, above fixed navigation, and inside every clipping ancestor.
  Check `elementFromPoint` and activate it using actual touch coordinates.
- Include Chromium and WebKit, iPhone safe areas, browser-height changes,
  small phones, enlarged text, landscape, keyboard visual viewports,
  online/offline transitions, and idle/running/paused actions. Use viewport screenshots, not only full-page
  screenshots, and inspect the bottom edge and every primary control.
- Size decorative UI from its available container space, after banners and
  controls. Preserve a user-operable scroll fallback for smaller or enlarged
  layouts; never clip essential controls to maintain a stationary screen.
- If scrolling is needed, verify a real user gesture reveals the control.
  Programmatic `scrollIntoView()` or `Locator.click()` auto-scroll cannot prove
  that a person can reach it. Browser emulation does not establish physical
  iPhone behavior; state that boundary explicitly. Playwright cannot swipe or
  wheel in mobile WebKit; use touch-enabled desktop WebKit at the same phone
  viewport for native scroll testing and disclose this limitation.
