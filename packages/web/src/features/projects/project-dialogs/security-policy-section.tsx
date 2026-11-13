import { useEffect, useState } from "react";
import type {
  CommandPolicyActionDto,
  CommandPolicyDto,
  CommandPolicyRuleDto,
} from "@prismshadow/penguin-server/api";
import {
  Button,
  ConfirmModal,
  FieldLegend,
  Input,
  Pager,
  Segmented,
  SettingRow,
  Switch,
  toastError,
  toastSuccess,
  useFormDraft,
  useSaving,
} from "@prismshadow/penguin-ui";
import { ApiError } from "../../../api/client";
import * as api from "../../../api/endpoints";
import { S } from "../../../lib/strings";
import { apiErrorText } from "../../../lib/api-error";
import { toastApiError } from "../../../lib/toast-api-error";
import { useInstantSetting } from "../../../lib/instant-setting";
import { PROJECT_SETTINGS_SCOPE } from "./shared";
import { RuleTable, pageCountOf, pageOf, type RejectedRule } from "./command-policy-table";

/**
 * The row a refused Save is about: the server answers a pattern it cannot compile with that
 * rule's place in the list it was sent, its name and the engine's reason. Null for any other
 * failure, or when that place does not hold that rule.
 */
function refusedPattern(
  err: unknown,
  sent: CommandPolicyRuleDto[],
): { index: number; reason: string } | null {
  if (!(err instanceof ApiError) || err.code !== "invalid_rule_pattern") return null;
  const index = Number(err.details?.index);
  if (!Number.isInteger(index) || sent[index]?.name !== err.details?.rule) return null;
  return { index, reason: err.details?.reason ?? "" };
}

