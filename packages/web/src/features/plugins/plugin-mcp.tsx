/**
 * A plugin's MCP servers on the Plugins page: the marks that say what stands between a server
 * and its tools, the detail dialog's section listing them, the body of the confirm a stdio
 * server asks for on install, and the Set up form that writes the vault values a server waits
 * for.
 *
 * State follows the house rule for status chrome: an icon in its tone, the sentence on hover,
 * no red text. A key is a vault value the server references and the Agent's vault lacks (the
 * server is skipped until it is set); the sign-in mark is an OAuth sign-in this version cannot
 * do; the terminal mark is a stdio server, with the exact command it runs on this server.
 *
 * Set up is the Project owner's (the vault's own rule): one masked field per missing key; a key
 * the vault already holds is named as set, not asked for, so the owner sees which values the
 * plugin's server will receive. Saving rewrites the vault with every existing key kept.
 */
import { useEffect, useState } from "react";
import type {
  PluginItem,
  PluginMcpServerItem,
  PluginSetupKeyItem,
  VaultUpdateRequest,
} from "@prismshadow/penguin-server/api";
import {
  Button,
  GlyphIcon,
  ICONS,
  ICON_GAP,
  ICON_SIZE,
  Modal,
  PasswordInput,
  RuledSection,
  Skeleton,
  toastSuccess,
} from "@prismshadow/penguin-ui";
import * as api from "../../api/endpoints";
import { S } from "../../lib/strings";
import { apiErrorText } from "../../lib/api-error";
import { toneInk, type Tone } from "../../lib/tone";
import { useLocale } from "../../state/locale";
import { localizedText } from "../chat/skill-use";
import { stdioServers } from "./plugin-status";

/** One mark: a glyph in its tone, the sentence on hover and as its accessible name. */
function Mark({ glyph, tone, sentence }: { glyph: string; tone: Tone; sentence: string }) {
  return (
    <span
      role="img"
      aria-label={sentence}
      data-tooltip={sentence}
      data-tooltip-content="text"
      className="inline-flex shrink-0"
    >
      <GlyphIcon d={glyph} size={ICON_SIZE.inlineGlyph} className={toneInk[tone]} />
    </span>
  );
}

/**
 * What stands between a server and its tools, as marks: the vault keys it waits for (with where
 * they are set, when `where` says), the sign-in it needs, and — for a stdio server — the command
 * it runs on this server. Nothing at all for a server that waits for nothing.
 */
export function McpServerMarks({
  keys,
  where,
  signIn,
  command,
}: {
  /** The keys, as the reader should see them (labels where the plugin gives them). */
  keys: readonly string[];
  /** Appended to the needs-setup sentence: where the values go, or who sets them. */
  where?: string;
  signIn: boolean;
  /** A stdio server's command line; absent for a remote one. */
  command?: string;
}) {
  if (keys.length === 0 && !signIn && command === undefined) return null;
  return (
    <span className={`inline-flex shrink-0 items-center ${ICON_GAP.row}`}>
      {keys.length > 0 && (
        <Mark
          glyph={ICONS.key}
          tone="attention"
          sentence={
            where === undefined
              ? S.plugins.mcpNeedsSetup([...keys])
              : `${S.plugins.mcpNeedsSetup([...keys])} · ${where}`
          }
        />
      )}
      {signIn && <Mark glyph={ICONS.signIn} tone="attention" sentence={S.plugins.mcpSignIn} />}
      {command !== undefined && (
        <Mark
          glyph={ICONS.terminalPrompt}
          tone="muted"
          sentence={S.plugins.mcpRunsCommand(command)}
        />
      )}
    </span>
  );
}

/** A setup key as the reader sees it: its label in the UI language, else the key itself. */
export function setupKeyLabel(item: PluginSetupKeyItem, locale: "zh" | "en"): string {
  return item.label !== undefined ? localizedText(locale, item.label, item.labelZh) : item.key;
}

/** Every vault key a plugin's servers need, once each, in the order the servers name them (the first declaration's label wins). */
export function pluginSetupKeys(plugin: Pick<PluginItem, "mcpServers">): PluginSetupKeyItem[] {
  const keys: PluginSetupKeyItem[] = [];
  for (const server of plugin.mcpServers) {
    for (const item of server.setup) {
      if (!keys.some((k) => k.key === item.key)) keys.push(item);
    }
  }
  return keys;
}

/**
 * The detail dialog's section of a plugin's MCP servers, one row each: the plug glyph, the
 * server's name, its transport and its target (in full on hover), then its marks — what it
 * needs before it can connect, whether it needs a sign-in, the command a stdio server runs.
 */
export function PluginMcpSection({ servers }: { servers: readonly PluginMcpServerItem[] }) {
  const { locale } = useLocale();
  return (
    <RuledSection title={S.plugins.detailMcpServers} level={3} className="mt-6">
      <ul className="space-y-1.5">
        {servers.map((server) => (
          <li key={server.name} className={`flex min-w-0 items-center ${ICON_GAP.menu} text-xs`}>
            <GlyphIcon
              d={ICONS.plug}
              size={ICON_SIZE.rowLead}
              className="shrink-0 text-fg-subtle"
            />
            <span className="shrink-0 font-mono text-fg">{server.name}</span>
            <span className="shrink-0 font-mono text-fg-muted">{server.transport}</span>
            <span
              className="min-w-0 flex-1 truncate font-mono text-fg-muted"
              data-tooltip={server.target}
              data-tooltip-content="code"
            >
              {server.target}
            </span>
            <McpServerMarks
              keys={server.setup.map((item) => setupKeyLabel(item, locale))}
              signIn={server.signIn}
              {...(server.transport === "stdio" ? { command: server.target } : {})}
            />
          </li>
        ))}
      </ul>
    </RuledSection>
  );
}

