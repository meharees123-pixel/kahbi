import { HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { finalize } from 'rxjs';
import { LoadingIndicatorService } from './loading-indicator.service';

export const loadingInterceptor: HttpInterceptorFn = (request, next) => {
  const loadingIndicator = inject(LoadingIndicatorService);
  loadingIndicator.requestStarted();
  return next(request).pipe(finalize(() => loadingIndicator.requestFinished()));
};
