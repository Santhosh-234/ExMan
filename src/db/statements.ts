import type { SQLiteDatabase } from 'expo-sqlite';

import { ensureMerchant } from '@/db/merchantCore';
import { loadRuleIndex } from '@/db/merchants';
import { loadModel } from '@/db/suggest';
import { detectTransfers } from '@/db/transfers';
import { guessCategory } from '@/utils/categorize';
import { hashMessage } from '@/utils/hash';
import { classifyKind } from '@/utils/kinds';
import { type ExTxn, type Reconciliation, reconcile } from '@/utils/reconcile';
import { type ParsedStatement, type StmtLine, dayOfTs } from '@/utils/statement';
import { isStrong, isUsable } from '@/utils/suggest';
import { REASON } from '@/utils/transfers';

const DAY = 864e5;
const dayStart = (key: string) => { const [y, m, d] = key.split('-').map(Number); return new Date(y, m - 1, d).getTime(); };

const SELECT = 'SELECT id, ts, direction, amount_paise, raw_text, balance_paise, merchant FROM transactions';

/** Compares the statement with what ExMan has for one account. Reads only; nothing changes until `applyStatement`. */
export async function previewStatement(db: SQLiteDatabase, accountId: number, st: ParsedStatement): Promise<Reconciliation> {
  const lo = dayStart(st.from) - 3 * DAY;
  const hi = dayStart(st.to) + 4 * DAY;
  const mine = await db.getAllAsync<ExTxn>(`${SELECT} WHERE account_id = ? AND status != 'dismissed' AND ts BETWEEN ? AND ?`, accountId, lo, hi);
  const others = await db.getAllAsync<ExTxn>(`${SELECT} WHERE (account_id IS NULL OR account_id != ?) AND status != 'dismissed' AND ts BETWEEN ? AND ?`, accountId, lo, hi);
  return reconcile(st.lines, mine, st.from, st.to, others);
}

/** A short label for lines whose narration names no payee. */
function labelFor(l: StmtLine): string | null {
  if (l.payee) return l.payee;
  if (/\bint(?:erest)?\.?\s*(?:pd|paid|credited|cr)\b|interest/i.test(l.desc)) return 'Bank interest';
  if (/credit\s*card/i.test(l.desc)) return 'Credit card payment';
  if (/\bATM\b|\bCWDR\b|cash\s*w/i.test(l.desc)) return 'ATM withdrawal';
  if (/\bsalary\b/i.test(l.desc)) return 'Salary';
  return null;
}

export type ApplyResult = { id: number; added: number; linked: number; balanceSet: boolean; transfers: number };

/**
 * Brings the statement into ExMan: missing lines become transactions waiting in Review, the bank's balance fills the balance of matched
 * transactions (which lets the Books check follow the account), and the closing balance becomes the account's balance when it can be trusted.
 */
