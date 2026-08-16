/**
 * Login page: brand penguin logo above the form + centered large
 * title + full-width primary button. Background is only the circuit-trace animation (the logo belongs to
 * the form area, not the background graphics); top-right corner has language and theme settings (reuses
 * global preferences, defaults to following the device). No open registration: accounts are created by
 * admins in the user backend; first use logs in with the built-in admin account (hinted in the footer).
 *
 * Above the form sits the "switch account" half of the flow, in two tiers that must not be confused:
 * - PARKED sessions (/api/auth/sessions): accounts still signed in on this browser, whose tokens the
 *   server holds in an HttpOnly jar. One click enters them, no password — that is the credential
 *   stash, and it never leaves the cookie.
 * - REMEMBERED accounts (known-accounts.ts): ids seen on this machine with no live session left. One
 *   click fills the username and focuses the password box; each row is removable on the spot.
 * Both blocks are absent until this browser has seen a sign-in, so a fresh install opens on the plain form.
 */
import { useEffect, useState } from "react";
import { useNavigate } from "react-router";
import * as api from "../api/endpoints";
import { S } from "../lib/strings";
import { apiErrorText } from "../lib/api-error";
import { accountsForMachine, currentMachine, forgetAccount } from "../lib/known-accounts";
import { useDocumentTitle } from "../lib/use-document-title";
import { useAuth } from "../state/auth";
import { useLocale } from "../state/locale";
import type { LangPref } from "../state/locale";
import { useTheme } from "../state/theme";
import type { ThemeMode } from "../state/theme";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { PasswordInput } from "../components/ui/password-input";
import { PenguinLogo } from "../components/ui/penguin-logo";
import { Segmented } from "../components/ui/segmented";
import { LoginCircuit } from "./login-circuit";

