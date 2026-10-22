// Randomised check that the amount survives any number style (1234.5, 1,234.50, 12,34,567.89...) in every corpus message.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { parseMessage } from './parser';
const src = readFileSync(new URL('./parser.india.test.ts', import.meta.url), 'utf8');
const re = /name: '([^']+)',\s*sender: '([^']+)',\s*text: ('(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"),\s*want: \{ ([^}]*)\}/g;
const cases: { name: string; sender: string; text: string; paise: number }[] = [];
let m;
while ((m = re.exec(src))) { const pm = m[4].match(/amountPaise: (\d+)/); if (pm) cases.push({ name: m[1], sender: m[2], text: eval(m[3]), paise: Number(pm[1]) }); }
let seed = 7; const rnd = () => ((seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296);
const indian = (n: string) => { const [i, d] = n.split('.'); let r = i.slice(-3); let rest = i.slice(0, -3); while (rest.length) { r = rest.slice(-2) + ',' + r; rest = rest.slice(0, -2); } return d !== undefined ? r + '.' + d : r; };
const western = (n: string) => { const [i, d] = n.split('.'); return i.replace(/\B(?=(\d{3})+(?!\d))/g, ',') + (d !== undefined ? '.' + d : ''); };
test('amounts in every grouping style and size are read exactly, across the whole bank corpus', () => {
const fails: Record<string, string[]> = {};
for (let k = 0; k < 1500; k++) {
  const c = cases[Math.floor(rnd() * cases.length)];
  const target = c.paise / 100;
  const nm = c.text.match(/\d[\d,]*(?:\.\d+)?/g)!.find((x) => Math.abs(parseFloat(x.replace(/,/g, '')) - target) < 1e-9);
  if (!nm) continue;
  const value = [1, 5, 9.5, 99.99, 100, 250, 1234.5, 5000, 12345.67, 99999, 100000, 250000.5, 1234567.89][Math.floor(rnd() * 13)];
  const dec = Math.floor(rnd() * 3);
  const base = dec === 0 && Number.isInteger(value) ? String(value) : dec === 1 && Math.round(value * 10) / 10 === value ? value.toFixed(1) : value.toFixed(2);
  const styled = [base, indian(base), western(base)][Math.floor(rnd() * 3)];
  const text = c.text.replace(nm, styled);
  const r = parseMessage(text, { sender: c.sender, ts: 1 });
  const want = Math.round(parseFloat(styled.replace(/,/g, '')) * 100);
  if (!r) { (fails['no parse'] ??= []).length < 4 && fails['no parse'].push(`${c.name}: ${text}`); continue; }
  if (r.amountPaise !== want) (fails['wrong amount'] ??= []).length < 6 && fails['wrong amount'].push(`${c.name}: ${text} => ${r.amountPaise} want ${want}`);
}
assert.deepEqual(fails, {});
});
