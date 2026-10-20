import { useCallback, useState } from 'react';
import { PermissionsAndroid, Pressable, Text, View } from 'react-native';
import { useFocusEffect } from 'expo-router';

import { notificationAccessGranted, openNotificationAccessSettings } from '../../../modules/vibe-listener';

function Row({ label, ok, onPress }: { label: string; ok: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} className="mb-3 flex-row items-center justify-between rounded-2xl bg-card p-4">
      <Text className="text-base text-white">{label}</Text>
      <Text className={ok ? 'text-accent' : 'text-amber-400'}>{ok ? 'Granted' : 'Tap to enable'}</Text>
    </Pressable>
  );
}

export default function Settings() {
  const [sms, setSms] = useState(false);
  const [notif, setNotif] = useState(false);
  // re-check when returning from the system settings screen
  useFocusEffect(
    useCallback(() => {
      PermissionsAndroid.check(PermissionsAndroid.PERMISSIONS.RECEIVE_SMS).then(setSms);
      setNotif(notificationAccessGranted());
    }, []),
  );

  return (
    <View className="flex-1 bg-base px-4 pt-16">
      <Text className="mb-6 text-2xl font-semibold text-white">Settings</Text>
      <Row
        label="Read bank SMS"
        ok={sms}
        onPress={async () =>
          setSms((await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.RECEIVE_SMS)) === 'granted')
        }
      />
      <Row label="UPI app notifications" ok={notif} onPress={openNotificationAccessSettings} />
    </View>
  );
}
