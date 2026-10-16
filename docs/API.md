# InterviewAI Arabia — API reference

Base URL (prod): `https://intervie-ai-arabia.barmagly.tech/api`
Base URL (dev): `http://localhost:4000/api`

All authenticated endpoints require `Authorization: Bearer <token>`.

## Health
- `GET /health` — liveness probe (no auth).

## Auth
| Method | Path | Body | Returns |
|---|---|---|---|
| POST | `/auth/register` | `{ email, password, name, language? }` | `{ user, token, refreshToken }` |
| POST | `/auth/login` | `{ email, password }` | `{ user, token, refreshToken }` |
| POST | `/auth/refresh` | `{ refreshToken }` | `{ token, refreshToken }` |
| POST | `/auth/forgot-password` | `{ email }` | `{ ok }` (stub) |
| POST | `/auth/logout` | — | `{ ok }` |

## User
| Method | Path | Auth | Returns |
|---|---|---|---|
| GET | `/user/me` | user | `{ user }` |
| PATCH | `/user/me` | user | `{ user }` |
| GET | `/user/stats` | user | totals + recent + breakdown |

## Categories & questions
| Method | Path | Auth | Returns |
|---|---|---|---|
| GET | `/categories` | public | `{ categories }` |
| GET | `/categories/:id/questions?limit=&difficulty=` | user | `{ category, questions }` |

## Sessions
| Method | Path | Auth | Body | Returns |
|---|---|---|---|---|
| POST | `/sessions/start` | user | `{ categoryId }` | `{ sessionId, category, question, quota }` |
| POST | `/sessions/:id/answer` | user | `{ questionId, userAnswer, language? }` | `{ answerId, feedback, tokensUsed, nextQuestion, quotaRemaining }` |
| POST | `/sessions/:id/end` | user | — | `{ session }` |
| GET | `/sessions/:id` | user | — | `{ session }` |
| GET | `/sessions?page=&limit=` | user | — | `{ sessions, page, limit, total }` |

## Subscriptions
| Method | Path | Auth | Body | Returns |
|---|---|---|---|---|
| POST | `/subscriptions/verify` | user | `{ productId, purchaseToken }` | `{ subscription }` |
| GET | `/subscriptions/status` | user | — | `{ active, plan, subscription }` |

## Voice interview (live, spoken)

The spoken interview does not post a turn at a time. The client opens one
websocket to Deepgram for the whole call, and Deepgram calls back here for each
reply. Two endpoints, with opposite callers.

| Method | Path | Auth | Body | Returns |
|---|---|---|---|---|
| POST | `/voice/session` | user | `{ meetingId, language, gender, context? }` | `{ url, token, expiresIn, settings }` |
| POST | `/voice/think` | voice token | OpenAI chat-completions request (sent by Deepgram) | `text/event-stream` of OpenAI chunks |
| POST | `/voice/speak` | voice token | OpenAI audio request (sent by Deepgram) | raw 16-bit mono PCM at 24 kHz |

**`/voice/session`** mints a short-lived Deepgram token and the Settings frame
for the call. The client forwards `settings` to `url` verbatim as the first
websocket message, authenticating the handshake with
`new WebSocket(url, ['bearer', token])` — a browser cannot set an
`Authorization` header on a websocket.

Refusals worth handling by code, not by message:
- `503 VOICE_UNAVAILABLE` — no Deepgram key on this deployment.
- `503 VOICE_NO_VOICE` — this language's voice is not answering. Arabic does
  not use Deepgram's voice (it has no Arabic at any price) and is checked
  against the voice service before the call opens.
- `409 MEETING_CLOSED` — the meeting ended. A voice session only exists for a
  live, metered meeting.

In every one of those cases the client falls back to the typed interview
(`/meeting/turn`), which is unchanged.

**`/voice/think`** is called by Deepgram, not by the app, and is authenticated
only by the bearer token minted above. It ignores any system prompt in the
request and rebuilds the interviewer from the meeting row — the Settings frame
travels through the client, so nothing that arrives on this endpoint is
trusted. It meters the turn exactly as `/meeting/turn` does.

**`/voice/speak`** is also called by Deepgram, for Arabic only, once per
sentence the interviewer says — English speaks with Deepgram's own voice and
never reaches here. It answers in OpenAI's audio shape, which Deepgram fixes at
`response_format: "pcm"`: raw 16-bit little-endian mono PCM at 24 kHz, no
container, streamed as it is synthesised. `model` and `voice` arrive in the body
and are ignored; the voice comes from the signed token. Not metered — synthesis
costs nothing and the turn that produced the text was already metered by
`/voice/think`.

