# ExMan: Product Requirements Document

Status: **DRAFT for approval** · Owner: Santhosh · Scope: V2.0 (V2.1 and later noted)

## 1. Summary

ExMan is a private, offline-first expense manager for Android that tracks money automatically from the bank, card and UPI alerts already on your phone. You don't type expenses; you glance at what ExMan found, confirm it with a swipe, and see where your money goes. Everything stays on the device unless you choose to sync to a server you own.

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
3. **Private by default.** No accounts, no analytics, no ads, no cloud. Data leaves the device only on explicit user action.
4. **Trust the numbers.** Totals must be right: no double counting, transfers are not spending, uncertainty is shown, never hidden.
5. **Fast and calm.** Instant screens at 10,000 transactions; a quiet visual design; no nagging.
6. **Works for India.** INR with lakh/crore grouping, Indian banks, cards and UPI, the SMS formats they actually send.

## 5. Goals and non-goals

### Goals (V2.0)
- G1. At least 90% of a user's bank/card/UPI transactions appear in ExMan with correct amount, direction and account, with no manual entry.
- G2. Reviewing a typical day's transactions takes under 15 seconds.
- G3. The user can answer "what did I spend this month, on what, versus last month?" from the first screen.
- G4. Zero data leaves the device in the default configuration.
- G5. Every screen is interactive in under 100 ms with 10,000 transactions.

