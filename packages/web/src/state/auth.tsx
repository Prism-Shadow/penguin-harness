/**
 * Current user context:
 * initialized via GET /api/me on mount; when unauthenticated, the route guard (RequireAuth)
 * redirects to /login; a successful login/registration holds a session cookie (HttpOnly,
 * issued by the server).
 */
import { createContext, useCallback, useContext, useEffect, useState } from "react";
import type { ReactNode } from "react";
import type { MeResponse, UploadPolicy, UserInfo } from "@prismshadow/penguin-server/api";
import * as api from "../api/endpoints";
import { ApiError, setUnauthorizedHandler } from "../api/client";

/**
 * Stand-in until GET /api/me answers, matching the server's shipped defaults. The window is the
 * mount-time fetch, before a composer can be used at all, and the policy shapes what a tab
 * uploads rather than what the server accepts — so a stale value here costs at most one image
 * that was re-encoded (or not) against the previous setting.
 */
const DEFAULT_UPLOAD_POLICY: UploadPolicy = {
  attachmentMaxCount: 20,
  imageCompression: true,
  imageCompressionOverMb: 4,
  imageCompressionMinMb: 1,
  imageCompressionMaxMb: 64,
};

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
  /**
   * Whether the server runs in desktop mode (spawned by the desktop shell). The UI then
   * hides the logout entry, the initial-password banner and the self-update entry — the
   * desktop app manages sign-in and updates itself.
   */
  desktopMode: boolean;
  /**
   * How THIS session was established — a browser signed into a desktop-mode server holds a
   * "password" session. "desktop" and "setup" may change the password without the old one
   * (see omitsOldPassword in lib/account-menu). ("token" marks Bearer-authenticated API
   * callers and never occurs in a browser session; it is carried for type parity with the
   * server.)
   */
  sessionVia: MeResponse["sessionVia"];
  /**
   * How this server wants uploads handled (admin-settable). The composer reads it to decide
   * whether a large image is re-encoded before it is uploaded, and how many files one message
   * may carry.
   */
  uploadPolicy: UploadPolicy;
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
  const [desktopMode, setDesktopMode] = useState(false);
  const [sessionVia, setSessionVia] = useState<MeResponse["sessionVia"]>("password");
  const [uploadPolicy, setUploadPolicy] = useState<UploadPolicy>(DEFAULT_UPLOAD_POLICY);

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
        setDesktopMode(res.desktopMode);
        setSessionVia(res.sessionVia);
        setUploadPolicy(res.uploadPolicy);
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
    // previewIsolated only rides on GET /api/me, and the mount-time fetch ran before
    // this session existed — without a refetch, a deployment with no separate preview
    // origin would keep the optimistic `true` after a UI login (navigation is
    // client-side, so nothing else re-asks) and the Files panel would take the isolated
    // preview path it can't actually serve. Never fail the login over it: the session
    // cookie is already set, so a transient /me error just leaves the default in place
    // until the next refresh.
    try {
      const me = await api.getMe();
      setUser(me.user);
      setPreviewIsolated(me.previewIsolated);
      setDesktopMode(me.desktopMode);
      setSessionVia(me.sessionVia);
      setUploadPolicy(me.uploadPolicy);
    } catch {
      // Login itself succeeded; keep the optimistic default.
    }
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
    setDesktopMode(res.desktopMode);
    setSessionVia(res.sessionVia);
    setUploadPolicy(res.uploadPolicy);
  }, []);

  return (
    <AuthContext.Provider
      value={{
        user,
        previewIsolated,
        desktopMode,
        sessionVia,
        uploadPolicy,
        login,
        logout,
        refresh,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within an AuthProvider");
  return ctx;
}
