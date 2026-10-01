# Business Calendar

[日本語](README.md)

Set your shop's **closed days, special hours, and regular hours** from your phone, and have them show up **instantly** on your website's calendar, its "open now" status, and Google Maps. Runs on Cloudflare Workers + D1 and fits entirely in **Cloudflare's free plan**.

- 📅 **Admin page**: tap a date → "Regular hours / Closed / Special hours (with a note)". Regular hours and weekly closing days too
- ⚡ **No redeploys**: your website reads the public API from the browser, so changes appear the moment you save
- 🧩 **Embeds anywhere**: one `<script>` tag gives you status and calendar Web Components
- 🔐 **Three login options**: email / Google, registered devices only (Cloudflare One), devices on your tailnet only (Tailscale tsidp)
- 📣 **Announce on social media**: build a message and a calendar image from your changes, then post to X or Instagram from the phone's share sheet (no APIs, no fees)
- 📤 **Share the calendar image**: visitors can share it with each platform's native share sheet (iOS / Android / Web)
- 🗺️ **Google Maps sync** (optional): updates regular and special hours through the Google Business Profile API
- 🌏 **Japanese / English**, any time zone

Used in production at [85-Store](https://85-store.com).

## How it works

```
Admin ──▶ calendar-admin.example.com ──▶ Cloudflare Access (login) ──▶ Worker ──▶ D1
                                                                         └─▶ Google Maps (optional)
Visitors ──▶ calendar.example.com/v1/calendar (public, GET only, no cache) ──▶ Worker ──▶ D1
         └─▶ calendar.example.com/widget.js (embeddable components)
```

| Host | Purpose | Protection |
|---|---|---|
| `calendar-admin.<your domain>` | Admin page and write API | Cloudflare Access. The Worker also verifies the Access JWT (signature, AUD, issuer) and the allowed emails |
| `calendar.<your domain>` | Public read API and widget | None (opening hours are public; GET only) |

## Requirements

- A Cloudflare account (free) and a domain whose DNS is on Cloudflare
- Node.js 20+
- Optional: approved access to the Google Business Profile API (for Google Maps sync)
- Optional: Tailscale (to restrict logins to devices on your tailnet)

## Setup

### 1. Deploy the Worker

```bash
git clone https://github.com/HayatoShimada/business-calendar.git
cd business-calendar
npm install
npx wrangler login

npx wrangler d1 create business-calendar   # put the database_id into wrangler.jsonc
```

Edit `routes`, `ADMIN_HOST`, `ADMIN_EMAILS`, `TIMEZONE`, `LANGUAGE` (`en`), and `STORE_NAME` in `wrangler.jsonc`, then:

```bash
npm run db:migrate:remote
npm run deploy
```

`https://calendar.<your domain>/v1/calendar` should return JSON. The admin page returns 401 until step 2 is done (expected).

> To keep your config outside this repository, use `npx wrangler deploy --config ../my-store/wrangler.jsonc` (`main` and `migrations_dir` are relative to the config file).

### 2. Add a login to the admin page (Cloudflare Access)

Protect `calendar-admin.<your domain>` with Cloudflare Zero Trust (free for up to 50 users). Pick one of three login methods — see **[docs/auth.md](docs/auth.md)** (Japanese).

| Method | Best for | Extra server |
|---|---|---|
| **A. Email / Google** | Getting started. The simplest | None |
| **B. Registered devices only (Cloudflare One)** | Allow only the shop's phone or PC | None |
| **C. Tailnet devices only (tsidp)** | You already use Tailscale | Something that runs tsidp 24/7 ([free-tier options](docs/tsidp-hosting.md)) |

After creating the Access application, set `ACCESS_TEAM_DOMAIN` (e.g. `your-team.cloudflareaccess.com`) and `ACCESS_AUD` in `wrangler.jsonc` and run `npm run deploy`.

### 3. Embed it in your website

```html
<script src="https://calendar.example.com/widget.js" defer></script>

<!-- Status ("Open now · until 18:00", "Closed today", ...) -->
<business-status lang="en"></business-status>

<!-- This month and next -->
<business-calendar months="2" lang="en"></business-calendar>
```

| Attribute | Description |
|---|---|
| `months` | Number of months to show (1–6, default 2) |
| `lang` | `ja` / `en` (defaults to the page's `<html lang>`) |
| `closed-mark` | Marker for closed days: `cat` (a curled-up cat) or a dot when omitted |
| `src` | API base URL (defaults to the origin that served widget.js) |
| `share` | Show a "Share calendar" button ([docs/share.md](docs/share.md)) |

Style it with CSS custom properties: `--bc-ink`, `--bc-muted`, `--bc-rule`, `--bc-surface`, `--bc-closed`, `--bc-open-bg` / `--bc-open-ink`. The components use Shadow DOM and expose `::part(status)`, `::part(table)`, and more.

For a custom UI in React / Next.js etc., read the public API (below) directly. See [85-Store's implementation](https://github.com/HayatoShimada/85store/blob/main/lib/business-calendar.ts) for an example.

### 4. Announce on social media

"Create announcement" in the admin page builds a message from your changes (or a monthly summary) and a calendar image (feed 4:5 / stories 9:16), which you post to X, Instagram, etc. from the share sheet. See **[docs/share.md](docs/share.md)** (Japanese).

### 5. (Optional) Sync to Google Maps

On every save, regular hours and special hours (today through 180 days ahead) on Google Maps are updated to match. See **[docs/google.md](docs/google.md)** (Japanese).

## Public API

`GET https://calendar.example.com/v1/calendar?from=YYYY-MM-DD&to=YYYY-MM-DD` (defaults to 7 days ago through 120 days ahead; up to 400 days)

```json
{
  "regular": { "opens": "10:00", "closes": "18:00", "closedWeekdays": [0] },
  "days": {
    "2026-10-05": { "kind": "hours", "opens": "13:30", "closes": "18:00" },
    "2026-10-07": { "kind": "closed", "note": "Inventory day" }
  },
  "updatedAt": "2026-10-01T08:28:58.015Z",
  "timezone": "America/New_York"
}
```

`closedWeekdays`: 0 = Sunday … 6 = Saturday. Dates are in the shop's time zone. CORS allows any origin; `Cache-Control: no-store`. The admin API is described in [docs/api.md](docs/api.md).

## Configuration (`vars` in `wrangler.jsonc`)

| Variable | Description |
|---|---|
| `ADMIN_HOST` | Hostname of the admin page. The admin page and write API are not served on any other host |
| `ACCESS_TEAM_DOMAIN` / `ACCESS_AUD` | Cloudflare Access team domain and the application's AUD tag |
| `ADMIN_EMAILS` | Comma-separated emails allowed to use the admin page |
| `TIMEZONE` | The shop's time zone (IANA name, default `Asia/Tokyo`) |
| `LANGUAGE` | Language of the admin page and messages (`ja` / `en`) |
| `STORE_NAME` | Store name used in the admin header, announcements, and calendar images |
| `SHARE_URL` | URL included in announcements and calendar images (the page with your calendar) |
| `IMAGE_CLOSED_MARK` | Marker for closed days in calendar images (`cat` / `dot`) |

Google Maps credentials (`GOOGLE_CLIENT_ID`, etc.) are stored as secrets ([docs/google.md](docs/google.md)).

## Development

```bash
npm test                 # unit tests
npm run typecheck

npm run db:migrate:local
node test/access-mock.mjs /tmp/tokens.json &          # test Access keys and tokens
npx wrangler dev --local --env-file test/dev.vars --ip 127.0.0.1 --port 8787
bash test/api-test.sh /tmp/tokens.json
```

## License

[MIT](LICENSE)
