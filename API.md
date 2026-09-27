# Still API

All endpoints are same-origin JSON APIs. Auth is an httpOnly `still_session` cookie; send browser requests with credentials. Mutating requests must include the same origin.

## Auth

`POST /api/auth/signup` body `{ email, password, name, timezone }`; returns `{ user: { id, email, name, timezone, weeklyTarget } }` and sets a 30-day cookie. `POST /api/auth/login` body `{ email, password }` returns the same shape. `POST /api/auth/logout` returns `{ ok: true }`. `GET /api/auth/me` returns `{ user }`.

## Practice

`POST /api/sessions/start` body `{ plannedSeconds, name? }`, returning `{ session }`. `POST /api/sessions/:id/complete` body `{ elapsedSeconds, beforeMood?, duringMood?, afterMood?, beforeNote?, duringNote?, afterNote? }`; elapsed time is verified against the server clock. It returns `{ session, practiceDate }`, and repeat calls are idempotent. `PATCH /api/sessions/:id/reflection` accepts the reflection fields to save privately after completion. `GET /api/sessions` returns `{ sessions, practiceDates }`; `DELETE /api/sessions/:id` deletes an owned session.

## Social

`GET /api/feed` returns `{ feed }` with `authorName`, `sessionName`, `plannedSeconds`, `elapsedSeconds`, `kudos`, `comments`, and `viewerHasKudosed`. `POST /api/sessions/:id/kudos` toggles the current user's kudos and returns `{ kudosed }`. `GET /api/sessions/:id/comments` returns `{ comments }`; `POST` accepts `{ body }`; `DELETE /api/comments/:id` deletes an owned comment.

`PATCH /api/profile` accepts `{ name?, timezone?, weeklyTarget? }` and returns `{ user }`.

## Shared sits

Shared sits use the existing signed-in account and an invitation token. The
token grants access to that sit only; it does not authenticate a user.

`POST /api/shared-sits` creates a host-owned sit with `{ plannedSeconds }` and
returns `{ sit, inviteToken }`. `GET /api/shared-sits/:token` returns the sit
and its members for signed-in invitees. `POST /api/shared-sits/:token/join`
joins the current user once. `POST /api/shared-sits/:token/start` starts the
host's sit. `POST /api/shared-sits/:token/leave` lets a member leave before or
during the sit. `POST /api/shared-sits/:token/cancel` cancels a host-owned sit.

Only the host can start or cancel; a signed-in user can join once and leave
their own membership. Shared-sit session completion remains owned by the
participant, and reflections remain private to that participant.
