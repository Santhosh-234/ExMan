/** Stable 64-bit-ish (two 32-bit FNV-1a/djb2 passes) hex hash. Not cryptographic; only de-duplicates messages. */
export function hashMessage(ts: number, text: string): string {
  let a = 0x811c9dc5;
  let b = 5381;
  const s = `${ts}|${text}`;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    a = Math.imul(a ^ c, 0x01000193) >>> 0;
    b = (Math.imul(b, 33) ^ c) >>> 0;
  }
  return a.toString(16).padStart(8, '0') + b.toString(16).padStart(8, '0');
}
