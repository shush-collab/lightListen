import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

import {
  api,
  clearRefreshToken,
  readRefreshToken,
  registerUnauthorizedHandler,
  saveRefreshToken,
  setAccessToken,
} from "@/src/api/client";
import type { User } from "@/src/api/types";

type AuthContextValue = {
  user: User | null;
  booting: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (email: string, password: string, displayName: string) => Promise<void>;
  signOut: () => Promise<void>;
  updateProfile: (displayName: string) => Promise<void>;
};

const AuthContext = createContext<AuthContextValue>({
  user: null,
  booting: true,
  signIn: async () => {},
  signUp: async () => {},
  signOut: async () => {},
  updateProfile: async () => {},
});

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [booting, setBooting] = useState(true);

  useEffect(() => {
    registerUnauthorizedHandler(() => setUser(null));
    return () => registerUnauthorizedHandler(null);
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const refresh = await readRefreshToken();
      if (refresh) {
        try {
          const pair = await api.refresh(refresh);
          setAccessToken(pair.access_token);
          await saveRefreshToken(pair.refresh_token);
          if (!cancelled) setUser(pair.user);
        } catch {
          await clearRefreshToken();
          setAccessToken(null);
        }
      }
      if (!cancelled) setBooting(false);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const signIn = useCallback(async (email: string, password: string) => {
    const pair = await api.login(email.trim(), password);
    setAccessToken(pair.access_token);
    await saveRefreshToken(pair.refresh_token);
    setUser(pair.user);
  }, []);

  const signUp = useCallback(async (email: string, password: string, displayName: string) => {
    const pair = await api.signup(email.trim(), password, displayName.trim());
    setAccessToken(pair.access_token);
    await saveRefreshToken(pair.refresh_token);
    setUser(pair.user);
  }, []);

  const signOut = useCallback(async () => {
    setAccessToken(null);
    await clearRefreshToken();
    setUser(null);
  }, []);

  const updateProfile = useCallback(async (displayName: string) => {
    const updated = await api.updateMe({ display_name: displayName });
    setUser(updated);
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({ user, booting, signIn, signUp, signOut, updateProfile }),
    [user, booting, signIn, signUp, signOut, updateProfile],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export const useAuth = () => useContext(AuthContext);
