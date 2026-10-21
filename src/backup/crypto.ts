// Password-protected backups: scrypt (password -> key) + AES-256-GCM (authenticated encryption), pure JS so it
// behaves identically on the phone and in tests. File layout:
//   "EXMANBK1" | log2(N) | r | p | salt(16) | nonce(12) | ciphertext+tag
// The header is authenticated as AAD, so any tampering (or a wrong password) fails to decrypt.
import { gcm } from '@noble/ciphers/aes.js';
import { scryptAsync } from '@noble/hashes/scrypt.js';

const MAGIC = new Uint8Array([69, 88, 77, 65, 78, 66, 75, 49]); // "EXMANBK1"
const LOG_N = 14; // 16 MB, ~1-2 s on a phone
const R = 8;
const P = 1;
const SALT = 16;
const NONCE = 12;
const HEADER = MAGIC.length + 3 + SALT;

export type RandomBytes = (n: number) => Uint8Array;

/** Minimal UTF-8 so we don't depend on TextEncoder/TextDecoder being present in the JS engine. */
export function utf8Encode(s: string): Uint8Array {
  const out: number[] = [];
  for (let i = 0; i < s.length; i++) {
    let c = s.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff && i + 1 < s.length) { c = 0x10000 + ((c - 0xd800) << 10) + (s.charCodeAt(++i) - 0xdc00); }
    if (c < 0x80) out.push(c);
    else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 63));
    else if (c < 0x10000) out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
    else out.push(0xf0 | (c >> 18), 0x80 | ((c >> 12) & 63), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
  }
  return Uint8Array.from(out);
}

export function utf8Decode(b: Uint8Array): string {
  let s = '';
  for (let i = 0; i < b.length;) {
    const c = b[i++];
    let cp: number;
    if (c < 0x80) cp = c;
    else if (c < 0xe0) cp = ((c & 31) << 6) | (b[i++] & 63);
    else if (c < 0xf0) { cp = ((c & 15) << 12) | ((b[i++] & 63) << 6) | (b[i++] & 63); }
    else { cp = ((c & 7) << 18) | ((b[i++] & 63) << 12) | ((b[i++] & 63) << 6) | (b[i++] & 63); }
    if (cp >= 0x10000) { cp -= 0x10000; s += String.fromCharCode(0xd800 + (cp >> 10), 0xdc00 + (cp & 0x3ff)); } else s += String.fromCharCode(cp);
  }
  return s;
}

const deriveKey = (password: string, salt: Uint8Array, logN: number, r: number, p: number) =>
  scryptAsync(utf8Encode(password.normalize('NFKC')), salt, { N: 2 ** logN, r, p, dkLen: 32, asyncTick: 20 });

export async function encryptBytes(plain: Uint8Array, password: string, random: RandomBytes): Promise<Uint8Array> {
  if (password.length < 6) throw new Error('Use a password of at least 6 characters');
  const salt = random(SALT);
  const nonce = random(NONCE);
  const header = new Uint8Array(HEADER);
  header.set(MAGIC, 0);
  header.set([LOG_N, R, P], MAGIC.length);
  header.set(salt, MAGIC.length + 3);
  const key = await deriveKey(password, salt, LOG_N, R, P);
  const ct = gcm(key, nonce, header).encrypt(plain);
  const out = new Uint8Array(HEADER + NONCE + ct.length);
  out.set(header, 0);
  out.set(nonce, HEADER);
  out.set(ct, HEADER + NONCE);
  return out;
}

export async function decryptBytes(file: Uint8Array, password: string): Promise<Uint8Array> {
  if (file.length < HEADER + NONCE + 16 || MAGIC.some((v, i) => file[i] !== v)) throw new Error('This is not an ExMan backup file');
  const [logN, r, p] = [file[MAGIC.length], file[MAGIC.length + 1], file[MAGIC.length + 2]];
  if (logN > 18 || logN < 10 || r < 1 || r > 16 || p < 1 || p > 4) throw new Error('Unsupported backup settings');
  const header = file.slice(0, HEADER);
  const salt = file.slice(MAGIC.length + 3, HEADER);
  const nonce = file.slice(HEADER, HEADER + NONCE);
  const key = await deriveKey(password, salt, logN, r, p);
  try {
    return gcm(key, nonce, header).decrypt(file.slice(HEADER + NONCE));
  } catch {
    throw new Error('Wrong password, or the file is damaged');
  }
}
