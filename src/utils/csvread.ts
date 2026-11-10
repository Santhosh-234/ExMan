// Minimal CSV reader for bank statement exports: quoted fields, doubled quotes, newlines inside quotes, a BOM, and comma / semicolon / tab / pipe delimiters.

export type Cell = string | number | Date | null;

function sniff(text: string): string {
  const head = text.split(/\r?\n/).slice(0, 40).join('\n');
  let best = ',';
  let bestN = 0;
  for (const d of [',', ';', '\t', '|']) {
    const n = head.split(d).length - 1;
    if (n > bestN) { best = d; bestN = n; }
  }
  return best;
}

export function readCsv(input: string): Cell[][] {
  const text = input.replace(/^﻿/, '');
  const delim = sniff(text);
  const rows: Cell[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  const endField = () => { row.push(field); field = ''; };
  const endRow = () => { endField(); if (row.some((c) => c.trim() !== '')) rows.push(row.map((c) => c)); row = []; };
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else quoted = false; } else field += ch;
    } else if (ch === '"' && field === '') quoted = true;
    else if (ch === delim) endField();
    else if (ch === '\n') endRow();
    else if (ch === '\r') { if (text[i + 1] === '\n') i++; endRow(); } else field += ch;
  }
  if (field !== '' || row.length) endRow();
  return rows;
}
