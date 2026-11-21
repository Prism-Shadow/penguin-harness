/**
 * Settings › Plugins, the administrator's 「服务端模块请求」 section: every ask to run a library
 * plugin's server module on the server on screen, and what was decided — one row each, newest
 * waiting first. Members leave a request when they install a plugin whose module this server does
 * not run and the build does not ship; a built-in module, or one the administrator installed,
 * is recorded here as enabled the moment it is.
 *
 * A row is one line: the plugin's tile and name, then how it stands — waiting, or enabled and
 * how (built in, by the administrator, approved), or declined — and after it the Project the ask
 * came from, who asked and when, then the actions:
 *
 * - waiting: Enable (lists it for that Project on this server and loads it) and Decline;
 * - enabled: Stop, which asks first — it takes the module off this server's own table of every
 *   Project and keeps installs from bringing it back, while what the Agents carry stays;
 * - declined: Enable.
 *
 * A module behind a system app reads "System app, built in" and has no action: it always runs,
 * and the server refuses to stop it. A preinstalled module's row belongs to every Project, so it
 * names none. A waiting row whose Project is gone can only be declined. The server answers each
 * decision with the whole list, which every reader of it takes at once (lib/plugin-modules.ts);
 * a stop that leaves the module running — a Project's shared table still lists it — says which
 * Projects. The section follows the page's machine picker: requests are kept by each server, and
 * a machine too old to keep them shows no section at all.
 */
import { useEffect, useState } from "react";
import type {
  PluginItem,
  PluginModuleRequest,
  PluginModuleRequestsResponse,
} from "@prismshadow/penguin-server/api";
import {
  Button,
  ConfirmModal,
  ICONS,
  ListRow,
  RuledSection,
  SettingsList,
  StatusMark,
  toastAttention,
  toastSuccess,
  type ToneName,
} from "@prismshadow/penguin-ui";
import * as api from "../../api/endpoints";
import { formatRelativeLong } from "../../lib/format";
import { acceptPluginModuleRequests, usePluginModuleRequests } from "../../lib/plugin-modules";
import { localizedText } from "../../lib/skill-use";
import { S } from "../../lib/strings";
import { toastApiError } from "../../lib/toast-api-error";
import { useLocale } from "../../state/locale";
import { SkillTile } from "../skills";

/** Waiting rows first, newest first; then decided ones, the latest decision first. */
function ordered(requests: readonly PluginModuleRequest[]): PluginModuleRequest[] {
  const at = (r: PluginModuleRequest) => r.decidedAt ?? r.requestedAt;
  return [...requests].sort((a, b) => {
    const waiting = Number(b.decision === null) - Number(a.decision === null);
    return waiting !== 0 ? waiting : at(b).localeCompare(at(a));
  });
}

/** How a row stands, as a status mark: its glyph, tone, word and what it means on hover. */
function stateOf(row: PluginModuleRequest): {
  glyph: string;
  tone?: ToneName;
  label: string;
  hint: string;
} {
  const words = S.settings.moduleRequests;
  if (row.systemApp === true) {
    return {
      glyph: ICONS.checkCircle,
      tone: "success",
      label: words.systemApp,
      hint: words.systemAppHint,
    };
  }
  if (row.decision === null) {
    return { glyph: ICONS.hand, tone: "attention", label: words.waiting, hint: words.waitingHint };
  }
  if (row.decision === "declined") {
    return { glyph: ICONS.stopCircle, label: words.declined, hint: words.declinedHint };
  }
  const via = row.via ?? "admin";
  return {
    glyph: ICONS.checkCircle,
    tone: "success",
    label: words.via[via],
    hint: words.viaHint[via],
  };
}

