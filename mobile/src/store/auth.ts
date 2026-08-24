import { create } from 'zustand';
import * as WebBrowser from 'expo-web-browser';
import * as Linking from 'expo-linking';
import { api, unwrap, getApiError, setSessionExpiredHandler, API_URL } from '@/api/client';
import { tokens } from '@/api/tokens';

export type Plan = 'free' | 'free_trial' | 'premium';

export interface User {
  id: string;
  email: string;
  full_name: string | null;
  avatar_url: string | null;
  plan: Plan;
  is_verified: boolean;
  dob?: string | null;
  location?: string | null;
  trial_expires_at?: string | null;
  onboarding_completed?: boolean;
  created_at?: string;
}

interface AuthState {
  user: User | null;
  /** False until the stored session has been read and validated. */
  hydrated: boolean;
  loading: boolean;

  hydrate: () => Promise<void>;
  sendOtp: (email: string) => Promise<void>;
  verifyOtp: (email: string, code: string) => Promise<{ isNewUser: boolean }>;
  signInWithProvider: (provider: 'google' | 'facebook') => Promise<{ isNewUser: boolean }>;
  refreshProfile: () => Promise<void>;
  setUser: (u: User) => void;
  logout: () => Promise<void>;
}

export const useAuth = create<AuthState>((set, get) => ({
  user: null,
  hydrated: false,
  loading: false,

  /**
   * Restore a session at launch.
   *
   * A stored token is treated as a *claim*, not proof: it is used to fetch the
   * profile, and only a successful fetch counts as signed in. That costs one
   * request but means a revoked, expired or tampered token surfaces on the
   * splash screen rather than as a wall of failures inside the app.
   */
  hydrate: async () => {
    const { access } = await tokens.load();
    if (!access) { set({ hydrated: true }); return; }
    try {
      const user = await api.get('/users/me').then(unwrap<User>);
      set({ user, hydrated: true });
    } catch {
      // The interceptor already attempted a refresh. Reaching here means the
      // session is genuinely gone.
      await tokens.clear();
      set({ user: null, hydrated: true });
    }
  },

  sendOtp: async (email) => {
    set({ loading: true });
    try {
      await api.post('/auth/send-otp', { email: email.trim().toLowerCase() });
    } catch (err) {
      throw new Error(getApiError(err, 'Could not send your code. Try again.'));
    } finally {
      set({ loading: false });
    }
  },

  verifyOtp: async (email, code) => {
    set({ loading: true });
    try {
      const res = await api.post('/auth/verify-otp', {
        email: email.trim().toLowerCase(),
        code: code.trim(),
      }).then(unwrap<{ accessToken: string; refreshToken: string; isNewUser: boolean }>);

      await tokens.save(res.accessToken, res.refreshToken);
      const user = await api.get('/users/me').then(unwrap<User>);
      set({ user });
      return { isNewUser: res.isNewUser };
    } catch (err) {
      throw new Error(getApiError(err, 'That code did not work. Check it and try again.'));
    } finally {
      set({ loading: false });
    }
  },

  /**
   * Social sign-in, via the system browser.
   *
   * Deliberately `openAuthSessionAsync` and not an in-app WebView. Google
   * blocks OAuth in embedded WebViews outright (disallowed_useragent), and
   * the system session shares cookies with Safari/Chrome — so someone already
   * signed in to Google taps once instead of typing a password. It is also the
   * only variant that shows the real URL bar, which is what makes a
   * credential prompt trustworthy.
   *
   * Flow: ask the API for an authorize URL → browser → the provider redirects
   * to the API callback → the API bounces back to our `omlivestream://` scheme
   * carrying a one-time ticket → we exchange the ticket for tokens. The ticket
   * matters: it keeps real tokens out of a URL, where they would land in logs
   * and browser history.
   */
  signInWithProvider: async (provider) => {
    set({ loading: true });
    try {
      const returnUrl = Linking.createURL('auth/callback');
      const { authUrl } = await api
        .get(`/auth/social/${provider}/url`, { params: { redirect: returnUrl } })
        .then(unwrap<{ authUrl: string; state: string }>);

      const result = await WebBrowser.openAuthSessionAsync(authUrl, returnUrl, {
        preferEphemeralSession: false,
        showInRecents: false,
      });

      if (result.type !== 'success' || !result.url) {
        throw new Error('Sign-in was cancelled.');
      }

      const { queryParams } = Linking.parse(result.url);
      const ticket = queryParams?.ticket as string | undefined;
      const error  = queryParams?.error as string | undefined;
      if (error)   throw new Error(String(error));
      if (!ticket) throw new Error('Sign-in did not complete. Please try again.');

      const res = await api.post('/auth/social/exchange', { ticket })
        .then(unwrap<{ accessToken: string; refreshToken: string; isNewUser: boolean }>);

      await tokens.save(res.accessToken, res.refreshToken);
      const user = await api.get('/users/me').then(unwrap<User>);
      set({ user });
      return { isNewUser: res.isNewUser };
    } catch (err) {
      throw new Error(getApiError(err, 'Could not sign in. Please try again.'));
    } finally {
      set({ loading: false });
    }
  },

  refreshProfile: async () => {
    try {
      const user = await api.get('/users/me').then(unwrap<User>);
      set({ user });
    } catch { /* keep the cached profile; a stale name beats an empty screen */ }
  },

  setUser: (user) => set({ user }),

  logout: async () => {
    // Best-effort server-side revocation. A network failure must never trap
    // someone in an account they are trying to leave, so the local clear
    // happens regardless.
    try { await api.post('/auth/logout'); } catch { /* ignore */ }
    await tokens.clear();
    set({ user: null });
  },
}));

// A refresh that fails mid-session ends it here, so every screen reacts at
// once rather than each discovering it through its own failed request.
setSessionExpiredHandler(() => {
  useAuth.setState({ user: null });
});

export { API_URL };