export async function applyStatement(
  db: SQLiteDatabase,
  accountId: number,
  st: ParsedStatement,
  rec: Reconciliation,
  opts: { add: Set<number>; useBalance: boolean },
  now = Date.now(),
): Promise<ApplyResult> {
  const acct = await db.getFirstAsync<{ bank: string | null; last4: string | null }>('SELECT bank, last4 FROM accounts WHERE id = ?', accountId);
  const cats = new Map((await db.getAllAsync<{ id: number; name: string }>('SELECT id, name FROM categories')).map((c) => [c.name, c.id]));
  const rules = await loadRuleIndex(db);
  const model = await loadModel(db);
  const merchants = new Map();

  // where each line sits in time: matched ones at their message's time, new ones just after the previous line of the same day
  const placed = new Map<number, number>();
  for (const m of rec.matched) if (dayOfTs(m.txn.ts) === m.line.day) placed.set(m.line.seq, m.txn.ts);
  for (const d of rec.differs) if (dayOfTs(d.txn.ts) === d.line.day) placed.set(d.line.seq, d.txn.ts);
  const sameDay = (seq: number, step: 1 | -1) => {
    for (let k = seq + step; k >= 0 && k < st.lines.length && st.lines[k].day === st.lines[seq].day; k += step) if (placed.has(k)) return placed.get(k)!;
    return null;
  };
  const stamp = new Map<number, number>();
  for (const l of st.lines) {
    if (!opts.add.has(l.seq) || placed.has(l.seq)) continue;
    const before = sameDay(l.seq, -1);
    const after = sameDay(l.seq, 1);
    const ts = before != null ? before + 1000 : after != null ? after - 1000 : l.ts;
    placed.set(l.seq, ts);
    stamp.set(l.seq, ts);
  }

  let id = 0;
  let balanceSet = false;
  const inserted: number[] = [];
  let linked = 0;
  await db.withExclusiveTransactionAsync(async (tx) => {
    id = (await tx.runAsync(
      `INSERT INTO statements (account_id, from_day, to_day, opening_paise, closing_paise, lines, matched, added, differs, extra, balance_set, imported_ts)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)`,
      accountId, st.from, st.to, st.openingPaise, st.closingPaise, st.lines.length, rec.matched.length, opts.add.size, rec.differs.length, rec.extra.length, now,
    )).lastInsertRowId;

    const seen = new Map<string, number>();
    for (const m of rec.missing) {
      const l = m.line;
      if (!opts.add.has(l.seq)) continue;
      const label = labelFor(l);
      const merchant = await ensureMerchant(tx, label, merchants);
      const mode = l.ref && /UPI/i.test(l.desc) ? 'UPI' : null;
      const ruleCat = rules.categoryFor(merchant?.id ?? null, label);
      const learned = model.predict({ merchant: merchant?.name ?? label, direction: l.direction, mode, amountPaise: l.paise });
      const guess = guessCategory(merchant?.name ?? label, l.direction);
      const category = ruleCat ?? (isStrong(learned) ? learned!.category : null) ?? ((guess && cats.get(guess)) || null) ?? (isUsable(learned) ? learned!.category : null);
      const kind = classifyKind({ text: l.desc, merchant: merchant?.name ?? label, direction: l.direction, mode })?.kind ?? 'normal';
      // identical lines on one day (same amount, no reference) are told apart by how many came before
      const base = `stmt|${accountId}|${l.day}|${l.ref ?? l.desc}|${l.direction}|${l.paise}`;
      const n = seen.get(base) ?? 0;
      seen.set(base, n + 1);
      const res = await tx.runAsync(
        `INSERT OR IGNORE INTO transactions
           (amount_paise, direction, merchant, merchant_id, category_id, account_id, source, bank, account_last4, payment_mode, ts, status, raw_text, msg_hash, kind, balance_paise, stmt_id, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, 'manual', ?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?, ?)`,
        l.paise, l.direction, merchant?.name ?? label, merchant?.id ?? null, category, accountId, acct?.bank ?? null, acct?.last4 ?? null, mode,
        stamp.get(l.seq) ?? l.ts, l.desc, hashMessage(0, `${base}|${n}`), kind, l.balance, id, now,
      );
      if (!res.changes) continue;
      inserted.push(res.lastInsertRowId);
      // the same payment is on another account of yours: both sides are one transfer
      if (m.partner) {
        for (const [a, b] of [[res.lastInsertRowId, m.partner.id], [m.partner.id, res.lastInsertRowId]]) {
          await tx.runAsync('UPDATE transactions SET is_transfer = 1, transfer_auto = 1, transfer_reason = ?, transfer_pair_id = ?, synced_at = NULL WHERE id = ? AND transfer_blocked = 0', REASON.own, b, a);
        }
      }
    }

    // balances for the transactions ExMan already had: the bank's figure after that payment
    for (const m of [...rec.matched, ...rec.differs]) {
      if (m.line.balance == null) continue;
      const r = await tx.runAsync('UPDATE transactions SET balance_paise = ? WHERE id = ? AND balance_paise IS NULL', m.line.balance, m.txn.id);
      linked += r.changes;
    }

    // the closing balance, but only from a statement whose own balances add up and only if nothing newer is known
    if (opts.useBalance && st.closingPaise != null && st.chainBroken === 0) {
      const at = dayStart(st.to) + DAY - 1;
      const cur = await tx.getFirstAsync<{ anchor_ts: number | null; balance_ts: number | null }>('SELECT anchor_ts, balance_ts FROM accounts WHERE id = ?', accountId);
      if (cur && (cur.anchor_ts ?? 0) < at && (cur.balance_ts ?? 0) < at) {
        await tx.runAsync('UPDATE accounts SET anchor_paise = ?, anchor_ts = ? WHERE id = ?', st.closingPaise, at, accountId);
        await tx.runAsync('UPDATE statements SET balance_set = 1 WHERE id = ?', id);
        balanceSet = true;
      }
    }
  });
  await detectTransfers(db, inserted);
  const transfers = (await db.getFirstAsync<{ n: number }>('SELECT COUNT(*) AS n FROM transactions WHERE stmt_id = ? AND is_transfer = 1', id))?.n ?? 0;
  return { id, added: inserted.length, linked, balanceSet, transfers };
}

export type StatementRow = { id: number; account_id: number | null; account: string | null; from_day: string; to_day: string; lines: number; matched: number; added: number; differs: number; extra: number; balance_set: number; imported_ts: number; closing_paise: number | null; pending: number };

export const listStatements = (db: SQLiteDatabase) =>
  db.getAllAsync<StatementRow>(
    `SELECT s.*, a.name AS account, (SELECT COUNT(*) FROM transactions t WHERE t.stmt_id = s.id AND t.status = 'pending') AS pending
     FROM statements s LEFT JOIN accounts a ON a.id = s.account_id ORDER BY s.to_day DESC, s.id DESC`,
  );

/** Takes back an import: transactions it added that are still waiting in Review are removed (ones you already confirmed stay). */
export async function undoStatement(db: SQLiteDatabase, id: number) {
  const gone = await db.getAllAsync<{ id: number }>("SELECT id FROM transactions WHERE stmt_id = ? AND status = 'pending'", id);
  await db.withExclusiveTransactionAsync(async (tx) => {
    for (const g of gone) {
      await tx.runAsync("UPDATE transactions SET is_transfer = 0, transfer_auto = 0, transfer_reason = NULL, transfer_pair_id = NULL WHERE transfer_pair_id = ? AND transfer_reason = ?", g.id, REASON.own);
      await tx.runAsync('DELETE FROM transactions WHERE id = ?', g.id);
    }
    await tx.runAsync('DELETE FROM statements WHERE id = ?', id);
  });
  return gone.length;
}

/** Accounts a statement could belong to, best guess first (last four digits, then bank name). */
export function guessAccount<T extends { id: number; name: string; bank: string | null; last4: string | null; kind: string }>(accounts: T[], hint: { last4: string | null; bank: string | null }): T | null {
  const banks = accounts.filter((a) => a.kind !== 'cash');
  if (hint.last4) { const m = banks.find((a) => a.last4 === hint.last4); if (m) return m; }
  if (hint.bank) { const re = new RegExp(hint.bank.split(' ')[0], 'i'); const m = banks.filter((a) => re.test(`${a.bank ?? ''} ${a.name}`)); if (m.length === 1) return m[0]; }
  return null;
}
