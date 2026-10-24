// Server-side copy of the app's telemetry allow-list (src/telemetry/schema.ts + src/utils/screens.ts).
// The collector re-validates everything it receives, so a modified or old client can never store anything the app itself could not send.
// A test in the app repo (src/utils/collector.test.ts) fails if this file and the app's schema drift apart.
const SCREENS = ['home', 'activity', 'insights', 'settings', 'review', 'detail', 'add', 'accounts', 'merchants', 'rules', 'categories', 'unrecognised', 'teach', 'privacy', 'budgets', 'subscriptions', 'backup', 'rates', 'welcome', 'unknown'];
const FEATURES = ['manual_add', 'teach_saved', 'rule_created', 'transfer_unmarked', 'transfer_marked', 'account_merged', 'merchant_merged', 'category_created', 'history_import', 'sync_run', 'theme_changed', 'bulk_edit', 'search_used', 'filters_used', 'budget_set', 'subscription_dismissed'];
const BANK_KEYS = ['HDFC', 'ICICI', 'SBI', 'AXIS', 'KOTAK', 'INDIAN', 'PNB', 'BOB', 'CANARA', 'UNION', 'BOI', 'IDFC', 'YES', 'INDUSIND', 'FEDERAL', 'SIB', 'RBL', 'BANDHAN', 'UCO', 'CENTRAL', 'IOB', 'AU', 'IDBI', 'PAYTMBANK', 'AMEX', 'HSBC', 'SC', 'CITI', 'DBS', 'KARNATAKA', 'JKB', 'TMB', 'DCB', 'CSB', 'EQUITAS', 'UJJIVAN', 'BOM', 'PSB', 'FINTECH', 'none'];

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
};

const MAX_INT = 1_000_000_000;

/** Returns { name, props } with only allowed, valid properties, or null when the event is not allowed. */
export function sanitize(name, props) {
  if (typeof name !== 'string' || !Object.hasOwn(EVENTS, name) || props === null || typeof props !== 'object') return null;
  const spec = EVENTS[name];
  const out = {};
  for (const [key, rule] of Object.entries(spec)) {
    const v = props[key];
    if (rule === 'int') { if (typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= MAX_INT) out[key] = Math.round(v); }
    else if (rule === 'bool') { if (typeof v === 'boolean') out[key] = v; }
    else if ('enum' in rule) { if (typeof v === 'string' && rule.enum.includes(v)) out[key] = v; }
    else if (typeof v === 'string' && rule.re.test(v)) out[key] = v;
  }
  if (Object.keys(out).length !== Object.keys(spec).length) return null;
  return { name, props: out };
}
