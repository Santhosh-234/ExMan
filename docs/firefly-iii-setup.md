# Setting up Firefly III for ExMan

ExMan stores everything on your phone. Syncing to Firefly III is optional and one-way: ExMan pushes
**confirmed** transactions to your own server. Nothing is sent until you fill in the Sync section in Settings.

## 1. Run Firefly III

Pick one. All need Docker.

**Home PC / Raspberry Pi / VPS (recommended)** — official compose files: https://docs.firefly-iii.org/firefly-iii/installation/docker/

```bash
mkdir firefly && cd firefly
curl -LO https://raw.githubusercontent.com/firefly-iii/docker/main/docker-compose.yml
curl -L  https://raw.githubusercontent.com/firefly-iii/firefly-iii/main/.env.example -o .env
curl -L  https://raw.githubusercontent.com/firefly-iii/docker/main/database.env -o .db.env
```

Edit `.env`: set `APP_KEY` (exactly 32 random characters, e.g. `openssl rand -base64 24 | head -c 32`),
`DEFAULT_LANGUAGE=en_US`, `TZ=Asia/Kolkata`, and the DB password to match `.db.env`. Then:

```bash
docker compose up -d
```

Open `http://<server-ip>:8080`, register the first user (that user is the admin).

## 2. Make it reachable from your phone

The phone must reach the server's URL. Options, easiest and safest first:

1. **Tailscale** (free): install on the server and the phone; use `http://<tailscale-ip>:8080`.
   Works anywhere, nothing exposed to the internet.
2. **Same Wi-Fi only**: `http://192.168.x.x:8080`. Sync only works at home.
3. **Public HTTPS**: Cloudflare Tunnel or a reverse proxy (Caddy/Nginx) with a real certificate.
   Only do this with a strong password and 2FA enabled in Firefly.

ExMan's APK allows plain `http://` (needed for options 1 and 2). Prefer HTTPS if you expose it publicly.
Rebuild the APK after pulling this change; the setting is baked in at build time.

## 3. Create the asset account

Firefly needs the account the money moves in/out of. ExMan cannot create it.

Firefly -> **Accounts -> Asset accounts -> Create**: name it e.g. `Indian Bank`, currency INR, opening
balance optional. The name you type in ExMan must match this **exactly** (case-sensitive).
Merchant (expense) and income (revenue) accounts are created automatically on first sync.

If you use several banks/cards, create one asset account per bank. ExMan v1 sends everything to the single
account name you configure; per-bank mapping is a future improvement.

## 4. Create a personal access token

Firefly -> **Options -> Profile -> OAuth -> Personal Access Tokens -> Create New Token**. Name it `ExMan`
and copy the long token immediately (it is shown once). Tokens are valid for a year by default.

## 5. Configure ExMan

Settings -> Sync:

| Field | Value |
|---|---|
| Mode | **Firefly III** |
| Endpoint | Base URL only, e.g. `http://100.64.0.5:8080` (no `/api/v1`, no trailing slash needed) |
| Asset account | Exact name from step 3, e.g. `Indian Bank` |
| Token | The personal access token from step 4 |

Tap **Save & sync now**. Expected result: `Synced N transactions`.

Only transactions you have **confirmed** in the Inbox are sent. Editing a transaction after it was synced
marks it unsynced again, and the next sync will push it as a new entry (delete the old one in Firefly).

## One Firefly account per bank (optional)

By default every transaction goes to the single asset account named in Settings. If you created one asset account per bank or card in Firefly, open the account in ExMan (Settings > Accounts > Manage accounts > the account > **Firefly account…**) and enter that account's exact Firefly name. Accounts without one use the default. Transfers and card bill payments detected by ExMan are not sent.

## What gets sent

Per transaction, `POST {endpoint}/api/v1/transactions`:

- debit -> `withdrawal` from your asset account to the merchant; credit -> `deposit` from the merchant to your asset account
- amount in INR, ISO date, merchant as description, category name, tags
- `external_id` = `exman-<id>` and a note with bank, last-4 digits and payment mode

## Troubleshooting

| Symptom | Cause / fix |
|---|---|
| `Network request failed` | Phone can't reach the URL. Open it in the phone browser first. Check Tailscale is connected and the port is open. |
| `401` | Token wrong/expired, or you pasted it with spaces. Create a new one. |
| `422 ... source/destination` | Asset account name doesn't match exactly, or the account is inactive. |
| `422` on amount/date | Send a screenshot of the message; share the row's raw SMS to improve the parser. |
| Works on Wi-Fi, fails on mobile data | Server isn't reachable outside home; use Tailscale. |
| Check from a PC | `curl -H "Authorization: Bearer TOKEN" -H "Accept: application/json" http://SERVER:8080/api/v1/about` should return version JSON. |

## Using a custom REST endpoint instead

Choose **Custom REST**. ExMan POSTs once to the endpoint URL with `Authorization: Bearer <token>` and body
`{"transactions":[{id, amount_paise, amount, direction, merchant, category, bank, account_last4, payment_mode, ts, tags}]}`.
Return any 2xx to mark them synced.
