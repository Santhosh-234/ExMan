/** Maps a route path to the screen name allowed in telemetry. Route params and ids are never reported. */
export const SCREEN_NAMES = ['home', 'activity', 'insights', 'settings', 'review', 'detail', 'add', 'accounts', 'merchants', 'rules', 'categories', 'unrecognised', 'teach', 'privacy', 'budgets', 'subscriptions', 'backup', 'rates', 'welcome', 'unknown'] as const;
export type ScreenName = (typeof SCREEN_NAMES)[number];

const BY_SEGMENT: Record<string, ScreenName> = {
  activity: 'activity', insights: 'insights', settings: 'settings', review: 'review', txn: 'detail', add: 'add', accounts: 'accounts', account: 'accounts',
  merchants: 'merchants', rules: 'rules', categories: 'categories', unrecognised: 'unrecognised', teach: 'teach', privacy: 'privacy', telemetry: 'privacy',
  budgets: 'budgets', subscriptions: 'subscriptions', backup: 'backup', rates: 'rates', welcome: 'welcome',
};

export function screenOf(path: string): ScreenName {
  const seg = path.split('?')[0].split('/').filter(Boolean)[0];
  if (!seg) return 'home';
  return BY_SEGMENT[seg] ?? 'unknown';
}
