# Sibi Auto-Responder — Slack Ticketing Assistant

**Important: this version replies AS YOU, not as a separate bot.**

When someone sends you (Sibisiddharth) a direct message on Slack, this app
intercepts it, figures out whether they're trying to create a ticket or
check a ticket's status, does the Freshdesk work, and replies — but the
reply appears to come from your real account. There is no bot name, icon,
or "APP" label; it looks exactly like you typed it.

## What it does

- Someone **DMs you** in plain English ("my login isn't working") → the
  app creates a Freshdesk ticket on their behalf and replies as you,
  confirming it.
- They ask **"what's the status of 12345?"** → it looks up the ticket and
  replies as you, in natural language.
- Their email is **resolved automatically** via Slack's `users.info` API
  (no manual `/register` step — that only made sense for the old
  separate-bot version).
- **External webhook** (`POST /webhook/notify`) — any external system
  (e.g. a Freshdesk automation rule) can call this to have you
  automatically send someone a DM when their ticket updates.
- **MoEngage FAQs** — answers common MoEngage product questions from a
  local knowledge base covering analytics, segmentation, channels,
  personalization, and AI features.

## Architecture

```
Someone DMs you → app.js (raw Express, verifies Slack's signature)
                       ├─ services/groq.js       (parse intent / write reply)
                       ├─ services/freshdesk.js  (create/check ticket)
                       └─ services/slack.js      (posts using YOUR user token)

External system → POST /webhook/notify → services/slack.js → DM as you
```

We use **raw Express** here instead of the Bolt.js framework, because
Bolt assumes your app has its own bot identity — this app deliberately
has none; every message goes out over your personal user token.

`store/userMap.js` is a minimal file-based cache of Slack user ID →
email (populated automatically, or manually if `users.info` can't find
one). Swap it for a real database later if needed.

## Read this before you turn this on

- Every reply looks exactly like you personally wrote it. There's no way
  for the person messaging you to tell it's automated.
- If you reply to someone yourself around the same time the automation
  does, both messages go out — there's no "wait for a human" logic here.
- Your user token (`xoxp-...`) can do anything your account can do within
  its granted scopes. Treat it like a password: never commit it, never
  log it, store it in a secrets manager in production.

## 1. Expose a public URL first

Slack needs to reach your server over HTTPS, and the URL has to go into
the manifest before you create the app.

```bash
ngrok http 3000
```

Copy the `https://...ngrok-free.app` (or `.dev`) URL it gives you.

## 2. Create the Slack app

1. Open `manifest.json` and replace `YOUR_PUBLIC_URL` with your ngrok URL
   (one place: `event_subscriptions.request_url`)
2. Go to https://api.slack.com/apps → **Create New App** → **From an app
   manifest** → select your workspace → paste the manifest → **Create**

## 3. Install the app AS YOURSELF

This is the step that makes replies come from you specifically:

- **OAuth & Permissions** → **Install to Workspace**
- Slack will show a consent screen — since this manifest only requests
  **User Token Scopes** (not bot scopes), you're authorizing the app to
  act *as your account*
- Copy the **User OAuth Token** — starts with `xoxp-`, not `xoxb-`

## 4. Get your Slack user ID

Slack → click your profile picture → **View profile** → **More (•••)** →
**Copy member ID**. It looks like `U0ABC1234`.

## 5. Get your other credentials

- **Signing Secret**: **Basic Information** → **App Credentials**
- **Freshdesk**: Admin → Profile Settings → API key. Note your subdomain
  (the `yourcompany` in `yourcompany.freshdesk.com`)
- **Groq**: https://console.groq.com/keys

## 6. Configure environment

```bash
cp .env.sample .env
```

Fill in every value:

```
SLACK_USER_TOKEN=xoxp-...
SLACK_SIGNING_SECRET=...
MY_SLACK_USER_ID=U0ABC1234
PORT=3000
FRESHDESK_DOMAIN=yourcompany
FRESHDESK_API_KEY=...
GROQ_API_KEY=...
GROQ_MODEL=llama-3.3-70b-versatile
WEBHOOK_SECRET=some-long-random-string
```

## 7. Install and run

```bash
npm install
npm start
```

You should see:
```
⚡ Auto-responder running on port 3000 — replying as user U0ABC1234
   Slack events:      POST /slack/events
   External webhook:  POST /webhook/notify
```

## 8. Try it out

Have a **different** Slack account (colleague, or a test account) DM
you directly — not an app, just a normal DM to your name. Send:

```
my vpn keeps disconnecting
```

You should see a reply appear from **you**, automatically, in that DM —
it creates a Freshdesk ticket and confirms. Then try:

```
what's the status of ticket 12345?
```
(use a real ticket ID from your Freshdesk)

You can also ask `What is Funnel Analysis?` or `Can MoEngage send push
notifications?` to receive a grounded FAQ answer without creating a ticket.

## 7. Wire up proactive notifications

In Freshdesk: **Admin → Automations → Ticket Updates** → create a rule
(e.g. "when status changes to Resolved") → add a **Webhook** action:

- URL: `https://YOUR_URL/webhook/notify`
- Method: `POST`
- Headers: `X-Webhook-Secret: <your WEBHOOK_SECRET>`
- Content type: `application/json`
- Body (custom):
  ```json
  {
    "email": "{{ticket.requester.email}}",
    "ticket_id": "{{ticket.id}}",
    "status": "{{ticket.status}}"
  }
  ```

Any other system can call the same endpoint the same way — it's not
Freshdesk-specific, it just needs the user's email and something to say.

## Notes / next steps

- `store/userMap.json` is created automatically on first `/register` and
  is git-ignored. For production, replace `store/userMap.js` with a real
  database (Postgres, Redis, etc.) — keep the same exported functions and
  nothing else in the app needs to change.
- The webhook uses a shared-secret header for simplicity. For stronger
  security, switch to HMAC request signing if your external system
  supports it.
- Rate limits: Slack's `chat.postMessage` is capped around 1 msg/sec per
  workspace on standard tiers — fine for this use case, but worth knowing
  if notification volume grows.
