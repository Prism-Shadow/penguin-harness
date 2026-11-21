/**
 * The manage-installs dialog's first row, 「新建空白 Agent」 (plugin-card.tsx): its 「新建并安装」
 * opens the Agents page's Create agent dialog over the list, prefilled for a blank Agent that
 * carries the plugin — the plugin's title in the UI language as the name, the plugin ticked, and
 * this server as the place (the dialog is given no machine, so it offers none). The id is left to
 * the dialog's own ways of getting one: typed, or generated from the name. Everything else is that
 * dialog's as well: its id check, the confirmation a stdio MCP server asks for, its errors. Blank
 * means the default template with nothing installed beyond what the form ticks, and no model or
 * description of its own.
 *
 * Once the Agent exists the page reads it into the list (`BlankAgentSource.onCreated`), the
 * dialog closes, and the list it sat over stays open with the new row reading Installed. One
 * Escape closes the dialog on top and leaves the list: both join the overlays' shared Escape stack.
 */
import type { AgentSummary, PluginItem } from "@prismshadow/penguin-server/api";
import { Button, GlyphIcon, ICONS, ICON_SIZE, toastSuccess } from "@prismshadow/penguin-ui";
import { S } from "../../lib/strings";
import { agentDisplayName } from "../../state/project";
import { CreateAgentDialog, defaultPicks } from "../agents";
import type { CreateAgentDraft, PluginPickItem } from "../agents";

/** What the page hands a card for the row: the picker's library, and how a new Agent joins the list. */
export interface BlankAgentSource {
  /** This server's plugin library as the create dialog's picker rows; null until it is read. */
  library: PluginPickItem[] | null;
  /**
   * The Agent was created: the page reads it into the manage-installs list. Never rejects — the
   * Agent exists whatever a later read says.
   */
  onCreated: (agent: AgentSummary) => Promise<void>;
}

/** The create form's prefill for a blank Agent carrying `plugin`, named `title`. */
export function blankAgentDraft(
  plugin: Pick<PluginItem, "name">,
  title: string,
  library: readonly PluginPickItem[] | null,
): Partial<CreateAgentDraft> {
  // The library's default-install plugins (goal and Plan mode) stay ticked beside this one: a
  // prefilled list is the whole list Create sends, so leaving them out would skip them.
  return { name: title, plugins: [...new Set([...defaultPicks(library), plugin.name])] };
}

/** The first row of the manage-installs list, laid out as the Agent rows under it are. */
export function BlankAgentRow({ disabled, onOpen }: { disabled: boolean; onOpen: () => void }) {
  return (
    <div className="border-b border-line pb-1">
      <div className="flex items-center gap-2 rounded-md px-1.5 py-1.5 transition-colors duration-150 hover:bg-gray-50 dark:hover:bg-gray-800/60">
        <span
          aria-hidden
          className="flex size-[22px] shrink-0 items-center justify-center text-fg-muted"
        >
          <GlyphIcon d={ICONS.robotPlus} size={ICON_SIZE.navRow} />
        </span>
        <span className="min-w-0 flex-1 truncate text-sm">{S.plugins.blankAgent}</span>
        <Button
          size="sm"
          className="shrink-0"
          title={S.plugins.blankAgentHint}
          data-tooltip-extra
          disabled={disabled}
          onClick={onOpen}
        >
          {S.plugins.blankAgentCreate}
        </Button>
      </div>
    </div>
  );
}

/** The Create agent dialog for a blank Agent carrying `plugin`, over the manage-installs list. */
export function BlankAgentDialog({
  plugin,
  title,
  projectId,
  source,
  onClose,
}: {
  plugin: Pick<PluginItem, "name">;
  /** The plugin's title in the UI language: the new Agent's name until the user changes it. */
  title: string;
  projectId: string | null;
  source: BlankAgentSource;
  onClose: () => void;
}) {
  return (
    <CreateAgentDialog
      open
      projectId={projectId}
      library={source.library}
      libraryError={null}
      initial={blankAgentDraft(plugin, title, source.library)}
      onClose={onClose}
      onCreated={async (_agentId, _machineId, agent) => {
        // Read into the list before the dialog closes, so the row is there when the list shows.
        await source.onCreated(agent);
        toastSuccess(S.plugins.blankAgentCreatedToast(agentDisplayName(agent)));
        onClose();
      }}
    />
  );
}
