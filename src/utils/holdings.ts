// Names an investment from the message that created it, so SIPs and transfers to the same place gather in one holding.

export type HoldingType = 'mutual_fund' | 'stocks' | 'fd' | 'rd' | 'ppf' | 'nps' | 'gold' | 'other';
export const HOLDING_TYPES: HoldingType[] = ['mutual_fund', 'stocks', 'fd', 'rd', 'ppf', 'nps', 'gold', 'other'];
export const HOLDING_LABEL: Record<HoldingType, string> = { mutual_fund: 'Mutual funds', stocks: 'Stocks & broker', fd: 'Fixed deposit', rd: 'Recurring deposit', ppf: 'PPF', nps: 'NPS', gold: 'Gold', other: 'Other' };

export type HoldingGuess = { name: string; key: string; type: HoldingType };

const BROKERS: [RegExp, string][] = [
  [/zerodha|\biccl\b|indian clearing|nse clearing/i, 'Zerodha / broker'],
  [/groww/i, 'Groww'], [/kuvera/i, 'Kuvera'], [/ind ?money/i, 'INDmoney'], [/et ?money/i, 'ET Money'], [/upstox/i, 'Upstox'],
  [/angel (?:one|broking)/i, 'Angel One'], [/5paisa/i, '5paisa'], [/paytm money/i, 'Paytm Money'], [/smallcase/i, 'smallcase'],
];

const title = (s: string) => s.replace(/\s+/g, ' ').trim().replace(/\b\w/g, (c) => c.toUpperCase());

export function holdingFor(text: string | null, merchant: string | null): HoldingGuess {
  const hay = `${merchant ?? ''} ${text ?? ''}`;
  const make = (name: string, type: HoldingType): HoldingGuess => ({ name, key: name.toLowerCase(), type });
  for (const [re, name] of BROKERS) if (re.test(hay)) return make(name, name === 'Kuvera' || name === 'ET Money' ? 'mutual_fund' : 'stocks');
  if (/\bppf\b|public provident/i.test(hay)) return make('PPF', 'ppf');
  if (/\bnps\b|national pension/i.test(hay)) return make('NPS', 'nps');
  if (/sovereign gold|gold bond|\bsgb\b/i.test(hay)) return make('Gold bonds', 'gold');
  if (/digital gold|augmont|safegold|gold/i.test(hay)) return make('Gold', 'gold');
  if (/recurring deposit|\brd\b/i.test(hay)) return make('Recurring deposit', 'rd');
  if (/fixed deposit|\bfd\b/i.test(hay)) return make('Fixed deposit', 'fd');
  const FUND = /\b((?:[A-Za-z&]+\s){1,3}?)(?:mutual fund|mf|amc|asset management)\b/i;
  const fund = (text ?? '').match(FUND) ?? (merchant ?? '').match(FUND); // the message keeps the fund house's own capitals (HDFC), the merchant name may not
  if (fund) {
    const name = title(fund[1]).replace(/\b(Sip|For|To|Towards|The|Of|In|A|An)\b\s*/gi, '').trim();
    if (name.length >= 2) return make(`${name} Mutual Fund`, 'mutual_fund');
  }
  if (/\bsip\b|mutual fund|folio|\bnav\b|units?\b/i.test(hay)) return make('Mutual fund SIPs', 'mutual_fund');
  return make(merchant ? title(merchant) : 'Other investments', 'other');
}
