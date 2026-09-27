# Still API

All endpoints are same-origin JSON APIs. Auth is an httpOnly `still_session` cookie; send browser requests with credentials. Mutating requests must include the same origin.

## Auth

`POST /api/auth/signup` body `{ email, password, name, timezone }`; returns `{ user: { id, email, name, timezone, weeklyTarget } }` and sets a 30-day cookie. `POST /api/auth/login` body `{ email, password }` returns the same shape. `POST /api/auth/logout` returns `{ ok: true }`. `GET /api/auth/me` returns `{ user }`.

## Practice

`POST /api/sessions/start` body `{ plannedSeconds, name? }`, returning `{ session }`. `POST /api/sessions/:id/complete` body `{ elapsedSeconds, beforeMood?, duringMood?, afterMood?, beforeNote?, duringNote?, afterNote? }`; elapsed time is verified against the server clock. It returns `{ session, practiceDate }`, and repeat calls are idempotent. `PATCH /api/sessions/:id/reflection` accepts the reflection fields to save privately after completion. `GET /api/sessions` returns `{ sessions, practiceDates }`; `DELETE /api/sessions/:id` deletes an owned session.

## Social

`GET /api/feed` returns `{ feed }` with `authorName`, `sessionName`, `plannedSeconds`, `elapsedSeconds`, `kudos`, `comments`, and `viewerHasKudosed`. `POST /api/sessions/:id/kudos` toggles the current user's kudos and returns `{ kudosed }`. `GET /api/sessions/:id/comments` returns `{ comments }`; `POST` accepts `{ body }`; `DELETE /api/comments/:id` deletes an owned comment.

`PATCH /api/profile` accepts `{ name?, timezone?, weeklyTarget? }` and returns `{ user }`.
