import { inject } from '@angular/core';
import type { CanActivateFn} from '@angular/router';
import { Router } from '@angular/router';
import { AuthService } from '../authentication/auth.service';

export const viewerGuard: CanActivateFn = () => {
  const role = inject(AuthService).user()?.role;
  return role === 'VIEWER' ? inject(Router).parseUrl('/dashboard') : true;
};
