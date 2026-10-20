// Keyword -> category name (must match seeded names in db/schema.ts). First match wins.
const RULES: [RegExp, string][] = [
  [/swiggy|zomato|restaurant|cafe|pizza|burger|dominos|kfc|mcdonald|starbucks|biryani|hotel|bakery/i, 'Food & Dining'],
  [/bigbasket|blinkit|zepto|grofers|dmart|instamart|grocery|supermarket|fresh|mart\b/i, 'Groceries'],
  [/uber|ola\b|rapido|irctc|redbus|metro|petrol|fuel|indianoil|bpcl|hpcl|fastag|railway/i, 'Transport'],
  [/amazon|flipkart|myntra|ajio|meesho|nykaa|shopping|store/i, 'Shopping'],
  [/airtel|jio|vodafone|vi\b|bsnl|electricity|bescom|water|gas|broadband|recharge|insurance|lic\b|tata ?power/i, 'Bills & Utilities'],
  [/netflix|hotstar|spotify|prime|bookmyshow|pvr|inox|youtube|gaming/i, 'Entertainment'],
  [/pharmacy|medical|apollo|medplus|hospital|clinic|1mg|pharmeasy|labs?\b/i, 'Health'],
  [/salary|payroll/i, 'Salary'],
];

export function guessCategory(merchant: string | null, direction: 'debit' | 'credit'): string | null {
  if (!merchant) return null;
  const hit = RULES.find(([re]) => re.test(merchant))?.[1];
  if (hit === 'Salary' && direction === 'debit') return null;
  return hit ?? null;
}
