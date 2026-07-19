/**
 * Login page: brand penguin logo above the form + centered large
 * title + full-width primary button. Background is only the circuit-trace animation (the logo belongs to
 * the form area, not the background graphics); top-right corner has language and theme settings (reuses
 * global preferences, defaults to following the device). No open registration: accounts are created by
 * admins in the user backend; first use logs in with the built-in admin account (hinted in the footer).
 */
import { useState } from "react";
import { useNavigate } from "react-router";
import { S } from "../lib/strings";
import { useDocumentTitle } from "../lib/use-document-title";
import { useAuth } from "../state/auth";
import { useLocale } from "../state/locale";
import type { LangPref } from "../state/locale";
import { useTheme } from "../state/theme";
import type { ThemeMode } from "../state/theme";
import { ApiError } from "../api/client";
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
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!userId.trim() || !password) {
      setError(S.common.requiredField);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await login(userId.trim(), password);
      navigate("/chat", { replace: true });
    } catch (e) {
      setError(e instanceof ApiError ? e.message : S.common.unknownError);
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
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              void submit();
            }}
          >
            <Input
              label={S.auth.username}
              value={userId}
              onChange={(e) => setUserId(e.target.value)}
              autoComplete="username"
              autoFocus
            />
            <PasswordInput
              label={S.auth.password}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
            />
            {error && (
              <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-900 dark:bg-red-950/50 dark:text-red-300">
                {error}
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
        </div>
      </div>
    </div>
  );
}
