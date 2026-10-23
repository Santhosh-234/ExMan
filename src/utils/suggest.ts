// Learns categories from the user's own confirmed history: a small naive-Bayes model over the merchant (whole name, words, letter
// triples), the payment mode, direction and amount size. Pure and tiny so it can rebuild in milliseconds on every ingest batch.

export type Example = { merchant: string | null; direction: 'debit' | 'credit'; mode: string | null; amountPaise: number; category: number };
export type Suggestion = { category: number; confidence: number; /** confirmed transactions that share this merchant (or its words) and this category */ support: number; exact: boolean };

// how much each kind of evidence counts; the merchant is the real signal, the rest only breaks ties
const WEIGHT = { whole: 3, word: 1.5, tri: 0.35, dir: 0.4, mode: 0.4, size: 0.3 };

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();

export function featuresOf(e: Pick<Example, 'merchant' | 'direction' | 'mode' | 'amountPaise'>): [string, number][] {
  const f: [string, number][] = [[`d:${e.direction}`, WEIGHT.dir]];
  if (e.mode) f.push([`p:${e.mode.toLowerCase()}`, WEIGHT.mode]);
  f.push([`a:${Math.floor(Math.log2(Math.max(1, e.amountPaise / 100)))}`, WEIGHT.size]);
  const m = e.merchant ? norm(e.merchant) : '';
  if (m) {
    f.push([`m:${m}`, WEIGHT.whole]);
    for (const w of m.split(' ')) if (w.length >= 3) f.push([`w:${w}`, WEIGHT.word]);
    const flat = m.replace(/ /g, '');
    for (let i = 0; i + 3 <= flat.length; i++) f.push([`g:${flat.slice(i, i + 3)}`, WEIGHT.tri]);
  }
  return f;
}

export type Model = { predict(e: Omit<Example, 'category'>): Suggestion | null; size: number };

export function trainModel(examples: Example[]): Model {
  const classCount = new Map<number, number>();
  const featCount = new Map<string, Map<number, number>>(); // feature -> class -> count
  const classTotal = new Map<number, number>();            // class -> number of feature occurrences
  const vocab = new Set<string>();
  const merchantClass = new Map<string, Map<number, number>>();
  const wordClass = new Map<string, Map<number, number>>();
  const bump = (m: Map<string, Map<number, number>>, k: string, c: number) => { const x = m.get(k) ?? new Map<number, number>(); x.set(c, (x.get(c) ?? 0) + 1); m.set(k, x); };

  for (const ex of examples) {
    classCount.set(ex.category, (classCount.get(ex.category) ?? 0) + 1);
    for (const [feat] of featuresOf(ex)) {
      vocab.add(feat);
      bump(featCount, feat, ex.category);
      classTotal.set(ex.category, (classTotal.get(ex.category) ?? 0) + 1);
    }
    const m = ex.merchant ? norm(ex.merchant) : '';
    if (m) { bump(merchantClass, m, ex.category); for (const w of m.split(' ')) if (w.length >= 3) bump(wordClass, w, ex.category); }
  }
  const classes = [...classCount.keys()];
  const n = examples.length;

  return {
    size: n,
    predict(e) {
      if (n < 5 || classes.length === 0 || !e.merchant) return null; // without a merchant there is nothing to go on
      const feats = featuresOf(e);
      const logp = new Map<number, number>();
      for (const c of classes) {
        let lp = Math.log(classCount.get(c)! / n);
        const total = classTotal.get(c)! + vocab.size;
        for (const [feat, w] of feats) lp += w * Math.log(((featCount.get(feat)?.get(c) ?? 0) + 1) / total);
        logp.set(c, lp);
      }
      const max = Math.max(...logp.values());
      let z = 0; for (const v of logp.values()) z += Math.exp(v - max);
      let best = classes[0]; for (const c of classes) if (logp.get(c)! > logp.get(best)!) best = c;
      const confidence = 1 / z; // exp(max - max) / z
      const m = norm(e.merchant);
      const exactMap = merchantClass.get(m);
      const exact = !!exactMap;
      const support = exactMap ? exactMap.get(best) ?? 0
        : Math.max(0, ...m.split(' ').filter((w) => w.length >= 3).map((w) => wordClass.get(w)?.get(best) ?? 0));
      return { category: best, confidence, support, exact };
    },
  };
}

/** Confident enough to file a new transaction under it without asking (and to beat the built-in keyword guess). */
export const isStrong = (s: Suggestion | null): s is Suggestion => !!s && s.confidence >= 0.85 && s.support >= 3;
/** Good enough to use when nothing else knows the category. */
export const isUsable = (s: Suggestion | null): s is Suggestion => !!s && s.confidence >= 0.6 && s.support >= 2;

export type Evaluation = { tested: number; answered: number; correct: number; baselineAnswered: number; baselineCorrect: number };

/**
 * Honest accuracy: train on the older 80% of history and predict the newest 20% (what actually happens as new messages arrive).
 * `baseline` is the existing keyword guess, so the number answers "is learning better than what we had?".
 */
export function evaluate(history: (Example & { ts: number })[], baseline: (e: Example) => number | null): Evaluation {
  const sorted = [...history].sort((a, b) => a.ts - b.ts);
  const cut = Math.floor(sorted.length * 0.8);
  const model = trainModel(sorted.slice(0, cut));
  const out: Evaluation = { tested: 0, answered: 0, correct: 0, baselineAnswered: 0, baselineCorrect: 0 };
  for (const e of sorted.slice(cut)) {
    out.tested++;
    const s = model.predict(e);
    if (isUsable(s)) { out.answered++; if (s.category === e.category) out.correct++; }
    const b = baseline(e);
    if (b !== null) { out.baselineAnswered++; if (b === e.category) out.baselineCorrect++; }
  }
  return out;
}
