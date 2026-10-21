export type Source = 'sms' | 'gpay' | 'phonepe' | 'paytm';

export type ParsedTxn = {
  amountPaise: number;
  direction: 'debit' | 'credit';
  merchant: string | null;
  account: string | null; // last 3-4 digits
  bank: string | null;
  balance: { paise: number; kind: 'balance' | 'limit' } | null; // "Avl bal" (accounts) or "Avl limit" (cards)
  mode: 'UPI' | 'Card' | 'NEFT' | 'IMPS' | 'RTGS' | 'ATM' | 'NACH' | 'Cheque' | null;
  source: Source;
  ts: number; // epoch ms
};

// Android package -> source, for NotificationListener input. Anything else is treated as SMS.
const APP_SOURCES: Record<string, Source> = {
  'com.google.android.apps.nbu.paisa.user': 'gpay',
  'com.phonepe.app': 'phonepe',
  'net.one97.paytm': 'paytm',
};

const AMOUNT_G = /(?:rs\.?|inr|₹)[:\s]?\s?([\d,]+(?:\.\d{1,2})?)/gi;
const AMOUNT_BY = /\b(?:debited|credited) (?:by|with)\s+([\d,]+(?:\.\d{1,2})?)/i; // SBI: "debited by 500.0"
// a number right after these words is a balance/limit, not the transaction amount
const BAL_BEFORE = /(?:bal(?:ance)?|limit|lmt|avl|available|outstanding|due)\W*(?:is|of|:|-)?\s*$/i;
const DEBIT = /\b(debited|debit of|spent|paid|sent|withdrawn|withdrawal|dr)\b/i;
const CREDIT = /\b(credited|credit of|received|deposited|refunded|refund|cr)\b/i;
// weak hints: only used when no strong verb is present ("Purchase of Rs 500 at X")
const DEBIT_WEAK = /\b(purchase|txn of|transaction of|payment of|used (?:for|at))\b/i;
const STRONG_PAST = /\b(debited|credited|spent|sent|deposited|withdrawn|received|paid)\b/i;
const OTP = /\b(otp|one[- ]time password|verification code|cvv)\b/i;
const REJECT = /\b(failed|declined|reversed|unsuccessful|unable to process|insufficient)\b|\b(?:will|to|may) be (?:debited|credited)\b|\b(?:is|are|was) due\b|\bminimum (?:amount )?due\b|\bpay (?:now|by)\b|\b(?:pre-?approved|loan offer|apply now)\b/i;
const ACCOUNTS: RegExp[] = [
  // "A/c no. XX1234", "a/c *1234", "AC X1234", "Acct XX123", "card no. XX1234", "Card x1234"
  /\b(?:a\/c|ac|acct|account|card)(?:\s*(?:no|number|ending(?:\s+with|\s+in)?)\b\.?)*\s*[:\-]?\s*[xX*•.]*\s*(\d{3,4})\b/i,
  /\bending\s+(?:with\s+|in\s+)?(\d{4})\b/i,
  /\b[xX*]{2,}\s?(\d{4})\b/,
];
const STOP = String.raw`(?=\s+(?:on|via|ref|upi|using|from|avl|bal|linked|dt|date|txn|info|if|not|call|thru|through|\()|[.,;(/]|\s*$)`;
const NAME = String.raw`(?!a\/c|ac\b|acct|account|your|card|vpa)([A-Za-z][A-Za-z0-9 &'\-]*?)`;
const merchantAfter = (words: string) => new RegExp(String.raw`\b(?:${words})\s+${NAME}${STOP}`, 'i');
const TO_DEBIT = merchantAfter('to|at|towards');
const FROM_CREDIT = merchantAfter('from|by');
const VPA = /\bVPA\s+([\w.\-]+@\w+)/i;
const VPA_BARE = /\b([\w.\-]{2,}@(?:ok\w+|ybl|ibl|axl|paytm|upi|sbi|icici|hdfcbank|apl|oksbi|axisbank|okaxis|okhdfcbank|okicici|ptyes|ptsbi|pthdfc|fbl|idfcbank|kotak|yesbank|indus|rbl|boi|cnrb|pnb|unionbank|barodampay|freecharge|jupiteraxis|slc|waaxis|wahdfcbank|wasbi|waicici|abfspay))\b/i;
const ICICI_PAYEE = /;\s*([^;]+?)\s+credited/i; // "debited for Rs 5; SWIGGY credited."
const UPI_SLASH = /\bUPI\/(?:P2[AMPB]|CR|DR|MOB)?\/?\d{6,}\/([^\/\n]+?)(?=\/|\s+(?:SMS|UPI|Ref|if|not|avl|bal)\b|\s*$)/i; // Axis: "UPI/P2M/123456789012/Swiggy"
const UPI_DASH = /\bUPI[-\/:]\s*([A-Za-z][A-Za-z0-9 .&'\-]*?)(?:[-\/][\w.\-]+@\w+|\s*[-\/]\d{6,}|\.|,|$)/; // "UPI-SWIGGY-swiggy@ybl-123"
const INFO = /\bInfo\s*[:\-]\s*(?:UPI\/\w+\/\d+\/|NEFT[-\/]|IMPS[-\/]|INF\/\w+\/\d+\/)?([A-Za-z][A-Za-z0-9 .&'\-]*?)(?:\/|\.\s|\s*$|;)/i;
const CARD_AT = /\bat\s+([A-Za-z0-9][A-Za-z0-9 .&'*\-]*?)(?=\s+(?:on|dt|date|ref|avl|bal|limit|using|if|not|call)\b|[.,;(]|\s*$)/i;

// Sender-ID (or text) -> bank. Sender is checked first so "to HDFC" in a SBI text does not win.
const BANKS: [RegExp, string][] = [
  [/hdfc/i, 'HDFC'],
  [/icic/i, 'ICICI'],
  [/(?:^|[^a-z])sbi|sbin\b|sbiupi|sbicrd|sbipsg/i, 'SBI'],
  [/axis|axisbk|axisbn/i, 'AXIS'],
  [/kotak|kmbl|kotakb/i, 'KOTAK'],
  [/indbnk|indian\s*bank/i, 'INDIAN'], // sender e.g. VM-INDBNK-S
  [/(?:^|[^a-z])pnb|punjab national/i, 'PNB'],
  [/(?:^|[^a-z])bob|baroda|bobtxn|bobcrd/i, 'BOB'],
  [/canara|cnrb|canbnk/i, 'CANARA'],
  [/union bank|unionb|(?:^|[^a-z])ubi(?:[^a-z]|$)/i, 'UNION'],
  [/bank of india|(?:^|[^a-z])boi(?:[^a-z]|$)|bkofin/i, 'BOI'],
  [/idfc/i, 'IDFC'],
  [/yes\s?bank|yesbnk|yesbk/i, 'YES'],
  [/indusind|indusb|indbk/i, 'INDUSIND'],
  [/federal|fedbnk|fedbk/i, 'FEDERAL'],
  [/south indian|sibl|sibank/i, 'SIB'],
  [/(?:^|[^a-z])rbl|ratnakar/i, 'RBL'],
  [/bandhan|bdnbnk/i, 'BANDHAN'],
  [/(?:^|[^a-z])uco(?:[^a-z]|$)/i, 'UCO'],
  [/central bank|cbinb|cenbk/i, 'CENTRAL'],
  [/indian overseas|(?:^|[^a-z])iob(?:[^a-z]|$)/i, 'IOB'],
  [/au small|aubank|ausfb/i, 'AU'],
  [/idbi/i, 'IDBI'],
  [/paytm\s?(?:payments )?bank|paytmb/i, 'PAYTMBANK'],
  [/amex|american express/i, 'AMEX'],
  [/hsbc/i, 'HSBC'],
  [/standard chartered|stanchart|scbank/i, 'SC'],
  [/citi/i, 'CITI'],
  [/dbs/i, 'DBS'],
  [/karnataka bank|kbl/i, 'KARNATAKA'],
  [/j&k bank|jkbank/i, 'JKB'],
  [/tmb|tamilnad/i, 'TMB'],
  [/dcb/i, 'DCB'],
  [/csb\b|catholic syrian/i, 'CSB'],
  [/equitas/i, 'EQUITAS'],
  [/ujjivan/i, 'UJJIVAN'],
  [/bank of maharashtra|mahabk|bom\b/i, 'BOM'],
  [/punjab & sind|psb\b/i, 'PSB'],
  [/slice|jupiter|fi money|onecard/i, 'FINTECH'],
];

const MODES: [RegExp, ParsedTxn['mode']][] = [
  [/\bupi\b|\bvpa\b|@\w+/i, 'UPI'],
  [/\bcard\b|\bpos\b/i, 'Card'],
  [/\bneft\b/i, 'NEFT'],
  [/\bimps\b/i, 'IMPS'],
  [/\brtgs\b/i, 'RTGS'],
  [/\batm\b|\bcash withdrawal\b/i, 'ATM'],
  [/\bnach\b|\becs\b|\bauto-?debit\b/i, 'NACH'],
  [/\bcheque\b|\bchq\b/i, 'Cheque'],
];

const firstMatch = (res: RegExp[], text: string) => {
  for (const re of res) {
    const m = text.match(re);
    if (m) return m[1].trim();
  }
  return null;
};

const NUM = String.raw`[\s:\-=]*(?:is|of)?[\s:\-=]*(?:rs\.?|inr|₹)?[\s:\-=]*([\d,]+(?:\.\d{1,2})?)`;
const LIMIT_RE = new RegExp(String.raw`(?:limit|lmt)\b${NUM}`, 'i');
const BAL_RE = new RegExp(String.raw`(?:^|[^a-z]|avl)bal(?:ance)?\b${NUM}`, 'i');

/** Balance (accounts) or available limit (cards) quoted in the message, if any. */
export function extractBalance(text: string): ParsedTxn['balance'] {
  const l = text.match(LIMIT_RE);
  const b = l ? null : text.match(BAL_RE);
  const raw = (l ?? b)?.[1];
  const paise = raw ? Math.round(parseFloat(raw.replace(/,/g, '')) * 100) : NaN;
  return Number.isFinite(paise) && paise >= 0 && raw ? { paise, kind: l ? 'limit' : 'balance' } : null;
}

/** First amount that is not a balance/limit figure. */
function findAmount(text: string): string | null {
  for (const m of text.matchAll(AMOUNT_G)) {
    if (!BAL_BEFORE.test(text.slice(Math.max(0, m.index - 30), m.index))) return m[1];
  }
  return text.match(AMOUNT_BY)?.[1] ?? null;
}

export function parseMessage(
  text: string,
  opts: { sender?: string; ts?: number } = {},
): ParsedTxn | null {
  if (REJECT.test(text)) return null;
  // OTP texts are rejected, but a real debit alert may say "never share OTP"
  if (OTP.test(text) && !STRONG_PAST.test(text)) return null;
  const rawAmt = findAmount(text);
  if (!rawAmt) return null;
  const amountPaise = Math.round(parseFloat(rawAmt.replace(/,/g, '')) * 100);
  if (!(amountPaise > 0)) return null;

  // earliest verb wins: ICICI texts say "debited ... X credited"
  let d = text.search(DEBIT);
  const c = text.search(CREDIT);
  if (d < 0 && c < 0) d = text.search(DEBIT_WEAK);
  if (d < 0 && c < 0) return null;
  const direction = c < 0 || (d >= 0 && d < c) ? 'debit' : 'credit';

  const sender = opts.sender ?? '';
  const bank = BANKS.find(([re]) => re.test(sender))?.[1] ?? BANKS.find(([re]) => re.test(text))?.[1] ?? null;

  const merchant =
    direction === 'debit'
      ? firstMatch([VPA, UPI_SLASH, ICICI_PAYEE, TO_DEBIT, CARD_AT, VPA_BARE, UPI_DASH, INFO], text)
      : firstMatch([VPA, UPI_SLASH, FROM_CREDIT, VPA_BARE, UPI_DASH, INFO], text);

  return {
    amountPaise,
    direction,
    merchant,
    account: firstMatch(ACCOUNTS, text),
    bank,
    balance: extractBalance(text),
    mode: MODES.find(([re]) => re.test(text))?.[1] ?? null,
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
