import { useEffect, useState } from 'react';
import { AccessibilityInfo } from 'react-native';

/** True when the phone's "remove animations" setting is on. Animations then run with no duration. */
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    let live = true;
    void AccessibilityInfo.isReduceMotionEnabled().then((v) => { if (live) setReduced(v); }).catch(() => {});
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduced);
    return () => { live = false; sub.remove(); };
  }, []);
  return reduced;
}