## Live Interview Assistant

Help during a real interview: the app transcribes the room, and suggested
answers stream back in the candidate's voice, grounded in their career profile
(loaded server-side) and the job. A session is a `meeting_sessions` row with
`client = 'assist'`, metered by the same minute clock as a practice interview.

| Method | Path | Auth | Body | Returns |
|---|---|---|---|---|
| POST | `/assist/start` | user | `{ jobId? \| jobTitle?, company?, jobDescription?, notes?, language: auto\|en\|ar, uiLanguage, style: concise\|balanced\|detailed, resumeSessionId? }` | `{ sessionId, resumed, billing, hasCv, job, language, speechLanguage, style, streamingStt }` |
| POST | `/assist/:id/listen` | user | — | `{ url, token, expiresIn, language }` — Deepgram streaming credential (web) |
| POST | `/assist/:id/tick` | user | — | `{ billing }` |
| POST | `/assist/:id/answer` | user | `{ question, transcript?, previous?: string[], mode: answer\|regenerate\|shorter }` | `text/event-stream`: `delta {text}` … then `done {billing, partial}` or `error {code, message}` |
| POST | `/assist/:id/end` | user | — | `{ billing, billedSeconds, skippedSeconds }` |

Billing: wall-clock while the client ticks (every `billing.tickSeconds`), a
gap past `meeting_max_gap_seconds` (a pause) billed at zero, and each answer is
a turn with the usual floor — reversed when the model fails or the client hangs
up before the first word. `402 QUOTA_EXCEEDED` after the goodwill answer;
`409 MEETING_EXPIRED` means open a new session with the same setup.
`503 STT_UNAVAILABLE` on `/listen` means no Deepgram key: web falls back to the
browser recogniser, phones always use the on-device one.

## Calendar (Google Calendar, Meet, Tasks, .ics)

Server-side OAuth web flow with offline access. The refresh token is stored
encrypted (`calendar_connections`, migration 011); access tokens live in
process memory only. The admin sets `GOOGLE_OAUTH_CLIENT_SECRET` (and
optionally `GOOGLE_OAUTH_CLIENT_ID`, else the web sign-in client id) under
Admin → AI integrations → "Google Calendar". Until then every Google endpoint
answers `503 { error: 'calendar_not_configured', code: 'CALENDAR_NOT_CONFIGURED' }`
and `/calendar/status` reports `configured: false`. `/calendar/ics` always works.

| Method | Path | Auth | Body / query | Returns |
|---|---|---|---|---|
| GET | `/calendar/status` | user | — | `{ configured, provider, connected, email, scopes: { calendar, tasks }, connectedAt }` |
| GET | `/calendar/google/connect` | user | `?target=web\|native&origin=<page origin>` | `{ url }` — Google consent URL (scopes `openid email calendar.events tasks`, `access_type=offline`, `prompt=consent`, PKCE S256, signed 10-min single-use `state`) |
| GET | `/calendar/google/callback` | — (Google redirect) | `?code&state` | `303` to the return target with `?calendar=connected` or `?calendar=error&reason=denied\|expired\|exchange\|google\|not_configured` |
| DELETE | `/calendar/google` | user | — | `{ ok, removed }` — token revoked at Google, row deleted |
| GET | `/calendar/events` | user | `?days=1..60` (default 14) | `{ events: [{ id, title, start, end, allDay, location, description, joinUrl, joinProvider: meet\|zoom\|teams\|webex\|whereby\|jitsi\|other, looksLikeInterview, kind, company, role, htmlLink, organizer }], days }` |
| POST | `/calendar/events` | user | `{ kind: interview\|practice\|prep, start (ISO), durationMinutes 10..480, timeZone?, title?, company?, role?, location?, notes?, addMeet?, jobId?, applicationId?, language: en\|ar }` | `201 { event, application }` — `addMeet` creates a Google Meet link; reminders 1 day + 30 min; an interview linked to a job/application moves the tracker to `interview` and sets `nextActionAt` |
| GET | `/calendar/tasks` | user | — | `{ tasks: [{ id, title, notes, due, webViewLink }] }` (open tasks, default list) |
| POST | `/calendar/tasks` | user | `{ title, notes?, due?: YYYY-MM-DD, jobId? }` | `201 { task }` |
| POST | `/calendar/ics` | user | same body as `POST /calendar/events` (`addMeet` ignored) | `text/calendar` attachment (RFC 5545: escaped TEXT, CRLF, 75-octet folding, UTC times, two alarms). No Google connection needed. |

