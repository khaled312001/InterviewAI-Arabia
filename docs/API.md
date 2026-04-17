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
