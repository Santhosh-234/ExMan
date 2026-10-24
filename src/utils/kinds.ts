// What a transaction IS, beyond which way the money moved. Investments and loan repayments move money without being consumption, so
// they are kept out of spending and income totals and shown on their own.

export type Kind = 'normal' | 'investment' | 'loan' | 'fee' | 'cash';
export const KINDS: Kind[] = ['normal', 'investment', 'loan', 'fee', 'cash'];
export const KIND_LABEL: Record<Kind, string> = { normal: 'Regular', investment: 'Investment', loan: 'Loan / EMI', fee: 'Bank fee', cash: 'Cash withdrawal' };
/** Kinds that are not counted as spending or income. */
export const EXCLUDED_KINDS: Kind[] = ['investment', 'loan'];

const INVEST = new RegExp(String.raw`\b(?:sip|systematic investment|mutual fund|mutual funds|folio|nav\b|units? (?:allotted|purchased|redeemed)|redemption|zerodha|groww|kuvera|indmoney|ind money|et ?money|upstox|angel (?:one|broking)|5paisa|paytm money|smallcase|nps|national pension|ppf|public provident|sukanya|fixed deposit|recurring deposit|iccl|indian clearing|nse clearing|bse star|nippon (?:india|life)|mirae asset|parag parikh|ppfas|quant (?:money|mutual)|motilal oswal (?:am|mutual)|uti (?:mutual|amc|asset)|sbi (?:mutual|funds)|hdfc (?:mutual|amc|asset)|icici pru\w* (?:mutual|amc|asset)|axis (?:mutual|amc|asset)|kotak (?:mutual|mahindra (?:am|mutual))|aditya birla sun life (?:am|mutual)|sovereign gold|gold bond|digital gold|augmont|safegold|coin by zerodha)\b|\b(?:fd|rd)\b.{0,40}\b(?:a\/c|account|booked|opened|matur\w*|closure|interest)`, 'i');
const LOAN = /\b(?:emi|equated monthly|loan (?:a\/c|account|repayment|instal+ment|installment)|loan emi|instal+ment (?:of|for) loan|bajaj fin\w*|tata capital|home credit|fullerton|moneyview|kreditbee|lendingkart|loan disburs\w+|disbursal|home loan|car loan|personal loan)\b/i;
const FEE = /\b(?:charges?|fees?|gst|penalty|late payment|processing fee|convenience fee|amc charges|sms charges|min(?:imum)? (?:avg|average)? ?bal\w* (?:charges|penalty)|annual (?:fee|charges)|interest debited|folio charges)\b/i;
const CASH = /\b(?:atm|cash withdrawal|cash wdl|cash wdrl|nfs)\b/i;

export type KindGuess = { kind: Kind; reason: string };

/**
 * Best guess from the message and merchant; null means a regular transaction. Investment and loan wins over fee/cash, which win over
 * nothing. Offers and statements that merely mention these words are filtered out earlier (they are not transactions).
 */
export function classifyKind(i: { text: string | null; merchant: string | null; direction: 'debit' | 'credit'; mode: string | null }): KindGuess | null {
  const hay = `${i.merchant ?? ''} ${i.text ?? ''}`;
  if (LOAN.test(hay) && !/\b(?:offer|pre-?approved|eligible|apply)\b/i.test(hay)) return { kind: 'loan', reason: i.direction === 'credit' ? 'Loan money received' : 'Loan repayment' };
  if (INVEST.test(hay)) return { kind: 'investment', reason: i.direction === 'credit' ? 'Money back from an investment' : 'Money put into an investment' };
  if (i.direction === 'debit' && i.mode !== 'UPI' && FEE.test(hay) && !i.merchant) return { kind: 'fee', reason: 'Bank or card charge' };
  if (i.direction === 'debit' && (i.mode === 'ATM' || CASH.test(hay))) return { kind: 'cash', reason: 'Cash withdrawal' };
  return null;
}
