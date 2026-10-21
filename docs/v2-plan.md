# ExMan V2 plan

Goal: a fast, calm, trustworthy expense app where SMS capture is invisible, review takes seconds, and every screen answers a question ("where did my money go?", "am I on budget?", "what needs my attention?").

## 1. Why V1 is slow (read from the code, not yet profiled)

| # | Cause | Where | Fix |
|---|---|---|---|
| 1 | Inbox is a `ScrollView` that renders **every** pending row. After a 1-year import that is hundreds of rows, each with its own `PanResponder`, `Animated.Value` and (if uncategorised) 9 category chips. | `inbox.tsx`, `SwipeRow.tsx` | Virtualised list (FlashList), memoised rows, swipes on the UI thread via gesture-handler + reanimated (both already installed), one shared category sheet instead of chips per row. |
| 2 | Import does 3-5 awaited queries **per message**, each insert its own transaction (disk sync each time). | `ingest/run.ts` `store()` | One transaction, prefetch existing keys into a `Set`, dedupe in memory, bulk insert in chunks, yield to the UI between chunks, show progress. |
| 3 | `WHERE raw_text = ? AND ts = ?` has **no index**: a full table scan per message, so import is O(n^2). | `store()` | Add `msg_hash` (hash of sender+text+ts) with a UNIQUE index; `INSERT OR IGNORE`. |
| 4 | Every tab focus re-runs `ingest()` plus 3 queries, and every swipe reloads the whole list. | `inbox.tsx` | Ingest only on app start, foreground and the native `onRaw` event. Optimistic updates; reactive queries via `addDatabaseChangeListener`. |
| 5 | Analytics runs 12 sequential queries; Dashboard 4+. | `analytics.tsx`, `index.tsx` | One `GROUP BY month` / `GROUP BY category` query per screen, indexed on `(status, direction, ts)`. |
| 6 | Dismiss **deletes** the row, so re-running an import resurrects it. | `inbox.tsx` | `status = 'dismissed'` kept as a tombstone; hash stops it coming back. |

Performance budget (we measure these, not guess): cold start < 1.5 s; Inbox/Activity scroll at 60 fps with 10,000 rows; 1-year import < 5 s for 3,000 SMS; any screen's data ready < 100 ms.
A hidden **Developer** screen seeds N synthetic transactions and times import/queries so every change is checked against the budget.

## 2. Product: screens and flows

**Navigation**: Home - Activity - Insights - Settings, plus a persistent **+** button (manual/cash entry; a real gap today, since cash and non-SMS spends are invisible).

- **Home**: month hero (spent, left in budget, daily safe-to-spend), a "N to review" card that opens triage, top 3 categories, recent activity, subtle trend vs last month. No charts you have to decode.
- **Review (triage)**: one transaction at a time as a large card: amount, merchant, parsed bank/account, original SMS (expandable), suggested category with one-tap alternatives. Swipe right = confirm, left = skip, up = split/edit. Undo snackbar on every action. "Confirm all that I've seen this merchant categorised before" for bulk.
- **Activity**: the ledger. Grouped by day with day totals, search, filters (account, category, tag, amount range, direction, unreviewed), multi-select with bulk category/tag/delete, tap for detail with edit history. Fast at 10k rows.
- **Insights**: month picker, category breakdown (tap to drill into Activity), 6/12-month trend, top merchants, recurring/subscriptions, weekday/hour heatmap, income vs spend, savings rate, plain-language callouts ("Food is 38% above your 3-month average").
- **Budgets**: overall and per-category monthly budgets, rollover option, pace line ("you're on track / 4 days ahead"), alerts at 80% and 100%.
- **Accounts**: auto-created from bank + last-4 (e.g. "Indian Bank ...1234", "HDFC Card ...4321") and renameable. Balance from "Avl bal" in SMS where present. Credit-card bill payments and own-account transfers are marked **transfers** so they are not double counted as spending.
- **Settings**: permissions health check with fix-it buttons, SMS sources (allow/ignore senders), categories and rules, sync, backup/restore, security, appearance, data export, developer tools.

Cross-cutting UX: skeleton loaders and thoughtful empty states, haptics, motion (200 ms, reduced-motion respected), dark/light/AMOLED, Indian digit grouping (1,23,456), large-text and TalkBack support, one-handed reach (primary actions at the bottom), consistent undo instead of confirm dialogs.

## 3. Intelligence that removes work

1. **Merchant normalisation**: "SWIGGY", "swiggy@icici", "Swiggy Instamart" -> one merchant, with aliases. Merchant table is the unit for categorising.
2. **Learned rules**: when you recategorise, offer "Always put Swiggy under Food?" Rules apply to new and past transactions. Rule manager in Settings.
3. **Recurring detection**: same merchant + similar amount at regular intervals -> subscription list, next-due estimate, "price went up" flag.
4. **Transfers and refunds**: link a refund to its original debit; detect card-bill payments and self transfers.
5. **Parser confidence**: low-confidence parses go to review with the fields highlighted; "Teach ExMan" on any unrecognised SMS (pick amount/merchant, it generates a per-sender pattern).
6. **Parser corpus**: "Copy masked message" button (digits/names masked) so real-world misses become test cases without leaking data.

## 4. Data model changes (migration 4+)

