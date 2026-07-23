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
  /**
   * Whether Workspace HTML previews open on a separate origin. False means this
   * deployment falls back to the same-origin sandbox, where `localStorage`, cookies and
   * third-party embeds do not work — the Files panel warns before opening. Comes from
   * /api/me because it depends on the host the browser is using.
   */
  previewIsolated: boolean;
  login: (userId: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  /** Refetch /api/me (e.g. to refresh the passwordIsInitial flag after a password change). */
  refresh: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<UserInfo | null | undefined>(undefined);
  // Assume isolated until told otherwise: the warning is the exceptional state, and
  // flashing it during initialization would be noise.
  const [previewIsolated, setPreviewIsolated] = useState(true);

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
        if (cancelled) return;
        setUser(res.user);
        setPreviewIsolated(res.previewIsolated);
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
    setPreviewIsolated(res.previewIsolated);
  }, []);

  return (
    <AuthContext.Provider value={{ user, previewIsolated, login, logout, refresh }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within an AuthProvider");
  return ctx;
}
