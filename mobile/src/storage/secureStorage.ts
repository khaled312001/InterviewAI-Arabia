// Cross-platform secure storage wrapper.
// On native (iOS/Android) this uses expo-secure-store (Keychain / EncryptedSharedPrefs).
// On web, SecureStore is not available — fall back to localStorage.
// Items stored here are limited to short auth tokens (~hundreds of bytes),
// not secrets at rest — the server enforces authorization, not the client.

import { Platform } from 'react-native';

type Adapter = {
  getItem: (key: string) => Promise<string | null>;
  setItem: (key: string, value: string) => Promise<void>;
  deleteItem: (key: string) => Promise<void>;
};

function webAdapter(): Adapter {
  const safeLocal = typeof window !== 'undefined' && window.localStorage ? window.localStorage : null;
  return {
    async getItem(key) { return safeLocal ? safeLocal.getItem(key) : null; },
    async setItem(key, value) { if (safeLocal) safeLocal.setItem(key, value); },
    async deleteItem(key) { if (safeLocal) safeLocal.removeItem(key); },
  };
}

function nativeAdapter(): Adapter {
  // Require lazily so Metro doesn't try to resolve the native module for web bundles.
  const SecureStore = require('expo-secure-store');
  return {
    async getItem(key) { return SecureStore.getItemAsync(key); },
    async setItem(key, value) { return SecureStore.setItemAsync(key, value); },
    async deleteItem(key) { return SecureStore.deleteItemAsync(key); },
  };
}

const adapter: Adapter = Platform.OS === 'web' ? webAdapter() : nativeAdapter();

export const secureStorage = adapter;
