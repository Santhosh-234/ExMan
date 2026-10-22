import { extractForeign } from './currency';

/** Does a message mention a money amount at all (rupees or a known foreign currency, either order)? Decides what is worth keeping for Teach. */
export function mentionsAmount(text: string): boolean {
  return /(?:rs\.?|inr|₹)\s?\.?\d/i.test(text) // Rs 450, INR 450, INR .32, ₹450
    || /\d\s?(?:inr|rs\b|rupees?)/i.test(text) // 450 INR, 450 Rs
    || extractForeign(text) !== null; // USD 32, 32 USD, $32 (balance and limit figures are ignored)
}

/**
 * One-time-password style messages. They are never kept (not even for Teach): the code in them is a credential. A genuine debit alert
 * that merely says "never share your OTP" has a past-tense verb and is not treated as an OTP message.
 */
export function isOtpMessage(text: string): boolean {
  return /\b(?:otp|one[- ]time password|verification code|cvv|passcode)\b/i.test(text) && !/\b(?:debited|credited|spent|sent|deposited|withdrawn|received|paid)\b/i.test(text);
}

/** Does an unrecognised message look like a real money movement (as opposed to an offer, reminder or OTP)? Used to keep the "missed" statistic meaningful. */
const ACTION = /\b(?:debited|credited|spent|paid|withdrawn|received|deposited|refunded|transferred|sent\s+(?:rs|inr|₹)|txn|transaction|purchase|upi|imps|neft|rtgs)\b/i;
const NOISE = /\b(?:otp|one[- ]time password|offer|cashback offer|congratulations|pre-?approved|apply now|loan|eligible|win\b|reward points|expires?|valid till|due (?:on|by)|bill (?:is )?due|reminder)\b/i;

export function looksLikeTransaction(text: string): boolean {
  return mentionsAmount(text) && ACTION.test(text) && !(NOISE.test(text) && !/\b(?:debited|credited)\b/i.test(text));
}