Other errors: `409 CALENDAR_NOT_CONNECTED` (never connected, or the grant was
revoked at Google — connect again), `403 CALENDAR_SCOPE_MISSING` /
`TASKS_SCOPE_MISSING` (the person unticked that permission on the consent
screen), `429 CALENDAR_RATE_LIMITED`, `502 CALENDAR_UPSTREAM`.

## Jobs (live search)

A search with words in it is live: the feeds that take a query (Himalayas,
Jobicy, Remote OK — plus JSearch, Adzuna and Jooble when their keys are set)
are asked at the moment of the search, in parallel, each with its own
timeout. What they return is folded into the index and leads the page with
`live: true`; the rest of the page is the index, refreshed every 10 minutes
from 120+ company boards and job boards. One live answer is reused for the
same query for 3 minutes. Arabic queries are searched with their English job
words («محاسب» → `accountant`) and a place in the query becomes the country
filter («في دبي» → `AE`, «عن بعد» → remote). A query with no exact match falls
back to any-word matching (`relaxed: true`).

| Method | Path | Auth | Body / query | Returns |
|---|---|---|---|---|
| GET | `/jobs/search` | optional | `?q&country&city&workplace&type&seniority&salary&posted&company&language&worldwide&sort&page&pageSize` | `{ total, page, pageSize, jobs: [card + live?], matched, relaxed?, query: { typed, searched, translated, country, remote }, live: false \| { at, count, sources[] }, checkedAt }` |
| GET | `/jobs/new-count` | — | `?since=ISO` + the search filters | `{ count, checkedAt }` — jobs indexed since `since` (floored at 7 days); the clients poll it every 90 s |

## CV templates, examples and the free first use

| Method | Path | Auth | Body / query | Returns |
|---|---|---|---|---|
| GET | `/career/templates` | — | — | `{ templates: [{ id, nameEn, nameAr, descEn, descAr }] }` — 10 single-column ATS-safe templates |
| GET | `/career/templates/:id/preview` | — | `?lang=en\|ar&role=` | HTML: the template filled with an example CV |
| GET | `/career/examples` | — | — | `{ roles: [{ id, labelEn, labelAr }] }` |
| GET | `/career/examples/:role\|random` | — | `?lang=en\|ar` | `{ role, labelEn, labelAr, cv }` — invented example data, nothing saved, no model call |
| GET | `/career/free-uses` | user | — | `{ freeUses: { cv_import, cv_bullets, cv_tailor, cover_letter } }` — `true` while that tool's first use is still free |

The first use of each of those four AI tools costs no balance, once per
account (`career_free_uses`, migration 012; app setting
`career_first_use_free` turns the offer off). The free use is taken with one
`INSERT IGNORE`, so parallel requests cannot both be free, and it is handed
back if the AI call fails. `GET /career/overview` also returns `freeUses`.

## Admin (requires admin JWT)
- `POST /admin/auth/login` — `{ email, password }` → `{ admin, token }`
- `GET  /admin/auth/me`
- `GET  /admin/users`  `PATCH /admin/users/:id`  `DELETE /admin/users/:id`
- `GET  /admin/users/:id/sessions`
- `POST /admin/categories`  `PATCH /admin/categories/:id`  `DELETE /admin/categories/:id`
- `GET  /admin/questions`  `POST /admin/questions`  `POST /admin/questions/bulk`
- `PATCH /admin/questions/:id`  `DELETE /admin/questions/:id`
- `GET  /admin/subscriptions`  `POST /admin/subscriptions/:id/refund`
- `GET  /admin/analytics/overview`
- `GET  /admin/analytics/popular-categories`
- `GET  /admin/ai-usage`
- `GET  /admin/reports`  `POST /admin/reports/:id/resolve`
- `GET  /admin/settings`  `PUT /admin/settings`
- `GET  /admin/admins`  `POST /admin/admins`

## Errors
All errors return `{ error: string, details?: any }`. Status codes follow REST conventions:
- `400` validation (Zod)
- `401` missing/invalid auth
- `402` payment required (free limit reached / premium-only content)
- `403` insufficient role
- `404` not found
- `409` conflict / duplicate
- `429` rate limited
- `500` server error
