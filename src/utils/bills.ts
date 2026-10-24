// "Bill due" notices (credit card statements, utility reminders): the amount owed and the date it is due. They move no money themselves,
// so they are not transactions; they feed the upcoming-payments list and the forecast.

export type ParsedBill = { amountPaise: number; dueTs: number; last4: string | null; bank: string | null };

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

function toTs(d: number, m: number, y: number): number | null {
  if (y < 100) y += 2000;
  if (m < 0 || m > 11 || d < 1 || d > 31 || y < 2000 || y > 2100) return null;
  const t = new Date(y, m, d, 23, 59).getTime();
  return Number.isNaN(t) ? null : t;
}

/** First date written in the text after the word "due" / "by" / "on", in the shapes banks use. */
export function findDueDate(text: string): number | null {
  const after = text.slice(Math.max(0, text.search(/\bdue\b|payable|pay by|pay before/i)));
  const pats: [RegExp, (m: RegExpMatchArray) => number | null][] = [
    [/\b(\d{1,2})[-/. ]([A-Za-z]{3})[a-z]*[-/. ,]*(\d{2,4})\b/, (m) => toTs(+m[1], MONTHS.indexOf(m[2].toLowerCase()), +m[3])],
    [/\b(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})\b/, (m) => toTs(+m[1], +m[2] - 1, +m[3])],
    [/\b([A-Za-z]{3})[a-z]*\.? (\d{1,2}),? (\d{4})\b/, (m) => toTs(+m[2], MONTHS.indexOf(m[1].toLowerCase()), +m[3])],
  ];
  for (const text2 of [after, text]) for (const [re, f] of pats) { const m = text2.match(re); const t = m && f(m); if (t) return t; }
  return null;
}

const RUPEE = /(?:rs\.?|inr|₹)\s?([\d,]+(?:\.\d{1,2})?)/gi;

/** The amount owed: the "total" figure when there is one (not the minimum), else the first amount. */
export function findBillAmount(text: string): number | null {
  const amounts = [...text.matchAll(RUPEE)].map((m) => ({ v: Math.round(parseFloat(m[1].replace(/,/g, '')) * 100), at: m.index ?? 0 })).filter((a) => a.v > 0);
  if (!amounts.length) return null;
  const total = text.match(/total\s*(?:amt|amount)?\s*(?:due|payable|outstanding)?/i);
  if (total?.index != null) { const a = amounts.find((x) => x.at >= total.index!); if (a) return a.v; }
  const notMin = amounts.find((a) => !/min(?:imum)?[^.]{0,20}$/i.test(text.slice(Math.max(0, a.at - 24), a.at)));
  return (notMin ?? amounts[0]).v;
}

const BILLISH = /\b(?:total (?:amt|amount) due|amount due|minimum (?:amt|amount) due|min(?:imum)? due|bill (?:of|for|amount)|statement|payment (?:is )?due|due (?:date|on|by)|is due|payable by|pay by)\b/i;
const DONE = /\b(?:received|credited|debited|paid successfully|payment of .* (?:received|processed)|thank you for (?:your )?payment|has been (?:paid|received)|autopay (?:successful|done))\b/i;

/** A bill notice, or null if the message is something else (a payment confirmation, an offer, an OTP). */
export function parseBill(text: string, bank: string | null = null): ParsedBill | null {
  if (!BILLISH.test(text) || !/\bdue\b|payable|pay by/i.test(text) || DONE.test(text)) return null;
  if (/\b(?:otp|offer|cashback|loan against|apply now|pre-?approved)\b/i.test(text)) return null;
  const dueTs = findDueDate(text);
  const amountPaise = findBillAmount(text);
  if (!dueTs || !amountPaise) return null;
  const last4 = text.match(/(?:ending|ending with|xx|x{2,}|card no\.?|a\/c|account)\D{0,4}(\d{4})\b/i)?.[1] ?? null;
  return { amountPaise, dueTs, last4, bank };
}
