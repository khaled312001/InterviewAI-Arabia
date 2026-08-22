# Interprova — Handover

Arabic-first AI interview coach, branded **Interprova** (formerly ثقتي / Thiqty — see
release/RELEASE-INTERPROVA-1.0.0.md for what the rename touched and why the package id
changed). Landing page +
Expo web/Android app + admin dashboard + Express API, all served by one Node
process on Hostinger.

Android package: `com.interprova.app` · Expo slug: `interprova`

**Live:** https://interview.khaledahmed.net

---

## 1. What runs where

| URL | Serves | Built from |
|---|---|---|
| `/` | Marketing landing page | `landing/index.html` (static, hand-written) |
| `/app`, `/app/*` | The user-facing app (Expo web) | `mobile/` → `expo export -p web` |
| `/admin/*` | Admin dashboard | `admin/` → `vite build` |
| `/api/*` | REST API | `backend/src/` |

Everything is one LiteSpeed/Passenger Node process:

```
~/domains/khaledahmed.net/interview-backend/
├── server.cjs          ← Passenger entry point (CJS shim → ESM app)
├── src/                ← the API
├── prisma/
├── .env                ← secrets, mode 600, never in git
└── public/{landing,admin,web}
```

`.htaccess` in `public_html/interview/` points Passenger here. Restart with
`touch tmp/restart.txt`.

---

## 2. Deploying

```bash
./scripts/deploy.sh              # everything
./scripts/deploy.sh --backend    # API only (fast)
./scripts/deploy.sh --frontends  # landing + admin + web bundle
./scripts/deploy.sh --migrate    # SQL migration only
```

The script backs up the database before every migration
(`~/backups/auto-<timestamp>.sql`).

**SSH:** `ssh -i ~/.ssh/interview_prod_ed25519 -p 65002 u405809647@145.79.20.56`

### Database migrations

`prisma migrate deploy` does **not** work on this host — it needs to create a
shadow database and the shared MySQL account cannot. Migrations are therefore
hand-written idempotent SQL in `backend/prisma/migrations/` and applied with
`mysql < file.sql`. They are safe to re-run.

After changing `schema.prisma`, run `npx prisma generate` **on the server**
with `TOKIO_WORKER_THREADS=1` — the box limits threads and an unconstrained
generate fails with `pthread_create: Resource temporarily unavailable`.

---

## 3. Switching the product on

Two env vars in `~/domains/khaledahmed.net/interview-backend/.env`, then
`touch tmp/restart.txt`.

### AI (currently OFF)

```ini
ANTHROPIC_API_KEY=sk-ant-...
AI_ENABLED=true
```

While `AI_ENABLED=false`, every AI route returns 503 **and consumes no user
quota** — nobody is charged for a feature that isn't running.

Cost per call is recorded in `claude_api_logs.cost_micro_usd`. Check real
margin before scaling:

```sql
SELECT feature,
       COUNT(*)                       AS calls,
       ROUND(SUM(cost_micro_usd)/1e6, 4) AS usd,
       ROUND(AVG(latency_ms))         AS avg_ms
FROM claude_api_logs
WHERE created_at > NOW() - INTERVAL 7 DAY
GROUP BY feature;
```

`CLAUDE_MODEL` is the main cost lever — `claude-opus-5` ($5/$25 per Mtok) →
`claude-sonnet-5` ($3/$15) → `claude-haiku-4-5` ($1/$5). Measure, don't guess.

### Payments (currently OFF)

```ini
EASYKASH_ENABLED=true
EASYKASH_API_KEY=<from merchant dashboard>
EASYKASH_WEBHOOK_SECRET=<from merchant dashboard>
```

Webhook URL to register with EasyKash:
`https://interview.khaledahmed.net/api/payments/webhook`

**Before going live, verify the signature recipe.** EasyKash publishes its API
reference inside the merchant dashboard, so `EASYKASH_SIGNATURE_FIELDS` (the
ordered list of fields concatenated before HMAC) is a configured default, not
a confirmed fact. If it is wrong, every genuine payment is rejected. Capture
one real callback and confirm the computed signature matches before switching
customers on. `backend/src/services/payments/easykash.js` is the only file
that needs to change.

To rehearse the whole flow without credentials, set `EASYKASH_MOCK=true`
locally — it simulates checkout → callback → activation end to end.
**Never in production:** it grants premium for free.

---

## 4. Building the Android app

Three environment facts that will waste an afternoon if you don't know them:

