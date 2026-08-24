import * as SecureStore from 'expo-secure-store';

/**
 * Where auth tokens live on device.
 *
 * expo-secure-store, not AsyncStorage. AsyncStorage is an unencrypted file in
 * the app sandbox — readable on a rooted or jailbroken device, and on Android
 * it can be swept up by full-device backups. SecureStore uses the iOS Keychain
 * and Android Keystore, which is where a long-lived credential belongs.
 *
 * `WHEN_UNLOCKED_THIS_DEVICE_ONLY` is chosen deliberately:
 *   • WHEN_UNLOCKED  — the app has no reason to read tokens while the phone is
 *     locked, and denying that closes a whole class of attack.
 *   • THIS_DEVICE_ONLY — the token never rides an iCloud Keychain backup to a
 *     different handset. Restoring a backup should require signing in again.
 *
 * Keys are namespaced to match the web app's, so the same names describe the
 * same thing across both clients. They are *not* shared storage — the web app
 * uses a cookie scoped to the apex domain; this is a separate device store.
 */

const ACCESS_KEY  = 'omlive_access_token';
const REFRESH_KEY = 'omlive_refresh_token';

const OPTIONS: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
};

/**
 * An in-memory mirror.
 *
 * Every authenticated request needs the access token, and a Keychain read is a
 * native bridge call — doing that per request adds measurable latency to a
 * list screen firing several at once. The mirror is populated on load and kept
 * in step on every write, so the disk read happens once per launch.
 */
let cachedAccess: string | null = null;

export const tokens = {
  async load(): Promise<{ access: string | null; refresh: string | null }> {
    try {
      const [access, refresh] = await Promise.all([
        SecureStore.getItemAsync(ACCESS_KEY, OPTIONS),
        SecureStore.getItemAsync(REFRESH_KEY, OPTIONS),
      ]);
      cachedAccess = access;
      return { access, refresh };
    } catch {
      // A corrupt or inaccessible keychain entry must not brick launch; the
      // worst case is being asked to sign in again.
      cachedAccess = null;
      return { access: null, refresh: null };
    }
  },

  getAccessSync(): string | null {
    return cachedAccess;
  },

  async getRefresh(): Promise<string | null> {
    try {
      return await SecureStore.getItemAsync(REFRESH_KEY, OPTIONS);
    } catch {
      return null;
    }
  },

  async save(access: string, refresh: string): Promise<void> {
    cachedAccess = access;
    try {
      await Promise.all([
        SecureStore.setItemAsync(ACCESS_KEY, access, OPTIONS),
        SecureStore.setItemAsync(REFRESH_KEY, refresh, OPTIONS),
      ]);
    } catch {
      // Keep the in-memory copy so the current session still works even if
      // the write failed; the next launch will simply require signing in.
    }
  },

  async clear(): Promise<void> {
    cachedAccess = null;
    try {
      await Promise.all([
        SecureStore.deleteItemAsync(ACCESS_KEY, OPTIONS),
        SecureStore.deleteItemAsync(REFRESH_KEY, OPTIONS),
      ]);
    } catch { /* nothing useful to do */ }
  },
};
