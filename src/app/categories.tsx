import { useRouter } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { Plus } from 'lucide-react-native';
import { useCallback, useEffect, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { Text, TextInput } from '@/ui/Text';

import { CATEGORY_COLORS, type Category, addCategory, deleteCategory, getCategories, getCategoryUsage, setCategoryArchived, updateCategory } from '@/db/queries';
import { notifyIngested } from '@/ingest/events';
import { track } from '@/telemetry';
import { BackButton, Button, Card, IconButton, ListRow, PageHeader, SectionLabel, Sheet, onColor } from '@/ui/kit';
import { useSnackbar } from '@/ui/Snackbar';
import { useTheme } from '@/ui/theme';
import { Page } from '@/ui/insets';

type Editing = { id: number | null; name: string; color: string; custom: boolean; archived: boolean; n: number };

export default function Categories() {
  const db = useSQLiteContext();
  const router = useRouter();
  const snack = useSnackbar();
  const { colors } = useTheme();
  const [cats, setCats] = useState<Category[]>([]);
  const [usage, setUsage] = useState<Map<number, number>>(new Map());
  const [ed, setEd] = useState<Editing | null>(null);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setCats(await getCategories(db));
    setUsage(new Map((await getCategoryUsage(db)).map((u) => [u.category_id, u.n])));
  }, [db]);
  useEffect(() => void load(), [load]);

  const open = (c?: Category) => {
    setError('');
    setEd(c ? { id: c.id, name: c.name, color: c.color, custom: !!c.is_custom, archived: !!c.archived, n: usage.get(c.id) ?? 0 } : { id: null, name: '', color: CATEGORY_COLORS[0], custom: true, archived: false, n: 0 });
  };

  const save = async () => {
    if (!ed) return;
    try {
      if (ed.id == null) { await addCategory(db, ed.name.trim(), ed.color); track('feature_used', { feature: 'category_created' }); }
      else await updateCategory(db, ed.id, { name: ed.name.trim(), color: ed.color });
      setEd(null); notifyIngested(); load();
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not save'); }
  };

  const archive = async () => {
    if (!ed?.id) return;
    const id = ed.id, next = !ed.archived;
    await setCategoryArchived(db, id, next);
    setEd(null); notifyIngested(); load();
    snack({ message: next ? `Archived ${ed.name}. Old transactions keep it.` : `Restored ${ed.name}`, onAction: () => void setCategoryArchived(db, id, !next).then(() => { notifyIngested(); load(); }) });
  };

  const remove = async () => {
    if (!ed?.id) return;
    try {
      await deleteCategory(db, ed.id);
      setEd(null); notifyIngested(); load();
      snack({ message: `Deleted ${ed.name}` });
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not delete'); }
  };

  const row = (c: Category) => (
    <ListRow key={c.id} muted={!!c.archived} onPress={() => open(c)}
      leading={<View className="h-11 w-11 items-center justify-center rounded-full" style={{ backgroundColor: `${c.color}33` }}><View className="h-5 w-5 rounded-full" style={{ backgroundColor: c.color }} /></View>}
      title={c.name}
      subtitle={`${usage.get(c.id) ?? 0} transaction${(usage.get(c.id) ?? 0) === 1 ? '' : 's'}${c.is_custom ? ' · custom' : ''}${c.archived ? ' · archived' : ''}`} />
  );

  return (
    <Page>
      <BackButton />
      <PageHeader title="Categories" subtitle="Archiving hides a category from pickers but keeps it on old transactions." right={<IconButton icon={Plus} label="Add category" onPress={() => open()} />} />
      <ScrollView showsVerticalScrollIndicator={false}>
        {cats.filter((c) => !c.archived).map(row)}
        {cats.some((c) => c.archived) && <View className="mt-3"><SectionLabel>Archived</SectionLabel></View>}
        {cats.filter((c) => c.archived).map(row)}
        <View className="h-10" />
      </ScrollView>

      {ed && (
        <Sheet title={ed.id == null ? 'New category' : 'Edit category'} onClose={() => setEd(null)}>
          <TextInput className="mb-3 min-h-12 rounded-2xl bg-card2 px-4 py-3 text-base text-fg" value={ed.name} onChangeText={(name) => setEd({ ...ed, name })} placeholder="Name" placeholderTextColor={colors.muted} autoFocus={ed.id == null} />
          <View className="mb-3 flex-row flex-wrap">
            {CATEGORY_COLORS.map((c) => (
              <Pressable key={c} onPress={() => setEd({ ...ed, color: c })} accessibilityRole="button" accessibilityLabel={`Colour ${c}${ed.color === c ? ', selected' : ''}`} className="mb-2 mr-2 h-10 w-10 items-center justify-center rounded-full" style={{ backgroundColor: c }}>
                {ed.color === c ? <Text className="font-bold" style={{ color: onColor(c) }}>✓</Text> : null}
              </Pressable>
            ))}
          </View>
          {error ? <Text className="mb-2 text-danger">{error}</Text> : null}
          <Button label="Save" disabled={!ed.name.trim()} onPress={save} className="mb-2" />
          {ed.id != null && <Button variant="secondary" label={ed.archived ? 'Restore' : 'Archive'} onPress={archive} className="mb-2" />}
          {ed.id != null && ed.custom && <Button variant="danger" label={ed.n ? `Delete (${ed.n} transaction${ed.n === 1 ? '' : 's'} become uncategorised)` : 'Delete'} onPress={remove} />}
        </Sheet>
      )}
    </Page>
  );
}
