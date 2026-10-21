import assert from 'node:assert/strict';
import { test } from 'node:test';

import { parseMessage } from './parser';
import { type TxnLite, REASON, classifyAlone, findCardBillPartner, findOwnTransferPartner } from './transfers';

const T = 1_760_000_000_000;
const MIN = 60_000;
let nextId = 1;
const tx = (o: Partial<TxnLite>): TxnLite => ({
  id: nextId++, amount_paise: 500_000, direction: 'debit', ts: T, account_id: 1, account_kind: 'bank', mode: 'UPI', merchant: null, raw_text: null,
  is_transfer: 0, blocked: 0, reason: null, pair_id: null, ...o,
});

test('card payment received on a card account is a transfer', () => {
  const texts = [
    'Payment of Rs.5000.00 received towards your HDFC Bank Credit Card ending 4321 on 20-OCT-26. Thank you',
    'Dear Customer, Payment of INR 1,500.00 has been received towards your ICICI Bank Credit Card XX5678 on 20-Oct-26.',
    'Payment of INR 12,000.00 has been received on your Axis Bank Credit Card no. XX1234 on 20-10-26.',
  ];
  for (const raw_text of texts) {
    // and the parser reads these as credits on a card
    const p = parseMessage(raw_text, { sender: 'VM-BANK', ts: T });
    assert.equal(p?.direction, 'credit', raw_text);
    assert.equal(classifyAlone(tx({ direction: 'credit', account_kind: 'card', raw_text })), REASON.cardReceived, raw_text);
  }
});

test('refunds and cashback on a card are NOT transfers', () => {
  assert.equal(classifyAlone(tx({ direction: 'credit', account_kind: 'card', raw_text: 'Refund of Rs 899 credited to your card XX4321 for payment reversal' })), null);
  assert.equal(classifyAlone(tx({ direction: 'credit', account_kind: 'card', raw_text: 'Cashback of Rs 50 credited to your card XX4321' })), null);
});

test('bank debits that pay a credit card are transfers; card spends and normal payments are not', () => {
  assert.equal(classifyAlone(tx({ raw_text: 'Rs.12000 debited from a/c XX1234 to VPA cred.club@axisb' })), REASON.cardBill);
  assert.equal(classifyAlone(tx({ raw_text: 'INR 8,000 debited A/c XX1234 UPI/P2M/123/AXIS BANK CREDIT CARD PAYMENT' })), REASON.cardBill);
  assert.equal(classifyAlone(tx({ merchant: 'SBI Card' })), REASON.cardBill);
  // spending on the card itself is real spending
  assert.equal(classifyAlone(tx({ account_kind: 'card', raw_text: 'Spent Rs 500 on your Axis Bank Credit Card at CRED STORE' })), null);
  // debit cards and ordinary merchants
  assert.equal(classifyAlone(tx({ raw_text: 'Rs 500 spent on Axis Bank Debit Card XX1234 at SWIGGY' })), null);
  assert.equal(classifyAlone(tx({ merchant: 'Credible Hardware', raw_text: 'debited Rs 900 to credible hardware' })), null);
});

test('own-account transfer: same amount, opposite direction, different accounts, close in time', () => {
  const out = tx({ account_id: 1, direction: 'debit', ts: T });
  const inn = tx({ account_id: 2, direction: 'credit', ts: T + 2 * MIN });
  assert.equal(findOwnTransferPartner(out, [inn])?.id, inn.id);
  assert.equal(findOwnTransferPartner(inn, [out])?.id, out.id);
});

test('own-account transfer rejects same account, other amounts, same direction, late, blocked, already marked', () => {
  const out = tx({ account_id: 1, direction: 'debit' });
  assert.equal(findOwnTransferPartner(out, [tx({ account_id: 1, direction: 'credit' })]), null); // same account
  assert.equal(findOwnTransferPartner(out, [tx({ account_id: 2, direction: 'credit', amount_paise: 400_000 })]), null);
  assert.equal(findOwnTransferPartner(out, [tx({ account_id: 2, direction: 'debit' })]), null);
  assert.equal(findOwnTransferPartner(out, [tx({ account_id: 2, direction: 'credit', ts: T + 20 * MIN })]), null); // UPI window is 5 min
  assert.equal(findOwnTransferPartner(out, [tx({ account_id: 2, direction: 'credit', blocked: 1 })]), null);
  assert.equal(findOwnTransferPartner(out, [tx({ account_id: 2, direction: 'credit', is_transfer: 1 })]), null);
  assert.equal(findOwnTransferPartner(tx({ blocked: 1 }), [tx({ account_id: 2, direction: 'credit' })]), null);
});

