import type { SQLiteDatabase } from 'expo-sqlite';

import { run } from '@/ingest/core';

const D = 864e5;
const TAG = '[DEMO] ';
const SENDER = 'VM-HDFCBK-S';

/** Sample bank messages that exercise every smart feature: salary, rent, a SIP, an EMI, groceries, ATM, a fee, a lost message, a double charge, a very large payment and an unpaid card bill. */
export function demoMessages(now: number) {
  const out: { kind: 'sms'; sender: string; text: string; ts: number }[] = [];
  let bal = 150000, n = 0;
  const ref = () => 910000000000 + ++n;
  const m = (ts: number, text: string) => out.push({ kind: 'sms', sender: SENDER, text: TAG + text, ts });
  for (let k = 3; k >= 1; k--) {
    const base = now - k * 30 * D;
    m(base + 1 * D, `Rs.85000.00 credited to a/c XX9999 by NEFT SALARY ACME CORP. Avl bal Rs.${(bal += 85000)}.00`);
    m(base + 4 * D, `Rs.20000.00 debited from a/c XX9999 to VPA landlord@okaxis (UPI Ref No ${ref()}). Avl bal Rs.${(bal -= 20000)}.00`);
    m(base + 6 * D, `Rs.5000.00 debited from a/c XX9999 towards SIP for HDFC Mutual Fund folio 9988. Avl bal Rs.${(bal -= 5000)}.00`);
    m(base + 8 * D, `Rs.12450.00 debited from a/c XX9999 for EMI of loan a/c 77 Bajaj Finance. Avl bal Rs.${(bal -= 12450)}.00`);
    for (let g = 0; g < 6; g++) m(base + (10 + g * 2) * D, `Rs.${700 + g * 10}.00 debited from a/c XX9999 to VPA bigbasket@upi (UPI Ref No ${ref()}). Avl bal Rs.${(bal -= 700 + g * 10)}.00`);
    m(base + 22 * D, `Rs.5000.00 withdrawn at ATM Koramangala from a/c XX9999. Avl bal Rs.${(bal -= 5000)}.00`);
  }
  m(now - 7 * D - 3600e3, `Rs.11.80 debited from a/c XX9999 towards SMS charges incl GST. Avl bal Rs.${(bal -= 11.8).toFixed(2)}`);
  bal -= 3000; // a Rs 3,000 debit whose message never arrived: the next balance already reflects it
  m(now - 6 * D, `Rs.640.00 debited from a/c XX9999 to VPA bigbasket@upi (UPI Ref No ${ref()}). Avl bal Rs.${(bal -= 640).toFixed(2)}`);
  m(now - 2 * D, `Rs.9000.00 debited from a/c XX9999 to VPA bigbasket@upi (UPI Ref No ${ref()}). Avl bal Rs.${(bal -= 9000).toFixed(2)}`);
  m(now - 1 * D, `Rs.1500.00 debited from a/c XX9999 to VPA gadgetshop@upi (UPI Ref No ${ref()}). Avl bal Rs.${(bal -= 1500).toFixed(2)}`);
  m(now - 1 * D + 5 * 60_000, `Rs.1500.00 debited from a/c XX9999 to VPA gadgetshop@upi (UPI Ref No ${ref()}). Avl bal Rs.${(bal -= 1500).toFixed(2)}`);
  const due = new Date(now + 4 * D);
  m(now - 1 * D, `Total Amt Due Rs 9,000.00 or Min Amt Due Rs 450.00 is payable by ${String(due.getDate()).padStart(2, '0')}-${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][due.getMonth()]}-${String(due.getFullYear()).slice(2)} for your HDFC Bank Credit Card ending 9998`);
  return out;
}

/** Loads the sample messages. Everything older than a week is confirmed so the charts and the feed have history; the newest few wait in Review. */
export async function loadDemo(db: SQLiteDatabase, now = Date.now()) {
  const added = await run(db, demoMessages(now), 0);
  await db.runAsync("UPDATE transactions SET status = 'confirmed' WHERE raw_text LIKE ? AND ts < ?", `${TAG}%`, now - 7 * D);
  return added;
}

/** Removes the sample data completely, including the accounts, bills, holdings and merchants it created. */
export async function removeDemo(db: SQLiteDatabase) {
  // the demo accounts are fake, so anything on them goes too: entries added by hand (the Books check "Add it"), edits, ignored differences
  const demoAccounts = (await db.getAllAsync<{ id: number }>("SELECT id FROM accounts WHERE last4 IN ('9999', '9998') AND bank = 'HDFC' AND kind != 'cash'")).map((a) => a.id);
  await db.runAsync('DELETE FROM transactions WHERE raw_text LIKE ?', `${TAG}%`);
  if (demoAccounts.length) {
    const ids = demoAccounts.join(',');
    await db.runAsync(`DELETE FROM transactions WHERE account_id IN (${ids})`);
    await db.runAsync(`UPDATE accounts SET merged_into = NULL WHERE merged_into IN (${ids})`);
    await db.runAsync(`DELETE FROM accounts WHERE id IN (${ids})`);
  }
  await db.runAsync("DELETE FROM bills WHERE last4 = '9998'");
  await db.runAsync('DELETE FROM ledger_ignored WHERE txn_id NOT IN (SELECT id FROM transactions)');
  await db.runAsync("DELETE FROM holdings WHERE key NOT LIKE 'manual:%' AND id NOT IN (SELECT holding_id FROM transactions WHERE holding_id IS NOT NULL)");
  await db.runAsync(
    `DELETE FROM merchants WHERE id NOT IN (SELECT merchant_id FROM transactions WHERE merchant_id IS NOT NULL)
       AND id NOT IN (SELECT merchant_id FROM rules WHERE merchant_id IS NOT NULL)
       AND id NOT IN (SELECT merchant_id FROM transfer_merchants)
       AND id NOT IN (SELECT merchant_id FROM kind_rules)
       AND id NOT IN (SELECT merged_into FROM merchants WHERE merged_into IS NOT NULL)`,
  );
  await db.runAsync("DELETE FROM settings WHERE key = 'feed_dismissed'");
}
