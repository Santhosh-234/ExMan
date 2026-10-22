import assert from 'node:assert/strict';
import { test } from 'node:test';

import { extractBalance, parseMessage } from './parser';

const T = 1_760_000_000_000;
const p = (text: string, sender: string) => parseMessage(text, { sender, ts: T });

type Case = { name: string; sender: string; text: string; want: Record<string, unknown> | null };

// Message shapes follow what Indian banks/card issuers send; amounts/accounts are made up.
const CASES: Case[] = [
  { name: 'Indian Bank UPI debit', sender: 'VM-INDBNK-S',
    text: 'A/c *1234 debited Rs. 250.00 on 20-10-2026 to zomato@icici. UPI:123456789012. If not you, call 1800 425 00000 -Indian Bank',
    want: { amountPaise: 25000, direction: 'debit', bank: 'INDIAN', account: '1234', merchant: 'zomato@icici', mode: 'UPI' } },
  { name: 'Indian Bank credit', sender: 'VM-INDBNK-S',
    text: 'A/c *1234 credited Rs. 1,500.00 on 20-10-2026 by UPI ref 123456789012 from RAHUL. Bal Rs. 9,000.00 -Indian Bank',
    want: { merchant: 'RAHUL', amountPaise: 150000, direction: 'credit', bank: 'INDIAN', account: '1234' } },
  { name: 'Axis UPI P2M', sender: 'AX-AXISBK-S',
    text: 'INR 450.00 debited A/c no. XX1234 20-10-26, 12:30:45 UPI/P2M/123456789012/Swiggy SMS BLOCK UPI to 7308080808 if not you - Axis Bank',
    want: { amountPaise: 45000, direction: 'debit', bank: 'AXIS', account: '1234', merchant: 'Swiggy', mode: 'UPI' } },
  { name: 'Axis card spend', sender: 'VK-AXISBK-S',
    text: 'Spent Card no. XX9876 INR 1999.00 20-10-26 13:01:02 AMAZON PAY IN Avl Lmt INR 1,00,000.00 SMS BLOCK 9876 to 5676782 if not you - Axis Bank',
    want: { merchant: 'AMAZON PAY IN', amountPaise: 199900, direction: 'debit', bank: 'AXIS', account: '9876', mode: 'Card' } },
  { name: 'Kotak UPI sent', sender: 'CP-KOTAKB-S',
    text: 'Sent Rs.500.00 from Kotak Bank AC X1234 to swiggy@ybl on 20-10-26.UPI Ref 123456789012. Not you, https://kotak.com/fraud',
    want: { amountPaise: 50000, direction: 'debit', bank: 'KOTAK', account: '1234', merchant: 'swiggy@ybl', mode: 'UPI' } },
  { name: 'Kotak card', sender: 'VM-KOTAKB',
    text: 'Rs.2,350.00 spent on your Kotak Credit Card XX4321 at BIGBASKET on 20-OCT-2026. Avl limit Rs.75,000.00',
    want: { amountPaise: 235000, direction: 'debit', bank: 'KOTAK', account: '4321', merchant: 'BIGBASKET', mode: 'Card' } },
  { name: 'SBI account debit', sender: 'JD-SBIINB-S',
    text: 'Dear Customer, your a/c no. XXXXXXXX1234 is debited by Rs.500.0 on 20Oct26 transfer to RAHUL Ref No 123456789012. If not done by you fwd this SMS to 9223008333/Call 1800111109 to block UPI - SBI',
    want: { amountPaise: 50000, direction: 'debit', bank: 'SBI', account: '1234', merchant: 'RAHUL' } },
  { name: 'SBI card', sender: 'BZ-SBICRD-T',
    text: 'Rs.1,234.00 spent on your SBI Card ending 5678 at FLIPKART on 20/10/26. Trxn. not done by you? Report at https://sbicard.com/Dispute',
    want: { amountPaise: 123400, direction: 'debit', bank: 'SBI', account: '5678', merchant: 'FLIPKART', mode: 'Card' } },
  { name: 'PNB', sender: 'AD-PNBSMS',
    text: 'A/c XX1234 debited INR 800.00 Dt 20-10-26 12:00:00 thru UPI:123456789012. Bal INR 5,000.00 -PNB',
    want: { amountPaise: 80000, direction: 'debit', bank: 'PNB', account: '1234', mode: 'UPI' } },
  { name: 'BoB', sender: 'VM-BOBTXN',
    text: 'Rs.600.00 Dr. from A/C XXXXXX1234 and Cr. to rahul@oksbi. Ref:123456789012. AvlBal:Rs5000.00(20-10-26)-Bank of Baroda',
    want: { amountPaise: 60000, direction: 'debit', bank: 'BOB', account: '1234', merchant: 'rahul@oksbi' } },
  { name: 'Canara', sender: 'AX-CANBNK',
    text: 'An amount of INR 300.00 has been DEBITED to your account XXX123 on 20/10/2026 Total Avail.bal INR 4,000.00. - Canara Bank',
    want: { amountPaise: 30000, direction: 'debit', bank: 'CANARA', account: '123' } },
  { name: 'Union Bank', sender: 'VM-UBINBK',
    text: 'A/c *1234 Debited for Rs:700.00 on 20-10-2026 by UPI Ref 123456789012. Avl Bal Rs:3000.00 -Union Bank of India',
    want: { amountPaise: 70000, direction: 'debit', bank: 'UNION', account: '1234' } },
  { name: 'IDFC First', sender: 'AD-IDFCFB-S',
    text: 'Your A/C XX1234 has been debited with INR 1,200.00 on 20-OCT-26 towards UPI/123456789012/BLINKIT. Bal INR 8,000.00. -IDFC FIRST Bank',
    want: { merchant: 'BLINKIT', amountPaise: 120000, direction: 'debit', bank: 'IDFC', account: '1234' } },
  { name: 'Yes Bank', sender: 'VK-YESBNK',
    text: 'Rs.150.00 debited from A/c XX1234 on 20-10-26 and credited to uber@axisbank. UPI Ref 123456789012. -YES BANK',
    want: { merchant: 'uber@axisbank', amountPaise: 15000, direction: 'debit', bank: 'YES', account: '1234' } },
  { name: 'Federal', sender: 'VM-FEDBNK',
    text: 'Rs 90.00 debited from your Federal Bank A/c XX1234 on 20-10-26 to paytmqr281@paytm via UPI Ref 123456789012',
    want: { merchant: 'paytmqr281@paytm', amountPaise: 9000, direction: 'debit', bank: 'FEDERAL', account: '1234' } },
  { name: 'Amex', sender: 'AM-AMEXIN',
    text: "Alert: You've spent INR 3,450.00 on your AMEX card ** 1005 at SWIGGY on 20 October 2026 at 08:15 PM IST.",
    want: { amountPaise: 345000, direction: 'debit', bank: 'AMEX', account: '1005', merchant: 'SWIGGY', mode: 'Card' } },
  { name: 'HDFC credit card', sender: 'VM-HDFCBK',
    text: 'Txn of Rs.899.00 done on HDFC Bank Card ending 4321 at NETFLIX on 20-10-26. Avl bal/limit Rs.50,000.00',
    want: { merchant: 'NETFLIX', amountPaise: 89900, direction: 'debit', bank: 'HDFC', account: '4321' } },
  { name: 'ICICI card', sender: 'VM-ICICIB',
    text: 'INR 2,000.00 spent using ICICI Bank Card XX1234 on 20-Oct-26 on AMAZON. Avl Lmt: INR 90,000.00. To dispute call 18002662',
    want: { merchant: 'AMAZON', amountPaise: 200000, direction: 'debit', bank: 'ICICI', account: '1234', mode: 'Card' } },
  { name: 'ATM withdrawal', sender: 'VM-SBIINB',
    text: 'Rs 5,000 withdrawn at SBI ATM from A/c X1234 on 20Oct26. Avl Bal Rs 20,000.',
    want: { merchant: 'SBI ATM', amountPaise: 500000, direction: 'debit', bank: 'SBI', account: '1234', mode: 'ATM' } },
  { name: 'NEFT credit salary', sender: 'AD-HDFCBK',
    text: 'INR 75,000.00 credited to A/c XX1234 on 20-10-26 by NEFT-ACME LTD SALARY. Avl bal INR 80,000.00',
    want: { merchant: 'ACME LTD SALARY', amountPaise: 7500000, direction: 'credit', account: '1234', mode: 'NEFT' } },
  { name: 'Refund', sender: 'VM-HDFCBK',
    text: 'Rs.899.00 refunded to your HDFC Bank Card ending 4321 from NETFLIX on 20-10-26.',
    want: { merchant: 'NETFLIX', amountPaise: 89900, direction: 'credit', account: '4321' } },
  // must NOT be transactions
  { name: 'OTP', sender: 'VM-HDFCBK', text: '123456 is the OTP for txn of Rs 500 at AMAZON on card ending 1234. Do not share.', want: null },
  { name: 'Failed', sender: 'VM-ICICIB', text: 'Txn of Rs 500 on card XX1234 declined due to insufficient funds.', want: null },
  { name: 'Bill due', sender: 'VM-HDFCBK', text: 'Your HDFC credit card bill of Rs 12,000 is due on 25-10-26. Minimum amount due Rs 600. Pay now.', want: null },
  { name: 'Autopay future', sender: 'VM-ICICIB', text: 'Rs 999 will be debited from your account on 25-10-26 for Netflix mandate.', want: null },
  { name: 'Loan promo', sender: 'AX-AXISBK', text: 'Pre-approved personal loan of Rs 5,00,000 for you. Apply now!', want: null },
  { name: 'Balance only', sender: 'VM-HDFCBK', text: 'Avl bal in a/c XX1234 is Rs 5,000.00 as on 20-10-26.', want: null },
];

