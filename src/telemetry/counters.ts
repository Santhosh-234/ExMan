// parser outcomes are counted in memory and emitted as one event per bank (never per message)
const counters = new Map<string, { parsed: number; unrecognised: number; taught: number }>();
export function countParse(bank: string | null, kind: 'parsed' | 'unrecognised' | 'taught') {
  const k = bank ?? 'none';
  const c = counters.get(k) ?? { parsed: 0, unrecognised: 0, taught: 0 };
  c[kind]++;
  counters.set(k, c);
}
/** Returns and clears the counts gathered so far. */
export function takeCounters() {
  const out = [...counters];
  counters.clear();
  return out;
}
