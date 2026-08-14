import { tokenStore } from './token-store';
import axios, { AxiosError, InternalAxiosRequestConfig } from 'axios';

export const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001/api/v1';

export const api = axios.create({
  baseURL: API_URL,
  timeout: 30_000,
  headers: { 'Content-Type': 'application/json' },
});

export const TOKEN_KEYS = {
  ACCESS:  'omlive_access',
  REFRESH: 'omlive_refresh',
  USER:    'omlive_user',
  ADMIN_ACCESS:  'omlive_admin_access',
  ADMIN_REFRESH: 'omlive_admin_refresh',
  ADMIN_USER:    'omlive_admin_user',
} as const;

// Endpoints that should NEVER trigger auto-refresh on 401
const NO_REFRESH_PATHS = [
  '/auth/send-otp',
  '/auth/verify-otp',
  '/auth/refresh',
  '/auth/social',
  '/admin/auth/login',
  '/admin/auth/refresh',
  '/waitlist/join',
  '/contact',
];

const shouldSkipRefresh = (url?: string) =>
  !url || NO_REFRESH_PATHS.some((p) => url.includes(p));

api.interceptors.request.use((config: InternalAxiosRequestConfig) => {
  if (typeof window === 'undefined') return config;
  const isAdmin = config.url?.startsWith('/admin') ?? false;
  const token = tokenStore.get(isAdmin ? TOKEN_KEYS.ADMIN_ACCESS : TOKEN_KEYS.ACCESS);
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

let isRefreshing = false;
let queue: Array<(t: string) => void> = [];

api.interceptors.response.use(
  (res) => res,
  async (err: AxiosError) => {
    const original = err.config as InternalAxiosRequestConfig & { _retry?: boolean };
    if (shouldSkipRefresh(original?.url)) return Promise.reject(err);

    if (err.response?.status === 401 && !original._retry && typeof window !== 'undefined') {
      const isAdmin = original.url?.startsWith('/admin') ?? false;
      const refreshKey = isAdmin ? TOKEN_KEYS.ADMIN_REFRESH : TOKEN_KEYS.REFRESH;
      const accessKey  = isAdmin ? TOKEN_KEYS.ADMIN_ACCESS  : TOKEN_KEYS.ACCESS;
      const refreshToken = localStorage.getItem(refreshKey);
      if (!refreshToken) return Promise.reject(err);

      if (isRefreshing) {
        return new Promise((resolve) => {
          queue.push((t) => { original.headers.Authorization = `Bearer ${t}`; resolve(api(original)); });
        });
      }
      original._retry = true;
      isRefreshing = true;

      try {
        const refreshPath = isAdmin ? '/admin/auth/refresh' : '/auth/refresh';
        const { data } = await axios.post(`${API_URL}${refreshPath}`, { refreshToken });
        const newToken = data?.data?.accessToken;
        if (!newToken) throw new Error('No token in refresh response');
        localStorage.setItem(accessKey, newToken);
        queue.forEach((cb) => cb(newToken));
        queue = [];
        original.headers.Authorization = `Bearer ${newToken}`;
        return api(original);
      } catch {
        localStorage.removeItem(accessKey);
        localStorage.removeItem(refreshKey);
        localStorage.removeItem(isAdmin ? TOKEN_KEYS.ADMIN_USER : TOKEN_KEYS.USER);
        if (typeof window !== 'undefined') window.location.href = isAdmin ? '/admin' : '/auth/signin';
      } finally { isRefreshing = false; }
    }
    return Promise.reject(err);
  }
);

export function unwrap<T>(r: { data: { success: boolean; data: T } }): T { return r.data.data; }

/**
 * Translate technical/Fastify/Zod errors into friendly English messages.
 */
function humanize(raw: string): string {
  // Fastify validation: "body/heard_from/0 must be equal to one of the allowed values"
  if (raw.includes('must be equal to one of the allowed values'))
    return 'One of your selections is not valid. Please try again.';
  if (raw.match(/body must have required property '(\w+)'/)) {
    const match = raw.match(/body must have required property '(\w+)'/);
    const field = match ? match[1].replace(/_/g, ' ').replace(/([A-Z])/g, ' $1').toLowerCase().trim() : 'a field';
    return `Please fill in the ${field} field.`;
  }
  if (raw.includes('String must contain at least')) return 'Please fill in all required fields.';
  if (raw.includes('Invalid email'))                 return 'Please enter a valid email address.';
  if (raw.includes('body/'))                         return 'Some of the information you entered is missing or incorrect.';

  // OpenAI quota / rate limit
  if (raw.includes('exceeded your current quota') || raw.includes('insufficient_quota'))
    return 'AI is temporarily unavailable. Our AI service quota has been exceeded — please try again later.';
  if (raw.includes('429') || raw.toLowerCase().includes('rate limit'))
    return "You're making requests too quickly. Please wait a moment and try again.";

  // Auth errors
  if (raw.includes('No active code'))     return "That code is no longer valid. We'll send you a new one.";
  if (raw.includes('Incorrect code'))     return raw; // Already user-friendly
  if (raw.includes('Code expired'))       return 'Your code has expired. Please request a new one.';
  if (raw.includes('Invalid or expired')) return 'Your session has expired. Please sign in again.';
  if (raw.includes('No account found'))   return "We couldn't find an account with that email. Please sign up first.";

  // Generic network
  if (raw.includes('Network Error')) return 'Unable to reach our servers. Please check your internet and try again.';
  if (raw.includes('timeout'))       return 'The request took too long. Please try again.';
  if (raw.includes('ECONNREFUSED'))  return 'Unable to reach our servers right now. Please try again later.';

  return raw;
}

export function getApiError(err: unknown, fallback = 'Something went wrong. Please try again.'): string {
  if (axios.isAxiosError(err)) {
    /**
     * Validation errors arrive as a generic "Validation failed" headline with
     * the useful part — which field, and why — in `details`. Showing only the
     * headline tells someone their form was rejected but not what to change,
     * which is how you get a person staring at four filled-in fields with no
     * idea which one is wrong. Prefer the first specific issue when there is
     * one, and name the field it belongs to.
     */
    const details = err.response?.data?.error?.details;
    if (Array.isArray(details) && details.length > 0) {
      const first = details[0] as { message?: string; path?: (string | number)[] };
      if (first?.message) {
        const field = Array.isArray(first.path)
          ? first.path.filter((p) => typeof p === 'string' && p !== 'body').slice(-1)[0]
          : undefined;
        const label = typeof field === 'string'
          ? field.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase())
          : null;
        return humanize(label ? `${label}: ${first.message}` : first.message);
      }
    }

    const serverMsg = err.response?.data?.error?.message
                   || err.response?.data?.message
                   || err.message;
    if (serverMsg) return humanize(serverMsg);
  }
  if (err instanceof Error) return humanize(err.message);
  return fallback;
}
