import assert from 'node:assert/strict';
import { test } from 'node:test';

import { readCsv } from './csvread';
import { type ExTxn, reconcile } from './reconcile';
import { dayOfTs, parseStatement, payeeOf, readDate, readMoney, refOf } from './statement';

// Synthetic copies of two real layouts (all names and numbers invented).
const axis = [
  ['Name :- A TESTER'], ['Customer ID :- 000000000'], [],
  ['Statement of Axis Account No - 910000000004321 for the period (From : 01-10-2026  To : 05-10-2026) '], [],
  ['SRL NO ', 'Tran Date ', 'CHQNO', 'PARTICULARS ', 'DR ', 'CR ', 'BAL ', 'SOL '],
  [1, '01-10-2026', '', 'UPI/P2M/111111111111/Swiggy Ltd           /Pay fo/AXIS BANK', '               305.00', ' ', '            10000.00', '1513'],
  [2, '02-10-2026', '', 'UPI/P2A/222222222222/Mr Friend/UPI/INDIAN BANK', '               200.00', ' ', '             9800.00', '1513'],
  [3, '03-10-2026', '', 'CreditCard Payment XX 2498 Ref#1Q2GEYXSRYNSI1', '              4000.00', ' ', '             5800.00', '1513'],
  [4, '03-10-2026', '', 'UPI/P2A/333333333333/Mr Self/IDIB/Test/', ' ', '               100.00', '             5900.00', '1513'],
  [5, '05-10-2026', '', 'INT.PD:01-07-2026 to 30-09-2026', ' ', '                23.50', '             5923.50', '1513'],
  [], ['Legends Used in Account Statement'], ['VMT-Visa Money Transfer through ATM'], ['This is a system generated output and requires no signature.'],
];
const indian = [
  [], ['A/C Holder Name', 'A Tester', 'Bank Name', 'Indian Bank'], ['Account Number', '7200001234'], [], ['Statement Date : Tue Nov 10 18:47:06 IST 2026'],
  ['Txn Date', 'Description', 'Cheque No', 'Debit Amount', 'Credit Amount', 'Balance'],
  [new Date(2026, 9, 3), 'UTIB0001513/A TESTER  /XXXXX30118/9486130118@ptaxis /UPI/222222222222/NA /BRANCH :  ATM SERVICE BRANCH', '', null, 200, '1711.100 CR'],
  [new Date(2026, 9, 4), 'HDFC0MERUPI/FLIPKART PAYMENTS/XXXXX86200/flipkart1.payu@hdfcbank /UPI/444444444444/UPIIntent/BRANCH :  ATM SERVICE BRANCH', '', 105, null, '1606.100 CR'],
  ['Total', null, null, 105, 200, null],
];

test('Axis layout: text dates, padded amounts, footer legend ignored', () => {
  const r = parseStatement(axis);
  assert.ok(r.ok);
  if (!r.ok) return;
  const s = r.statement;
  assert.equal(s.lines.length, 5);
  assert.deepEqual([s.from, s.to], ['2026-10-01', '2026-10-05']);
  assert.equal(s.openingPaise, 1030500);
  assert.equal(s.closingPaise, 592350);
  assert.equal(s.chainChecked, 4);
  assert.equal(s.chainBroken, 0);
  assert.equal(s.hint.last4, '4321');
  assert.equal(s.hint.bank, 'Axis');
  assert.equal(s.lines[0].ref, '111111111111');
  assert.equal(s.lines[0].payee, 'Swiggy Ltd');
  assert.equal(s.lines[2].ref, null);
  assert.equal(s.lines[3].direction, 'credit');
});

