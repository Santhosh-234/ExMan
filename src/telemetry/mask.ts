// Turns a bank message into a template that keeps its structure but none of its content, for "Report a gap".
// Digits become #, UPI IDs/links become <VPA>/<URL>, and every word outside a banking vocabulary becomes <W>.
export const KEEP = new Set(`a ac acct account accounts amount amt and any at atm available avail avl balance bal bank banking by call card cards cheque chq clear credit credited credit debit debited dear deposit deposited do dr cr due emi fund for from has have if in info into is it limit lmt linked mobile neft not no number of on or otp payment paid pay pos purchase received ref refno reference reversed rtgs rs inr sent share spent thank thanks that the this thru through to total transaction transfer txn txns upi use used using via vpa will with withdrawn you your yourself self dt date time block sms avl-bal pls please contact customer care helpline alert update`.split(/\s+/));

export function maskMessage(text: string): string {
  return text
    .slice(0, 600)
    // control characters stand in for placeholders so the word masking below can't touch them
    .replace(/https?:\/\/\S+|www\.\S+/gi, '\u0002')
    .replace(/[\w.\-+]+@[\w.\-]+/g, '\u0001')
    .replace(/[A-Za-z][A-Za-z']*/g, (w) => (KEEP.has(w.toLowerCase()) || w.length <= 2 ? w : '\u0003'))
    .replace(/\d+/g, '#')
    .replace(/(?:\u0003\s*)+/g, '\u0003 ')
    .replace(/\u0001/g, '<VPA>')
    .replace(/\u0002/g, '<URL>')
    .replace(/\u0003/g, '<W>')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 400);
}
