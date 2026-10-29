import { useEffect, useState } from "react";
import type { CommandPolicyDto, CommandPolicyRuleDto } from "@prismshadow/penguin-server/api";
import {
  Button,
  ConfirmModal,
  Input,
  SettingRow,
  Switch,
  toastError,
  toastSuccess,
  useFormDraft,
  useSaving,
} from "@prismshadow/penguin-ui";
import * as api from "../../../api/endpoints";
import { S } from "../../../lib/strings";
import { apiErrorText } from "../../../lib/api-error";
import { useInstantSetting } from "../../../lib/instant-setting";
import { PROJECT_SETTINGS_SCOPE } from "./shared";

export function sameRule(a: CommandPolicyRuleDto, b: CommandPolicyRuleDto): boolean {
  return (
    a.name === b.name &&
    a.pattern === b.pattern &&
    (a.description ?? "") === (b.description ?? "") &&
    a.enabled === b.enabled
  );
}

export function RuleEditor({
  initial,
  scope,
  onApply,
  onCancel,
}: {
  initial: CommandPolicyRuleDto | null;
  /** The surface whose leave asks about the typing; a scope of its own when left out. */
  scope?: string;
  onApply: (rule: CommandPolicyRuleDto) => void;
  onCancel: () => void;
}) {
  const form = useFormDraft(
    {
      name: initial?.name ?? "",
      pattern: initial?.pattern ?? "",
      desc: initial?.description ?? "",
    },
    {
      ...(scope !== undefined ? { scope } : {}),
      normalize: (d) => ({ name: d.name.trim(), pattern: d.pattern.trim(), desc: d.desc.trim() }),
    },
  );
  const { name, pattern, desc } = form.draft;
  const [err, setErr] = useState<string | undefined>(undefined);

  const apply = () => {
    const n = name.trim();
    const p = pattern.trim();
    if (!n || !p) return;
    try {
      new RegExp(p);
    } catch {
      setErr(S.project.commandPolicyInvalidPattern);
      return;
    }
    const d = desc.trim();
    onApply({
      name: n,
      pattern: p,
      ...(d !== "" ? { description: d } : {}),
      enabled: initial?.enabled ?? true,
    });
  };

  return (
    <div className="space-y-2 py-3">
      {/* Name and pattern are both mandatory — Apply stays disabled without either — and the red
          "*" is what says so; the description carries no mark because it is optional. The flex
          sizing sits on the wrappers because a labelled Input renders its own <label> block
          around the control, so the control itself is not the flex item. */}
      <div className="flex flex-col gap-2 sm:flex-row">
        <div className="sm:w-40">
          <Input
            size="sm"
            label={S.project.commandPolicyRuleName}
            required
            value={name}
            maxLength={64}
            // The editor mounts only on an explicit Add / Edit click, so taking focus is what
            // that click asked for: it puts the caret in the first field for a keyboard user,
            // and the browser's scroll-on-focus keeps the form in view on a short viewport.
            autoFocus
            onChange={(e) => form.patch({ name: e.target.value })}
          />
        </div>
        <div className="min-w-0 flex-1">
          <Input
            size="sm"
            className="font-mono"
            label={S.project.commandPolicyRulePattern}
            required
            value={pattern}
            maxLength={512}
            {...(err !== undefined ? { error: err } : {})}
            onChange={(e) => {
              form.patch({ pattern: e.target.value });
              if (err) setErr(undefined);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") apply();
            }}
          />
        </div>
      </div>
      <Input
        size="sm"
        label={S.project.commandPolicyRuleDesc}
        value={desc}
        maxLength={300}
        onChange={(e) => form.patch({ desc: e.target.value })}
      />
      <div className="flex justify-end gap-2">
        <Button size="sm" variant="ghost" onClick={onCancel}>
          {S.common.cancel}
        </Button>
        <Button size="sm" disabled={!name.trim() || !pattern.trim()} onClick={apply}>
          {S.project.commandPolicyApplyRule}
        </Button>
      </div>
    </div>
  );
}

