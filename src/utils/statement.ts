// Reads a bank statement that was downloaded as a spreadsheet or CSV: finds the table, understands each line, and checks that the balance
// column adds up (so a mis-read file is caught instead of trusted). Works on plain rows of cells; reading the file itself happens elsewhere.
// Only the table is used. Names, addresses, PAN and the like above it are never read into the result.
import type { Cell } from './csvread';

export type StmtLine = {
  /** position in the statement as the bank listed it (oldest first after any reordering) */
  seq: number;
  /** local calendar day, YYYY-MM-DD */
  day: string;
  /** noon on that day (epoch ms): statements carry no time of day */
  ts: number;
  desc: string;
  direction: 'debit' | 'credit';
  paise: number;
  balance: number | null;
  /** 12-digit UPI / bank reference found in the narration */
  ref: string | null;
  payee: string | null;
};

export type ParsedStatement = {
  lines: StmtLine[];
  from: string;
  to: string;
  openingPaise: number | null;
  closingPaise: number | null;
  /** how many consecutive balance pairs add up; a statement that is read correctly adds up completely */
  chainChecked: number;
  chainBroken: number;
  /** account hints from the lines above the table (last four digits and bank name only) */
  hint: { last4: string | null; bank: string | null };
  warnings: string[];
};

export type StatementResult = { ok: true; statement: ParsedStatement } | { ok: false; reason: string };

const norm = (c: Cell) => (c == null ? '' : c instanceof Date ? '' : String(c)).replace(/\s+/g, ' ').trim();

const MONTHS: Record<string, number> = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };
const pad = (n: number) => String(n).padStart(2, '0');
export const dayKey = (y: number, m: number, d: number) => `${y}-${pad(m + 1)}-${pad(d)}`;
const noon = (key: string) => { const [y, m, d] = key.split('-').map(Number); return new Date(y, m - 1, d, 12, 0, 0).getTime(); };
export const dayOfTs = (ts: number) => { const d = new Date(ts); return dayKey(d.getFullYear(), d.getMonth(), d.getDate()); };

/** Dates as banks write them: real dates, Excel serial numbers, dd-mm-yyyy, dd/mm/yy, dd-Mon-yyyy, yyyy-mm-dd. Day first, as in India. */
export function readDate(c: Cell): string | null {
  if (c instanceof Date) return Number.isNaN(c.getTime()) ? null : dayKey(c.getFullYear(), c.getMonth(), c.getDate());
  if (typeof c === 'number') {
    if (c < 30000 || c > 80000) return null;
    const d = new Date(Math.round((c - 25569) * 864e5));
    return dayKey(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  }
  const s = norm(c);
  let m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:[ T].*)?$/);
  if (m) return valid(+m[1], +m[2] - 1, +m[3]);
  m = s.match(/^(\d{1,2})[-/. ](\d{1,2})[-/. ](\d{2}|\d{4})(?:[ T,].*)?$/);
  if (m) return valid(+m[3] < 100 ? 2000 + +m[3] : +m[3], +m[2] - 1, +m[1]);
  m = s.match(/^(\d{1,2})[-/. ]([A-Za-z]{3})[A-Za-z]*[-/. ,]+(\d{2}|\d{4})(?:[ T,].*)?$/);
  if (m && MONTHS[m[2].toLowerCase()] != null) return valid(+m[3] < 100 ? 2000 + +m[3] : +m[3], MONTHS[m[2].toLowerCase()], +m[1]);
  return null;
}
function valid(y: number, m: number, d: number): string | null {
  const t = new Date(y, m, d);
  return t.getFullYear() === y && t.getMonth() === m && t.getDate() === d && y > 1999 && y < 2100 ? dayKey(y, m, d) : null;
}

/** Amounts as banks write them: 1,234.50 / 1234.5 / "  305.00" / "1711.100 CR" / "(50.00)". Paise, or null when it is not an amount. A trailing DR makes it negative. */
export function readMoney(c: Cell): number | null {
  if (typeof c === 'number') return Number.isFinite(c) ? Math.round(c * 100) : null;
  if (c == null || c instanceof Date) return null;
  let s = String(c).trim();
  if (!s || s === '-' || s === '--') return null;
  let neg = false;
  const suffix = s.match(/\s*(CR|DR|Cr|Dr|cr|dr)\.?$/);
  if (suffix) { neg = suffix[1].toLowerCase() === 'dr'; s = s.slice(0, suffix.index).trim(); }
  if (/^\(.*\)$/.test(s)) { neg = true; s = s.slice(1, -1); }
  s = s.replace(/^(?:₹|Rs\.?|INR)\s*/i, '').replace(/,/g, '').replace(/\s/g, '');
  if (s.startsWith('-')) { neg = !neg; s = s.slice(1); }
  if (!/^\d*\.?\d+$/.test(s) && !/^\d+\.$/.test(s)) return null;
  const p = Math.round(parseFloat(s) * 100);
  return neg ? -p : p;
}