/**
 * What installing a plugin with a stdio server says before it runs: the question, when the
 * confirm is this one's own (the compact confirm card renders no title, so the body asks), then
 * each stdio server with the exact command it runs on this server whenever a session of the
 * Agent starts.
 */
export function StdioInstallBody({
  plugin,
  question,
}: {
  plugin: Pick<PluginItem, "mcpServers">;
  question?: string;
}) {
  return (
    <div className="space-y-2 text-sm">
      {question !== undefined && <p className="font-medium">{question}</p>}
      {stdioServers(plugin).map((server) => (
        <p key={server.name} className="break-words text-fg-muted">
          {S.plugins.installStdioBody(server.name, server.target)}
        </p>
      ))}
    </div>
  );
}

/**
 * The vault the Set up form writes: every key the vault holds, kept as it is (an entry without
 * a value keeps its value), with each key given a value set to it — a new key added, an existing
 * one replaced. A key left empty is not written.
 */
export function setUpVaultEntries(
  existing: readonly string[],
  values: Readonly<Record<string, string>>,
): VaultUpdateRequest["entries"] {
  const given = Object.entries(values).filter(([, value]) => value !== "");
  return [
    ...existing.map((key) => {
      const value = values[key];
      return value !== undefined && value !== "" ? { key, value } : { key };
    }),
    ...given.filter(([key]) => !existing.includes(key)).map(([key, value]) => ({ key, value })),
  ];
}

/** Whether a setup help is a link to open, rather than a sentence to read. */
const isLink = (help: string) => /^https?:\/\//i.test(help);

/**
 * The Set up form (Project owner): one masked field per key the plugin's servers wait for on
 * this Agent; a key the vault already holds is named as set. Saving re-reads the vault's keys and
 * writes them back with the new values (see setUpVaultEntries), then `onSaved` refreshes the
 * Agent's servers.
 */
export function McpSetUpModal({
  projectId,
  agentId,
  agentName,
  title,
  plugin,
  onClose,
  onSaved,
}: {
  projectId: string;
  agentId: string;
  agentName: string;
  /** What the dialogs call the plugin (its card's title). */
  title: string;
  plugin: Pick<PluginItem, "mcpServers">;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { locale } = useLocale();
  const keys = pluginSetupKeys(plugin);
  /** The vault's key names (never a value), once read. */
  const [present, setPresent] = useState<ReadonlySet<string> | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api.getVault(projectId, agentId).then(
      (res) => !cancelled && setPresent(new Set(res.entries.map((entry) => entry.key))),
      (e: unknown) => !cancelled && setError(apiErrorText(e)),
    );
    return () => {
      cancelled = true;
    };
  }, [projectId, agentId]);

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      // Read again right before writing: a key added since the form opened is kept too.
      const fresh = await api.getVault(projectId, agentId);
      await api.putVault(projectId, agentId, {
        entries: setUpVaultEntries(
          fresh.entries.map((entry) => entry.key),
          values,
        ),
      });
      toastSuccess(S.agent.savedTakesEffect);
      onSaved();
      onClose();
    } catch (e) {
      setError(apiErrorText(e));
    } finally {
      setBusy(false);
    }
  };

  const filled = Object.values(values).some((value) => value !== "");
  return (
    <Modal
      open
      title={S.plugins.setUpTitle(title, agentName)}
      onClose={onClose}
      footer={
        <>
          <Button size="sm" onClick={onClose} disabled={busy}>
            {S.common.cancel}
          </Button>
          <Button
            size="sm"
            variant="primary"
            disabled={busy || !filled}
            onClick={() => void save()}
          >
            {S.common.save}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <p className="text-xs text-fg-muted">{S.plugins.setUpDesc}</p>
        {present === null && error === null && <Skeleton className="h-16 w-full" />}
        {present !== null &&
          keys.map((item) =>
            present.has(item.key) ? (
              <p
                key={item.key}
                className={`flex items-center ${ICON_GAP.row} text-xs`}
                data-tooltip={S.plugins.setUpKeySetHint}
                data-tooltip-content="text"
              >
                <span className="font-mono text-fg">{item.key}</span>
                <span className="text-fg-muted">{S.plugins.setUpKeySet}</span>
              </p>
            ) : (
              <div key={item.key} className="space-y-1">
                <PasswordInput
                  size="sm"
                  label={setupKeyLabel(item, locale)}
                  {...(item.help !== undefined && !isLink(item.help) ? { hint: item.help } : {})}
                  value={values[item.key] ?? ""}
                  onChange={(e) => setValues((prev) => ({ ...prev, [item.key]: e.target.value }))}
                  className="font-mono"
                  placeholder={item.key}
                  autoComplete="off"
                />
                {item.help !== undefined && isLink(item.help) && (
                  <a
                    href={item.help}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={`inline-flex items-center ${ICON_GAP.tight} text-xs text-fg-muted hover:text-fg`}
                  >
                    <GlyphIcon d={ICONS.externalLink} size={ICON_SIZE.inlineGlyph} />
                    {S.plugins.setUpHelpLink}
                  </a>
                )}
              </div>
            ),
          )}
        {error !== null && <p className={`text-xs ${toneInk.danger}`}>{error}</p>}
      </div>
    </Modal>
  );
}