export function LoginPage() {
  useDocumentTitle(S.auth.login);
  const { login } = useAuth();
  const { mode, setMode } = useTheme();
  const { lang, setLang } = useLocale();
  const navigate = useNavigate();
  const [userId, setUserId] = useState("");
  const [password, setPassword] = useState("");
  // Per-field required errors sit next to their input; `form` holds the auth failure (wrong user/password), which isn't specific to one field.
  const [errors, setErrors] = useState<{ userId?: string; password?: string; form?: string }>({});
  const [busy, setBusy] = useState(false);
  const clearErrors = () => setErrors((p) => (p.userId || p.password || p.form ? {} : p));
  /**
   * Accounts remembered for THIS machine, newest first — read once on mount and kept in
   * state so a removal updates the list without a reload. Other machines' accounts are not
   * offered: their passwords belong to a different host, and this form only signs in here.
   * Nothing is prefilled on its own: the page cannot tell "switch account" (where the
   * account you just left is the one you do NOT want) from a plain visit, so choosing stays
   * an explicit click.
   */
  const machine = currentMachine();
  const [accounts, setAccounts] = useState(() => accountsForMachine(machine));

  /**
   * Accounts still signed in on this browser (parked session tokens, held server-side).
   * Entering one costs a click; the password path below is for everything else. An
   * unreachable server just leaves the block out.
   */
  const [parked, setParked] = useState<string[]>([]);
  useEffect(() => {
    let cancelled = false;
    void api
      .getAuthSessions()
      .then((res) => {
        if (!cancelled) setParked(res.sessions.filter((s) => !s.active).map((s) => s.userId));
      })
      .catch(() => {
        if (!cancelled) setParked([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  /**
   * The password box's id. Input is not a forwardRef component, so picking an account moves
   * focus by id rather than threading a ref through PasswordInput -> Input for the one field
   * on this single-purpose page.
   */
  const PASSWORD_FIELD_ID = "login-password";

  /** Remembered account clicked: fill the username and leave the cursor in the password box. */
  const pickAccount = (id: string) => {
    setUserId(id);
    clearErrors();
    document.getElementById(PASSWORD_FIELD_ID)?.focus();
  };

  /**
   * Enter a parked account: the server activates the token it already holds and the app is
   * loaded fresh onto it (a full document load, like every other account switch, so nothing
   * of the previous account survives in this tab). A session that died in the meantime
   * falls back to the form, with the id prefilled.
   */
  const enterParked = async (id: string) => {
    setBusy(true);
    try {
      await api.switchAccount(id);
      window.location.assign("/");
    } catch {
      setParked((prev) => prev.filter((p) => p !== id));
      setErrors({ form: S.auth.switchFailed });
      pickAccount(id);
      setBusy(false);
    }
  };

  /**
   * The remembered ids worth showing: an account that is still signed in is already offered
   * above as a one-click entry, so listing it again under "type your password" would be two
   * rows for one account with different meanings.
   */
  const remembered = accounts.filter((a) => !parked.includes(a.userId));

  /** Per-row remove: drops the account from this browser's memory (the typed username is left alone). */
  const forget = (id: string) => {
    forgetAccount({ machine, userId: id });
    setAccounts(accountsForMachine(machine));
  };

  const submit = async () => {
    const next: { userId?: string; password?: string } = {};
    if (!userId.trim()) next.userId = S.common.requiredField;
    if (!password) next.password = S.common.requiredField;
    if (next.userId || next.password) {
      setErrors(next);
      return;
    }
    setBusy(true);
    setErrors({});
    try {
      await login(userId.trim(), password);
      navigate("/chat", { replace: true });
    } catch (e) {
      setErrors({ form: apiErrorText(e) });
    } finally {
      setBusy(false);
    }
  };

  const themeOptions: ReadonlyArray<{ value: ThemeMode; label: string }> = [
    { value: "light", label: S.settings.themeLight },
    { value: "dark", label: S.settings.themeDark },
    { value: "system", label: S.settings.followSystem },
  ];
  const langOptions: ReadonlyArray<{ value: LangPref; label: string }> = [
    { value: "en", label: S.settings.langEn },
    { value: "zh", label: S.settings.langZh },
    { value: "system", label: S.settings.followSystem },
  ];

  return (
    // relative + overflow-hidden: the circuit-trace background fills this page and clips lines that go out
    // of bounds; the form area uses relative positioning to sit above the background (otherwise the
    // absolutely positioned SVG would render in front of the static content).
    <div className="relative flex min-h-full items-center justify-center overflow-hidden p-4">
      <LoginCircuit />
      {/* Language / theme settings: compact segmented control in the top-right corner (stacks vertically on narrow screens to avoid competing with the form for width). */}
      <div className="absolute right-4 top-4 flex flex-col items-end gap-1.5 sm:flex-row sm:items-center sm:gap-2">
        <div aria-label={S.settings.language}>
          <Segmented options={langOptions} value={lang} onChange={setLang} />
        </div>
        <div aria-label={S.settings.theme}>
          <Segmented options={themeOptions} value={mode} onChange={setMode} />
        </div>
      </div>
      <div className="anim-rise relative w-full max-w-sm">
        {/* Brand penguin logo (part of the form area, not background graphics, so it doesn't clash with the trace animation) */}
        <PenguinLogo className="mx-auto mb-3 h-16 w-16 rounded-2xl" />
        <h1 className="mb-6 text-center text-3xl font-semibold tracking-tight">{S.appName}</h1>

        <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm dark:border-gray-800 dark:bg-gray-900">
          {/* Still signed in: one click and you are in, because the server is holding that
              account's session token — no password, nothing typed. Rendered above the
              remembered ids so the cheap path comes first, and visually distinct (accent
              dot) from rows that will ask for a password. */}
          {parked.length > 0 && (
            <div className="mb-5 border-b border-gray-100 pb-5 dark:border-gray-800">
              <p className="mb-2 text-xs font-semibold text-gray-500 dark:text-gray-400">
                {S.auth.signedInAccounts}
              </p>
              <ul className="space-y-0.5">
                {parked.map((id) => (
                  <li key={id}>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void enterParked(id)}
                      className="flex w-full min-w-0 items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors duration-150 hover:bg-gray-100 disabled:opacity-60 dark:hover:bg-gray-800"
                    >
                      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-gray-900 text-[10px] font-bold text-white dark:bg-gray-200 dark:text-gray-900">
                        {id.slice(0, 1).toUpperCase()}
                      </span>
                      <span className="min-w-0 flex-1 truncate">{id}</span>
                      <span
                        aria-hidden
                        className="h-2 w-2 shrink-0 rounded-full bg-[var(--accent-bg)]"
                      />
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Accounts remembered on this browser: avatar initial + id (the same avatar the
              sidebar's account row uses, so the switch reads as the same object), plus a
              hover-weight remove for a shared machine. The separator below hands the eye
              over to the form, which stays the primary path — an unlisted account is still
              just typed in. */}
          {remembered.length > 0 && (
            <div className="mb-5 border-b border-gray-100 pb-5 dark:border-gray-800">
              <p className="mb-2 text-xs font-semibold text-gray-500 dark:text-gray-400">
                {S.auth.recentAccounts}
              </p>
              <ul className="space-y-0.5">
                {remembered.map(({ userId: id }) => (
                  <li key={id} className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => pickAccount(id)}
                      className={`flex min-w-0 flex-1 items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors duration-150 ${
                        id === userId
                          ? "bg-gray-100 font-medium dark:bg-gray-800"
                          : "hover:bg-gray-100 dark:hover:bg-gray-800"
                      }`}
                    >
                      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-gray-900 text-[10px] font-bold text-white dark:bg-gray-200 dark:text-gray-900">
                        {id.slice(0, 1).toUpperCase()}
                      </span>
                      <span className="min-w-0 truncate">{id}</span>
                    </button>
                    <button
                      type="button"
                      title={S.auth.forgetAccount(id)}
                      aria-label={S.auth.forgetAccount(id)}
                      onClick={() => forget(id)}
                      className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-gray-400 transition-colors duration-150 hover:bg-gray-200/70 hover:text-gray-700 dark:hover:bg-gray-800 dark:hover:text-gray-200"
                    >
                      <svg
                        width={14}
                        height={14}
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.8"
                        strokeLinecap="round"
                        aria-hidden
                      >
                        <path d="M6 6l12 12M18 6L6 18" />
                      </svg>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              void submit();
            }}
          >
            <Input
              label={S.common.username}
              required
              value={userId}
              onChange={(e) => {
                setUserId(e.target.value);
                clearErrors();
              }}
              error={errors.userId}
              autoComplete="username"
              autoFocus
            />
            <PasswordInput
              id={PASSWORD_FIELD_ID}
              label={S.auth.password}
              required
              value={password}
              onChange={(e) => {
                setPassword(e.target.value);
                clearErrors();
              }}
              error={errors.password}
              autoComplete="current-password"
            />
            {errors.form && (
              <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-900 dark:bg-red-950/50 dark:text-red-300">
                {errors.form}
              </p>
            )}
            <Button
              type="submit"
              variant="primary"
              className="w-full justify-center py-2.5 text-sm font-semibold"
              disabled={busy}
            >
              {S.auth.login}
            </Button>
          </form>

          <p className="mt-4 text-center text-xs text-gray-400 dark:text-gray-500">
            {S.auth.defaultAdminNote}
          </p>
          <p className="mt-1.5 text-center text-xs text-gray-400 dark:text-gray-500">
            {S.auth.forgotAdminNote}
          </p>
        </div>
      </div>
    </div>
  );
}