type Cols = { date: number; desc: number; debit: number; credit: number; balance: number; amount: number; type: number };

const HEADERS: Record<keyof Cols, RegExp> = {
  date: /^(tran(saction)?\.?\s*date|txn\.?\s*date|value\s*date|post(ing)?\s*date|date)$/i,
  desc: /^(particulars|description|narration|transaction\s*(remarks|details|description)|details|remarks|txn\s*description)$/i,
  debit: /^(dr|debit|debit\s*amount|withdrawals?(\s*amt\.?)?|withdrawal\s*amount(\s*\(dr\))?|amount\s*\(dr\))$/i,
  credit: /^(cr|credit|credit\s*amount|deposits?(\s*amt\.?)?|deposit\s*amount(\s*\(cr\))?|amount\s*\(cr\))$/i,
  balance: /^(bal|balance|closing\s*balance|running\s*balance|balance\s*\(inr\))$/i,
  amount: /^(amount|txn\s*amount|transaction\s*amount)$/i,
  type: /^(dr\s*\/\s*cr|cr\s*\/\s*dr|type|transaction\s*type|debit\s*\/\s*credit)$/i,
};

function findHeader(rows: Cell[][]): { at: number; cols: Cols } | null {
  for (let i = 0; i < Math.min(rows.length, 80); i++) {
    const cols = { date: -1, desc: -1, debit: -1, credit: -1, balance: -1, amount: -1, type: -1 } as Cols;
    rows[i].forEach((c, j) => {
      const t = norm(c);
      if (!t) return;
      for (const k of Object.keys(HEADERS) as (keyof Cols)[]) if (cols[k] < 0 && HEADERS[k].test(t)) { cols[k] = j; break; }
    });
    const split = cols.debit >= 0 && cols.credit >= 0;
    const single = cols.amount >= 0 && cols.type >= 0;
    if (cols.date >= 0 && cols.desc >= 0 && (split || single)) return { at: i, cols };
  }
  return null;
}

const REF = /(?<!\d)(\d{12})(?!\d)/;
const IFSC = /^[A-Za-z]{4}0[A-Za-z0-9]{6}$/;

export function refOf(desc: string): string | null {
  const u = desc.match(/UPI\/(?:[A-Z0-9]{2,4}\/)?(\d{12})\b/i);
  return u ? u[1] : (desc.match(REF)?.[1] ?? null);
}