test('Indian Bank layout: real dates, "1711.100 CR" balances, no opening row, Total row stops', () => {
  const r = parseStatement(indian);
  assert.ok(r.ok);
  if (!r.ok) return;
  const s = r.statement;
  assert.equal(s.lines.length, 2);
  assert.equal(s.openingPaise, 151110);
  assert.equal(s.closingPaise, 160610);
  assert.equal(s.chainBroken, 0);
  assert.equal(s.lines[0].payee, 'A TESTER');
  assert.equal(s.lines[1].payee, 'FLIPKART PAYMENTS');
  assert.equal(s.lines[1].direction, 'debit');
  assert.equal(s.hint.last4, '1234');
  assert.equal(s.hint.bank, 'Indian Bank');
});

test('no personal header text leaks into the result', () => {
  const r = parseStatement(axis);
  assert.ok(r.ok);
  assert.ok(!JSON.stringify(r).includes('TESTER'));
});

test('newest-first statements are put in order using the balance column', () => {
  const rows = [axis[5], ...axis.slice(6, 11).reverse()];
  const r = parseStatement(rows);
  assert.ok(r.ok);
  if (!r.ok) return;
  assert.equal(r.statement.lines[0].day, '2026-10-01');
  assert.equal(r.statement.chainBroken, 0);
});

test('a misread amount is reported through the balance chain', () => {
  const bad = axis.map((r) => [...r]);
  bad[7][4] = '               250.00';
  const r = parseStatement(bad);
  assert.ok(r.ok);
  if (r.ok) { assert.ok(r.statement.chainBroken >= 1); assert.ok(r.statement.warnings.length); }
});

test('CSV: quotes, thousands separators, wrapped narration, separate Amount + Dr/Cr columns', () => {
  const csv = '﻿Date,Narration,Amount,Dr/Cr,Balance\n"01/10/2026","UPI/P2M/555555555555/Zomato/\nmore text","1,250.00",DR,"8,750.00"\n02/10/26,Salary,"50,000.00",CR,"58,750.00"\n';
  const r = parseStatement(readCsv(csv));
  assert.ok(r.ok);
  if (!r.ok) return;
  assert.equal(r.statement.lines.length, 2);
  assert.equal(r.statement.lines[0].paise, 125000);
  assert.equal(r.statement.lines[0].direction, 'debit');
  assert.equal(r.statement.lines[0].ref, '555555555555');
  assert.equal(r.statement.lines[1].direction, 'credit');
  assert.equal(r.statement.chainBroken, 0);
});

test('unsupported files are refused politely', () => {
  const r = parseStatement([['hello', 'world'], ['1', '2']]);
  assert.equal(r.ok, false);
});

test('dates, money, references', () => {
  assert.equal(readDate('10-10-2026'), '2026-10-10');
  assert.equal(readDate('5/3/26'), '2026-03-05');
  assert.equal(readDate('05-Nov-2026'), '2026-11-05');
  assert.equal(readDate('2026-11-05 10:30:00'), '2026-11-05');
  assert.equal(readDate('31-02-2026'), null);
  assert.equal(readDate(46300), '2026-10-05');
  assert.equal(readMoney('  1,234.50 '), 123450);
  assert.equal(readMoney('1711.100 CR'), 171110);
  assert.equal(readMoney('50.00 DR'), -5000);
  assert.equal(readMoney('(50.00)'), -5000);
  assert.equal(readMoney('₹ 99'), 9900);
  assert.equal(readMoney(' '), null);
  assert.equal(readMoney('abc'), null);
  assert.equal(refOf('IMPS/P2A/123456789012/x'), '123456789012');
  assert.equal(refOf('Ref 12345'), null);
  assert.equal(payeeOf('NEFT/AXISP00123456789/SOMEONE LTD/xx'), 'SOMEONE LTD');
});

const T0 = new Date(2026, 9, 1, 15, 0).getTime();
const day = (n: number, h = 12) => T0 + n * 864e5 + (h - 15) * 36e5;
const ex = (id: number, d: number, dir: 'debit' | 'credit', rupees: number, raw: string | null): ExTxn => ({ id, ts: day(d), direction: dir, amount_paise: rupees * 100, raw_text: raw });

