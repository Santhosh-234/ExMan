import { maskMessage } from '@/telemetry/mask';
import { looksLikeTransaction } from '@/utils/transactional';

export type MsgRow = { id: number; sender: string; text: string; ts: number };
export type TemplateGroup = { template: string; count: number; senders: string[]; sampleId: number; sample: string; likelyTransaction: boolean };

/** Groups messages that differ only in numbers, names and codes, so a few formats stand for hundreds of messages. Biggest first. */
export function groupByTemplate(rows: MsgRow[]): TemplateGroup[] {
  const groups = new Map<string, TemplateGroup>();
  for (const r of rows) {
    const template = maskMessage(r.text);
    const g = groups.get(template);
    if (g) { g.count++; if (!g.senders.includes(r.sender) && g.senders.length < 4) g.senders.push(r.sender); }
    else groups.set(template, { template, count: 1, senders: [r.sender], sampleId: r.id, sample: r.text, likelyTransaction: looksLikeTransaction(r.text) });
  }
  return [...groups.values()].sort((a, b) => b.count - a.count || a.template.localeCompare(b.template));
}

/** Share of the unrecognised messages that the biggest `n` formats account for: tells whether teaching a few formats is worth it. */
export function coverageOfTop(groups: TemplateGroup[], n: number): number {
  const total = groups.reduce((s, g) => s + g.count, 0);
  if (!total) return 0;
  return groups.slice(0, n).reduce((s, g) => s + g.count, 0) / total;
}

/** The text shared as the "masked report": structure only, no digits, names or message text. */
export function maskedReport(opts: { parsed: number; unrecognised: number; groups: TemplateGroup[] }): string {
  const lines = [`ExMan message lab (masked): ${opts.parsed} understood, ${opts.unrecognised} unrecognised`];
  for (const g of opts.groups.slice(0, 25)) lines.push(`${g.count}× ${g.likelyTransaction ? '[money]' : '[other]'} ${g.template}`);
  return lines.join('\n');
}
