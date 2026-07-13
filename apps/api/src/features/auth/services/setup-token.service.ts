import { Injectable } from '@nestjs/common';
import { randomBytes } from 'node:crypto';

@Injectable()
export class SetupTokenService {
  private readonly token = randomBytes(24).toString('base64url');

  constructor() {
    console.log(`Palwarden first-run setup token: ${this.token}`);
  }

  verify(token: string | undefined): boolean {
    return Boolean(token && token === this.token);
  }
}