test('reconcile: ref match, amount match within 2 days, missing, extra, differs, partner', () => {
  const r = parseStatement(axis);
  assert.ok(r.ok);
  if (!r.ok) return;
  const s = r.statement;
  const mine: ExTxn[] = [
    ex(1, 0, 'debit', 305, 'INR 305.00 debited UPI/P2M/111111111111/SWIGGY'), // ref
    ex(2, 2, 'debit', 4000, null), // amount, day later than the statement's 03-10 → within tolerance
    ex(3, 1, 'debit', 777, null), // extra
    ex(4, 4, 'credit', 24, null), // interest recorded as 24 instead of 23.50 → differs
  ];
  const others: ExTxn[] = [ex(90, 1, 'credit', 200, 'Credited UPI/P2A/222222222222/x')];
  const out = reconcile(s.lines, mine, s.from, s.to, others);
  assert.deepEqual(out.matched.map((m) => [m.txn.id, m.how]), [[1, 'ref'], [2, 'amount']]);
  assert.deepEqual(out.differs.map((d) => d.txn.id), [4]);
  assert.deepEqual(out.missing.map((m) => m.line.seq), [1, 3]);
  assert.equal(out.missing[0].partner?.id, 90); // ₹200 to your own other account
  assert.equal(out.missing[1].partner, null);
  assert.deepEqual(out.extra.map((t) => t.id), [3]);
});

test('reconcile: two equal payments are matched one-to-one; recent transactions near the end are not flagged', () => {
  const lines = [
    { seq: 0, day: '2026-10-01', ts: day(0), desc: 'a', direction: 'debit' as const, paise: 5000, balance: null, ref: null, payee: null },
    { seq: 1, day: '2026-10-01', ts: day(0), desc: 'a', direction: 'debit' as const, paise: 5000, balance: null, ref: null, payee: null },
  ];
  const out = reconcile(lines, [ex(1, 0, 'debit', 50, null), ex(2, 4, 'debit', 10, null)], '2026-10-01', '2026-10-05');
  assert.equal(out.matched.length, 1);
  assert.equal(out.missing.length, 1);
  assert.deepEqual(out.edge.map((t) => t.id), [2]);
  assert.equal(dayOfTs(day(0)), '2026-10-01');
});

test('CSV: an unquoted comma in the narration shifts the columns; the row is repaired', () => {
  const csv = [
    'SRL NO,Tran Date,CHQNO,PARTICULARS,DR,CR,BAL,SOL',
    '1,01-10-2026,,UPI/P2M/111111111111/Swiggy Ltd/Pay fo/AXIS BANK,305.00, ,10000.00,1513',
    '2,02-10-2026,,UPI/P2A/222222222222/Mr Friend, Jr/UPI/INDIAN BANK,200.00, ,9800.00,1513',
    '3,03-10-2026,,UPI/P2A/333333333333/Mr Self/IDIB/Test/, ,100.00,9900.00,1513',
  ].join('\n');
  const r = parseStatement(readCsv(csv));
  assert.ok(r.ok);
  if (!r.ok) return;
  const [a, b, c] = r.statement.lines;
  assert.equal(b.direction, 'debit');
  assert.equal(b.paise, 20000);
  assert.equal(b.balance, 980000);
  assert.match(b.desc, /Mr Friend, Jr/);
  assert.equal(c.direction, 'credit');
  assert.equal(r.statement.chainBroken, 0);
  assert.equal(a.direction, 'debit');
});

test('a debit whose amount sits in the credit column is corrected by the balance column', () => {
  const rows = axis.map((r) => [...r]);
  rows[7][4] = ' '; rows[7][5] = '               200.00'; // line 2: a debit placed under CR
  const r = parseStatement(rows);
  assert.ok(r.ok);
  if (!r.ok) return;
  assert.equal(r.statement.lines[1].direction, 'debit');
  assert.equal(r.statement.chainBroken, 0);
  assert.ok(r.statement.warnings.some((w) => /balance column/.test(w)));
});
