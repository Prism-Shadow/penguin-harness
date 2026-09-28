/**
 * Deploy (admin only, server-global): where activities are deployed to. A form, not a live
 * surface: nothing is written until Save, which sends only what changed in one PUT; a refused
 * field is marked under itself and nothing is stored. Tokens are never shown: a saved one is
 * reported as saved, an empty field keeps it, and Forget token removes it on the next save.
 *
 * Test connection sits beside each Jenkins and makes one read-only request with the SAVED
 * settings, so it says so rather than testing what is typed but not saved.
 */
import { useEffect, useState } from "react";
import type {
  DeployConnectionTest,
  DeploySettingsView,
  DeployTarget,
} from "@prismshadow/penguin-server/api";
import * as api from "../../api/endpoints";
import { ApiError } from "../../api/client";
import { S } from "../../lib/strings";
import { apiErrorText } from "../../lib/api-error";
import { toneInk } from "../../lib/tone";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { PasswordInput } from "../../components/ui/password-input";
import { toastError, toastInfo, toastSuccess } from "../../components/ui/toast";
import { SectionShell } from "./section-shell";
import {
  DEPLOY_GROUPS,
  deployUpdate,
  emptyTokenDrafts,
  formFromView,
  type DeployFormValues,
  type DeployTokenDrafts,
} from "./deploy-form";

/** A connection test's result in words, and its tone. */
function testLine(test: DeployConnectionTest): { text: string; ok: boolean } {
  const words = S.settings.deploy;
  if (test.ok) return { text: words.testOk(test.status), ok: true };
  if (test.status === 0) return { text: words.testNoAnswer, ok: false };
  return { text: words.testFailed(test.status), ok: false };
}

export function DeploySection() {
  const words = S.settings.deploy;
  const [view, setView] = useState<DeploySettingsView | null>(null);
  const [values, setValues] = useState<DeployFormValues>({});
  const [tokens, setTokens] = useState<DeployTokenDrafts>(emptyTokenDrafts);
  /** The refused field and why, as the server named them. */
  const [fieldError, setFieldError] = useState<{ field: string; reason: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [testing, setTesting] = useState<DeployTarget | null>(null);
  const [tests, setTests] = useState<Partial<Record<DeployTarget, DeployConnectionTest>>>({});

  const adopt = (next: DeploySettingsView) => {
    setView(next);
    setValues(formFromView(next));
    setTokens(emptyTokenDrafts());
    setTests({});
  };

  useEffect(() => {
    let cancelled = false;
    void api
      .adminGetDeploySettings()
      .then((res) => {
        if (!cancelled) adopt(res.settings);
      })
      .catch((e: unknown) => {
        if (!cancelled) toastError(apiErrorText(e));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const save = async () => {
    if (view === null || busy) return;
    const update = deployUpdate(values, view, tokens);
    if (update === null) {
      toastInfo(S.common.noChangesToSave);
      return;
    }
    setBusy(true);
    setFieldError(null);
    try {
      adopt((await api.adminPutDeploySettings(update)).settings);
      toastSuccess(S.common.saved);
    } catch (e) {
      if (e instanceof ApiError && e.code === "invalid_deploy_setting" && e.detail?.field)
        setFieldError({ field: e.detail.field, reason: e.detail.reason ?? "" });
      else toastError(apiErrorText(e));
    } finally {
      setBusy(false);
    }
  };

  const test = async (target: DeployTarget) => {
    setTesting(target);
    try {
      const res = await api.adminTestDeployConnection(target);
      setTests((current) => ({ ...current, [target]: res.test }));
    } catch (e) {
      toastError(apiErrorText(e));
    } finally {
      setTesting(null);
    }
  };

  const hydrated = view !== null;
  const errorFor = (path: string) =>
    fieldError?.field === path ? (words.reasons[fieldError.reason] ?? words.invalid) : undefined;
  return (
    <SectionShell
      actions={
        <Button
          size="sm"
          variant="primary"
          disabled={!hydrated || busy}
          onClick={() => void save()}
        >
          {S.common.save}
        </Button>
      }
    >
      {DEPLOY_GROUPS.map((group) => {
        const target = group.target;
        const result = target ? tests[target] : undefined;
        const line = result ? testLine(result) : null;
        return (
          <fieldset key={group.key} className="space-y-3">
            <legend className="mb-2 text-sm font-semibold">{words.groups[group.key]}</legend>
            {group.fields.map((field) => (
              <Input
                key={field.path}
                label={words[field.label]}
                size="sm"
                value={values[field.path] ?? ""}
                disabled={!hydrated}
                inputMode={field.kind === "minutes" ? "numeric" : undefined}
                {...(field.hint ? { hint: words[field.hint] } : {})}
                {...(errorFor(field.path) ? { error: errorFor(field.path) } : {})}
                onChange={(e) => {
                  const next = e.target.value;
                  setValues((current) => ({ ...current, [field.path]: next }));
                  if (fieldError?.field === field.path) setFieldError(null);
                }}
              />
            ))}
            {target && view && (
              <>
                <PasswordInput
                  label={words.token}
                  size="sm"
                  value={tokens[target].value}
                  disabled={!hydrated}
                  autoComplete="off"
                  {...(tokens[target].forget
                    ? { hint: words.tokenWillClear }
                    : view[target].token.set
                      ? { hint: words.tokenSaved }
                      : {})}
                  {...(errorFor(`${target}.token`) ? { error: errorFor(`${target}.token`) } : {})}
                  onChange={(e) => {
                    const next = e.target.value;
                    setTokens((current) => ({
                      ...current,
                      [target]: { value: next, forget: false },
                    }));
                    if (fieldError?.field === `${target}.token`) setFieldError(null);
                  }}
                />
                <div className="flex flex-wrap items-center gap-2">
                  {view[target].token.set && !tokens[target].forget && (
                    <Button
                      size="sm"
                      disabled={busy}
                      onClick={() =>
                        setTokens((current) => ({
                          ...current,
                          [target]: { value: "", forget: true },
                        }))
                      }
                    >
                      {words.tokenForget}
                    </Button>
                  )}
                  <Button
                    size="sm"
                    disabled={!view[target].jenkinsUrl || testing !== null}
                    aria-busy={testing === target}
                    onClick={() => void test(target)}
                  >
                    {testing === target
                      ? words.testing
                      : words.testConnection(words.targets[target])}
                  </Button>
                  <span className="text-xs text-gray-500 dark:text-gray-400">
                    {words.testUsesSaved}
                  </span>
                </div>
                {line && (
                  <p
                    role="status"
                    className={`text-xs ${line.ok ? toneInk.success : toneInk.danger}`}
                    data-testid={`deploy-test-${target}`}
                  >
                    {line.text}
                  </p>
                )}
              </>
            )}
          </fieldset>
        );
      })}
    </SectionShell>
  );
}