test('windows widen for IMPS, NEFT and explicit self-transfer wording', () => {
  const out = tx({ account_id: 1, direction: 'debit', mode: 'NEFT' });
  assert.ok(findOwnTransferPartner(out, [tx({ account_id: 2, direction: 'credit', mode: 'NEFT', ts: T + 3 * 60 * MIN })]));
  assert.equal(findOwnTransferPartner(out, [tx({ account_id: 2, direction: 'credit', mode: 'NEFT', ts: T + 7 * 60 * MIN })]), null);
  const imps = tx({ direction: 'debit', mode: 'IMPS' });
  assert.ok(findOwnTransferPartner(imps, [tx({ account_id: 2, direction: 'credit', mode: 'IMPS', ts: T + 10 * MIN })]));
  const self = tx({ account_id: 1, direction: 'debit', raw_text: 'Rs 5000 debited. Transfer to self' });
  assert.ok(findOwnTransferPartner(self, [tx({ account_id: 2, direction: 'credit', ts: T + 40 * MIN })]));
});

test('without account ids a transfer needs a self hint; the closest candidate wins', () => {
  const out = tx({ account_id: null, direction: 'debit' });
  assert.equal(findOwnTransferPartner(out, [tx({ account_id: null, direction: 'credit' })]), null);
  const hinted = tx({ account_id: null, direction: 'debit', raw_text: 'sent to own account' });
  const near = tx({ account_id: 2, direction: 'credit', ts: T + 1 * MIN });
  const far = tx({ account_id: 3, direction: 'credit', ts: T + 4 * MIN });
  assert.equal(findOwnTransferPartner(hinted, [far, near])?.id, near.id);
});

test('card bill payment links the card credit to the bank debit within 3 days, even without card wording', () => {
  const credit = tx({ direction: 'credit', account_kind: 'card', account_id: 5, amount_paise: 1_200_000 });
  const debit = tx({ direction: 'debit', account_kind: 'bank', amount_paise: 1_200_000, ts: T - 26 * 60 * MIN, raw_text: 'debited via BILLDESK' });
  assert.equal(findCardBillPartner(credit, [debit])?.id, debit.id);
  // reverse: bank debit arrives after the card credit was already flagged
  const flagged = { ...credit, is_transfer: 1, reason: REASON.cardReceived };
  assert.equal(findCardBillPartner(debit, [flagged])?.id, flagged.id);
  // too old, wrong amount, already paired, blocked
  assert.equal(findCardBillPartner(credit, [{ ...debit, ts: T - 4 * 24 * 60 * MIN }]), null);
  assert.equal(findCardBillPartner(credit, [{ ...debit, amount_paise: 1 }]), null);
  assert.equal(findCardBillPartner(debit, [{ ...flagged, pair_id: 99 }]), null);
  assert.equal(findCardBillPartner(credit, [{ ...debit, blocked: 1 }]), null);
});

test('more ways a bank debit names a credit card payment', () => {
  const t = (raw_text: string) => classifyAlone(tx({ raw_text }));
  for (const text of [
    'INR 12,000 debited A/c XX1234 UPI/P2A/123/AXISCARD',
    'Rs 8000 debited to AXIS BANK CC 4321 ref 9988',
    'NEFT-AXIS BANK CARDS-12000 debited from a/c',
    'Rs.5,000 debited BBPS payment HDFC credit card',
    'Rs 3,500 paid via BBPS to ICICI card ending 5678',
    'Card repayment of Rs 9000 from a/c XX1234',
  ]) assert.equal(t(text), REASON.cardBill, text);
  // still not: debit-card purchases, electricity BBPS, ATM
  for (const text of ['Rs 500 spent on Axis Bank Debit Card XX1234 at SWIGGY', 'Rs 1,800 paid via BBPS to BESCOM electricity', 'Rs 5000 withdrawn at ATM using card XX1234'])
    assert.equal(t(text), null, text);
});
