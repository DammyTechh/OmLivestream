'use client';
import { io, Socket } from 'socket.io-client';
import { TOKEN_KEYS } from './api';

/**
 * One socket for the whole dashboard.
 *
 * Every component that wanted live data used to open its own connection. That
 * is a fresh WebSocket handshake and a fresh JWT verification per component,
 * and — more importantly — the server counts a stream's viewers by socket, so
 * two connections from one browser tab counted that person twice.
 *
 * The connection is shared and reference-counted: the last consumer to release
 * it closes it. Nothing here runs on the server, so the module never touches
 * `window` outside a call.
 */

const SOCKET_URL = process.env.NEXT_PUBLIC_SOCKET_URL || 'http://localhost:3001';

let shared: Socket | null = null;
let refs = 0;

export function acquireSocket(): Socket | null {
  if (typeof window === 'undefined') return null;

  const token = localStorage.getItem(TOKEN_KEYS.ACCESS);
  // The server's auth middleware rejects a tokenless handshake, so connecting
  // without one just produces a connect_error loop with backoff.
  if (!token) return null;

  if (!shared) {
    shared = io(SOCKET_URL, {
      auth: { token },
      transports: ['websocket', 'polling'],
      reconnectionAttempts: 10,
      reconnectionDelay: 1_000,
    });
  }
  refs += 1;
  return shared;
}

export function releaseSocket(): void {
  refs = Math.max(0, refs - 1);
  if (refs === 0 && shared) {
    shared.disconnect();
    shared = null;
  }
}

/**
 * Drop the connection outright — used on sign-out.
 *
 * The handshake token is captured once at connect, so a socket opened by the
 * previous user survives a re-login and keeps delivering their notifications
 * to whoever is now sitting at the browser.
 */
export function resetSocket(): void {
  refs = 0;
  if (shared) {
    shared.disconnect();
    shared = null;
  }
}
