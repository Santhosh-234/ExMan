// Tiny pub/sub so screens refresh when the background ingest adds rows (no DB polling).
const subs = new Set<() => void>();
export const onIngested = (cb: () => void) => {
  subs.add(cb);
  return () => void subs.delete(cb);
};
export const notifyIngested = () => subs.forEach((cb) => cb());