1. **Build from a path with no spaces.** `F:\InterviewAI Arabia\` breaks
   Gradle. The build runs from a copy at `C:\iaabuild`.
2. **`local.properties` must use forward slashes.** Java `.properties` files
   treat `\a` as an escape sequence, so `sdk.dir=F:\android-toolchain\sdk`
   silently becomes `F:androidtoolchainsdk` and fails with
   *"The filename, directory name, or volume label syntax is incorrect"*.
   Correct: `sdk.dir=F:/android-toolchain/sdk`.
3. **SDK 34 + build-tools 34.0.0 are required** (Expo SDK 51 pins them).

```bash
./scripts/build-android.sh            # signed APK  → release/
./scripts/build-android.sh --aab      # Play bundle → release/
```

The script syncs the sources to `C:\iaabuild`, runs `expo prebuild --clean`,
re-applies the signing config (prebuild wipes it every time), and builds.
Artifacts land in `release/`.


### 🔑 Signing key — back this up today

| | |
|---|---|
| Keystore | `C:\Users\KHALE\localbuild\ks\interviewai-upload.jks` |
| Alias | `interviewai-upload` |
| Password | `InterviewAI#2026Key` (store **and** key) |
| SHA-1 | `F9:FC:5E:A1:BC:58:5D:C1:AC:43:35:23:B1:B3:AA:9D:92:9D:45:FD` |
| SHA-256 | `81:D7:3A:44:EA:07:38:CC:AD:74:E3:BD:F1:B4:F5:7D:A0:7E:3C:C7:DE:41:B4:98:CE:56:4F:74:DB:B6:31:CC` |

**Lose this file and the app can never be updated on Google Play again.**
Copy it to a private cloud drive and an external disk now. It is deliberately
outside the repo and `*.keystore`/`*.jks` are gitignored.

The release `signingConfig` throws rather than falling back to the public
Android debug key — an unconfigured build fails loudly instead of producing an
APK Play will reject.

### Verify every build before you ship it

This is not paranoia. The first release build here came out signed with the
**Android debug key** and looked completely normal — `BUILD SUCCESSFUL`, right
size, installs fine. Play rejects that at upload, and nothing earlier in the
process says a word. The cause was Expo's template putting two comment lines
between `release {` and `signingConfig`, so a literal string replacement in the
build script missed silently. That replacement is now a structural regex with an
`assert`, but verify the artifact anyway — the check costs ten seconds.

```bash
BT=/f/android-toolchain/sdk/build-tools/36.0.0
"$BT/apksigner.bat" verify --print-certs release/interprova-app-release.apk | grep -E "DN|SHA-1"
"$BT/aapt2.exe" dump badging release/interprova-app-release.apk | grep -E "^package|application-label"
```

The SHA-1 must equal the keystore's, and the DN must read
`CN=InterviewAI Arabia, … O=Barmagly, … C=EG`. A debug-signed APK shows
`CN=Android Debug, O=Android, C=US` — the tell is unmistakable once you look.

**Reading the JS bundle: it is Hermes bytecode, not JavaScript.**
`assets/index.android.bundle` starts with magic `c61fbc03c103191f`. Its string
table stores ASCII as UTF-8 but **non-ASCII as UTF-16**, so grepping it for
Arabic finds nothing and looks alarmingly like the Arabic locale failed to
bundle. It didn't. Search for the UTF-16 encoding instead:

```python
raw = open('index.android.bundle','rb').read()
'مقابلة'.encode('utf-16-le') in raw   # True
'مقابلة'.encode('utf-8')     in raw   # False — means nothing
```

### Brand assets

**Two generators, and the split matters.**

`python scripts/generate-assets.py` regenerates the icon, adaptive icon,
monochrome (themed) icon, splash, favicon, Play Store icon, feature graphic
and the landing page's OG image **from the artwork in `logo/`**, so every
surface uses the same mark. Re-run it after any logo change.

`node scripts/render-text-assets.mjs` regenerates the three assets that
contain **Arabic text** (`landing/og-image.png`, `mobile/assets/splash.png`,
`store-assets/feature-graphic.png`) using a headless browser.

Why a browser: Pillow cannot render Arabic. It needs contextual shaping and
bidi reordering, which it only has when built against libraqm — this machine's
build is not. The usual workaround (`arabic-reshaper` + `python-bidi`) maps
letters into the Arabic Presentation Forms-B block, and **Cairo does not
contain that block at all** — it ships base codepoints and expects an OpenType
shaper. The result was "ثقتي" rendering as "يتقث" with tofu boxes wherever a
shadda or hamza appeared. A browser has HarfBuzz and the real font, so it is
both correct and simpler than reimplementing shaping. Run the Python generator
first (it produces `logo-mark.png`, which the browser renderer embeds), then
the Node one.