### Non-goals (V2.0)
- No bank-login/account-aggregator integration; SMS and notifications only.
- No cloud accounts or multi-device sync service run by us. (Optional sync to the user's own Firefly III is allowed.)
- No investments, net worth, loans, bill reminders, or tax features.
- No Play Store distribution (sideloaded APK).

## 6. Success metrics

Measured locally by the developer tools or by the owner's own use; there is **no telemetry**.

| Metric | Target |
|---|---|
| Capture rate (transactions in app / transactions in bank statement, owner spot-check monthly) | >= 90% |
| Auto-category accuracy after 1 month of rules | >= 80% of transactions need no change |
| Unrecognised financial SMS per month | < 5% of financial SMS |
| Time to clear a day's Review queue | < 15 s |
| Cold start | < 1.5 s |
| 1-year SMS import (3,000 messages) | < 5 s |
| List scroll at 10,000 rows | 60 fps |
| Crash-free sessions | > 99.5% (local crash log) |

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
- V2.0 first-class: Indian Bank, Axis Bank (account, debit card, credit card), ICICI (Amazon Pay credit card), plus the already-supported major banks.
- AC: a maintained corpus of real, masked messages; every supported format has a test; ignores OTPs, promos, bill-due notices, future-dated debits and failed transactions.

**F5. Unrecognised messages (P1).** A list of financial-looking SMS the parser could not read, with a **"Teach ExMan"** action to mark amount/merchant/direction and create a pattern for that sender, plus **"Copy masked message"** to report a parser gap without leaking personal data.

**F6. Manual / cash entry (P0).** A **+** button: amount, in/out, merchant or note, category, account (Cash by default), date, tags.
- AC: under 10 s to enter; appears immediately in Activity and totals; editable and deletable.

### 8.2 Accounts

**F7. Accounts and cards (P0).** Automatically create accounts and cards from bank + last-4 found in messages (e.g. "Axis card ...4321"); the user can rename, merge duplicates, archive, and add Cash.
- AC: every transaction belongs to an account; per-account filter everywhere; accounts list shows month in/out and, where SMS provide it, latest known balance with "as of" date.

**F8. Transfers and bill payments (P0).** Detect and mark money moved between the user's own accounts and credit-card bill payments as **transfers**, excluded from spending and income.
- AC: paying the Axis card bill from Axis savings does not count as spending twice; user can manually mark/unmark any transaction as a transfer.

**F9. Refunds (P1).** Link a credit to the original debit so net spend is correct.

### 8.3 Review (the Inbox, reimagined)

**F10. Review queue (P0).** New transactions land as *pending*. Review shows one transaction as a large card: amount, merchant, account, time, suggested category, and the original message on demand.
- Gestures: right = confirm, left = dismiss, tap = edit. Every action shows an **Undo** snackbar.
- AC: dismissed transactions are hidden but recoverable (Settings > Dismissed); queue count shows on Home; **Confirm all categorised** and **Confirm all from known merchants** for bulk clearing.

**F11. Edit transaction (P0).** Amount, merchant, category, account, date, tags, notes, transfer flag. Edits are logged.

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

**F30. Data controls (P0).** Delete all data; delete messages older than N days (raw SMS text can be purged while keeping the parsed transaction); view exactly which senders ExMan reads.

### 8.9 Platform and delivery

**F31. Fast iteration pipeline (P0, internal).** Dev-client build plus over-the-air JS updates, release signing key, in-app "update available" check, separate fast PR checks.

**F32. Developer tools (P0, internal).** Seed synthetic data, benchmark queries, view local error log.

## 9. Non-functional requirements

- **Privacy:** no network calls except user-initiated sync, update checks, and Expo OTA fetches (code only, never data). No third-party SDKs that collect data. SMS permission used only to read bank-style (alphanumeric) senders.
- **Performance:** per section 6. Database access via indexed queries; no per-row N+1 queries.
- **Reliability:** idempotent ingestion (no duplicates after restarts or re-imports); schema migrations are versioned, tested, and never lose data; automatic pre-migration backup.
- **Compatibility:** Android 8+ (target latest), arm64. Works offline always.
- **Security:** data in app-private storage; optional app lock; encrypted backups; release builds signed with a private key.
- **Accessibility:** WCAG AA contrast in both themes, scalable text, screen-reader labels.
- **Maintainability:** parser is pure and unit tested against a masked real-message corpus; every bug found in the field becomes a test.

## 10. Data model (conceptual)

Transaction (amount in paise, direction, merchant, category, account, timestamp, status: pending/confirmed/dismissed, source: sms/gpay/phonepe/paytm/manual, payment mode, tags, notes, transfer flag, linked transaction, raw message, message hash, sync status) · Account (name, kind: bank/card/cash, bank, last-4, balance + as-of) · Merchant (name, aliases) · Category · Rule (merchant or pattern -> category) · Budget (overall in V2.0; per category in V2.1) · Setting · Edit log · Unparsed message.

## 11. Release scope

| Release | Contents |
|---|---|
| **V2.0** | F1-F4, F6-F8, F10, F11, F13, F14, F16-F19, F23, F24, F25, F29-F32. P1 items (F5, F9, F15, F26, F27, F28, AMOLED) as capacity allows, in that order. |
| **V2.1** | F20 per-category budgets, F21 subscriptions, plus remaining P1s and any parser fixes from real-world use. |
| **Later** | F12 split, F22 notifications, home-screen widget, background sync service, self-hosted update server and diagnostics (privacy discussion pending). |

## 12. Risks and mitigations

| Risk | Mitigation |
|---|---|
| Banks change SMS formats | Corpus-driven tests; "Teach ExMan"; masked-report button; fast OTA fixes |
| Android restricts SMS/notification access for sideloaded apps | Clear in-app guidance; health screen; no Play Store dependency |
| Double counting (SMS + UPI + card) | Cross-channel dedupe, transfer detection, tested rules |
| Misclassified transfers distort totals | Easy manual override; show transfers separately |
| Battery/OEM killing background receivers | Receiver is system-triggered (not a service); doc OEM battery settings; queue persists |
| Performance regressions | Perf budget checked with Developer tools before each release |
| Single-developer scope | Strict P0/P1/P2 cut; each phase ships an installable build |

## 13. Open questions for approval

1. Is the one-line promise and principle set (section 4) right, especially "no telemetry at all"?
2. Are the V2.0 P0 features correct, or should anything move (e.g. App lock P1 -> P0, Firefly sync P1 -> V2.1)?
3. Should transfers/bill payments be detected automatically with undo (proposed), or only when you mark them?
4. Raw SMS retention: keep the original message by default (useful for corrections) with an easy purge, or discard it after parsing?
5. Do you want the "Teach ExMan" pattern builder in V2.0, or is fixing the parser in code via masked reports enough?
6. Any must-have feature missing from this document?
