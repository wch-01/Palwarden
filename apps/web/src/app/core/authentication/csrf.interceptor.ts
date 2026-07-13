import type { HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { AuthService } from './auth.service';

export const csrfInterceptor: HttpInterceptorFn = (req, next) => {
  const auth = inject(AuthService);
  const token = auth.csrfToken();
  const stateChanging = !['GET', 'HEAD', 'OPTIONS'].includes(req.method);
  return next(stateChanging && token ? req.clone({ setHeaders: { 'x-csrf-token': token } }) : req);
};
