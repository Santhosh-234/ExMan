import { View } from 'react-native';
import { Text } from '@/ui/Text';

import { Button, Sheet } from '@/ui/kit';
import { type Cadence } from '@/utils/recurring';

const OPTIONS: { c: Cadence; label: string }[] = [
  { c: 'monthly', label: 'Every month' }, { c: 'yearly', label: 'Every year' }, { c: 'quarterly', label: 'Every 3 months' }, { c: 'weekly', label: 'Every week' },
];

/** "How often does it charge you?" Picking one declares the payee a subscription. */
export function CadenceSheet({ title, hint, onPick, onClose }: { title: string; hint?: string; onPick: (c: Cadence) => void; onClose: () => void }) {
  return (
    <Sheet title={title} onClose={onClose}>
      {hint ? <Text className="mb-3 text-sm text-muted">{hint}</Text> : null}
      <View>{OPTIONS.map((o, i) => <Button key={o.c} className="mb-2" variant={i === 0 ? 'primary' : 'secondary'} label={o.label} onPress={() => onPick(o.c)} />)}</View>
    </Sheet>
  );
}
