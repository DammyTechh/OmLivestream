# Platform API Setup

How to obtain credentials for every platform OmliveStream can broadcast to, and
how to wire the live-comment feeds where the platform offers one.

Everything here matches what the code actually asks for. Redirect URIs and
scopes are copied from `src/modules/platforms/platforms.service.ts` (broadcast
connections) and `src/modules/auth/auth.service.ts` (social sign-in) — if you
paste a different value into a developer console, the OAuth handshake fails
with a redirect-mismatch error and no useful message.

**Before you start:** decide your `API_BASE_URL`. Every redirect URI below is
derived from it. Locally that is `http://localhost:3001`; in production it is
your deployed API origin (e.g. `https://api.omlivestream.com`). Most consoles
let you register several redirect URIs on one app, so register both and avoid
maintaining two sets of credentials.

---

## At a glance

| Platform | Broadcast method | Credentials needed | Approval? | Live comments |
|---|---|---|---|---|
| YouTube | RTMP + Live Streaming API | `YOUTUBE_CLIENT_ID/SECRET` | Verification for public use | ✅ Implemented (polled) |
| Facebook | RTMPS + Graph API | `META_APP_ID/SECRET` | ✅ App Review | ✅ Implemented (polled) |
| Instagram | Graph API | `META_APP_ID/SECRET` | ✅ App Review | ⚠️ Not wired |
| Twitch | RTMP + Helix | `TWITCH_CLIENT_ID/SECRET` | No | ⚠️ Read not wired; replies work |
| TikTok | Live API | `TIKTOK_CLIENT_KEY/SECRET` | ✅ Partner access, 2–4 weeks | ❌ No public API |
| X (Twitter) | Live video | `TWITTER_CLIENT_ID/SECRET` | Paid tier | ❌ No public API |
| LinkedIn | Live Video API | `LINKEDIN_CLIENT_ID/SECRET` | ✅ Application, 2–4 weeks | ❌ No public API |
| Kick | RTMP, manual key | none | No | ❌ No public API |

