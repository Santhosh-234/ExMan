// Allow-list for anonymous telemetry. Anything not described here is dropped before it is stored or sent.
import { SCREEN_NAMES } from '../utils/screens';

// Rule of thumb: counts, timings, enums and app/OS versions only; never amounts, merchants, accounts or message text.
type Spec = 'int' | 'bool' | { enum: readonly string[] } | { re: RegExp };

export const SCREENS = SCREEN_NAMES;
const FEATURES = ['manual_add', 'teach_saved', 'rule_created', 'transfer_unmarked', 'transfer_marked', 'account_merged', 'merchant_merged', 'category_created', 'history_import', 'sync_run', 'theme_changed', 'bulk_edit', 'search_used', 'filters_used', 'budget_set', 'subscription_dismissed', 'subscription_marked'] as const;
const BANK_KEYS = ['HDFC', 'ICICI', 'SBI', 'AXIS', 'KOTAK', 'INDIAN', 'PNB', 'BOB', 'CANARA', 'UNION', 'BOI', 'IDFC', 'YES', 'INDUSIND', 'FEDERAL', 'SIB', 'RBL', 'BANDHAN', 'UCO', 'CENTRAL', 'IOB', 'AU', 'IDBI', 'PAYTMBANK', 'AMEX', 'HSBC', 'SC', 'CITI', 'DBS', 'KARNATAKA', 'JKB', 'TMB', 'DCB', 'CSB', 'EQUITAS', 'UJJIVAN', 'BOM', 'PSB', 'FINTECH', 'none'] as const;

export const EVENTS = {
  app_open: { version: { re: /^\d{1,3}\.\d{1,3}\.\d{1,3}$/ }, runtime: { re: /^[0-9a-f]{8}$/ }, update: { enum: ['embedded', 'ota'] }, os_version: 'int' },
  import_completed: { days: 'int', messages: { enum: ['<100', '100-1k', '1k-5k', '5k+'] }, ms: { enum: ['<1s', '1-5s', '5-15s', '15s+'] } },
  review_action: { action: { enum: ['confirm', 'dismiss', 'undo'] }, via: { enum: ['swipe', 'button'] } },
  parser_stats: { bank: { enum: BANK_KEYS }, parsed: 'int', unrecognised: 'int', taught: 'int' },
  screen_load: { screen: { enum: SCREENS }, ms: 'int' },
  feature_used: { feature: { enum: FEATURES } },
  error: { kind: { enum: ['js_error', 'promise_rejection', 'db_error'] }, screen: { enum: SCREENS }, code: { re: /^[A-Za-z0-9_.:-]{0,60}$/ } },
  pattern_share: { sender_key: { re: /^[a-z0-9]{3,12}$/ }, direction: { enum: ['debit', 'credit'] }, rx_value: { re: /^[A-Za-z0-9\s\\.,:;()\[\]{}|?+*^$\-/@_₹%&'<>=!#]{1,400}$/ }, rx_payee: { re: /^[A-Za-z0-9\s\\.,:;()\[\]{}|?+*^$\-/@_₹%&'<>=!#]{0,400}$/ }, rx_acct: { re: /^[A-Za-z0-9\s\\.,:;()\[\]{}|?+*^$\-/@_₹%&'<>=!#]{0,400}$/ }, currency: { re: /^[A-Z]{3}$/ } },
  gap_report: { sender_key: { re: /^[a-z0-9]{3,12}$/ }, template: { re: /^[A-Za-z0-9<>#\s.,:;()\-/@₹%&'*+=?!]{1,400}$/ } },
} as const satisfies Record<string, Record<string, Spec>>;

export type EventName = keyof typeof EVENTS;
export type Props = Record<string, string | number | boolean>;

const MAX_INT = 1_000_000_000;

/** Returns the event with only allowed, valid properties, or null if the event itself is not allowed. */
export function sanitize(name: string, props: Record<string, unknown>): { name: EventName; props: Props } | null {
  const spec = (EVENTS as Record<string, Record<string, Spec>>)[name];
  if (!spec) return null;
  const out: Props = {};
  for (const [key, rule] of Object.entries(spec)) {
    const v = props[key];
    if (rule === 'int') { if (typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= MAX_INT) out[key] = Math.round(v); }
    else if (rule === 'bool') { if (typeof v === 'boolean') out[key] = v; }
    else if ('enum' in rule) { if (typeof v === 'string' && (rule.enum as readonly string[]).includes(v)) out[key] = v; }
    else if (typeof v === 'string' && rule.re.test(v)) out[key] = v;
  }
  // an event must carry every property it declares, otherwise it is malformed (and dropped, not guessed at)
  if (Object.keys(out).length !== Object.keys(spec).length) return null;
  return { name: name as EventName, props: out };
}

export const bucketMessages = (n: number) => (n < 100 ? '<100' : n < 1000 ? '100-1k' : n < 5000 ? '1k-5k' : '5k+');
export const bucketMs = (ms: number) => (ms < 1000 ? '<1s' : ms < 5000 ? '1-5s' : ms < 15000 ? '5-15s' : '15s+');
