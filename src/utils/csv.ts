// CSV export. Cells are quoted per RFC 4180, and anything a spreadsheet could treat as a formula is neutralised.
export type ExportRow = {
  ts: number; direction: 'debit' | 'credit'; is_transfer: number; refund_of: number | null; amount_paise: number;
  currency: string | null; foreign_minor: number | null; merchant: string | null; category: string | null; account: string | null;
  bank: string | null; account_last4: string | null; payment_mode: string | null; source: string; tags: string; notes: string | null;
  status: string; transfer_reason: string | null;
};

const COLUMNS = ['Date', 'Time', 'Type', 'Amount (INR)', 'Original amount', 'Merchant', 'Category', 'Account', 'Bank', 'Last 4', 'Mode', 'Source', 'Tags', 'Notes', 'Status', 'Transfer reason'] as const;

export function csvCell(v: string | number | null | undefined): string {
  let s = v == null ? '' : String(v);
  // spreadsheets run text starting with = + - @ (or tab/CR) as a formula; a leading apostrophe makes it plain text
  if (/^[=+\-@\t\r]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

const pad = (n: number) => String(n).padStart(2, '0');

export function toCsv(rows: ExportRow[]): string {
  const lines = [COLUMNS.join(',')];
  for (const r of rows) {
    const d = new Date(r.ts);
    const type = r.is_transfer ? 'Transfer' : r.direction === 'credit' ? (r.refund_of ? 'Refund' : 'Received') : 'Spent';
    const orig = r.currency && r.foreign_minor != null ? `${r.currency} ${(r.foreign_minor / (r.currency === 'JPY' ? 1 : 100)).toFixed(r.currency === 'JPY' ? 0 : 2)}` : '';
    lines.push([
      `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`, `${pad(d.getHours())}:${pad(d.getMinutes())}`, type,
      (r.amount_paise / 100).toFixed(2), orig, r.merchant, r.category, r.account, r.bank, r.account_last4, r.payment_mode, r.source,
      r.tags.split(',').filter(Boolean).join('; '), r.notes, r.status, r.transfer_reason,
    ].map(csvCell).join(','));
  }
  return `﻿${lines.join('\r\n')}\r\n`; // BOM so Excel reads ₹/UTF-8 correctly
}
