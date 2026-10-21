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
