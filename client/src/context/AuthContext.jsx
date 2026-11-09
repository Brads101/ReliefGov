import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api } from '../lib/api.js';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [session, setSession] = useState(null); // server auth metadata (demo accounts, notice…)
  const [status, setStatus] = useState('loading'); // loading | ready

  const clear = useCallback(() => {
    try {
      localStorage.removeItem('reliefgov_token');
      localStorage.removeItem('reliefgov_user');
    } catch {
      /* storage unavailable */
    }
    setUser(null);
  }, []);

  const loadMe = useCallback(async () => {
    let token = null;
    try {
      token = localStorage.getItem('reliefgov_token');
    } catch {
      token = null;
    }
    if (!token) {
      setStatus('ready');
      return;
    }
    try {
      const data = await api('/auth/me');
      setUser(data.user);
      try {
        localStorage.setItem('reliefgov_user', JSON.stringify(data.user));
      } catch {
        /* storage unavailable */
      }
    } catch (err) {
      if (err && err.status === 401) {
        // The server definitively rejected the session (expired, deactivated,
        // or approval withdrawn) — sign out.
        clear();
      } else {
        // Transient failure (network or server hiccup): keep the token and
        // fall back to the cached profile instead of forcing a sign-out.
        // Every API call is still authenticated server-side; the session is
        // revalidated on the next successful request.
        try {
          const cached = localStorage.getItem('reliefgov_user');
          if (cached) setUser(JSON.parse(cached));
        } catch {
          /* storage unavailable */
        }
      }
    } finally {
      setStatus('ready');
    }
  }, [clear]);

  useEffect(() => {
    loadMe();
  }, [loadMe]);

  const login = useCallback(
    async (email, password) => {
      const data = await api('/auth/login', { method: 'POST', body: { email, password } });
      try {
        localStorage.setItem('reliefgov_token', data.token);
        localStorage.setItem('reliefgov_user', JSON.stringify(data.user));
      } catch {
        /* storage unavailable */
      }
      setUser(data.user);
      return data;
    },
    []
  );

  const logout = useCallback(() => {
    clear();
  }, [clear]);

  const value = useMemo(
    () => ({ user, status, session, login, logout, reload: loadMe }),
    [user, status, session, login, logout, loadMe]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}

export default AuthContext;
