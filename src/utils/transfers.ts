// Rules for spotting money that moved between the user's own accounts (so it isn't counted as spending/income).
export type TxnLite = {
  id: number;
  amount_paise: number;
  direction: 'debit' | 'credit';
  ts: number;
  account_id: number | null;
  account_kind: 'bank' | 'card' | 'cash' | null;
  mode: string | null;
  merchant: string | null;
  raw_text: string | null;
  is_transfer: number;
  blocked: number; // user said "not a transfer"
  reason: string | null;
  pair_id: number | null;
  merchant_id?: number | null;
};

export const REASON = {
  own: 'own-account transfer',
  cardBill: 'credit card bill payment',
  cardReceived: 'card payment received',
  user: 'marked by you',
  rule: 'always a transfer (your rule)',
} as const;

const MIN = 60_000;
export const WINDOW = { instant: 5 * MIN, imps: 15 * MIN, neft: 6 * 60 * MIN, hint: 60 * MIN, cardBill: 3 * 24 * 60 * MIN } as const;

const ISSUERS = 'hdfc|icici|axis|sbi|kotak|idfc|yes|rbl|indusind|au|amex|american express|standard chartered|citi|hsbc|bob|boi|pnb|federal|onecard|slice|amazon pay';
// a bank-side debit that pays a credit card: "credit card", "CC bill", "SBI Card", CRED, ...
const CARD_BILL = new RegExp(
  String.raw`credit\s*card|\bcc\s*(?:bill|payment|pymt|pay)|\b(?:${ISSUERS})\s*(?:bank\s*)?cc\b|\b(?:${ISSUERS})card|card\s*(?:bill|payment|pymt|outstanding|dues?|repayment)|\b(?:${ISSUERS})\s*(?:bank\s*)?(?:credit\s*)?cards?\b|\bcred(?:\s*club)?\b|clubcred|\bbbps\b[^.]*\bcard\b|\bcard\b[^.]*\bbbps\b`,
  'i',
);
const PAYMENT_WORD = /\b(?:payment|pmt)\b/i;
const RECEIVED_WORD = /\b(?:received|credited|posted|successful|thank you)\b/i;
const NOT_PAYMENT = /refund|reversal|reversed|cashback|cash back|waiver|chargeback/i;
const SELF_HINT = /\b(?:self|own)[\s-]*(?:transfer|account|a\/c)\b|\bto self\b|\bmy own\b/i;

const textOf = (t: TxnLite) => `${t.merchant ?? ''} ${t.raw_text ?? ''}`;
export const hasSelfHint = (t: TxnLite) => SELF_HINT.test(textOf(t));

/** Transfers that can be recognised from one transaction alone (card bill payments). */
export function classifyAlone(t: TxnLite): string | null {
  const text = textOf(t);
  if (t.direction === 'credit' && t.account_kind === 'card' && PAYMENT_WORD.test(text) && RECEIVED_WORD.test(text) && !NOT_PAYMENT.test(text)) return REASON.cardReceived;
  // card spends on a card account are real spending; only bank/UPI debits can be bill payments
  if (t.direction === 'debit' && t.account_kind !== 'card' && CARD_BILL.test(text)) return REASON.cardBill;
  return null;
}

const nearest = (t: TxnLite, list: TxnLite[]) => list.reduce<TxnLite | null>((best, c) => (!best || Math.abs(c.ts - t.ts) < Math.abs(best.ts - t.ts) ? c : best), null);
const free = (c: TxnLite) => !c.is_transfer && !c.blocked;

/** Counterpart of an own-account move: same amount, opposite direction, different own account, close in time. */
export function findOwnTransferPartner(t: TxnLite, cands: TxnLite[]): TxnLite | null {
  if (t.is_transfer || t.blocked) return null;
  const ok = cands.filter((c) => {
    if (c.id === t.id || !free(c) || c.direction === t.direction || c.amount_paise !== t.amount_paise) return false;
    const hint = hasSelfHint(t) || hasSelfHint(c);
    const bothKnown = t.account_id != null && c.account_id != null;
    if (bothKnown ? t.account_id === c.account_id : !hint) return false; // same account, or can't tell without a hint
    const modes = `${t.mode ?? ''} ${c.mode ?? ''}`;
    const window = hint ? WINDOW.hint : /NEFT|RTGS/.test(modes) ? WINDOW.neft : /IMPS/.test(modes) ? WINDOW.imps : WINDOW.instant;
    return Math.abs(c.ts - t.ts) <= window;
  });
  return nearest(t, ok);
}

/**
 * Links a card payment with the bank debit that funded it even when the bank SMS doesn't say "credit card".
 * `t` is either the card-side credit or a bank-side debit; `cands` are the opposite side.
 */
export function findCardBillPartner(t: TxnLite, cands: TxnLite[]): TxnLite | null {
  const isCardSide = t.direction === 'credit' && t.account_kind === 'card';
  const ok = cands.filter((c) => {
    if (c.id === t.id || c.blocked || c.amount_paise !== t.amount_paise || Math.abs(c.ts - t.ts) > WINDOW.cardBill) return false;
    return isCardSide
      ? c.direction === 'debit' && c.account_kind !== 'card' && !c.is_transfer
      : c.direction === 'credit' && c.account_kind === 'card' && c.is_transfer === 1 && c.reason === REASON.cardReceived && c.pair_id == null;
  });
  return nearest(t, ok);
}