export function SecurityPolicySection({
  projectId,
  isOwner,
}: {
  projectId: string;
  isOwner: boolean;
}) {
  const [saved, setSaved] = useState<CommandPolicyDto | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  /** The list's Save is in flight, which holds the dialog's close (the switch's write does not). */
  const [busy, setBusy] = useState(false);
  useSaving(busy, PROJECT_SETTINGS_SCOPE);
  const form = useFormDraft<CommandPolicyRuleDto[]>(saved?.rules ?? [], {
    scope: PROJECT_SETTINGS_SCOPE,
    normalize: (list) =>
      list.map((r) => ({
        name: r.name,
        pattern: r.pattern,
        description: r.description ?? "",
        enabled: r.enabled,
      })),
  });
  const rules = form.draft;
  const setRules = form.setDraft;
  /** The master switch: written alone, with the stored rules, and adopted as the new stored policy. */
  const policySwitch = useInstantSetting(saved?.enabled ?? false, async (next) => {
    if (saved === null) return;
    setSaved(await api.putCommandPolicy(projectId, { enabled: next, rules: saved.rules }));
  });
  const enabled = policySwitch.value;
  /** Index being edited inline, "new" for the add form, null when idle. */
  const [editing, setEditing] = useState<number | "new" | null>(null);
  /** "Restore defaults" awaiting confirmation: it replaces every rule in the list. */
  const [confirmRestore, setConfirmRestore] = useState(false);

  useEffect(() => {
    let cancelled = false;
    // Cleared first: the effect re-fires per project, and the error branch renders ahead of
    // the loaded one — a stale error would outlive a later successful load.
    setSaved(null);
    setLoadError(null);
    setEditing(null);
    api
      .getCommandPolicy(projectId)
      .then((res) => {
        if (!cancelled) setSaved(res);
      })
      .catch((e: unknown) => {
        if (!cancelled) setLoadError(apiErrorText(e));
      });
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  const restoreDefaults = () => {
    if (saved === null) return;
    setRules(saved.defaultRules.map((r) => ({ ...r })));
    setConfirmRestore(false);
  };
  /** Already the factory set: there is nothing to restore, so the button rests disabled. */
  const atDefaults =
    saved !== null &&
    rules.length === saved.defaultRules.length &&
    rules.every((r, i) => sameRule(r, saved.defaultRules[i]!));

  const save = async () => {
    if (busy || !form.dirty || saved === null) return;
    setBusy(true);
    try {
      const stored = await api.putCommandPolicy(projectId, { enabled: saved.enabled, rules });
      setSaved(stored);
      form.adopt(stored.rules);
      toastSuccess(S.common.saved);
    } catch (e) {
      toastError(apiErrorText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      {loadError !== null ? (
        <p className="text-xs text-red-600 dark:text-red-400">{loadError}</p>
      ) : saved === null ? (
        <p className="text-xs text-gray-400">{S.common.loading}</p>
      ) : (
        <>
          <div className="divide-y divide-gray-100 dark:divide-gray-800/60">
            <SettingRow
              title={S.project.commandPolicyEnable}
              description={S.project.commandPolicyEnableDesc}
            >
              {isOwner ? (
                <Switch
                  checked={enabled}
                  aria-label={S.project.commandPolicyEnable}
                  onChange={(next) => void policySwitch.set(next)}
                  disabled={busy || policySwitch.busy}
                />
              ) : (
                <span className="text-xs text-gray-400">
                  {enabled ? S.project.commandPolicyOn : S.project.commandPolicyOff}
                </span>
              )}
            </SettingRow>
          </div>
          {/* The list is inert while the master switch is off. `opacity` alone would leave
              every control focusable, so each one below disables on `!enabled` as well. */}
          <div className={enabled ? "" : "opacity-50"}>
            <div className="flex items-center justify-between gap-2 border-t border-gray-100 py-1.5 dark:border-gray-800/60">
              <p className="text-xs font-medium text-gray-500">
                {S.project.commandPolicyRules} ·{" "}
                <span className="font-semibold">{rules.length}</span>
              </p>
              {isOwner && (
                <div className="flex items-center gap-1">
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={busy || !enabled || editing !== null || atDefaults}
                    onClick={() => setConfirmRestore(true)}
                  >
                    {S.project.commandPolicyRestore}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={busy || !enabled || editing !== null}
                    onClick={() => setEditing("new")}
                  >
                    {S.project.commandPolicyAddRule}
                  </Button>
                </div>
              )}
            </div>
            <div className="divide-y divide-gray-100 dark:divide-gray-800/60">
              {/* The add form opens at the TOP of the list, right under the Add button that
                  asked for it: the factory rules alone make the list taller than the dialog's
                  scroll box, so a form appended after them would open below the fold and the
                  click would look like it did nothing. The rule it applies stays where it was
                  typed for the same reason. Deny rules are order-independent — every enabled
                  match refuses, and list order only picks which rule name the refusal
                  reports — so the head of the list is as good a home as the tail. */}
              {editing === "new" && (
                <RuleEditor
                  initial={null}
                  scope={PROJECT_SETTINGS_SCOPE}
                  onApply={(nr) => {
                    setRules([nr, ...rules]);
                    setEditing(null);
                  }}
                  onCancel={() => setEditing(null)}
                />
              )}
              {rules.map((r, i) =>
                editing === i ? (
                  <RuleEditor
                    key={`edit-${i}`}
                    initial={r}
                    scope={PROJECT_SETTINGS_SCOPE}
                    onApply={(nr) => {
                      setRules(rules.map((x, j) => (j === i ? nr : x)));
                      setEditing(null);
                    }}
                    onCancel={() => setEditing(null)}
                  />
                ) : (
                  <div
                    key={`${r.name}-${i}`}
                    className={`flex items-center gap-3 py-2.5 ${r.enabled ? "" : "opacity-60"}`}
                  >
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium">{r.name}</p>
                      {r.description !== undefined && (
                        <p className="mt-0.5 text-xs text-gray-400">{r.description}</p>
                      )}
                      <p
                        className="mt-0.5 truncate font-mono text-xs text-gray-400"
                        data-tooltip={r.pattern}
                        data-tooltip-content="code"
                      >
                        {r.pattern}
                      </p>
                    </div>
                    {isOwner ? (
                      <div className="flex shrink-0 items-center gap-1.5">
                        <Switch
                          checked={r.enabled}
                          disabled={busy || !enabled}
                          onChange={(v) =>
                            setRules(rules.map((x, j) => (j === i ? { ...x, enabled: v } : x)))
                          }
                        />
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={busy || !enabled || editing !== null}
                          onClick={() => setEditing(i)}
                        >
                          {S.project.commandPolicyEditRule}
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={busy || !enabled || editing !== null}
                          onClick={() => setRules(rules.filter((_, j) => j !== i))}
                        >
                          {S.common.delete}
                        </Button>
                      </div>
                    ) : (
                      <span className="shrink-0 text-xs text-gray-400">
                        {r.enabled ? S.project.commandPolicyOn : S.project.commandPolicyOff}
                      </span>
                    )}
                  </div>
                ),
              )}
              {rules.length === 0 && editing !== "new" && (
                <p className="py-3 text-xs text-gray-400">{S.project.commandPolicyEmpty}</p>
              )}
            </div>
          </div>
          {isOwner && (
            <div className="mt-2 flex justify-end border-t border-gray-100 pt-3 dark:border-gray-800/60">
              {/* Blocked while a rule editor is open, like every other control here: the
                  editor is keyed by index, so a save that replaced the list underneath it
                  would leave a stale draft that Apply then writes over the wrong rule. */}
              <Button
                size="sm"
                disabled={busy || !form.dirty || editing !== null || policySwitch.busy}
                onClick={() => void save()}
              >
                {S.common.save}
              </Button>
            </div>
          )}
        </>
      )}
      <ConfirmModal
        open={confirmRestore}
        title={S.project.commandPolicyRestore}
        onClose={() => setConfirmRestore(false)}
        onConfirm={restoreDefaults}
        confirmLabel={S.project.commandPolicyRestore}
        cancelLabel={S.common.cancel}
      >
        <p className="text-sm text-gray-600 dark:text-gray-300">
          {S.project.commandPolicyRestoreConfirm}
        </p>
      </ConfirmModal>
    </div>
  );
}
