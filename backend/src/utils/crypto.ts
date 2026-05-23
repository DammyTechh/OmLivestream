import crypto from 'crypto';
import { env } from '../config/env';

const ALGORITHM = 'aes-256-gcm';
const IV_LEN    = 16;

/** AES-256-GCM encrypt. Returns "iv:ciphertext:tag" hex string. */
export function encrypt(plaintext: string): string {
  const key = Buffer.from(env.ENCRYPTION_KEY, 'hex');
  const iv  = crypto.randomBytes(IV_LEN);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const enc  = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag  = cipher.getAuthTag();
  return `${iv.toString('hex')}:${enc.toString('hex')}:${tag.toString('hex')}`;
}

/** AES-256-GCM decrypt. */
export function decrypt(ciphertext: string): string {
  const key = Buffer.from(env.ENCRYPTION_KEY, 'hex');
  const [ivHex, encHex, tagHex] = ciphertext.split(':');
  if (!ivHex || !encHex || !tagHex) throw new Error('Invalid ciphertext format');
  const decipher = crypto.createDecipheriv(ALGORITHM, key, Buffer.from(ivHex, 'hex'));
  decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
  return Buffer.concat([decipher.update(Buffer.from(encHex, 'hex')), decipher.final()]).toString('utf8');
}

/** 6-digit cryptographically secure OTP. */
export function generateOtp(digits = 6): string {
  return crypto.randomInt(0, 10 ** digits).toString().padStart(digits, '0');
}

/** SHA-256 hash for OTP storage. */
export function hashOtp(otp: string): string {
  return crypto.createHash('sha256').update(otp).digest('hex');
}

/** Timing-safe string comparison. */
export function safeCompare(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'));
}

/** Random hex token. */
export function generateToken(bytes = 32): string {
  return crypto.randomBytes(bytes).toString('hex');
}

/** SHA-256 hash (for token storage). */
export function sha256(input: string): string {
  return crypto.createHash('sha256').update(input).digest('hex');
}
