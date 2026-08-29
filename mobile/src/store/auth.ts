import { create } from 'zustand';
import { secureStorage } from '../storage/secureStorage';
import { api, AuthEvents } from '../api/client';
// Deep import, not the `../push` barrel: the barrel re-exports the root hook,
// which imports this store, and the round trip is an import cycle Metro
// resolves by handing one of the two modules a half-initialised copy of the
// other. `registration` imports nothing from `store/`.
import { unregisterPush } from '../push/registration';
import { useBalance } from './balance';

export interface AppUser {
  id: string;
  email: string;
  name: string;
  language: 'ar' | 'en';
  plan: 'free' | 'premium';
  /**
   * DEPRECATED — the daily question quota was replaced by the minute balance.
   * The server still emits it for one release so an old build keeps rendering;
   * nothing in this app reads it any more. Use `useBalance()` instead.
   */
  dailyQuestionsUsed?: number;
  /** Profile picture from the identity provider, when they used one. */
  avatarUrl?: string | null;
  /**
   * Whether this account can be signed into with a password.
   *
   * False for an account created through Google, which has none. Optional
   * because an older backend does not send it, and the safe reading of a
   * missing value is "there is a password" — that keeps the confirmation step
   * for every existing account.
   */
  hasPassword?: boolean;
}

interface AuthState {
  user: AppUser | null;
  token: string | null;
  refreshToken: string | null;
  loading: boolean;
  hydrate: () => Promise<void>;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string, name: string, language: 'ar' | 'en') => Promise<void>;
  /** Exchange a verified Google ID token for our own session. */
  signInWithGoogle: (idToken: string, language: 'ar' | 'en') => Promise<void>;
  logout: () => Promise<void>;
  refreshMe: () => Promise<void>;
}

/**
 * Re-entrancy guard for `logout`.
 *
 * Sign-out now makes a network call (detaching the push token) *before* it
 * clears the credentials. When sign-out was triggered by an expired session,
 * that call comes back 401 too — which fires `AuthEvents.on401`, which calls
 * `logout` again, which detaches again. Without this flag that is an unbounded
 * recursion, and the app spins instead of returning to the login screen.
 */
let signingOut = false;

async function persistTokens(token: string | null, refreshToken: string | null) {
  if (token) await secureStorage.setItem('access_token', token);
  else await secureStorage.deleteItem('access_token');
  if (refreshToken) await secureStorage.setItem('refresh_token', refreshToken);
  else await secureStorage.deleteItem('refresh_token');
}

/**
 * The last known profile, kept beside the tokens.
 *
 * Not a cache for speed — a cache for CORRECTNESS at launch. Without it the
 * first frame after a cold start has a valid session and no user, so every
 * screen that greets someone by name renders a blank while the network
 * answers, and an offline launch renders that blank for as long as it stays
 * offline. Written wherever the server hands us a fresh copy.
 */
async function cacheUser(user: AppUser | null) {
  try {
    if (user) await secureStorage.setItem('user', JSON.stringify(user));
    else await secureStorage.deleteItem('user');
  } catch { /* storage is a convenience here, never a requirement */ }
}

export const useAuth = create<AuthState>((set, get) => ({
  user: null,
  token: null,
  refreshToken: null,
  loading: false,

  /**
   * Restore the session at launch.
   *
   * Two rules, and both exist because breaking either sends someone who never
   * signed out back to the onboarding slides:
   *
   *  1. The CACHED user is applied before the network is touched, so a launch
   *     with no signal opens the app rather than a signed-out shell.
   *  2. Only an actual 401 clears the session. The previous version cleared on
   *     ANY error from `/user/me` — a timeout on a train, a 502 during a
   *     deploy, a captive portal — all of which are temporary, and none of
   *     which say the token is invalid. The client's refresh interceptor has
   *     already tried to renew by the time an error reaches here, so a 401
   *     at this point really does mean the session is over.
   */
  hydrate: async () => {
    const token = await secureStorage.getItem('access_token');
    const refreshToken = await secureStorage.getItem('refresh_token');
    if (!token) return;

    let cached: AppUser | null = null;
    try {
      const raw = await secureStorage.getItem('user');
      if (raw) cached = JSON.parse(raw) as AppUser;
    } catch { /* a corrupt cache is not worth a failed launch */ }
    set({ token, refreshToken, user: cached });

    try {
      const { data } = await api.get('/user/me');
      set({ user: data.user });
      await cacheUser(data.user);
    } catch (err) {
      const status = (err as { response?: { status?: number } })?.response?.status;
      if (status === 401 || status === 403) {
        await persistTokens(null, null);
        await cacheUser(null);
        set({ token: null, refreshToken: null, user: null });
      }
      // Anything else: keep the session. The token is still good, and the next
      // successful request fills in whatever this one could not.
    }
  },

  login: async (email, password) => {
    set({ loading: true });
    try {
      const { data } = await api.post('/auth/login', { email, password });
      await persistTokens(data.token, data.refreshToken);
      await cacheUser(data.user);
      set({ token: data.token, refreshToken: data.refreshToken, user: data.user });
    } finally {
      set({ loading: false });
    }
  },

  register: async (email, password, name, language) => {
    set({ loading: true });
    try {
      const { data } = await api.post('/auth/register', { email, password, name, language });
      await persistTokens(data.token, data.refreshToken);
      await cacheUser(data.user);
      set({ token: data.token, refreshToken: data.refreshToken, user: data.user });
    } finally {
      set({ loading: false });
    }
  },

  signInWithGoogle: async (idToken, language) => {
    set({ loading: true });
    try {
      const { data } = await api.post('/auth/google', { idToken, language });
      await persistTokens(data.token, data.refreshToken);
      await cacheUser(data.user);
      set({ token: data.token, refreshToken: data.refreshToken, user: data.user });
    } finally {
      set({ loading: false });
    }
  },

  logout: async () => {
    if (signingOut) return;
    signingOut = true;
    try {
      // Before the credentials are cleared, never after: the server decides
      // whose device_tokens row to detach from the bearer token on the request,
      // so a detach sent afterwards detaches nothing and this device keeps
      // receiving the departing user's notifications once the next person signs
      // in. `unregisterPush` swallows its own failures — it must not be able to
      // strand someone on a screen they asked to leave.
      await unregisterPush();
      await persistTokens(null, null);
      await cacheUser(null);
      set({ token: null, refreshToken: null, user: null });
      // The balance belongs to the account, not to the app. Leaving it behind
      // would show the next person to sign in the previous one's minutes.
      useBalance.getState().clear();
    } finally {
      signingOut = false;
    }
  },

  refreshMe: async () => {
    const { token } = get();
    if (!token) return;
    const { data } = await api.get('/user/me');
    set({ user: data.user });
    await cacheUser(data.user);
  },
}));

// Wire the 401 interceptor to the store.
AuthEvents.on401 = () => {
  useAuth.getState().logout().catch(() => {});
};

/**
 * A silent renewal happened inside the API client.
 *
 * The client has already written the new pair to secure storage — every
 * request reads the token from there, so nothing is broken without this. It
 * exists so the store's own copy does not drift: `logout` and anything else
 * reading `refreshToken` from state would otherwise be holding a token the
 * server replaced fifteen minutes ago.
 */
AuthEvents.onTokens = (token, refreshToken) => {
  useAuth.setState({ token, refreshToken });
};
