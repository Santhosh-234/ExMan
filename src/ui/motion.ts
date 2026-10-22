import { useEffect, useState } from 'react';
import { AccessibilityInfo } from 'react-native';

// One shared subscription for the whole app (lists create hundreds of components that read this).
let reduced = false;
let started = false;
const listeners = new Set<(v: boolean) => void>();
function start() {
  if (started) return;
  started = true;
  void AccessibilityInfo.isReduceMotionEnabled().then((v) => { reduced = v; listeners.forEach((l) => l(v)); }).catch(() => {});
  AccessibilityInfo.addEventListener('reduceMotionChanged', (v) => { reduced = v; listeners.forEach((l) => l(v)); });
}

/** True when the phone's "remove animations" setting is on. Animations then run with no duration. */
export function useReducedMotion(): boolean {
  const [v, setV] = useState(reduced);
  useEffect(() => {
    start();
    listeners.add(setV);
    setV(reduced);
    return () => { listeners.delete(setV); };
  }, []);
  return v;
}
