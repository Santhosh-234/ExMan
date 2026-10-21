# ExMan: Product Requirements Document

Status: **DRAFT v3: all open questions resolved, awaiting final approval** · Owner: Santhosh · Scope: V2.0 (V2.1 and later noted)

## 1. Summary

ExMan is a private, offline-first expense manager for Android that tracks money automatically from the bank, card and UPI alerts already on your phone. You don't type expenses; you glance at what ExMan found, confirm it with a swipe, and see where your money goes. Your financial data stays on the device unless you choose to sync to a server you own. Anonymous product telemetry (on by default, switch-off anytime, no financial content, ever) helps the app improve and is fully visible and controllable by you.

**One-line promise:** *"Your money, tracked for you, seen only by you."*

## 2. Problem

- Manual expense apps die within weeks because entering every transaction is tedious.
- Indian money moves through many channels at once (savings accounts, debit cards, credit cards, UPI apps, cash). No single statement shows it all.
- Existing automatic trackers upload your SMS and financial data to their servers, ask for logins to your accounts, or monetise your data. Many Indian users are uncomfortable with that.
- Bank alerts are inconsistent (hundreds of formats), so naive trackers miscount, double count (SMS plus UPI app notification), or treat transfers and bill payments as spending.

## 3. Target user

**Primary: the privacy-conscious salaried Indian smartphone user** (like the owner of this project). Has 2+ bank accounts, 1-3 cards, uses GPay/PhonePe/Paytm daily, gets an SMS for nearly every transaction, wants to know "where did my month go?" and "am I overspending?" without sharing data with a third party.

**Secondary: the self-hoster / tinkerer** who runs Firefly III (or similar) and wants the phone to feed it.

Not targeting (V2): businesses, shared household budgets, investments tracking, users outside India, iOS.

## 4. Product principles

1. **Capture without effort.** If the phone already knows about a transaction, the user shouldn't type it.
2. **Review in seconds.** Each decision (confirm, categorise, dismiss) is one gesture, and every action is undoable.
3. **Private by default.** No accounts, no ads, no cloud copy of your finances. Financial content (amounts, merchants, message text, account numbers) never leaves the device except by an explicit action such as your own Firefly sync. Product telemetry is **on by default, anonymous, content-free, inspectable, and can be turned off (and its data erased) at any time, with a clear notice at first run** (see F33).
4. **Trust the numbers.** Totals must be right: no double counting, transfers are not spending, uncertainty is shown, never hidden.
5. **Fast and calm.** Instant screens at 10,000 transactions; a quiet visual design; no nagging.
6. **Works for India.** INR with lakh/crore grouping, Indian banks, cards and UPI, the SMS formats they actually send.

## 5. Goals and non-goals

### Goals (V2.0)
- G1. At least 90% of a user's bank/card/UPI transactions appear in ExMan with correct amount, direction and account, with no manual entry.
- G2. Reviewing a typical day's transactions takes under 15 seconds.
- G3. The user can answer "what did I spend this month, on what, versus last month?" from the first screen.
- G4. No financial content leaves the device in any configuration except user-initiated sync; telemetry is anonymous, content-free and can be switched off.
- G6. Use anonymous telemetry to find and fix parser gaps, crashes and slow screens within one release cycle.
- G5. Every screen is interactive in under 100 ms with 10,000 transactions.