/** Field-level equality for the security page's dirty check (description "" ≡ absent, action deny ≡ absent). */
export function sameRule(a: CommandPolicyRuleDto, b: CommandPolicyRuleDto): boolean {
  return (
    a.name === b.name &&
    a.pattern === b.pattern &&
    (a.description ?? "") === (b.description ?? "") &&
    a.enabled === b.enabled &&
    (a.action ?? "deny") === (b.action ?? "deny")
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
      action: initial?.action ?? ("deny" as CommandPolicyActionDto),
    },
    {
      ...(scope !== undefined ? { scope } : {}),
      normalize: (d) => ({
        name: d.name.trim(),
        pattern: d.pattern.trim(),
        desc: d.desc.trim(),
        action: d.action,
      }),
    },
  );
  const { name, pattern, desc, action } = form.draft;
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
      // Stored only where it departs from the default, as the server serves it back.
      ...(action === "ask" ? { action } : {}),
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
      {/* What a hit does: refuse it, or wait for a person whatever the approval mode. The
          fieldset's legend names the two options as one question. */}
      <fieldset className="min-w-0 sm:w-56">
        <FieldLegend>{S.project.commandPolicyRuleAction}</FieldLegend>
        <Segmented<CommandPolicyActionDto>
          cols={2}
          value={action}
          onChange={(next) => form.patch({ action: next })}
          options={[
            { value: "deny", label: S.project.commandPolicyActionDeny },
            { value: "ask", label: S.project.commandPolicyActionAsk },
          ]}
        />
      </fieldset>
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
        action: r.action ?? "deny",
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
  /** The table's page; held past the last page only until the next render clamps it. */
  const [page, setPage] = useState(0);
  const pageCount = pageCountOf(rules.length);
  const shownPage = Math.min(page, pageCount - 1);
  /** The rule the last Save was refused over, marked on its row until that row changes. */
  const [rejected, setRejected] = useState<RejectedRule | null>(null);

  useEffect(() => {
    let cancelled = false;
    // Cleared first: the effect re-fires per project, and the error branch renders ahead of
    // the loaded one — a stale error would outlive a later successful load.
    setSaved(null);
    setLoadError(null);
    setEditing(null);
    setPage(0);
    setRejected(null);
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
    setPage(0);
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
      setRejected(null);
      toastSuccess(S.common.saved);
    } catch (e) {
      // A pattern the server cannot compile may sit on a page the person is not looking at:
      // turn to it and mark its row, so the toast's rule name has somewhere to point.
      const refused = refusedPattern(e, rules);
      if (refused === null) {
        toastApiError(e);
      } else {
        setRejected({ rule: rules[refused.index]!, reason: refused.reason });
        setPage(pageOf(refused.index));
        toastError(
          S.project.commandPolicyPatternRejected(rules[refused.index]!.name, refused.reason),
        );
      }
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
                {S.project.commandPolicyRules} <span className="font-semibold">{rules.length}</span>
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
            {/* The add form opens above the table, right under the Add button that asked for
                it, whichever page is showing; the rule it applies goes to the head of the list,
                so the table turns to the first page to show it there. The rules are
                order-independent — a deny match refuses wherever it sits, even past an ask
                match, and list order only picks which rule name a decision reports — so the
                head of the list is as good a home as the tail. */}
            {editing === "new" && (
              <RuleEditor
                initial={null}
                scope={PROJECT_SETTINGS_SCOPE}
                onApply={(nr) => {
                  setRules([nr, ...rules]);
                  setPage(0);
                  setEditing(null);
                }}
                onCancel={() => setEditing(null)}
              />
            )}
            {rules.length === 0 && editing !== "new" ? (
              <p className="border-t border-line-muted py-3 text-xs text-fg-muted">
                {S.project.commandPolicyEmpty}
              </p>
            ) : (
              <RuleTable
                rules={rules}
                page={shownPage}
                isOwner={isOwner}
                locked={busy || !enabled}
                editing={editing}
                rejected={rejected}
                editor={(i) => (
                  <RuleEditor
                    initial={rules[i]!}
                    scope={PROJECT_SETTINGS_SCOPE}
                    onApply={(nr) => {
                      setRules(rules.map((x, j) => (j === i ? nr : x)));
                      setEditing(null);
                    }}
                    onCancel={() => setEditing(null)}
                  />
                )}
                onToggle={(i, v) =>
                  setRules(rules.map((x, j) => (j === i ? { ...x, enabled: v } : x)))
                }
                onEdit={setEditing}
                onDelete={(i) => {
                  setRules(rules.filter((_, j) => j !== i));
                  setPage(Math.min(shownPage, pageCountOf(rules.length - 1) - 1));
                }}
              />
            )}
          </div>
          {/* Under the table, held to the dialog's bottom edge while the rows scroll beneath it,
              so Save is in reach however many rules the page shows. A sticky box stops short of
              its scroller's padding, so it reaches 1rem (the dialog body's bottom padding) past
              it and pads that back inside — no row shows through below it — and the negative
              margin gives the same 1rem back where it rests at the end of the list. Its fill is
              the dialog's own. The page steps rest while a rule editor is open: the editor
              belongs to a row of the page it was opened on. */}
          {(isOwner || pageCount > 1) && (
            <div className="sticky -bottom-4 z-sticky-head -mb-4 flex min-h-10 items-center justify-between gap-2 border-t border-line-muted bg-overlay pt-2 pb-6">
              {pageCount > 1 ? (
                <Pager
                  page={shownPage}
                  pageCount={pageCount}
                  onChange={setPage}
                  disabled={editing !== null}
                  className="-ml-1.5"
                />
              ) : (
                <span />
              )}
              {isOwner && (
                // Blocked while a rule editor is open, like every other control here: the
                // editor is keyed by index, so a save that replaced the list underneath it
                // would leave a stale draft that Apply then writes over the wrong rule.
                <Button
                  size="sm"
                  disabled={busy || !form.dirty || editing !== null || policySwitch.busy}
                  onClick={() => void save()}
                >
                  {S.common.save}
                </Button>
              )}
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
