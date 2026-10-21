import { useRouter } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { ChevronLeft, Plus, Trash2 } from 'lucide-react-native';
import { useCallback, useEffect, useState } from 'react';
import { Pressable, ScrollView, Switch, Text, TextInput, View } from 'react-native';

import { addKeywordRule, applyRuleToExisting, deleteRule, getRules, setRuleCategory, setRuleEnabled } from '@/db/merchants';
import { type Category, getCategories } from '@/db/queries';
import { notifyIngested } from '@/ingest/events';
import { Button, Card, EmptyState, Sheet } from '@/ui/kit';
import { CategoryChips } from '@/ui/sheets';
import { useSnackbar } from '@/ui/Snackbar';
import { useTheme } from '@/ui/theme';

type RuleRow = Awaited<ReturnType<typeof getRules>>[number];

export default function Rules() {
  const db = useSQLiteContext();
  const router = useRouter();
  const snack = useSnackbar();
  const { colors } = useTheme();
  const [rules, setRules] = useState<RuleRow[] | null>(null);
  const [cats, setCats] = useState<Category[]>([]);
  const [editing, setEditing] = useState<RuleRow | null>(null);
  const [adding, setAdding] = useState(false);
  const [kw, setKw] = useState('');
  const [kwCat, setKwCat] = useState<number | null>(null);

  const load = useCallback(async () => { setRules(await getRules(db)); setCats(await getCategories(db)); }, [db]);
  useEffect(() => void load(), [load]);

  const remove = async (r: RuleRow) => {
    await deleteRule(db, r.id);
    load();
    snack({
      message: 'Rule deleted. Existing transactions keep their categories.',
      onAction: async () => {
        await db.runAsync('INSERT INTO rules (id, kind, merchant_id, keyword, category_id, enabled, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)', r.id, r.kind, r.merchant_id, r.keyword, r.category_id, r.enabled, r.created_at);
        load();
      },
    });
  };

  const section = (title: string, list: RuleRow[]) =>
    list.length === 0 ? null : (
      <View key={title}>
        <Text className="mb-2 mt-2 text-xs uppercase tracking-wider text-muted">{title}</Text>
        {list.map((r) => (
          <Card key={r.id} className="mb-2">
            <View className="flex-row items-center">
              <View className="flex-1">
                <Text className="text-base text-fg">{r.kind === 'merchant' ? r.merchant_name : `Contains “${r.keyword}”`}</Text>
                <Pressable onPress={() => setEditing(r)} accessibilityRole="button" accessibilityLabel={`Change category, currently ${r.category_name}`} className="mt-1 flex-row items-center">
                  <View className="mr-2 h-3 w-3 rounded-full" style={{ backgroundColor: r.category_color }} />
                  <Text className="text-accent">→ {r.category_name}</Text>
                </Pressable>
              </View>
              <Switch value={!!r.enabled} onValueChange={async (v) => { await setRuleEnabled(db, r.id, v); load(); }} trackColor={{ true: colors.accent, false: colors.surface2 }} accessibilityLabel="Rule enabled" />
              <Pressable onPress={() => remove(r)} hitSlop={10} className="ml-3" accessibilityRole="button" accessibilityLabel="Delete rule"><Trash2 size={18} color={colors.muted} /></Pressable>
            </View>
          </Card>
        ))}
      </View>
    );

  return (
    <View className="flex-1 bg-base px-4 pt-14">
      <Pressable onPress={() => router.back()} hitSlop={12} className="mb-2 flex-row items-center" accessibilityRole="button" accessibilityLabel="Back">
        <ChevronLeft color={colors.fg} /><Text className="text-fg">Back</Text>
      </Pressable>
      <View className="mb-1 flex-row items-center justify-between">
        <Text className="text-3xl font-bold text-fg" accessibilityRole="header">Rules</Text>
        <Pressable onPress={() => { setKw(''); setKwCat(null); setAdding(true); }} hitSlop={10} accessibilityRole="button" accessibilityLabel="Add keyword rule"><Plus color={colors.accent} /></Pressable>
      </View>
      <Text className="mb-3 text-xs text-muted">New transactions are categorised by these rules first. Merchant rules are created when you answer “Always put … under …?”.</Text>
      <ScrollView showsVerticalScrollIndicator={false}>
        {rules && rules.length === 0 && <EmptyState title="No rules yet" body="Change a transaction's category and ExMan will offer to remember it for that merchant." />}
        {section('Merchants', (rules ?? []).filter((r) => r.kind === 'merchant'))}
        {section('Keywords', (rules ?? []).filter((r) => r.kind === 'keyword'))}
        <View className="h-10" />
      </ScrollView>

      {editing && (
        <Sheet title={`Category for ${editing.kind === 'merchant' ? editing.merchant_name : `“${editing.keyword}”`}`} onClose={() => setEditing(null)}>
          <CategoryChips cats={cats} value={editing.category_id} onPick={async (id) => {
            const r = editing; setEditing(null);
            await setRuleCategory(db, r.id, id);
            const { n, undo } = await applyRuleToExisting(db, r.kind === 'merchant' ? { merchantId: r.merchant_id!, categoryId: id } : { keyword: r.keyword!, categoryId: id });
            notifyIngested(); load();
            if (n) snack({ message: `Updated ${n} transaction${n === 1 ? '' : 's'}`, onAction: () => void undo().then(() => { void setRuleCategory(db, r.id, r.category_id); notifyIngested(); load(); }) });
          }} />
        </Sheet>
      )}
      {adding && (
        <Sheet title="New keyword rule" onClose={() => setAdding(false)}>
          <Text className="mb-2 text-sm text-muted">Any merchant containing this text goes to the category you pick.</Text>
          <TextInput className="mb-3 min-h-12 rounded-2xl bg-card2 px-4 py-3 text-base text-fg" value={kw} onChangeText={setKw} placeholder="e.g. petrol" placeholderTextColor={colors.muted} autoCapitalize="none" autoFocus />
          <CategoryChips cats={cats} value={kwCat} onPick={setKwCat} />
          <Button className="mt-2" label="Add rule" disabled={kw.trim().length < 2 || kwCat == null} onPress={async () => {
            const k = kw.trim(); const c = kwCat!;
            setAdding(false);
            await addKeywordRule(db, k, c);
            const { n, undo } = await applyRuleToExisting(db, { keyword: k, categoryId: c });
            notifyIngested(); load();
            snack({ message: n ? `Rule added · updated ${n} transaction${n === 1 ? '' : 's'}` : 'Rule added', onAction: n ? () => void undo().then(() => notifyIngested()) : undefined });
          }} />
        </Sheet>
      )}
    </View>
  );
}