### Non-goals (V2.0)
- No bank-login/account-aggregator integration; SMS and notifications only.
- No cloud accounts, no user profiles, no multi-device sync service run by us. (Optional sync to the user's own Firefly III is allowed.)
- No investments, net worth, loans, bill reminders, or tax features.
- No Play Store distribution (sideloaded APK).

## 6. Success metrics

Measured locally (developer tools, owner spot-checks) and, for users who opt in, through anonymous telemetry (F33). Metrics that need telemetry are marked † and cover users who leave telemetry on.

| Metric | Target |
|---|---|
| Capture rate (transactions in app / transactions in bank statement, owner spot-check monthly) | >= 90% |
| Auto-category accuracy after 1 month of rules | >= 80% of transactions need no change |
| Unrecognised financial SMS per month† | < 5% of financial SMS |
| Time to clear a day's Review queue | < 15 s |
| Cold start | < 1.5 s |
| 1-year SMS import (3,000 messages) | < 5 s |
| List scroll at 10,000 rows | 60 fps |
| Crash-free sessions† | > 99.5% |
| Median / p95 screen load time† | < 100 ms / < 300 ms |

## 7. Core user journeys

1. **First run.** Onboarding explains what ExMan reads and why, requests SMS and notification permissions with rationale, offers to import the last 30/90/365 days, shows the accounts it discovered ("Indian Bank a/c ...1234", "Axis card ...4321"), and lands on Home with the first month already populated.
2. **Daily glance.** A transaction SMS arrives. Later, Home shows "3 to review". The user opens Review, swipes right on correct ones, fixes a category on one, dismisses a non-expense. Done.
3. **Mid-month check.** Home shows spent so far, budget remaining, and safe daily spend. Tap a category to see its transactions.
4. **Cash and misc.** The user taps **+**, enters 120, "Chai", Food, Cash. Saved in three taps.
5. **Month review.** Insights shows category breakdown, trend vs prior months, top merchants, and plain-language callouts.
6. **Find something.** Search "Amazon" in Activity, filter to credit card and last 90 days, select several, bulk re-categorise.
7. **Optional sync.** The user connects their Firefly III; confirmed transactions flow there.
8. **Safety.** The user locks the app with biometrics, hides amounts on Home, exports an encrypted backup, restores on a new phone.

## 8. Features

Priority: **P0** must ship in V2.0 · **P1** V2.0 if capacity allows · **P2** V2.1+. Each feature lists acceptance criteria (AC).

### 8.1 Capture and ingestion

**F1. SMS capture (P0).** Detect incoming bank/card SMS in the background, even when the app is closed, and queue them for parsing.
- AC: a new SMS appears in the app within 5 s of opening it, and within 5 s of arrival if open. Personal (numeric-sender) messages are never read, stored or parsed. OTP-only messages are discarded.

**F2. UPI app notification capture (P0).** Read payment notifications from GPay, PhonePe and Paytm.
- AC: a payment made in each app produces one transaction. If the bank SMS for the same payment also arrives, only one transaction results (cross-channel de-duplication).

**F3. SMS history import (P0).** One-off import of past 30/90/365 days with a progress bar.
- AC: 3,000 messages import in < 5 s; re-running adds nothing; dismissed items never come back.

**F4. Parser coverage (P0).** Understand debit/credit alerts for supported Indian banks, cards and UPI: amount, direction, merchant/payee, account/card last-4, bank, payment mode, balance (when present).
- V2.0 first-class: Indian Bank (account, debit card), Axis Bank (account, debit card, credit card), ICICI (Amazon Pay credit card), plus the already-supported major banks.
- AC: a maintained corpus of real, masked messages; every supported format has a test; ignores OTPs, promos, bill-due notices, future-dated debits and failed transactions.

**F5. Unrecognised messages and Teach ExMan (P0).** A list of financial-looking SMS the parser could not read. **Teach ExMan** lets the user tap the amount, merchant and account in the message and choose debit/credit; ExMan builds a pattern for that sender/format and applies it to similar past and future messages.
- AC: after teaching one message, other messages in the same format parse correctly; taught patterns are listed, editable and deletable; a wrong pattern can be reverted. **Report a gap** (optional, per message) sends only a masked template of the message (digits and names replaced, see F33), after showing the user exactly what will be sent.

**F6. Manual / cash entry (P0).** A **+** button: amount, in/out, merchant or note, category, account (Cash by default), date, tags.
- AC: under 10 s to enter; appears immediately in Activity and totals; editable and deletable.

### 8.2 Accounts

**F7. Accounts and cards (P0).** Automatically create accounts and cards from bank + last-4 found in messages (e.g. "Axis card ...4321"); the user can rename, merge duplicates, archive, and add Cash.
- AC: every transaction belongs to an account; per-account filter everywhere; accounts list shows month in/out and, where SMS provide it, latest known balance with "as of" date.

**F8. Transfers and bill payments (P0).** Automatically detect money moved between the user's own accounts and credit-card bill payments, mark them as **transfers** (excluded from spending and income), and show an **Undo** at the moment of detection and in the transaction's detail.
- Detection: a debit from one own account matched with a credit to another within a short window and equal amount; card-bill payment debits matched to the card's payment credit or to the card issuer's bill-payment wording.
- AC: paying the Axis card bill from Axis savings does not count as spending twice; every auto-marked transfer is visible in a "Transfers" filter and can be un-marked in one tap; un-marking teaches the matcher not to repeat that pairing.

**F9. Refunds (P1).** Link a credit to the original debit so net spend is correct.

### 8.3 Review (the Inbox, reimagined)

**F10. Review queue (P0).** New transactions land as *pending*. Review shows one transaction as a large card: amount, merchant, account, time, suggested category, and the original message on demand.
- Gestures: right = confirm, left = dismiss, tap = edit. Every action shows an **Undo** snackbar.
- AC: dismissed transactions are hidden but recoverable (Settings > Dismissed); queue count shows on Home; **Confirm all categorised** and **Confirm all from known merchants** for bulk clearing.

**F11. Edit transaction (P0).** Amount, merchant, category, account, date, tags, notes, transfer flag. Edits are logged. The original message is always viewable from the detail screen.

**F12. Split transaction (P2).** Split one payment across categories.

### 8.4 Categorisation

**F13. Categories (P0).** Sensible defaults (Food, Groceries, Transport, Shopping, Bills, Entertainment, Health, Salary, Transfers, Other) plus custom categories with name, icon and colour; reorder, archive.

**F14. Merchants and auto-categorisation (P0).** Normalise merchant names and UPI IDs into a single merchant ("SWIGGY", "swiggy@icici" -> Swiggy). Categorise by merchant.
- AC: recategorising a transaction offers "Always categorise Swiggy as Food", applies to past and future transactions, and appears in an editable **Rules** list.

**F15. Tags (P1).** Free-form tags, filterable, shown on rows.

### 8.5 Home and Activity

**F16. Home (P0).** Month selector; spent, income and net; budget status (overall); "N to review" card; top categories; recent transactions; comparison with the previous month.

**F17. Activity (P0).** Day-grouped ledger of all confirmed transactions with day totals; search; filters (date range, account, category, tag, amount, direction, transfers); multi-select with bulk category, tag, account, delete; detail view with original message and edit history.
- AC: 10,000 rows scroll at 60 fps; search results in < 200 ms.

### 8.6 Insights and budgets

**F18. Insights (P0).** Category breakdown (tap to drill into Activity), 6/12-month trend, top merchants, income vs spend, and 2-4 plain-language callouts ("Food is 38% above your 3-month average").

**F19. Overall monthly budget (P0).** Set a monthly limit; progress bar, remaining, safe daily spend, projected month-end, over-budget state.

**F20. Per-category budgets (P2, V2.1).** Limits per category, rollover option, 80%/100% alerts.

**F21. Subscriptions / recurring (P2, V2.1).** Detect recurring merchants and amounts, list with next expected date, flag price changes.

**F22. Notifications (P2).** Optional local alerts for budget thresholds and a weekly summary. No push server.

### 8.7 Appearance

**F23. Themes (P0).** Light, Dark, and **Follow system**, switchable in Settings; instant, persisted, applies to all screens, charts and the status bar. Optional AMOLED-black variant (P1).

**F24. Design system and accessibility (P0).** Consistent tokens, components, spacing and type; Indian number grouping; supports system font scaling and TalkBack labels; respects reduce-motion; haptic feedback on key actions.

### 8.8 Data, sync and safety

**F25. Backup and restore (P0).** Export all data to an encrypted file (password) via the share sheet; restore on a fresh install.

**F26. Export (P1).** CSV export of transactions (filtered or all).

**F27. App lock (P1).** Biometric/PIN lock on open and after a timeout; hide amounts toggle; block screenshots and recents preview.

**F28. Firefly III sync (P1).** Existing one-way push of confirmed transactions to the user's server (asset-account mapping, token, retry, status). Per-account mapping to Firefly asset accounts. Custom REST endpoint remains.

**F29. Permissions health (P0).** Settings shows each required permission with status and a fix-it action, including the Android 13+ "allow restricted settings" flow for sideloaded apps.

**F30. Data controls (P0).** The original (raw) message text is **kept by default** with each transaction, so corrections, re-parsing after parser upgrades and Teach ExMan keep working. It stays on the device only; it is never uploaded by telemetry. The user can purge raw text older than N days (keeping the parsed transaction), delete all data, and view exactly which senders ExMan reads.

### 8.9 Platform and delivery

**F31. Fast iteration pipeline (P0, internal).** Dev-client build plus over-the-air JS updates, release signing key, in-app "update available" check, separate fast PR checks.

**F32. Developer tools (P0, internal).** Seed synthetic data, benchmark queries, view local error log.

**F33. Privacy-preserving telemetry (P0).** On-by-default, anonymous, content-free product telemetry with opt-out to improve parsing, stability and speed across versions.
- **Default and opt-out:** **on by default**. Because it is on without an explicit tap, the first-run screen must state it plainly (what is collected, that it never includes financial content) with a one-tap **Turn off** and a "See exactly what is sent" link, shown before any event is sent. Toggle anytime in Settings > Privacy; turning it off stops collection, deletes queued events, and asks the collector to delete data for the current install ID.
- **Identity:** a random install ID generated on the device, with no link to phone number, account, device identifiers, name or email; **Reset ID** button; no IP logging at the collector.
- **Allowed events (allow-list, versioned):** app version/OS/device class; crash and error types with stack traces scrubbed of data; screen load timings; feature usage counters (e.g. "review confirmed", "theme changed"); import duration and counts; parser outcomes as counts per bank key (parsed / unrecognised / low-confidence).
- **Never collected:** amounts, balances, merchants, categories names the user created, account numbers or last-4, message text, contacts, location, other apps. Parser-gap reports contain only a **masked template** (digits -> `#`, names/merchants/VPAs -> `<NAME>`/`<VPA>`, sender ID kept) and are sent only when the user taps "Report a gap" on that specific message after previewing the exact payload.
- **Transparency:** an in-app **Telemetry log** screen lists every event sent (and queued) in readable form; payload schema documented in the repo.
- **Delivery:** batched over HTTPS when on Wi-Fi/idle; small, drop-on-failure; no SDK that fingerprints. Collector endpoint is owned by the project (hosting option decided in the infrastructure plan, self-hosted preferred).
- **Collector (project-owned server):** a small HTTPS service on a user-run VM (AWS) receiving batched JSON events; validates every payload against the same allow-list schema and rejects unknown fields; stores no IP addresses or user agents beyond transient request handling (reverse-proxy logs disabled or truncated); rate-limited; supports delete-by-install-ID. **Retention: raw events 90 days; aggregated counts 12 months**, enforced by a scheduled job.
- AC: with telemetry off, zero telemetry requests are made (verifiable in the log and by network inspection); with it on, every outbound payload matches the documented allow-list schema, enforced by a unit test that fails on unknown fields.

## 9. Non-functional requirements

- **Privacy:** network calls are limited to user-initiated sync, update checks, Expo OTA fetches (code only), and telemetry (F33). No third-party analytics or advertising SDKs. SMS permission is used only to read bank-style (alphanumeric) senders. Raw message text and financial values are never transmitted by telemetry; a schema allow-list test guards this.
- **Performance:** per section 6. Database access via indexed queries; no per-row N+1 queries.
- **Reliability:** idempotent ingestion (no duplicates after restarts or re-imports); schema migrations are versioned, tested, and never lose data; automatic pre-migration backup.
- **Compatibility:** Android 8+ (target latest), arm64. Works offline always.
- **Security:** data in app-private storage; optional app lock; encrypted backups; release builds signed with a private key.
- **Accessibility:** WCAG AA contrast in both themes, scalable text, screen-reader labels.
- **Maintainability:** parser is pure and unit tested against a masked real-message corpus; every bug found in the field becomes a test.

## 10. Data model (conceptual)

Transaction (amount in paise, direction, merchant, category, account, timestamp, status: pending/confirmed/dismissed, source: sms/gpay/phonepe/paytm/manual, payment mode, tags, notes, transfer flag, linked transaction, raw message, message hash, sync status) · Account (name, kind: bank/card/cash, bank, last-4, balance + as-of) · Merchant (name, aliases) · Category · Rule (merchant or pattern -> category) · Budget (overall in V2.0; per category in V2.1) · Setting · Edit log · Unparsed message · Taught pattern (sender, template, field map) · Telemetry event queue (local, inspectable).

## 11. Release scope

| Release | Contents |
|---|---|
| **V2.0** | F1-F8, F10, F11, F13, F14, F16-F19, F23, F24, F25, F29-F33 (F5 Teach ExMan and F33 telemetry now P0). P1 items (F9, F15, F26, F27, F28, AMOLED) as capacity allows, in that order. |
| **V2.1** | F20 per-category budgets, F21 subscriptions, plus remaining P1s and any parser fixes from real-world use. |
| **Later** | F12 split, F22 notifications, home-screen widget, background sync service, self-hosted update server and diagnostics (privacy discussion pending). |

## 12. Risks and mitigations

| Risk | Mitigation |
|---|---|
| Banks change SMS formats | Corpus-driven tests; Teach ExMan; masked gap reports and parser-outcome counts; fast OTA fixes |
| Telemetry erodes trust | On by default with a clear first-run notice and one-tap opt-out, allow-list schema enforced by tests, visible Telemetry log, Reset ID, no financial content; published schema |
| Teach ExMan creates a bad pattern | Preview before saving, pattern list with edit/delete, one-tap revert, never overwrite built-in parsers silently |
| Android restricts SMS/notification access for sideloaded apps | Clear in-app guidance; health screen; no Play Store dependency |
| Double counting (SMS + UPI + card) | Cross-channel dedupe, transfer detection, tested rules |
| Misclassified transfers distort totals | Easy manual override; show transfers separately |
| Battery/OEM killing background receivers | Receiver is system-triggered (not a service); doc OEM battery settings; queue persists |
| Performance regressions | Perf budget checked with Developer tools before each release |
| Single-developer scope | Strict P0/P1/P2 cut; each phase ships an installable build |

## 13. Decisions

1. **Telemetry:** yes; **on by default with an opt-out**, anonymous and content-free (F33). Chosen over opt-in to get enough signal to improve parsing and performance; mitigated by a prominent first-run notice, one-tap off, an in-app log of everything sent, a published schema and a test-enforced allow-list.
2. **V2.0 feature set:** confirmed as listed in section 11.
3. **Transfers and card-bill payments:** detected automatically with undo (F8).
4. **Raw message text:** kept by default on-device with a purge option; never uploaded by telemetry (F30). *(Interpreted "raw image" as the raw SMS/notification text.)*
5. **Teach ExMan:** in V2.0 as P0 (F5).
6. **Indian Bank debit card:** included (F4).
7. **Collector:** self-hosted on a small AWS VM run by the project owner. Retention: 90 days events, 12 months aggregates.
8. **No missing features** identified.

## 14. Infrastructure implied by this PRD

| Need | Proposal |
|---|---|
| Telemetry collector | One small VM (e.g. t4g.small or t3.micro), Caddy/Nginx for HTTPS, a tiny service (Node or Go) validating the allow-list schema, SQLite or Postgres for events, nightly job for retention and aggregation, optional Grafana/Metabase dashboard. Estimated cost: a few dollars a month. |
| App delivery | EAS dev client + EAS Update for JS; release keystore in GitHub Secrets; GitHub Releases for the full APK. |
| Parser corpus | Repo folder of masked real messages, fed by owner use and gap reports. |
| Firefly III (optional, user) | Documented in `docs/firefly-iii-setup.md`. |
