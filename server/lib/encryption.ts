import { createCipheriv, createDecipheriv, randomBytes, pbkdf2Sync } from 'crypto';
import { SESSION_SECRET } from '../config.ts';
import { logger } from './logger.ts';

const ALGORITHM = 'aes-256-gcm';
const KEY_LENGTH = 32;
const IV_LENGTH = 16;
const AUTH_TAG_LENGTH = 16;

// Use SESSION_SECRET directly as the salt (it's already environment-specific and secret)
// PBKDF2 iterations follow OWASP recommendations (100k minimum for 2023+)
const PBKDF2_ITERATIONS = 100000;

/**
 * Derive encryption key from SESSION_SECRET using PBKDF2
 * Uses SESSION_SECRET itself as salt to ensure deployment-specific keys
 */
function deriveKey(): Buffer {
  return pbkdf2Sync(SESSION_SECRET, SESSION_SECRET, PBKDF2_ITERATIONS, KEY_LENGTH, 'sha256');
}

/**
 * Encrypt a string value using AES-256-GCM
 * Returns base64-encoded string with format: iv:authTag:ciphertext
 */
export function encrypt(plaintext: string): string {
  const key = deriveKey();
  const iv = randomBytes(IV_LENGTH);

  const cipher = createCipheriv(ALGORITHM, key, iv);
  let encrypted = cipher.update(plaintext, 'utf8', 'base64');
  encrypted += cipher.final('base64');

  const authTag = cipher.getAuthTag();

  // Format: iv:authTag:ciphertext (all base64)
  return `${iv.toString('base64')}:${authTag.toString('base64')}:${encrypted}`;
}

/**
 * Decrypt a string value encrypted with encrypt()
 * Expects format: iv:authTag:ciphertext (all base64)
 */
export function decrypt(ciphertext: string): string {
  const key = deriveKey();
  const parts = ciphertext.split(':');

  if (parts.length !== 3) {
    throw new Error('Invalid encrypted data format');
  }

  const iv = Buffer.from(parts[0], 'base64');
  const authTag = Buffer.from(parts[1], 'base64');
  const encrypted = parts[2];

  // Validate auth tag length for security
  if (authTag.length !== AUTH_TAG_LENGTH) {
    throw new Error('Invalid auth tag length');
  }

  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);

  let decrypted = decipher.update(encrypted, 'base64', 'utf8');
  decrypted += decipher.final('utf8');

  return decrypted;
}

/**
 * Safely decrypt - returns null on any error instead of throwing
 * Logs failed attempts for security monitoring
 */
export function safeDecrypt(ciphertext: string): string | null {
  try {
    return decrypt(ciphertext);
  } catch (error) {
    logger.warn({
      error: error instanceof Error ? error.message : String(error),
      length: ciphertext?.length
    }, 'Failed to decrypt cookie');
    return null;
  }
}
