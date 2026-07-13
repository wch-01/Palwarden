import { describe, expect, it } from 'vitest';
import { ConfigService } from '@nestjs/config';
import { CryptoService } from '../src/core/security/crypto.service';

describe('CryptoService', () => {
  it('round trips credentials without preserving plaintext', () => {
    const service = new CryptoService(
      new ConfigService({ PALWARDEN_MASTER_KEY: Buffer.alloc(32, 7).toString('base64') }),
    );
    const encrypted = service.encrypt('secret-admin-password');
    expect(encrypted.ciphertext).not.toContain('secret-admin-password');
    expect(service.decrypt(encrypted)).toBe('secret-admin-password');
  });
});