for (const c of CASES) {
  test(c.name, () => {
    const r = p(c.text, c.sender);
    if (!c.want) return assert.equal(r, null);
    assert.ok(r, 'expected a parsed transaction');
    for (const [k, v] of Object.entries(c.want)) assert.equal((r as Record<string, unknown>)[k], v, k);
  });
}

test('balance and limit extraction', () => {
  const b = (t: string) => extractBalance(t);
  assert.deepEqual(b('debited Rs 500 on 20-10-26. Avl Bal Rs:3000.00 -Union Bank'), { paise: 300000, kind: 'balance' });
  assert.deepEqual(b('Rs.600.00 Dr. from A/C XXXXXX1234. AvlBal:Rs5000.00(20-10-26)'), { paise: 500000, kind: 'balance' });
  assert.deepEqual(b('debited A/c XX1234. Bal INR 5,000.00'), { paise: 500000, kind: 'balance' });
  assert.deepEqual(b('INR 90.00 spent on card. Avl Lmt: INR 90,000.00'), { paise: 9000000, kind: 'limit' });
  assert.deepEqual(b('Txn of Rs.899 done. Avl bal/limit Rs.50,000.00'), { paise: 5000000, kind: 'limit' });
  assert.equal(b('Rs 250 debited from a/c XX1234 to zomato@icici'), null);
  assert.equal(b('Available balance in a/c XX1234 is hidden'), null);
});
