import type { SQLiteDatabase } from 'expo-sqlite';

// Bump when changing DDL; migrate() applies each step once, in order.
const MIGRATIONS = [
  `
  CREATE TABLE categories (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    icon TEXT NOT NULL DEFAULT 'tag',
    color TEXT NOT NULL DEFAULT '#10B981',
    is_custom INTEGER NOT NULL DEFAULT 0
  );

  -- amounts are integer paise; ts is epoch ms
  CREATE TABLE transactions (
    id INTEGER PRIMARY KEY,
    amount_paise INTEGER NOT NULL,
    direction TEXT NOT NULL CHECK (direction IN ('debit','credit')),
    merchant TEXT,
    category_id INTEGER REFERENCES categories(id) ON DELETE SET NULL,
    source TEXT NOT NULL CHECK (source IN ('sms','gpay','phonepe','paytm')),
    bank TEXT,
    account_last4 TEXT,
    payment_mode TEXT,
    ts INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','confirmed')),
    tags TEXT NOT NULL DEFAULT '',
    raw_text TEXT,
    synced_at INTEGER
  );
  -- dedup lookup: same amount within +/-60s (see isDuplicate in utils/parser.ts)
  CREATE INDEX idx_txn_dedup ON transactions (amount_paise, ts);
  CREATE INDEX idx_txn_status_ts ON transactions (status, ts DESC);

  -- category_id NULL = overall monthly budget
  CREATE TABLE budgets (
    id INTEGER PRIMARY KEY,
    category_id INTEGER REFERENCES categories(id) ON DELETE CASCADE,
    month TEXT NOT NULL, -- 'YYYY-MM'
    limit_paise INTEGER NOT NULL,
    UNIQUE (category_id, month)
  );

  INSERT INTO categories (name, icon, color) VALUES
    ('Food & Dining', 'utensils', '#F59E0B'),
    ('Groceries', 'shopping-basket', '#84CC16'),
    ('Transport', 'car', '#3B82F6'),
    ('Shopping', 'shopping-bag', '#EC4899'),
    ('Bills & Utilities', 'receipt', '#8B5CF6'),
    ('Entertainment', 'film', '#F43F5E'),
    ('Health', 'heart-pulse', '#14B8A6'),
    ('Salary', 'banknote', '#10B981'),
    ('Other', 'tag', '#6B7280');
  `,
  // financial-looking messages the parser rejected; kept only so parser misses can be inspected
  `
  CREATE TABLE unparsed (
    id INTEGER PRIMARY KEY,
    sender TEXT NOT NULL,
    text TEXT NOT NULL,
    ts INTEGER NOT NULL
  );
  `,
  // bank detection was missing Indian Bank; backfill old rows from their text. Key/value app settings (sync).
  `
  UPDATE transactions SET bank = 'INDIAN' WHERE bank IS NULL AND raw_text LIKE '%Indian Bank%';
  CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  `,
];

export async function migrate(db: SQLiteDatabase) {
  await db.execAsync('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
  const row = await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version');
  for (let v = row?.user_version ?? 0; v < MIGRATIONS.length; v++) {
    await db.withExclusiveTransactionAsync(async (tx) => {
      await tx.execAsync(MIGRATIONS[v]);
    });
    await db.execAsync(`PRAGMA user_version = ${v + 1}`);
  }
}
