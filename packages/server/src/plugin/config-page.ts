/**
 * The Plugins page's view of the settings groups: the stored entries (`PluginConfigEntries`,
 * config.ts) with what each group's status contributor reports live — notices, actions, enum
 * options this machine cannot honour, values derived for a document saved before a field
 * existed, and whether a backend the group needs is installed. A separate node from the store
 * for the ordering reason config.ts gives: a status contributor (the sandbox's, which reads the
 * sandbox service) is created before this page, and a sandbox backend reading its own group is
 * created after the provider.
 */
import { Interface, Module, Provide, Use } from "@prismshadow/penguin-core/kernel";
import type { ClassCtx, Slot } from "@prismshadow/penguin-core/kernel";
import type { PluginConfigBackend, PluginConfigEntry, PluginConfigNotice } from "../api/types.js";
import {
  PluginConfig,
  PluginConfigEntries,
  PluginConfigError,
  TABLE_ADDED,
  isRecord,
  resolveTable,
} from "./config.js";

/**
 * The code half of a `status` contribution: a group's live notices, asked per read, and the
 * ACTIONS it offers.
 *
 * An action is for what a person cannot express as a field: something the deployment must DO
 * once, on the machine, before the settings above mean anything — the Windows sandbox's local
 * accounts, which need an administrator's consent. Naming the command in a notice puts the work
 * on whoever reads it; an action lets the module do it and report back.
 */
export interface SettingsGroupStatus {
  notices(): PluginConfigNotice[];
  /**
   * After a save of this group or of one drawn inside its card: does what that save sets in
   * motion beyond the group's own watchers, and resolves once it has settled, so the notices
   * the save answers with are current.
   */
  saved?(): Promise<void>;
  /** What this group offers to do, drawn as buttons beneath its notices. */
  actions?(): PluginConfigAction[];
  /**
   * Enum options this machine cannot honour right now: drawn greyed out with the reason, and a
   * save choosing one is refused. Asked per read, like the notices.
   */
  unavailable?(): PluginConfigUnavailable[];
  /** Runs one, by its id. Told what happened, in words the page shows as they are. */
  run?(action: string): Promise<PluginConfigActionResult>;
  /**
   * The values the page reads, with what the group derives for a document saved before one of
   * its fields existed (the sandbox's `enabled`, read off its old mode). Read-side only: the
   * document on disk is never rewritten, and the module applying the group derives the same way
   * from the document it reads. `stored` is that document whole — the stored keys merged onto
   * the defaults, including keys the schema no longer declares, which `values` leaves out.
   */
  derive?(
    values: Record<string, unknown>,
    stored: Record<string, unknown>,
  ): Record<string, unknown>;
  /** For a group a backend plugin enforces: whether one for this OS is installed, and the default. */
  backend?(): PluginConfigBackend;
  /**
   * Completes a save of this group before it is validated and stored: what every save must
   * write besides the fields the page changed. `current` is the group's values as the page
   * reads them (`derive` applied) (the sandbox pins its default preset, so the
   * first save ends a document's pre-preset reading).
   */
  saving?(
    update: Record<string, unknown>,
    current: Record<string, unknown>,
  ): Record<string, unknown>;
}

/** One enum option a settings group cannot honour on this machine, and why. */
export interface PluginConfigUnavailable {
  field: string;
  /** A `table` field's column: the option is unavailable in every cell of that column. */
  column?: string;
  value: string;
  reason: string;
  reasonZh?: string;
}

/** One thing a settings group can do, named for the button that runs it. */
export interface PluginConfigAction {
  id: string;
  title: string;
  titleZh?: string;
  /** What pressing it will do, shown beside the button — a person consents to what they read. */
  description?: string;
  descriptionZh?: string;
}

/** What an action reports: whether it did what it said, and what to tell the person. */
export interface PluginConfigActionResult {
  ok: boolean;
  message: string;
  messageZh?: string;
  /**
   * Work the action started and did not wait for, reported through `progress` notices; it
   * resolves when that work ends. The page node then settles the card the way a save does (a
   * sandbox backend the work made usable loads again). Never sent to the page.
   */
  settled?: Promise<void>;
}

/** What the settings page reads and writes. */
@Interface()
export abstract class PluginConfigAdmin {
  /** Every declared group, in order, with its live notices; values masked. */
  abstract describe(): PluginConfigEntry[];
  /** Validates and stores one update; answers that entry, masked, with its notices once its card's status has settled. */
  abstract set(name: string, update: Record<string, unknown>): Promise<PluginConfigEntry>;
  /** Runs one group's action and says what happened; throws PluginConfigError for an unknown one. */
  abstract run(name: string, action: string): Promise<PluginConfigActionResult>;
}

