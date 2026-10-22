/** Does an unrecognised message look like a real money movement (as opposed to an offer, reminder or OTP)? Used to keep the "missed" statistic meaningful. */
const AMOUNT = /(?:rs\.?|inr|₹)\s?\d/i;
const ACTION = /\b(?:debited|credited|spent|paid|withdrawn|received|deposited|refunded|transferred|sent\s+(?:rs|inr|₹)|txn|transaction|purchase|upi|imps|neft|rtgs)\b/i;
const NOISE = /\b(?:otp|one[- ]time password|offer|cashback offer|congratulations|pre-?approved|apply now|loan|eligible|win\b|reward points|expires?|valid till|due (?:on|by)|bill (?:is )?due|reminder)\b/i;

export function looksLikeTransaction(text: string): boolean {
  return AMOUNT.test(text) && ACTION.test(text) && !(NOISE.test(text) && !/\b(?:debited|credited)\b/i.test(text));
}
