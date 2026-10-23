import type { SQLiteDatabase } from 'expo-sqlite';

import { categoryReport } from '@/db/suggest';
import { type TemplateGroup, coverageOfTop, groupByTemplate } from '@/utils/lab';

export type LabReport = {
  parsed: number;
  unrecognised: number;
  likelyMoney: number;
  groups: TemplateGroup[];
  top5Coverage: number;
  /** transactions the parser created that the user then dismissed (candidates for wrong reads), grouped by format */
  dismissed: TemplateGroup[];
  /** how often the user had to correct what the parser read, per field */
  corrections: { field: string; n: number }[];
  category: Awaited<ReturnType<typeof categoryReport>>;
};

export async function labReport(db: SQLiteDatabase): Promise<LabReport> {
  const parsed = (await db.getFirstAsync<{ n: number }>("SELECT COUNT(*) AS n FROM transactions WHERE raw_text IS NOT NULL AND source != 'manual'"))!.n;
  const rows = await db.getAllAsync<{ id: number; sender: string; text: string; ts: number }>('SELECT id, sender, text, ts FROM unparsed');
  const groups = groupByTemplate(rows);
  const dismissed = groupByTemplate(
    await db.getAllAsync<{ id: number; sender: string; text: string; ts: number }>(
      "SELECT id, COALESCE(bank, source) AS sender, raw_text AS text, ts FROM transactions WHERE status = 'dismissed' AND raw_text IS NOT NULL LIMIT 2000",
    ),
  );
  const corrections = await db.getAllAsync<{ field: string; n: number }>(
    "SELECT field, COUNT(*) AS n FROM edit_log WHERE field IN ('amount_paise','merchant','direction') GROUP BY 1 ORDER BY 2 DESC",
  );
  return {
    parsed,
    unrecognised: rows.length,
    likelyMoney: groups.filter((g) => g.likelyTransaction).reduce((s, g) => s + g.count, 0),
    groups,
    top5Coverage: coverageOfTop(groups, 5),
    dismissed,
    corrections,
    category: await categoryReport(db),
  };
}