export function PluginModuleRequests({ machine }: { machine: string | null }) {
  const { locale } = useLocale();
  const ledger = usePluginModuleRequests(machine, true);
  /** The library of the server on screen, by plugin name: each row's tile and display name. */
  const [library, setLibrary] = useState<ReadonlyMap<string, PluginItem>>(new Map());
  /** The package a decision is running for. */
  const [busy, setBusy] = useState<string | null>(null);
  /** The enabled row whose stop waits for its confirmation. */
  const [stopping, setStopping] = useState<PluginModuleRequest | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLibrary(new Map());
    void api.getPluginLibrary(machine).then(
      (res) => {
        if (cancelled) return;
        setLibrary(new Map(res.groups.flatMap((g) => g.plugins).map((p) => [p.name, p])));
      },
      // Without the library a row names its plugin by its name and draws the puzzle tile.
      () => undefined,
    );
    return () => {
      cancelled = true;
    };
  }, [machine]);

  // A machine too old to keep requests (or out of reach) shows no section rather than an error.
  if (ledger.value === null && ledger.error !== null) return null;

  const titleOf = (row: PluginModuleRequest) => {
    const plugin = library.get(row.plugin);
    return plugin === undefined
      ? row.plugin
      : localizedText(locale, plugin.title || row.plugin, plugin.titleZh);
  };
  const words = S.settings.moduleRequests;

  const decide = async (row: PluginModuleRequest, decision: "enable" | "decline") => {
    setBusy(row.package);
    let res: PluginModuleRequestsResponse;
    try {
      res = await api.adminDecidePluginModule({ package: row.package, decision }, machine);
    } catch (e) {
      toastApiError(e);
      setBusy(null);
      return;
    }
    acceptPluginModuleRequests(machine, res);
    setBusy(null);
    setStopping(null);
    const title = titleOf(row);
    const still = res.stillListedBy ?? [];
    if (still.length > 0) {
      toastAttention(words.stillListed(title, still.map((p) => p.projectName).join(words.sep)));
    } else if (decision === "enable") toastSuccess(words.enabledToast(title));
    else if (row.decision === "enabled") toastSuccess(words.stoppedToast(title));
    else toastSuccess(words.declinedToast(title));
  };

  const actionsOf = (row: PluginModuleRequest) => {
    const title = titleOf(row);
    const button = (label: string, run: () => void) => (
      <Button
        key={label}
        size="sm"
        variant="secondary"
        loading={busy === row.package}
        disabled={busy !== null}
        aria-label={`${label} ${title}`}
        onClick={run}
      >
        {label}
      </Button>
    );
    if (row.systemApp === true) return null;
    if (row.decision === "enabled") return button(words.stop, () => setStopping(row));
    const enable =
      row.projectId !== null ? button(words.enable, () => void decide(row, "enable")) : null;
    if (row.decision === "declined") return enable;
    return (
      <>
        {enable}
        {button(words.decline, () => void decide(row, "decline"))}
      </>
    );
  };

  const metaOf = (row: PluginModuleRequest) =>
    [
      ...(row.preinstalled === true && row.projectId === null
        ? []
        : [row.projectName ?? words.projectGone]),
      row.requestedBy === "" ? words.system : (row.requestedByName ?? row.requestedBy),
      formatRelativeLong(row.decidedAt ?? row.requestedAt, locale),
    ].join(" · ");

  const rows = ordered(ledger.value?.requests ?? []);
  return (
    <RuledSection title={words.title} info={words.info} level={3}>
      <SettingsList
        label={words.title}
        loading={ledger.value === null}
        skeletonRows={1}
        empty={words.empty}
      >
        {rows.map((row) => {
          const plugin = library.get(row.plugin);
          const state = stateOf(row);
          return (
            <ListRow
              key={row.package}
              as="li"
              leading={
                <SkillTile
                  icon={plugin?.icon}
                  name={row.plugin}
                  fallback={ICONS.puzzle}
                  size={28}
                  glyph={16}
                />
              }
              title={titleOf(row)}
              titleTrail={
                <span className="text-xs text-fg-muted">
                  <StatusMark
                    glyph={state.glyph}
                    {...(state.tone !== undefined ? { tone: state.tone } : {})}
                    label={state.label}
                    hint={state.hint}
                  />
                </span>
              }
              meta={metaOf(row)}
              trailing={actionsOf(row)}
            />
          );
        })}
      </SettingsList>
      <ConfirmModal
        open={stopping !== null}
        title={stopping === null ? "" : words.stopTitle(titleOf(stopping))}
        tone="danger"
        confirmLabel={words.stop}
        cancelLabel={S.common.cancel}
        busy={busy !== null}
        onClose={() => {
          if (busy === null) setStopping(null);
        }}
        onConfirm={() => {
          if (stopping !== null) void decide(stopping, "decline");
        }}
      >
        <p className="text-sm text-fg-muted">
          {stopping === null ? "" : words.stopBody(titleOf(stopping))}
        </p>
      </ConfirmModal>
    </RuledSection>
  );
}