/** Who the money went to / came from, out of the narration. Layouts differ per bank; unknown ones return null and the whole narration is shown. */
export function payeeOf(desc: string): string | null {
  const parts = desc.split('/').map((p) => p.trim());
  let name: string | null = null;
  if (/^UPI$/i.test(parts[0]) && parts.length >= 4) name = parts[3]; // Axis: UPI/P2M/<ref>/<payee>/<note>/<bank>
  else if (IFSC.test(parts[0]) && parts.length >= 2) name = parts[1]; // Indian Bank: <ifsc>/<payee>/<acct>/<vpa>/UPI/<ref>/<note>
  else if (/^(IMPS|NEFT|RTGS)$/i.test(parts[0]) && parts.length >= 3) name = parts.find((p, i) => i >= 1 && /^[A-Za-z][A-Za-z .&'-]{2,}$/.test(p)) ?? null;
  name = name?.replace(/\s+/g, ' ').replace(/[.\s]+$/, '').trim() ?? null;
  return name && /[A-Za-z]{2}/.test(name) ? name : null;
}

function hintOf(rows: Cell[][], upTo: number): ParsedStatement['hint'] {
  let last4: string | null = null;
  let bank: string | null = null;
  const text = rows.slice(0, upTo).map((r) => r.map(norm).filter(Boolean).join(' ')).join('\n');
  const acct = text.match(/(?:a\/?c|account)\s*(?:no\.?|number)?\s*[:\-]*\s*([X*\d]{5,})/i);
  if (acct) { const d = acct[1].replace(/\D/g, ''); if (d.length >= 4) last4 = d.slice(-4); }
  const b = text.match(/\b(Axis|HDFC|ICICI|SBI|State Bank|Indian Bank|Kotak|Federal|IDFC|Yes Bank|IndusInd|Canara|Union Bank|Bank of Baroda|PNB|Punjab National)\b/i);
  if (b) bank = b[1];
  return { last4, bank };
}

const signed = (l: { direction: 'debit' | 'credit'; paise: number }) => (l.direction === 'credit' ? l.paise : -l.paise);

function chainScore(lines: StmtLine[]) {
  let checked = 0;
  let ok = 0;
  for (let i = 1; i < lines.length; i++) {
    const a = lines[i - 1].balance;
    const b = lines[i].balance;
    if (a == null || b == null) continue;
    checked++;
    if (Math.abs(a + signed(lines[i]) - b) <= 1) ok++;
  }
  return { checked, ok };
}

export function parseStatement(rows: Cell[][]): StatementResult {
  const head = findHeader(rows);
  if (!head) return { ok: false, reason: "Couldn't find the transaction table. It needs columns for date, description and debit/credit (or amount)." };
  const { cols } = head;
  const lines: StmtLine[] = [];
  let skipped = 0;
  let stoppedAtTotal = false;
  for (let i = head.at + 1; i < rows.length; i++) {
    const r = rows[i];
    const first = norm(r[0]);
    const day = readDate(r[cols.date]);
    if (!day) {
      // a wrapped narration continues on the next row with no date and no amounts
      const extra = norm(r[cols.desc]);
      const prev = lines[lines.length - 1];
      const hasMoney = [cols.debit, cols.credit, cols.amount].some((k) => k >= 0 && readMoney(r[k]) != null);
      if (extra && prev && !hasMoney && !first && !stoppedAtTotal && extra.length < 200) prev.desc += ` ${extra}`;
      else if (/^total|^closing|^opening/i.test(first)) stoppedAtTotal = true;
      continue;
    }
    if (stoppedAtTotal) break;
    const desc = norm(r[cols.desc]);
    let dir: 'debit' | 'credit';
    let paise: number;
    if (cols.debit >= 0 && cols.credit >= 0) {
      const d = readMoney(r[cols.debit]);
      const c = readMoney(r[cols.credit]);
      if (d != null && d > 0 && !(c != null && c > 0)) { dir = 'debit'; paise = d; }
      else if (c != null && c > 0 && !(d != null && d > 0)) { dir = 'credit'; paise = c; }
      else { skipped++; continue; }
    } else {
      const a = readMoney(r[cols.amount]);
      const t = norm(r[cols.type]).toLowerCase();
      if (a == null || a === 0) { skipped++; continue; }
      const isDebit = /^(dr|debit|d|w)/.test(t) || (!t && a < 0);
      const isCredit = /^(cr|credit|c|dep)/.test(t) || (!t && a > 0);
      if (!isDebit && !isCredit) { skipped++; continue; }
      dir = isDebit ? 'debit' : 'credit';
      paise = Math.abs(a);
    }
    const balance = cols.balance >= 0 ? readMoney(r[cols.balance]) : null;
    lines.push({ seq: lines.length, day, ts: noon(day), desc, direction: dir, paise, balance, ref: refOf(desc), payee: payeeOf(desc) });
  }
  if (!lines.length) return { ok: false, reason: 'Found the table but no transactions in it.' };

  // some banks list the newest first: use whichever order makes the balances add up
  let ordered = lines;
  if (lines.length > 1) {
    const fwd = chainScore(lines);
    const rev = chainScore([...lines].reverse());
    if (rev.ok > fwd.ok) ordered = [...lines].reverse();
    else if (fwd.checked === 0 && lines[0].day > lines[lines.length - 1].day) ordered = [...lines].reverse();
  }
  ordered = ordered.map((l, seq) => ({ ...l, seq }));
  const score = chainScore(ordered);
  const first = ordered[0];
  const last = ordered[ordered.length - 1];
  const days = ordered.map((l) => l.day).sort();
  const warnings: string[] = [];
  if (skipped) warnings.push(`${skipped} row${skipped === 1 ? '' : 's'} without a clear amount were skipped.`);
  if (score.checked && score.ok < score.checked) warnings.push(`The balances don't add up in ${score.checked - score.ok} place${score.checked - score.ok === 1 ? '' : 's'}, so some lines may have been misread.`);
  return {
    ok: true,
    statement: {
      lines: ordered,
      from: days[0],
      to: days[days.length - 1],
      openingPaise: first.balance != null ? first.balance - signed(first) : null,
      closingPaise: last.balance,
      chainChecked: score.checked,
      chainBroken: score.checked - score.ok,
      hint: hintOf(rows, head.at),
      warnings,
    },
  };
}
