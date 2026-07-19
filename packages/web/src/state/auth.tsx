/**
 * Current user context:
 * initialized via GET /api/me on mount; when unauthenticated, the route guard (RequireAuth)
 * redirects to /login; a successful login/registration holds a session cookie (HttpOnly,
 * issued by the server).
 */
import { createContext, useCallback, useContext, useEffect, useState } from "react";
import type { ReactNode } from "react";
import type { UserInfo } from "@prismshadow/penguin-server/api";
import * as api from "../api/endpoints";
import { ApiError, setUnauthorizedHandler } from "../api/client";

interface AuthContextValue {
  /** undefined = initializing; null = not logged in. */
  user: UserInfo | null | undefined;
  login: (userId: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  /** Refetch /api/me (e.g. to refresh the passwordIsInitial flag after a password change). */
  refresh: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<UserInfo | null | undefined>(undefined);

  // Any API returning 401 (session expired / database rebuilt) clears the current user, and
  // RequireAuth redirects back to the login page.
  // Must be registered before the GET /api/me effect below (effects in the same component
  // run in declaration order).
  useEffect(() => {
    setUnauthorizedHandler(() => setUser(null));
    return () => setUnauthorizedHandler(null);
  }, []);

  useEffect(() => {
    let cancelled = false;
    api
      .getMe()
      .then((res) => {
        if (!cancelled) setUser(res.user);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        if (err instanceof ApiError && err.status === 401) setUser(null);
        else setUser(null);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const login = useCallback(async (userId: string, password: string) => {
    const res = await api.login({ userId, password });
    setUser(res.user);
  }, []);

  const logout = useCallback(async () => {
    try {
      await api.logout();
    } finally {
      setUser(null);
    }
  }, []);

  const refresh = useCallback(async () => {
    const res = await api.getMe();
    setUser(res.user);
  }, []);

  return (
    <AuthContext.Provider value={{ user, login, logout, refresh }}>{children}</AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth 必须在 AuthProvider 内使用");
  return ctx;
}
