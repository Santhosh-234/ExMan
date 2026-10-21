import { useSQLiteContext } from 'expo-sqlite';
import { useCallback } from 'react';

import { applyRuleToExisting, getMerchantRule, removeMerchantRule, setMerchantRule } from '@/db/merchants';
import { notifyIngested } from '@/ingest/events';
import { useSnackbar } from '@/ui/Snackbar';

type Offer = {
  merchantId: number | null;
  merchantName: string | null;
  categoryId: number;
  categoryName: string;
  /** Shown before the question, e.g. "Confirmed ₹250"; `undo` becomes the snackbar's second action. */
  prefix?: string;
  undo?: () => void;
};

/**
 * After the user picks a category for a merchant, offers "Always put X under Y?".
 * Accepting saves the rule and re-categorises that merchant's other transactions, with Undo.
 * Returns true if an offer was shown (so the caller can skip its own snackbar).
 */
export function useRuleOffer() {
  const db = useSQLiteContext();
  const snack = useSnackbar();
  return useCallback(async (o: Offer): Promise<boolean> => {
    if (!o.merchantId || !o.merchantName) return false;
    const existing = await getMerchantRule(db, o.merchantId);
    if (existing?.enabled && existing.category_id === o.categoryId) return false;
    snack({
      message: `${o.prefix ? `${o.prefix}. ` : ''}Always put ${o.merchantName} under ${o.categoryName}?`,
      actionLabel: 'Always',
      onAction: async () => {
        await setMerchantRule(db, o.merchantId!, o.categoryId);
        const { n, undo } = await applyRuleToExisting(db, { merchantId: o.merchantId!, categoryId: o.categoryId });
        notifyIngested();
        snack({
          message: n ? `Rule saved · updated ${n} other transaction${n === 1 ? '' : 's'}` : 'Rule saved',
          onAction: async () => {
            await undo();
            if (existing) await setMerchantRule(db, o.merchantId!, existing.category_id);
            else await removeMerchantRule(db, o.merchantId!);
            notifyIngested();
          },
        });
      },
      secondLabel: o.undo ? 'Undo' : undefined,
      onSecond: o.undo,
    });
    return true;
  }, [db, snack]);
}