export interface PluginConfigAdminSlots {
  /** Live notices for a group that has any (`group` names it). */
  status: Slot<{ group: string }, SettingsGroupStatus>;
}

/** The page's view: the stored entries with the live notices their status contributors report. */
@Module()
export class PluginConfigPage {
  @Use() private readonly entries!: PluginConfigEntries;
  /** The stored documents whole, which a group's `derive` reads. */
  @Use() private readonly pluginConfig!: PluginConfig;
  @Provide() pluginConfigAdmin!: PluginConfigAdmin;
  setup({ contributions }: ClassCtx) {
    const entries = this.entries;
    const pluginConfig = this.pluginConfig;
    const status = new Map<string, SettingsGroupStatus>();
    for (const c of contributions.status ?? []) {
      status.set(c.data.group as string, c.code as SettingsGroupStatus);
    }
    const withStatus = (entry: PluginConfigEntry): PluginConfigEntry => {
      const group = status.get(entry.name);
      const notices = group?.notices() ?? [];
      const actions = group?.actions?.() ?? [];
      const unavailable = group?.unavailable?.() ?? [];
      const backend = group?.backend?.();
      return {
        ...entry,
        ...(group?.derive !== undefined
          ? { values: group.derive(entry.values, pluginConfig.get(entry.name)) }
          : {}),
        ...(notices.length > 0 ? { notices } : {}),
        ...(actions.length > 0 ? { actions } : {}),
        ...(unavailable.length > 0 ? { unavailable } : {}),
        ...(backend !== undefined ? { backend } : {}),
      };
    };
    /** A group's values as the page reads them: stored onto defaults, then derived. */
    const readValues = (name: string, group: SettingsGroupStatus) => {
      const values = entries.describe().find((e) => e.name === name)?.values ?? {};
      return group.derive?.(values, pluginConfig.get(name)) ?? values;
    };
    this.pluginConfigAdmin = {
      describe: () => entries.describe().map(withStatus),
      set: async (name, sent) => {
        const group = status.get(name);
        const update =
          group?.saving === undefined ? sent : group.saving(sent, readValues(name, group));
        // An option this machine cannot honour is refused like an invalid value, naming it.
        for (const u of status.get(name)?.unavailable?.() ?? []) {
          if (u.column !== undefined) {
            // A table is saved whole: only a cell the save CHANGES to the value is refused, so
            // one already holding it (a backend went away since) does not block the others.
            const rows = update[u.field];
            const entry = entries.describe().find((e) => e.name === name);
            const field = entry?.configuration.properties[u.field];
            const current =
              field?.type === "table" ? resolveTable(field, entry!.values[u.field]) : [];
            const before = (id: string): Record<string, unknown> =>
              current.find((r) => r.id === id)?.values ?? {};
            // The declared rows' cells, and the added rows (stored whole, so every cell of
            // theirs is "sent").
            const sentRows = isRecord(rows)
              ? { ...rows, ...(isRecord(rows[TABLE_ADDED]) ? rows[TABLE_ADDED] : {}) }
              : {};
            const row = Object.entries(sentRows).find(
              ([id, cells]) =>
                isRecord(cells) &&
                cells[u.column!] === u.value &&
                before(id)[u.column!] !== u.value,
            );
            if (row !== undefined) {
              const at = `${u.field}.${row[0]}.${u.column}`;
              throw new PluginConfigError(
                u.field,
                `"${at}" cannot be "${u.value}" here: ${u.reason}`,
              );
            }
            continue;
          }
          if (update[u.field] === u.value) {
            throw new PluginConfigError(
              u.field,
              `"${u.field}" cannot be "${u.value}" here: ${u.reason}`,
            );
          }
        }
        const saved = entries.set(name, update);
        await status.get(saved.parent ?? name)?.saved?.();
        return withStatus(saved);
      },
      run: async (name, action) => {
        const group = status.get(name);
        const offered = group?.actions?.() ?? [];
        if (group?.run === undefined || !offered.some((a) => a.id === action)) {
          throw new PluginConfigError(null, `"${name}" offers no action "${action}".`);
        }
        const { settled, ...result } = await group.run(action);
        // What the action changed on the machine is settled like a save of its card: the
        // owner's status runs its follow-up (a backend that failed its check loads again).
        const owner = entries.describe().find((e) => e.name === name)?.parent ?? name;
        const settle = async () => {
          await status.get(owner)?.saved?.();
        };
        if (settled === undefined) await settle();
        else void settled.then(settle, settle).catch(() => {});
        return result;
      },
    };
  }
}
