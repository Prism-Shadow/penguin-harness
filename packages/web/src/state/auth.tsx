/**
 * Current user context:
 * initialized via GET /api/me on mount; when unauthenticated, the route guard (RequireAuth)
 * redirects to /login; a successful login/registration holds a session cookie (HttpOnly,
 * issued by the server).
 */
import { createContext, useCallback, useContext, useEffect, useState } from "react";
import type { ReactNode } from "react";
import type { MeResponse, UploadLimits, UserInfo } from "@prismshadow/penguin-server/api";
import * as api from "../api/endpoints";
import { ApiError, setUnauthorizedHandler } from "../api/client";

/**
 * Stand-in until GET /api/me answers, matching the server's shipped defaults. The window is the
 * mount-time fetch, before a composer can be used at all; the server re-validates every upload
 * against the real limits regardless, so a stale value here can only make the composer's
 * pre-flight check slightly wrong, never let an oversize file through.
 */
const DEFAULT_UPLOAD_LIMITS: UploadLimits = {
  attachmentMaxMb: 100,
  attachmentTotalMb: 120,
  attachmentMaxCount: 20,
  imageMaxMb: 20,
  attachmentLimitMinMb: 1,
  attachmentLimitMaxMb: 200,
};

/**
 * A GET /api/me issued right after a successful login failed: does the session it was meant to
 * read still stand? A 401 is the one answer that says it does not — the login held, but the
 * session cookie never took (blocked cookies, a cross-site context, a proxy dropping
 * `Set-Cookie`), so there is no session to adopt a user onto, and the client's 401 handler has
 * already cleared the user. Any other failure (offline, a 5xx) leaves the session standing and
 * costs only the flags that read would have refreshed.
 *
 * Exported as a test seam: this package's vitest runs in node with no DOM, so the decision is
 * asserted by value rather than by mounting the Provider.
 */
export function loginSessionSurvives(error: unknown): boolean {
  return !(error instanceof ApiError && error.status === 401);
}

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
   * Upload limits in force on this server (admin-settable). The composer reads them to refuse an
   * oversize pick before reading it and to name the real number in the message, so the client
   * check and the server check can never disagree about what "too large" means.
   */
  uploadLimits: UploadLimits;
  /**
   * Whether company mode is enabled server-wide (the admin master switch in server settings,
   * default off). Off hides the work-mode switch for everyone and 404s every organization
   * route; the user's own preference (`UiPrefs.companyMode`) only hides the switch for them.
   */
  companyMode: boolean;
  login: (userId: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  /** Refetch /api/me (e.g. to refresh the passwordIsInitial flag after a password change). */
  refresh: () => Promise<void>;
  /**
   * Adopt a user the server has just returned — the Profile page's save. `refresh()` would
   * reach the same state through a second request, and the fields it would bring back with it
   * (previewIsolated, the upload limits) did not change, so the response is the cheaper and
   * more direct source: the sidebar's avatar and name move in the same commit as the save.
   */
  setUserInfo: (user: UserInfo) => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<UserInfo | null | undefined>(undefined);
  // Assume isolated until told otherwise: the warning is the exceptional state, and
  // flashing it during initialization would be noise.
  const [previewIsolated, setPreviewIsolated] = useState(true);
  const [desktopMode, setDesktopMode] = useState(false);
  const [sessionVia, setSessionVia] = useState<MeResponse["sessionVia"]>("password");
  const [uploadLimits, setUploadLimits] = useState<UploadLimits>(DEFAULT_UPLOAD_LIMITS);
  // Off until /api/me says otherwise, as it is on a server nobody has turned it on: the mode
  // switch must not flash for a server that has company mode off.
  const [companyMode, setCompanyMode] = useState(false);

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
        setUploadLimits(res.uploadLimits);
        setCompanyMode(res.companyMode);
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
    // previewIsolated only rides on GET /api/me, and the mount-time fetch ran before
    // this session existed — without a refetch, a deployment with no separate preview
    // origin would keep the optimistic `true` after a UI login (navigation is
    // client-side, so nothing else re-asks) and the Files panel would take the isolated
    // preview path it can't actually serve. Never fail the login over it: the session
    // cookie is already set, so a transient /me error just leaves the default in place
    // until the next refresh.
    //
    // The user is adopted together with that answer, not before it: the shell mounts the
    // moment there is a user, and a shell mounted on the pre-login flags acts on them — the
    // company store reads an "off" master switch as its cue to put the chosen work mode
    // back to development, which would cost every UI login a company choice.
    try {
      const me = await api.getMe();
      setUser(me.user);
      setPreviewIsolated(me.previewIsolated);
      setDesktopMode(me.desktopMode);
      setSessionVia(me.sessionVia);
      setUploadLimits(me.uploadLimits);
      setCompanyMode(me.companyMode);
    } catch (e) {
      // Login itself succeeded; adopt the user and keep the optimistic defaults — unless the
      // read came back 401, which says the session cookie never took. Adopting a user on a
      // session that does not exist would undo the 401 handler's setUser(null) in the same
      // continuation and mount the shell over a dead session.
      if (loginSessionSurvives(e)) setUser(res.user);
    }
  }, []);

  const logout = useCallback(async () => {
    try {
      await api.logout();
    } finally {
      setUser(null);
    }
  }, []);

  const setUserInfo = useCallback((next: UserInfo) => setUser(next), []);

  const refresh = useCallback(async () => {
    const res = await api.getMe();
    setUser(res.user);
    setPreviewIsolated(res.previewIsolated);
    setDesktopMode(res.desktopMode);
    setSessionVia(res.sessionVia);
    setUploadLimits(res.uploadLimits);
    setCompanyMode(res.companyMode);
  }, []);

  return (
    <AuthContext.Provider
      value={{
        user,
        previewIsolated,
        desktopMode,
        sessionVia,
        uploadLimits,
        companyMode,
        login,
        logout,
        refresh,
        setUserInfo,
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
