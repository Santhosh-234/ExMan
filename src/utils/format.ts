import { maskState } from './mask';

export const rupees = (paise: number) =>
  maskState.hidden ? '₹ ••••' : '₹' + (paise / 100).toLocaleString('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 2 });

export const monthKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;

/** [start, end) epoch ms for a 'YYYY-MM' key. */
export function monthRange(key: string): [number, number] {
  const [y, m] = key.split('-').map(Number);
  return [new Date(y, m - 1, 1).getTime(), new Date(y, m, 1).getTime()];
}

export const shiftMonth = (key: string, delta: number) => {
  const [y, m] = key.split('-').map(Number);
  return monthKey(new Date(y, m - 1 + delta, 1));
};

export const monthLabel = (key: string) => {
  const [y, m] = key.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleString('en-IN', { month: 'short', year: 'numeric' });
};

/** Compact rupees for tight spaces: ₹4.2L, ₹1.3Cr, ₹12K (Indian lakh/crore units). */
export function rupeesShort(paise: number): string {
  if (maskState.hidden) return '₹ ••••';
  const r = Math.abs(paise) / 100, sign = paise < 0 ? '−' : '';
  const f = (n: number) => String(Math.round(n * 10) / 10).replace(/\.0$/, '');
  if (r >= 1e7) return `${sign}₹${f(r / 1e7)}Cr`;
  if (r >= 1e5) return `${sign}₹${f(r / 1e5)}L`;
  if (r >= 1e3) return `${sign}₹${f(r / 1e3)}K`;
  return `${sign}₹${Math.round(r)}`;
}
