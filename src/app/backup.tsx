import * as DocumentPicker from 'expo-document-picker';
import { getRandomBytes } from 'expo-crypto';
import { Directory, File, Paths } from 'expo-file-system';
import { useRouter } from 'expo-router';
import * as Sharing from 'expo-sharing';
import { useSQLiteContext } from 'expo-sqlite';

import { useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { Text, TextInput } from '@/ui/Text';

import { makeBackup, readBackup, restoreAll } from '@/backup/dump';
import { exportRows } from '@/db/queries';
import { notifyIngested } from '@/ingest/events';
import { BackButton, Button, Card, Chip, PageHeader, Sheet } from '@/ui/kit';
import { useSnackbar } from '@/ui/Snackbar';
import { useTheme } from '@/ui/theme';
import { toCsv } from '@/utils/csv';
import { utf8Encode } from '@/backup/crypto';
import { monthKey, monthRange, shiftMonth } from '@/utils/format';

const RANGES = {
  'This month': () => monthRange(monthKey(new Date())),
  'Last month': () => monthRange(shiftMonth(monthKey(new Date()), -1)),
  'Last 90 days': () => [Date.now() - 90 * 864e5, 8.64e15] as [number, number],
  'This year': () => [new Date(new Date().getFullYear(), 0, 1).getTime(), 8.64e15] as [number, number],
  'Everything': () => [0, 8.64e15] as [number, number],
} as const;

const stamp = () => { const d = new Date(); return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`; };

/** Writes bytes to the cache, opens the share sheet, then deletes the temporary copy. */
async function shareFile(name: string, bytes: Uint8Array, mimeType: string) {
  if (!(await Sharing.isAvailableAsync())) throw new Error('Sharing is not available on this phone');
  const f = new File(Paths.cache, name);
  f.create({ overwrite: true });
  await f.write(bytes);
  try { await Sharing.shareAsync(f.uri, { mimeType, dialogTitle: name }); } finally { try { f.delete(); } catch { /* temp file */ } }
}

/** Writes the file into a folder the user picks (Downloads, Drive, a USB drive...). Returns the folder's name, or null if they backed out. */
async function saveToFolder(name: string, bytes: Uint8Array, mimeType: string): Promise<string | null> {
  let dir: Directory;
  try { dir = await Directory.pickDirectoryAsync(); } catch { return null; } // cancelled
  const f = dir.createFile(name, mimeType);
  await f.write(bytes);
  return dir.name || 'the folder you chose';
}

type Delivery = 'share' | 'save';
const deliver = (how: Delivery, name: string, bytes: Uint8Array, mime: string) => (how === 'share' ? shareFile(name, bytes, mime).then(() => 'shared' as const) : saveToFolder(name, bytes, mime));

export default function Backup() {
  const db = useSQLiteContext();
  const router = useRouter();
  const snack = useSnackbar();
  const { colors } = useTheme();
  const [range, setRange] = useState<keyof typeof RANGES>('This month');
  const [busy, setBusy] = useState('');
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [err, setErr] = useState('');
  const [picked, setPicked] = useState<{ bytes: Uint8Array; name: string } | null>(null);
  const [restorePw, setRestorePw] = useState('');
  const [preview, setPreview] = useState<Awaited<ReturnType<typeof readBackup>> | null>(null);
  const input = 'mb-3 min-h-12 rounded-2xl bg-card2 px-4 py-3 text-base text-fg';

  const exportCsv = async (how: Delivery) => {
    setBusy('csv');
    try {
      const rows = await exportRows(db, ...RANGES[range]());
      if (!rows.length) return snack({ message: 'No transactions in that range' });
      const where = await deliver(how, `ExMan-${range.toLowerCase().replace(/\s+/g, '-')}-${stamp()}.csv`, utf8Encode(toCsv(rows)), 'text/csv');
      if (where && where !== 'shared') snack({ message: `Saved to ${where}` });
    } catch (e) { snack({ message: e instanceof Error ? e.message : 'Export failed' }); } finally { setBusy(''); }
  };

  const backup = async (how: Delivery) => {
    setErr('');
    if (pw.length < 6) return setErr('Use a password of at least 6 characters.');
    if (pw !== pw2) return setErr('The two passwords do not match.');
    setBusy('backup');
    try {
      const bytes = await makeBackup(db, pw, getRandomBytes);
      const where = await deliver(how, `ExMan-backup-${stamp()}.exmanbak`, bytes, 'application/octet-stream');
      if (!where) return; // backed out of the folder picker: nothing was saved
      setPw(''); setPw2('');
      snack({ message: where === 'shared' ? 'Backup shared. Keep the file and the password safe.' : `Backup saved to ${where}. Keep the file and the password safe.` });
    } catch (e) { setErr(e instanceof Error ? e.message : 'Backup failed'); } finally { setBusy(''); }
  };

  const pick = async () => {
    try {
      const r = await DocumentPicker.getDocumentAsync({ type: '*/*', copyToCacheDirectory: true, multiple: false });
      if (r.canceled || !r.assets?.[0]) return;
      const a = r.assets[0];
      const f = new File(a.uri);
      const bytes = new Uint8Array(await f.bytes());
      try { f.delete(); } catch { /* cache copy */ }
      setPicked({ bytes, name: a.name }); setRestorePw(''); setPreview(null); setErr('');
    } catch (e) { snack({ message: e instanceof Error ? e.message : 'Could not open that file' }); }
  };

  const unlock = async () => {
    if (!picked) return;
    setBusy('unlock'); setErr('');
    try { setPreview(await readBackup(picked.bytes, restorePw)); }
    catch (e) { setErr(e instanceof Error ? e.message : 'Could not open the backup'); }
    finally { setBusy(''); }
  };

  const restore = async () => {
    if (!preview) return;
    setBusy('restore');
    try {
      const r = await restoreAll(db, preview);
      setPicked(null); setPreview(null); notifyIngested();
      snack({ message: `Restored ${r.transactions} transactions` });
      router.replace('/');
    } catch (e) { setErr(e instanceof Error ? e.message : 'Restore failed'); } finally { setBusy(''); }
  };

  return (
    <View className="flex-1 bg-base px-4 pt-14">
      <BackButton />
      <PageHeader title="Backup & export" subtitle="Your data lives only on this phone. A backup lets you move to a new phone or recover after a reset." />
      <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
        <Card className="mb-4">
          <Text className="text-base font-semibold text-fg">Export to a spreadsheet (CSV)</Text>
          <Text className="mb-2 mt-1 text-sm text-muted">Transactions with dates, amounts, merchants, categories and accounts. The file is not encrypted, so share it carefully.</Text>
          <View className="flex-row flex-wrap">{(Object.keys(RANGES) as (keyof typeof RANGES)[]).map((k) => <Chip key={k} label={k} color={colors.accent} selected={range === k} onPress={() => setRange(k)} />)}</View>
          <Text className="mb-2 text-xs text-muted">Save puts a copy in a folder you choose (Downloads, Drive...). Share sends it to another app and keeps nothing on this phone.</Text>
          <Button label={busy === 'csv' ? 'Preparing…' : 'Save to a folder…'} disabled={!!busy} onPress={() => exportCsv('save')} />
          <Button variant="secondary" className="mt-2" label="Share…" disabled={!!busy} onPress={() => exportCsv('share')} />
        </Card>

        <Card className="mb-4">
          <Text className="text-base font-semibold text-fg">Create an encrypted backup</Text>
          <Text className="mb-3 mt-1 text-sm text-muted">Everything: transactions, accounts, rules, taught formats, budgets and settings. Protected by a password only you know. If you forget it, the backup cannot be opened.</Text>
          <TextInput className={input} value={pw} onChangeText={setPw} secureTextEntry placeholder="Password (6+ characters)" placeholderTextColor={colors.muted} autoCapitalize="none" />
          <TextInput className={input} value={pw2} onChangeText={setPw2} secureTextEntry placeholder="Repeat password" placeholderTextColor={colors.muted} autoCapitalize="none" />
          {err && !picked ? <Text className="mb-2 text-danger">{err}</Text> : null}
          <Button label={busy === 'backup' ? 'Encrypting… (a few seconds)' : 'Save backup to a folder…'} disabled={!!busy} onPress={() => backup('save')} />
          <Button variant="secondary" className="mt-2" label="Share backup…" disabled={!!busy} onPress={() => backup('share')} />
        </Card>

        <Card className="mb-10">
          <Text className="text-base font-semibold text-fg">Restore from a backup</Text>
          <Text className="mb-3 mt-1 text-sm text-muted">Pick a .exmanbak file. Restoring replaces everything currently in ExMan.</Text>
          <Button variant="secondary" label="Choose backup file…" disabled={!!busy} onPress={pick} />
        </Card>
      </ScrollView>

      {picked && !preview && (
        <Sheet title="Open backup" onClose={() => setPicked(null)}>
          <Text className="mb-2 text-sm text-muted">{picked.name}</Text>
          <TextInput className={input} value={restorePw} onChangeText={setRestorePw} secureTextEntry autoFocus placeholder="Backup password" placeholderTextColor={colors.muted} autoCapitalize="none" />
          {err ? <Text className="mb-2 text-danger">{err}</Text> : null}
          <Button label={busy === 'unlock' ? 'Checking…' : 'Open'} disabled={!restorePw || !!busy} onPress={unlock} />
        </Sheet>
      )}
      {preview && (
        <Sheet title="Replace everything?" onClose={() => { setPreview(null); setPicked(null); }}>
          <Text className="mb-3 text-base text-fg">
            Backup from {new Date(preview.created).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })} with {preview.tables.transactions.rows.length} transactions and {preview.tables.accounts.rows.length} accounts.
          </Text>
          <Text className="mb-3 text-sm text-muted">Everything currently in ExMan will be replaced. This can't be undone, so create a backup of the current data first if you might need it.</Text>
          {err ? <Text className="mb-2 text-danger">{err}</Text> : null}
          <Button variant="danger" label={busy === 'restore' ? 'Restoring…' : 'Replace and restore'} disabled={!!busy} onPress={restore} />
        </Sheet>
      )}
    </View>
  );
}
