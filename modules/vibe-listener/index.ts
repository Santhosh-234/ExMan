import { requireNativeModule } from 'expo';

export type RawMessage = { kind: 'sms' | 'notif'; sender: string; text: string; ts: number };

const native = requireNativeModule('VibeListener');

/** Pops everything the native receivers queued (also while the app was closed). */
export const drain = (): RawMessage[] => native.drain().map((s: string) => JSON.parse(s));
export const notificationAccessGranted = (): boolean => native.notificationAccessGranted();
export const openNotificationAccessSettings = (): void => native.openNotificationAccessSettings();
/** Fires when a message arrives while the app process is alive. */
export const onRaw = (cb: () => void) => native.addListener('onRaw', cb);
/** Existing inbox messages from alphanumeric senders since `sinceMs` (needs READ_SMS). */
export const readInbox = (sinceMs: number): RawMessage[] => native.readInbox(sinceMs).map((s: string) => JSON.parse(s));

/** Updates the home-screen widget's three lines. Does nothing on a build that predates the widget. */
export const setWidget = (title: string, amount: string, sub: string): void => { if (typeof native.setWidget === 'function') native.setWidget(title, amount, sub); };
