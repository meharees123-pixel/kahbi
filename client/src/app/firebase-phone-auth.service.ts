import { Injectable } from '@angular/core';
import { getApps, initializeApp } from 'firebase/app';
import type { FirebaseOptions } from 'firebase/app';
import {
  RecaptchaVerifier,
  getAuth,
  signInWithPhoneNumber,
  signOut
} from 'firebase/auth';
import type { Auth, ConfirmationResult } from 'firebase/auth';
import { firebaseConfig } from './firebase-config';

@Injectable({ providedIn: 'root' })
export class FirebasePhoneAuthService {
  private auth: Auth | null = null;
  private readonly verifiers = new Map<string, RecaptchaVerifier>();
  private readonly confirmations = new Map<string, ConfirmationResult>();
  private readonly containers = new Map<string, HTMLElement>();

  async requestCode(phone: string, flow: string): Promise<void> {
    if (!/^\+[1-9]\d{7,14}$/.test(phone)) {
      throw new Error('Enter a valid phone number in international format, including the country code.');
    }
    const auth = this.getAuth();
    this.clearFlow(flow);
    const container = document.createElement('div');
    container.style.position = 'fixed';
    container.style.bottom = '0';
    container.style.right = '0';
    container.style.zIndex = '1000';
    container.dataset['firebasePhoneAuth'] = flow;
    document.body.appendChild(container);
    this.containers.set(flow, container);
    const verifier = new RecaptchaVerifier(auth, container, { size: 'invisible' });
    this.verifiers.set(flow, verifier);
    try {
      const confirmation = await signInWithPhoneNumber(auth, phone, verifier);
      this.confirmations.set(flow, confirmation);
    } catch (error) {
      this.clearFlow(flow);
      throw this.authError(error, 'Firebase could not send the verification SMS. Check your Firebase phone-auth settings and try again.');
    }
  }

  async verifyCode(flow: string, code: string): Promise<string> {
    const confirmation = this.confirmations.get(flow);
    if (!confirmation) throw new Error('Request a new verification code before continuing.');
    if (!/^\d{6}$/.test(code)) throw new Error('Enter the six-digit code sent to your phone.');
    try {
      const credential = await confirmation.confirm(code);
      const idToken = await credential.user.getIdToken();
      await signOut(this.getAuth());
      this.clearFlow(flow);
      return idToken;
    } catch (error) {
      throw this.authError(error, 'The verification code could not be confirmed. Check the code or request a new one.');
    }
  }

  clearFlow(flow: string): void {
    this.verifiers.get(flow)?.clear();
    this.verifiers.delete(flow);
    this.confirmations.delete(flow);
    this.containers.get(flow)?.remove();
    this.containers.delete(flow);
  }

  private getAuth(): Auth {
    if (this.auth) return this.auth;
    const config: FirebaseOptions = firebaseConfig;
    if (!config.apiKey || !config.authDomain || !config.projectId || !config.appId) {
      throw new Error('Firebase Phone Authentication is not configured. Add the Firebase web app settings to client/src/app/firebase-config.ts.');
    }
    const app = getApps().find((entry) => entry.name === 'kahbi-phone-auth') ||
      initializeApp(config, 'kahbi-phone-auth');
    this.auth = getAuth(app);
    return this.auth;
  }

  private authError(error: unknown, fallback: string): Error {
    if (error instanceof Error && 'code' in error && typeof error.code === 'string') {
      const code = error.code;
      if (code === 'auth/invalid-phone-number') return new Error('Enter a valid phone number in international format.');
      if (code === 'auth/too-many-requests' || code === 'auth/quota-exceeded') {
        return new Error('Firebase temporarily blocked SMS requests for this phone. Please wait before trying again.');
      }
      if (code === 'auth/invalid-verification-code' || code === 'auth/code-expired') {
        return new Error('That verification code is incorrect or expired. Request a new code.');
      }
    }
    return new Error(fallback);
  }
}
