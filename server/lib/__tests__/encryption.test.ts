import { describe, it, expect } from 'vitest';
import { encrypt, decrypt, safeDecrypt } from '../encryption';

describe('Encryption Module', () => {
  describe('encrypt / decrypt', () => {
    it('should encrypt and decrypt a string', () => {
      const plaintext = 'test-secret-value';
      const encrypted = encrypt(plaintext);

      expect(encrypted).not.toBe(plaintext);
      expect(encrypted).toContain(':'); // Format check: iv:authTag:ciphertext

      const decrypted = decrypt(encrypted);
      expect(decrypted).toBe(plaintext);
    });

    it('should produce different ciphertext for same plaintext (due to random IV)', () => {
      const plaintext = 'same-value';
      const encrypted1 = encrypt(plaintext);
      const encrypted2 = encrypt(plaintext);

      expect(encrypted1).not.toBe(encrypted2);
      expect(decrypt(encrypted1)).toBe(plaintext);
      expect(decrypt(encrypted2)).toBe(plaintext);
    });

    it('should handle special characters', () => {
      const plaintext = 'test@#$%^&*(){}[]|\\:";\'<>?,./~`';
      const encrypted = encrypt(plaintext);
      const decrypted = decrypt(encrypted);

      expect(decrypted).toBe(plaintext);
    });

    it('should throw on invalid encrypted data format', () => {
      expect(() => decrypt('invalid-format')).toThrow('Invalid encrypted data format');
    });

    it('should throw on invalid auth tag length', () => {
      expect(() => decrypt('aGVsbG8=:aGVsbG8=:aGVsbG8=')).toThrow();
    });

    it('should throw on tampered ciphertext', () => {
      const plaintext = 'original-value';
      const encrypted = encrypt(plaintext);
      const parts = encrypted.split(':');
      const tampered = `${parts[0]}:${parts[1]}:${'A'.repeat(20)}`;

      expect(() => decrypt(tampered)).toThrow();
    });
  });

  describe('safeDecrypt', () => {
    it('should return decrypted value for valid input', () => {
      const plaintext = 'test-value';
      const encrypted = encrypt(plaintext);
      const result = safeDecrypt(encrypted);

      expect(result).toBe(plaintext);
    });

    it('should return null for invalid input without throwing', () => {
      expect(safeDecrypt('invalid')).toBeNull();
      expect(safeDecrypt('')).toBeNull();
      expect(safeDecrypt('a:b:c')).toBeNull();
    });
  });
});