- `transactions`: add `account_id`, `merchant_id`, `msg_hash UNIQUE`, `is_transfer`, `linked_txn_id`, `notes`, `created_at`, `updated_at`; status gains `dismissed`.
- New: `accounts`, `merchants` (+ `merchant_aliases`), `rules`, `recurring`, `edit_log`.
- Indexes for the new queries; drop the debug `unparsed` growth by capping it and adding a "Teach" flow.
- Money stays integer paise. Migrations stay versioned and tested against a seeded DB.

## 5. Architecture

- Lists: FlashList. Gestures/animation: gesture-handler + reanimated on the UI thread.
- Data: keep `expo-sqlite`, add a thin typed query layer + reactive hooks (`useQuery(sql, params)` re-running on DB change). No heavy state library needed; Zustand only for UI state (filters, selection).
- Ingest: native receiver -> queue (as now) -> JS batch worker. Import runs in chunks with progress and cancel.
- Design system: tokens (colour, spacing, type, radius, elevation) in one file, a small component kit (Button, Card, Sheet, Chip, ListRow, Amount, EmptyState, Skeleton), Tailwind classes map to tokens. Icon set stays lucide.
- Charts: keep react-native-svg; build 4 purpose-made charts (donut, bars, sparkline, heatmap) with touch tooltips.
- Tests: parser corpus (exists), migration tests, query tests on an in-memory SQLite, component tests for the kit, perf seed script.

## 6. Infrastructure proposals (this is where we need decisions)

The biggest drag on V2 is the **30-minute build loop**. Proposals, most valuable first:

1. **Dev-client APK + OTA updates (strongly recommended).** Build one development-client APK in CI. After that, all JS/UI changes reload on your phone in seconds (over Wi-Fi/Tailscale to a Metro server) or ship as an over-the-air update, with a native rebuild only when Kotlin or permissions change. Options: **EAS Update** (free tier; hosted by Expo, ships code only, never data) or a **self-hosted update server** (more work, fully private). *Decision needed: EAS account OK?*
2. **Proper release keystore** in GitHub Secrets (today it is the debug key). Needed for stable in-place updates and to stop Play Protect warnings. We also bump `versionCode` per build.
3. **In-app update check** against GitHub Releases ("Build 7 available") so you never hunt for the APK.
4. **Fast CI path**: split CI into `check` (tsc + tests, ~2 min, runs on every PR) and `build` (APK, on demand or main). Cache the Gradle/NDK layers; add a debug-variant job for quick native-only changes.
5. **Local, privacy-first diagnostics**: an on-device error/perf log you can export, no third-party telemetry. Optional self-hosted GlitchTip later.
6. **Encrypted backup/restore** to a file you choose (share sheet -> Drive/Syncthing). Phone loss should not lose years of data.
7. **Sync server**: Firefly III on a home box over Tailscale (guide exists). Add background sync via Android WorkManager once the foreground path is proven. Not required for V2 launch.
8. **Emulator in CI** (optional): headless Android emulator running a Maestro smoke test (open app, seed data, review one item). Slow, so nightly only.

## 7. Phases

| Phase | Scope | Outcome |
|---|---|---|
| 0 Infra | Dev-client build, OTA, release keystore, CI split | Seconds-long feedback loop |
| 1 Foundation | Schema v2, `msg_hash`, batch import, tombstones, indexes, dev seed screen | Import fast and idempotent; perf budget measurable |
| 2 Design system + Review | Tokens, component kit, new navigation, Review (triage) flow, shared category sheet | Inbox fast and delightful |
| 3 Home + Activity | New Home, ledger with search/filters/bulk, manual entry, undo | Day-to-day core |
| 4 Intelligence | Accounts, merchants, rules, transfers, recurring | Less manual work |
| 5 Insights + Budgets | New charts, per-category budgets, alerts, notifications | Understand and control |
| 6 Trust and polish | Onboarding with permission rationale, app lock (biometric), hide amounts, block screenshots, backup/restore, a11y, widgets | Safe and finished |

Phase 1 can start immediately and fixes the slowness you see now, independent of the redesign. Each phase ends in an installable build.

## 8. Decisions (resolved)

1. **Infra**: Expo (EAS) account created; use EAS Update + dev client now. Self-hosted alternatives (own update server, GlitchTip, Firefly sync) and their privacy trade-offs are a later discussion.
2. **Theme**: light, dark and "follow system", switchable in Settings (V2.0). Tokens must support both from the start.
3. **V2.0 includes**: manual/cash entry and multi-account.
4. **Accounts to support first**: Indian Bank (account + debit card), Axis Bank (account + debit card + credit card), Amazon Pay ICICI credit card. UPI apps: GPay, PhonePe, Paytm (RuPay is a card network, not a UPI app; BHIM or a RuPay card on UPI would arrive as bank SMS, to be confirmed).
5. **V2.1**: per-category budgets, subscription/recurring detection. V2.0 vs V2.1 build times will tell us whether the infra change delivered the speedup.

## 9. Status

- Phase 1 (foundation) implemented: schema v4 (accounts, `msg_hash`, dismissed tombstones, indexes), single-transaction batch import with progress, virtualised optimistic Inbox, one-query Analytics, Developer screen (seed + benchmark), PR-time `check.yml`.
- Phase 0 needs one-time steps from the account owner (see CLAUDE.md).
