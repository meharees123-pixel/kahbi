import { Injectable, signal } from '@angular/core';

@Injectable({ providedIn: 'root' })
export class LoadingIndicatorService {
  readonly isLoading = signal(false);
  private activeRequests = 0;

  requestStarted(): void {
    this.activeRequests += 1;
    this.isLoading.set(true);
  }

  requestFinished(): void {
    this.activeRequests = Math.max(0, this.activeRequests - 1);
    this.isLoading.set(this.activeRequests > 0);
  }
}