Brand colours are sampled from that artwork and mirrored in
`mobile/src/theme/tokens.ts`: `#2D73FD` (brand), `#0736A8` (deep), `#FEAF04`
(gold accent).

---

## 5. Design system

`mobile/src/theme/tokens.ts` is the single source of truth: spacing (4pt
grid), radii, a type scale with Arabic-aware line heights, elevation,
motion, layout, and semantic colour roles.

Rules the screens follow:

- No raw numbers for spacing/radii/font size — use `theme.spacing.*`,
  `theme.radii.*`, `<Text role="...">`.
- No raw colours — semantic roles only (`primaryMuted`, `successMuted`, …).
- Every screen roots in `<Screen>`, which owns safe-area edges, padding, and
  the max-content-width cap that stops the web build looking like a phone
  stretched across a desktop monitor.
- Direction comes from `useDirection()` — never hardcode `chevron-back` or
  `textAlign: 'right'`.
- Loading states use the `Skeleton*` components, not a bare spinner.

`npx tsc --noEmit` in `mobile/` must stay at zero errors.

---

## 6. Security notes

Fixed in this pass, worth not regressing:

- **Premium can only be granted by the payment webhook**, after signature,
  amount and currency are checked against a `payments` row we created at
  checkout. The old `POST /subscriptions/verify` endpoint granted a free month
  to anyone who asked; it is deleted.
- **Cron routes require `CRON_SECRET`** compared in constant time. The old
  loopback bypass trusted `req.ip`, which is derived from `X-Forwarded-For`
  behind a proxy — anyone could reset every user's quota.
- **Quota is consumed atomically** in one conditional `UPDATE` before the AI
  call, and refunded if the call fails. The old read-check-then-increment
  allowed concurrent requests to blow past the free limit.
- **AI failures throw** and return 503 without persisting anything. The old
  code returned a stub scored 6/10 and saved it as a real grade.
- **Webhooks are idempotent** via a unique `(provider, external_id)` row.
- **Env validation fails the boot in production** rather than warning.
- `/api/diag` is off by default and token-gated.
- **Errors carry a machine-readable `code`** (`QUOTA_EXCEEDED`,
  `PREMIUM_REQUIRED`, `AI_UNAVAILABLE`, `ACCOUNT_DISABLED`) alongside the
  human-readable message. The client branches on the code — a 402 "out of free
  questions" now renders a Subscribe CTA instead of a Retry button that could
  only fail again. Do not go back to matching on prose strings.

---

## 6b. Voice and interview language

The live interviewer speaks through **`window.speechSynthesis`**
(`mobile/src/speech/webSpeech.ts`), not the server. The old path scraped
Google Translate's TTS endpoint and awaited each ~180-char chunk serially, so a
four-sentence reply cost four sequential HTTPS round-trips before any sound —
robotic *and* slow. Browser neural voices (Microsoft Salma/Hamed Online on
Windows) start instantly and sound human.

`backend/src/routes/tts.js` is kept strictly as a fallback for browsers with no
usable voice. Voice selection scores quality first (`natural`/`neural`/`online`
+70, `espeak`/`compact` −80), then region, then persona gender — a natural
female voice reading Ahmed's lines beats a robotic male one.

**Interview language** is chosen on `MeetingSetupScreen` before the call and
travels in the `Meeting` route params. It drives the questions, the TTS voice,
`SpeechRecognition.lang` (ar-EG vs en-US), and the final evaluation.

Known trade-off: `speechSynthesis` exposes no `MediaStream`, so on the default
path the interviewer's voice reaches a session recording only via the tab audio
the user grants in the screen-share dialog. The candidate's own answers are
always captured.

---

## 7. Known gaps

- **Live meeting is web-only.** `MeetingScreen` uses `webkitSpeechRecognition`
  and `getUserMedia`, so on Android it renders but the voice path does not
  work. Either gate the CTA behind `Platform.OS === 'web'` or implement the
  native path (`expo-av` recording → a server-side STT endpoint).
- **TTS uses an unofficial Google Translate endpoint** with no contract or SLA,
  and the "male voice" is the same female voice. Move to Azure Speech
  (`ar-EG-ShakirNeural`) or ElevenLabs before promoting the feature.
- **Password reset sends no email.** The endpoint returns `{ok:true}` and the
  UI correctly says "if that address exists…", but no mail is ever sent. Needs
  an SMTP provider.
- **No recurring billing.** Every subscription is a one-off charge; renewal is
  a fresh manual checkout.
- **Admin dashboard was not redesigned** in this pass — it works and is now on
  the hardened API, but it has not been rebuilt on the new design language.
- Admin bundle is a single 1.4 MB chunk; worth code-splitting.
