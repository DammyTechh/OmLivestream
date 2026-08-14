'use client';
import { create } from 'zustand';
import { api, TOKEN_KEYS, unwrap } from '@/lib/api';
import { resetSocket } from '@/lib/socket';
import { tokenStore } from '@/lib/token-store';

export type Plan = 'free_trial' | 'free' | 'premium';
export type Role = 'super_admin' | 'admin' | 'support';

export interface User {
  id: string;
  email: string;
  full_name?: string | null;
  avatar_url?: string | null;
  dob?: string | null;
  location?: string | null;
  plan: Plan;
  is_verified: boolean;
  onboarding_completed?: boolean;
  heard_from?: string[] | null;
  use_case?: string[] | null;
  trial_expires_at?: string | null;
  waitlist_member?: boolean;
  waitlist_reward_claimed?: boolean;
  /** Login sessions the first-run dashboard tour has played in (capped at 3). */
  tour_views?: number;
  created_at?: string;
}

export interface AdminUser {
  id: string;
  email: string;
  full_name: string;
  role: Role;
}

interface AuthState {
  user: User | null;
  accessToken: string | null;
  refreshToken: string | null;
  hydrated: boolean;

  setTokens: (access: string, refresh: string) => void;
  setUser: (u: User | null) => void;
  hydrate: () => void;
  logout: () => void;
  refreshProfile: () => Promise<void>;
}

export const useAuth = create<AuthState>((set, get) => ({
  user: null,
  accessToken: null,
  refreshToken: null,
  hydrated: false,

  setTokens: (accessToken, refreshToken) => {
    tokenStore.set(TOKEN_KEYS.ACCESS, accessToken);
    tokenStore.set(TOKEN_KEYS.REFRESH, refreshToken);
    set({ accessToken, refreshToken });
  },

  setUser: (user) => {
    if (user) localStorage.setItem(TOKEN_KEYS.USER, JSON.stringify(user));
    else localStorage.removeItem(TOKEN_KEYS.USER);
    set({ user });
  },

  hydrate: () => {
    if (typeof window === 'undefined') return;
    const accessToken  = tokenStore.get(TOKEN_KEYS.ACCESS);
    const refreshToken = tokenStore.get(TOKEN_KEYS.REFRESH);
    const userStr      = localStorage.getItem(TOKEN_KEYS.USER);
    set({
      accessToken,
      refreshToken,
      user: userStr ? JSON.parse(userStr) : null,
      hydrated: true,
    });
  },

  refreshProfile: async () => {
    try {
      const user = unwrap<User>(await api.get('/users/me'));
      localStorage.setItem(TOKEN_KEYS.USER, JSON.stringify(user));
      set({ user });
    } catch {
      // fail silently — token may be invalid, guard will redirect
    }
  },

  logout: () => {
    tokenStore.remove(TOKEN_KEYS.ACCESS);
    tokenStore.remove(TOKEN_KEYS.REFRESH);
    localStorage.removeItem(TOKEN_KEYS.USER);
    // The socket authenticates once, at handshake, with the token that was in
    // localStorage then. Left open across a sign-out it keeps delivering the
    // previous user's notifications to whoever signs in next.
    resetSocket();
    set({ accessToken: null, refreshToken: null, user: null });
  },
}));

interface AdminState {
  admin: AdminUser | null;
  accessToken: string | null;
  refreshToken: string | null;
  hydrated: boolean;
  setTokens: (access: string, refresh: string) => void;
  setAdmin: (u: AdminUser | null) => void;
  hydrate: () => void;
  logout: () => void;
}

export const useAdmin = create<AdminState>((set) => ({
  admin: null,
  accessToken: null,
  refreshToken: null,
  hydrated: false,

  setTokens: (accessToken, refreshToken) => {
    tokenStore.set(TOKEN_KEYS.ADMIN_ACCESS, accessToken);
    tokenStore.set(TOKEN_KEYS.ADMIN_REFRESH, refreshToken);
    set({ accessToken, refreshToken });
  },

  setAdmin: (admin) => {
    if (admin) localStorage.setItem(TOKEN_KEYS.ADMIN_USER, JSON.stringify(admin));
    else localStorage.removeItem(TOKEN_KEYS.ADMIN_USER);
    set({ admin });
  },

  hydrate: () => {
    if (typeof window === 'undefined') return;
    const accessToken  = tokenStore.get(TOKEN_KEYS.ADMIN_ACCESS);
    const refreshToken = tokenStore.get(TOKEN_KEYS.ADMIN_REFRESH);
    const adminStr     = localStorage.getItem(TOKEN_KEYS.ADMIN_USER);
    set({
      accessToken,
      refreshToken,
      admin: adminStr ? JSON.parse(adminStr) : null,
      hydrated: true,
    });
  },

  logout: () => {
    tokenStore.remove(TOKEN_KEYS.ADMIN_ACCESS);
    tokenStore.remove(TOKEN_KEYS.ADMIN_REFRESH);
    localStorage.removeItem(TOKEN_KEYS.ADMIN_USER);
    set({ accessToken: null, refreshToken: null, admin: null });
  },
}));
