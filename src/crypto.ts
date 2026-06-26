import { createCipheriv, createDecipheriv, randomBytes, createHash } from 'node:crypto';

/** AES-256-GCM at-rest encryption for secret settings (API keys). */
const ALGO = 'aes-256-gcm';

function keyFrom(secret: string): Buffer {
  return createHash('sha256').update(secret).digest();
}

/** Returns "v1:iv:tag:ciphertext" (base64 parts), or '' for empty input. */
export function encrypt(plain: string, secret: string): string {
  if (!plain) return '';
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGO, keyFrom(secret), iv);
  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return ['v1', iv.toString('base64'), tag.toString('base64'), enc.toString('base64')].join(':');
}

/** Reverses encrypt(). Returns '' on empty/garbled input. */
export function decrypt(blob: string, secret: string): string {
  if (!blob) return '';
  const parts = blob.split(':');
  if (parts.length !== 4 || parts[0] !== 'v1') return '';
  try {
    const [, iv, tag, data] = parts;
    const decipher = createDecipheriv(ALGO, keyFrom(secret), Buffer.from(iv, 'base64'));
    decipher.setAuthTag(Buffer.from(tag, 'base64'));
    return Buffer.concat([decipher.update(Buffer.from(data, 'base64')), decipher.final()]).toString('utf8');
  } catch {
    return '';
  }
}
