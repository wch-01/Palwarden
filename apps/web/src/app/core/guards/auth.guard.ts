import { inject } from '@angular/core';
import type { CanActivateFn} from '@angular/router';
import { Router } from '@angular/router';
import { map } from 'rxjs';
import { AuthService } from '../authentication/auth.service';

export const authGuard: CanActivateFn = () => {
  const auth = inject(AuthService);
  const router = inject(Router);
  return auth.restore().pipe(
    map(() => {
      if (auth.setupRequired()) {
        return router.parseUrl('/setup');
      }
      return auth.user() ? true : router.parseUrl('/login');
    }),
  );
};