The comment column is the honest state of the code, not the platform's
marketing. See [Live comments](#live-comments) for what each value means.

---

## Redirect URIs

Two separate families. Confusing them is the single most common setup mistake,
because both use the same client credentials on Google, Meta, TikTok and Twitch.

**Broadcast connection** — user links a channel to publish to:

```
{API_BASE_URL}/api/v1/platforms/oauth/callback/{platform}
```

`{platform}` ∈ `youtube` `facebook` `instagram` `twitch` `tiktok` `twitter` `linkedin`

**Social sign-in** — user creates or logs into an OmliveStream account:

```
{API_BASE_URL}/api/v1/auth/social/{provider}/callback
```

`{provider}` ∈ `google` `facebook` `instagram` `tiktok` `twitch`

Register *both* URIs for any platform you want to use for both purposes. They
request different scopes and are handled by different services; a single
registered URI will not serve both.

Sign-in can use its own client credentials, set via the optional
`AUTH_<PROVIDER>_CLIENT_ID` / `_SECRET` variables. Each falls back to the
broadcast client when unset, so the split is opt-in. It is worth doing: the
broadcast clients carry publishing scopes, so sharing one means your "Sign in
with Google" button opens a consent screen asking permission to upload videos
and manage the user's channel — which reads as a phishing attempt and costs
signups.

### The sign-in flow

1. Frontend calls `GET /auth/social/{provider}/url` → `{ authUrl, state }`.
   The state is stored server-side in Redis with a 10-minute life.
2. Browser goes to `authUrl`; the user approves.
3. Provider redirects to `{API_BASE_URL}/api/v1/auth/social/{provider}/callback`.
   That handler verifies and consumes the state, exchanges the code at the
   provider's own token endpoint, fetches the profile, and finds or creates the
   account.
4. It redirects to `{FRONTEND_URL}/auth/callback?ticket=…`, and the frontend
   trades the ticket at `POST /auth/social/exchange` for the JWT pair.

The ticket hop exists so tokens never travel in a URL, where they would land in
browser history and in the `Referer` header of the next request the page makes.
Both the state and the ticket are single-use.

### Providers that give you no email

Instagram and TikTok disclose no email address at any scope, and Facebook omits
it for accounts registered with a phone number. Those accounts are created
against a placeholder `@social.omlivestream.invalid` address, flagged with
`needsEmail: true`, and the frontend collects a real address — verified by OTP —
before onboarding proceeds. Nothing is mailed to the account until then, so the
welcome email and any waitlist reward are deferred to that point.

Accounts are matched on the provider's own user id, held in `social_identities`,
rather than on email. The email is not a usable key when half the providers
never supply one, and it changes; the provider id does not.

---

## YouTube

**Console:** [console.cloud.google.com](https://console.cloud.google.com)

1. Create a project (or reuse one).
2. **APIs & Services → Library**, enable both:
   - *YouTube Data API v3*
   - *YouTube Live Streaming API*
3. **OAuth consent screen** → External. Fill in app name, support email, logo,
   homepage, privacy policy and terms URLs. Add the scopes below. Add yourself
   as a test user so you can use the app before verification.
4. **Credentials → Create credentials → OAuth client ID → Web application.**
5. Authorised redirect URIs — add both:
   - `{API_BASE_URL}/api/v1/platforms/oauth/callback/youtube`
   - `{API_BASE_URL}/api/v1/auth/social/google/callback`
6. Copy the client ID and secret into `YOUTUBE_CLIENT_ID` / `YOUTUBE_CLIENT_SECRET`,
   and set `YOUTUBE_REDIRECT_URI` to the first URI above.

**Scopes**

| Purpose | Scope |
|---|---|
| Broadcast | `https://www.googleapis.com/auth/youtube.force-ssl` |
| Broadcast | `https://www.googleapis.com/auth/youtube.upload` |
| Sign-in | `openid` `profile` `email` |

`youtube.force-ssl` is the one that covers creating broadcasts, binding streams
**and** reading/writing live chat — the comment feed rides on it, so there is no
extra scope to request for comments.

**Verification.** Both broadcast scopes are *sensitive*, so an unverified app is
capped at 100 test users and shows an "unverified app" interstitial. Verification
requires the consent screen fully filled in, a verified domain, and a demo video
showing the OAuth flow and what you do with the data. Budget several weeks;
Google frequently comes back with questions.

**Quota — read this before launch.** The default is 10,000 units/day for the
whole project, shared across every user. `liveChatMessages.list` costs 5 units
per call. A single stream polled every 5 seconds burns ~3,600 units/hour, so the
default quota supports roughly **three hours of one broadcast per day**. This is
the binding constraint on the entire comment feature, which is why the poller
honours `pollingIntervalMillis` from the response instead of using a fixed
interval. Request a quota increase through the Cloud Console early — it is
reviewed by hand and is slow.

---

## Facebook

**Console:** [developers.facebook.com](https://developers.facebook.com)

1. **Create App → Business.**
2. Add products: **Facebook Login**, and **Live Video API** where available.
3. Facebook Login → Settings → Valid OAuth Redirect URIs:
   - `{API_BASE_URL}/api/v1/platforms/oauth/callback/facebook`
   - `{API_BASE_URL}/api/v1/auth/social/facebook/callback`
4. Copy App ID and App Secret into `META_APP_ID` / `META_APP_SECRET`, and set
   `FACEBOOK_REDIRECT_URI`.

**Scopes**

| Purpose | Scope |
|---|---|
| Broadcast | `publish_video` |
| Broadcast | `pages_manage_posts` |
| Broadcast | `pages_read_engagement` |
| Sign-in | `email` `public_profile` |

`pages_read_engagement` is what makes the comment feed work — the Graph
`/{live_video_id}/comments` edge reads through it.

**App Review is mandatory.** `publish_video`, `pages_manage_posts` and
`pages_read_engagement` are all reviewable permissions. In development mode they
work only for users with a role on the app (admin, developer, tester), which is
fine for building but means zero real customers. Submission needs a screencast
of the full flow, a written justification per permission, and a completed
Business Verification for the owning business. Business Verification alone can
take a week or more and requires legal documents.

**Ingest.** Facebook wants RTMPS, not RTMP: `rtmps://live-api-s.facebook.com:443/rtmp`.

---

## Instagram

**Console:** same Meta app as Facebook — `META_APP_ID` / `META_APP_SECRET` are
shared. Only the redirect URI differs.

1. Add the **Instagram** product to the app.
2. Valid OAuth Redirect URIs:
   - `{API_BASE_URL}/api/v1/platforms/oauth/callback/instagram`
   - `{API_BASE_URL}/api/v1/auth/social/instagram/callback`
3. Set `INSTAGRAM_REDIRECT_URI`.

**Scopes**

| Purpose | Scope |
|---|---|
| Broadcast | `instagram_basic` |
| Broadcast | `instagram_content_publish` |
| Sign-in | `user_profile` `user_media` |

**Constraints.** The account must be a Professional (Business or Creator)
account linked to a Facebook Page — personal accounts cannot be used at all.
`instagram_content_publish` requires App Review.

Live comments on Instagram need a Business account *and* a separate permission
beyond the two above, and are not wired in `comment-ingestion.service.ts`.
Connecting Instagram gets you publishing, not chat.

---

## Twitch

**Console:** [dev.twitch.tv/console](https://dev.twitch.tv/console)

1. **Applications → Register Your Application.**
2. OAuth Redirect URLs:
   - `{API_BASE_URL}/api/v1/platforms/oauth/callback/twitch`
   - `{API_BASE_URL}/api/v1/auth/social/twitch/callback`
3. Category: *Broadcasting Suite*.
4. Copy Client ID, then **New Secret** — the secret is shown once. Set
   `TWITCH_CLIENT_ID`, `TWITCH_CLIENT_SECRET`, `TWITCH_REDIRECT_URI`.

**Scopes**

| Purpose | Scope |
|---|---|
| Broadcast | `channel:manage:broadcast` |
| Broadcast | `user:read:broadcast` |
| Chat read | `chat:read` |
| Chat write | `chat:edit` |
| Sign-in | `user:read:email` |

No review process — Twitch is the fastest platform to get working end to end.

**Chat.** Twitch chat is IRC/EventSub over WebSocket, not an HTTP endpoint you
can poll, so it has no poller in the ingestion service. Sending works: replies go
to Helix `POST /helix/chat/messages`, which needs `chat:edit` and sends the
`Client-Id` header alongside the bearer token. To add read support you would
attach an EventSub WebSocket subscription for `channel.chat.message` rather than
extending the polling loop.

---

## TikTok

**Console:** [developers.tiktok.com](https://developers.tiktok.com)

1. Register as a developer, create an app.
2. Redirect URIs:
   - `{API_BASE_URL}/api/v1/platforms/oauth/callback/tiktok`
   - `{API_BASE_URL}/api/v1/auth/social/tiktok/callback`
3. Set `TIKTOK_CLIENT_KEY` (TikTok calls it a *client key*, not client ID),
   `TIKTOK_CLIENT_SECRET`, `TIKTOK_REDIRECT_URI`.

**Scopes**

| Purpose | Scope |
|---|---|
| Broadcast | `user.info.basic` `live.write` `video.publish` |
| Sign-in | `user.info.basic` |

**`live.write` is gated.** It is not self-serve: you must apply for Live API
partner access, describing your product and expected volume. Expect **2–4 weeks**,
and expect rejection if the app is not live and demonstrable. Plan for TikTok to
be the last platform you can ship.

No public live-comment read API — nothing to configure, and nothing the app can
show for TikTok chat.

---

## X (Twitter)

**Console:** [developer.twitter.com](https://developer.twitter.com)

1. Create a project and an app inside it.
2. **User authentication settings** → OAuth 2.0, type *Web App*, with PKCE.
3. Callback URI: `{API_BASE_URL}/api/v1/platforms/oauth/callback/twitter`
4. Set `TWITTER_CLIENT_ID`, `TWITTER_CLIENT_SECRET`, `TWITTER_REDIRECT_URI`.

**Scopes:** `tweet.read` `tweet.write` `users.read` `offline.access`

`offline.access` is what returns a refresh token. Without it the connection dies
at the first token expiry and the user has to reconnect by hand.

**Cost.** The free tier cannot do live video. A paid plan (Basic, US$100/month at
time of writing) is the practical entry point. Verify current pricing before
committing — X has changed its API tiers repeatedly.

No public live-comment API.

---

## LinkedIn

**Console:** [developer.linkedin.com](https://developer.linkedin.com)

1. Create an app; it must be associated with a LinkedIn **Company Page** you
   administer.
2. **Auth** tab → Authorised redirect URLs:
   `{API_BASE_URL}/api/v1/platforms/oauth/callback/linkedin`
3. Set `LINKEDIN_CLIENT_ID`, `LINKEDIN_CLIENT_SECRET`, `LINKEDIN_REDIRECT_URI`.

**Scopes:** `w_member_social` `r_basicprofile`

**Live Video API requires an application** — it is not in the self-serve product
list. Apply through LinkedIn's Live Video access form; **2–4 weeks**, and they
decline applications from products without an established user base. The
company page also needs to be approved for LinkedIn Live independently.

No public live-comment API.

---

## Kick

**No developer app, no OAuth, no credentials.** Kick has no public API for
third-party publishing, so the user pastes their stream key directly:

```
POST /api/v1/platforms/connect/manual
```

The ingest endpoint is `rtmp://ingest.kick.com/live`. The user finds their key
under Kick → Settings → Stream Key. Because the key is typed rather than
granted, there is nothing to renew and nothing that expires — but also no way to
detect revocation until a broadcast fails.

---

## Live comments

What each state in the table means:

**✅ Implemented** — a poller exists in `src/websocket/comment-ingestion.service.ts`
and comments reach the browser over the socket.

- **YouTube** polls `liveChatMessages.list`. The response supplies both the
  cursor (`nextPageToken`) and the interval the server wants (`pollingIntervalMillis`),
  and the poller honours the interval. Polling faster returns the same page and
  burns quota for nothing. Covered by `youtube.force-ssl`.
- **Facebook** polls Graph `/{live_video_id}/comments` with a `since` cursor.
  The cursor is inclusive at second granularity, so the boundary comment
  re-delivers every poll; rows are upserted with `ignoreDuplicates` rather than
  inserted so one duplicate cannot abort a 200-row batch. Covered by
  `pages_read_engagement`.

**⚠️ Not wired** — the platform has an API but no poller here.

- **Instagram** needs a Business account plus a permission beyond the two scopes
  the app requests.
- **Twitch** chat is a WebSocket transport, not a pollable endpoint, so it
  cannot reuse the polling loop. Outbound replies already work.

**❌ No public API** — TikTok, X, LinkedIn and Kick expose no third-party live
chat read API. Nothing to configure.

Replies are outbound-only for YouTube, Facebook, Instagram and Twitch
(`src/websocket/platform-reply.service.ts`). Note the asymmetry on Twitch: it can
send without being able to read.

---

## Webhooks

Only two webhooks matter, and neither belongs to a streaming platform.

**Paystack** — `{API_BASE_URL}/api/v1/billing/webhooks/paystack`
Enable: `charge.success`, `subscription.create`, `subscription.disable`,
`invoice.create`, `invoice.payment_failed`.

`charge.success` is load-bearing beyond activating the subscription: it is where
a waitlist percentage code is consumed and where the discount cycle counter is
decremented. If it is not delivered, waitlist members are charged full price
from the second month.

**Meta** — optional. Subscribing to the `live_videos` webhook field gives you
stream-state changes without polling. The comment feed does not depend on it.

The streaming platforms send nothing else worth subscribing to for this product.

---

## Verifying a connection

After setting the variables, restart the API — `src/config/env.ts` validates
every one at boot and refuses to start on a missing value, so a typo surfaces
immediately rather than at the first user click.

Then, per platform:

1. `GET /api/v1/platforms/oauth/url/:platform` → returns the consent URL.
2. Open it, approve, and confirm the callback lands on your API without a
   redirect-mismatch error.
3. `GET /api/v1/platforms` → the connection should be listed with
   `status: connected`.

A redirect mismatch at step 2 is almost always the console holding a different
URI than the env var — check for a trailing slash, `http` vs `https`, and
`localhost` vs `127.0.0.1`, which the consoles treat as different hosts.

---

## Realistic launch order

Approval time, not engineering time, sets the schedule:

1. **Twitch** and **Kick** — same day, no review.
2. **YouTube** — works immediately for test users; start verification in parallel.
3. **Facebook** and **Instagram** — start Business Verification now; App Review
   cannot begin until it clears.
4. **X** — quick once you are paying.
5. **TikTok** and **LinkedIn** — apply as early as possible and assume 2–4 weeks
   with a real chance of rejection on the first attempt.

Both TikTok and LinkedIn look more favourably on an application from a product
that is already live with other platforms, so shipping the easy ones first
improves the odds on the hard ones.

---

See also: [CONFIG.md](./CONFIG.md) for the full environment variable reference.
