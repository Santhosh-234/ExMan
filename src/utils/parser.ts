export type Source = 'sms' | 'gpay' | 'phonepe' | 'paytm';

export type ParsedTxn = {
  amountPaise: number;
  direction: 'debit' | 'credit';
  merchant: string | null;
  account: string | null; // last 3-4 digits
  bank: string | null;
  mode: 'UPI' | 'Card' | null;
  source: Source;
  ts: number; // epoch ms
};

// Android package -> source, for NotificationListener input. Anything else is treated as SMS.
const APP_SOURCES: Record<string, Source> = {
  'com.google.android.apps.nbu.paisa.user': 'gpay',
  'com.phonepe.app': 'phonepe',
  'net.one97.paytm': 'paytm',
};

const AMOUNT = /(?:rs\.?|inr|₹)\s?([\d,]+(?:\.\d{1,2})?)/i;
const AMOUNT_BY = /\b(?:debited|credited) by\s+([\d,]+(?:\.\d{1,2})?)/i; // SBI: "debited by 500.0"
const DEBIT = /\b(debited|debit of|spent|paid|sent|withdrawn)\b/i;
const CREDIT = /\b(credited|credit of|received|deposited)\b/i;
const REJECT = /\b(otp|failed|declined|reversed|unsuccessful)\b/i;
const ACCOUNT = /\b(?:a\/c|acct|account|card)\s*(?:no\.?\s*)?:?\s*[xX*]*(\d{3,4})\b/i;
const STOP = String.raw`(?=\s+(?:on|via|ref|upi|using|from|avl|bal|linked|\()|[.,;(]|\s*$)`;
const NAME = String.raw`(?!a\/c|acct|account|your)([A-Za-z][A-Za-z0-9 &'\-]*?)`;
const merchantAfter = (words: string) => new RegExp(String.raw`\b(?:${words})\s+${NAME}${STOP}`, 'i');
const TO_DEBIT = merchantAfter('to|at');
const FROM_CREDIT = merchantAfter('from|by');
const VPA = /\bVPA\s+([\w.\-]+@\w+)/i;
const ICICI_PAYEE = /;\s*([^;]+?)\s+credited/i; // "debited for Rs 5; SWIGGY credited."

const BANKS: [RegExp, string][] = [
  [/hdfc/i, 'HDFC'],
  [/icic/i, 'ICICI'],
  [/\bsbi|sbin|sbiupi/i, 'SBI'],
  [/axis/i, 'AXIS'],
  [/kotak/i, 'KOTAK'],
  [/indbnk|indian\s*bank/i, 'INDIAN'], // sender e.g. VM-INDBNK-S
];

const firstMatch = (res: RegExp[], text: string) => {
  for (const re of res) {
    const m = text.match(re);
    if (m) return m[1].trim();
  }
  return null;
};

export function parseMessage(
  text: string,
  opts: { sender?: string; ts?: number } = {},
): ParsedTxn | null {
  if (REJECT.test(text)) return null;
  const amt = text.match(AMOUNT) ?? text.match(AMOUNT_BY);
  if (!amt) return null;
  const amountPaise = Math.round(parseFloat(amt[1].replace(/,/g, '')) * 100);
  if (!(amountPaise > 0)) return null;

  // earliest verb wins: ICICI texts say "debited ... X credited"
  const d = text.search(DEBIT);
  const c = text.search(CREDIT);
  if (d < 0 && c < 0) return null;
  const direction = c < 0 || (d >= 0 && d < c) ? 'debit' : 'credit';

  const sender = opts.sender ?? '';
  const bank = BANKS.find(([re]) => re.test(sender))?.[1] ?? BANKS.find(([re]) => re.test(text))?.[1] ?? null;

  return {
    amountPaise,
    direction,
    merchant: firstMatch(direction === 'debit' ? [VPA, ICICI_PAYEE, TO_DEBIT] : [VPA, FROM_CREDIT], text),
    account: text.match(ACCOUNT)?.[1] ?? null,
    bank,
    mode: /\bupi\b|\bvpa\b/i.test(text) ? 'UPI' : /\bcard\b/i.test(text) ? 'Card' : null,
    source: APP_SOURCES[sender] ?? 'sms',
    ts: opts.ts ?? Date.now(),
  };
}

// Same transaction seen via SMS and a UPI-app notification? Notifications carry no account,
// so a missing account on either side matches. Compare at insert time against rows within +/-60s
// (SELECT ... WHERE amount_paise=? AND ts BETWEEN ? AND ?; see idx_txn_dedup).
// ponytail: same amount+direction within 60s from two different accounts merges; add account-aware tie-break if it happens.
export function isDuplicate(
  a: Pick<ParsedTxn, 'amountPaise' | 'direction' | 'account' | 'ts'>,
  b: Pick<ParsedTxn, 'amountPaise' | 'direction' | 'account' | 'ts'>,
) {
  return (
    a.amountPaise === b.amountPaise &&
    a.direction === b.direction &&
    Math.abs(a.ts - b.ts) <= 60_000 &&
    (!a.account || !b.account || a.account === b.account)
  );
}
