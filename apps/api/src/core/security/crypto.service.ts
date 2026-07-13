import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

export interface EncryptedSecret {
  ciphertext: string;
  iv: string;
  tag: string;
}

@Injectable()
export class CryptoService {
  constructor(private readonly config: ConfigService) {}

  encrypt(value: string): EncryptedSecret {
    const key = this.key();
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', key, iv);
    const ciphertext = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
    return {
      ciphertext: ciphertext.toString('base64'),
      iv: iv.toString('base64'),
      tag: cipher.getAuthTag().toString('base64'),
    };
  }

  decrypt(secret: EncryptedSecret): string {
    const decipher = createDecipheriv('aes-256-gcm', this.key(), Buffer.from(secret.iv, 'base64'));
    decipher.setAuthTag(Buffer.from(secret.tag, 'base64'));
    return Buffer.concat([
      decipher.update(Buffer.from(secret.ciphertext, 'base64')),
      decipher.final(),
    ]).toString('utf8');
  }

  private key(): Buffer {
    const raw = this.config.get<string>('PALWARDEN_MASTER_KEY');
    if (!raw) {
      throw new InternalServerErrorException('PALWARDEN_MASTER_KEY is required for credentials.');
    }
    const key = Buffer.from(raw, 'base64');
    if (key.length !== 32) {
      throw new InternalServerErrorException('PALWARDEN_MASTER_KEY must decode to 32 bytes.');
    }
    return key;
  }
}
