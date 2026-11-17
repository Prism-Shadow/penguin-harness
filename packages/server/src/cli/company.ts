/**
 * The server's own CLI commands, as contributions: one `@Component` per command, whose
 * `contributes["CompanyCommandsModule.commands"]` entry is the command's data half (its key and
 * one-line summary) and whose `@Bind(entry.id)` field is its code half. `CompanyCommandsModule`
 * owns the slot and collects them — other packages can contribute their own commands to
 * the same slot the same way.
 *
 * The host boots this module once per invocation, turns each key into its command node,
 * writes the summary as the node's description, then calls the bound register with that
 * node. A register never names its own path.
 */
import {
  Bind,
  Component,
  Interface,
  Module,
  Provide,
  bootModules,
  moduleDefOf,
} from "@prismshadow/penguin-core/kernel";
import type {
  ClassCtx,
  IfaceTable,
  ManifestTable,
  Resources,
  Slot,
} from "@prismshadow/penguin-core/kernel";
import type {
  CliCommandCode,
  CliCommandData,
  CliCommandProgram,
  CliCommandSummary,
} from "@prismshadow/penguin-core/cli";
import type { Command } from "commander";
import type { Messages } from "./i18n.js";
import table from "../ifaces.json" with { type: "json" };
import { registerOrgCommand } from "./commands/org.js";

/** The node the host located for a key, typed with this package's commander. */
const node = (command: CliCommandProgram): Command => command as Command;

/** `penguin org`. */
@Component({
  contributes: {
    "CompanyCommandsModule.commands": [
      {
        id: "company.org",
        key: "org",
        summary: {
          en: "Company mode: manage an organization (employees, desks, calendar, tickets, channels, finance)",
          zh: "公司模式：管理组织（员工、工位、日程、工单、频道、财务）",
        } satisfies CliCommandSummary,
      },
    ],
  },
})
export class OrgCommand {
  @Bind("company.org") command!: CliCommandCode<Messages>;
  setup() {
    this.command = {
      register: (command, ctx) => {
        registerOrgCommand(node(command), ctx.messages);
      },
    };
  }
}

/** One collected command: its data half and the code half its class bound. */
export interface CompanyCommand {
  readonly id: string;
  readonly key: string;
  readonly summary: CliCommandSummary;
  readonly code: CliCommandCode<Messages>;
}

/** The collector's face: the server's commands, in contribution order (the order help lists them in). */
@Interface()
export abstract class CompanyCommands {
  abstract list(): readonly CompanyCommand[];
}

/** The slot `CompanyCommandsModule` owns: a command's key and summary, and the code half it binds. */
export interface CompanyCommandsSlots {
  commands: Slot<CliCommandData, CliCommandCode<Messages>>;
}

/** Owns the `commands` slot; its children are the server's commands. */
@Module({
  children: [OrgCommand],
})
export class CompanyCommandsModule {
  @Provide() companyCommands!: CompanyCommands;
  setup({ contributions }: ClassCtx) {
    // The kernel checked each entry against the slot's data type at boot, and resolved
    // every code half by its id.
    const commands: CompanyCommand[] = (contributions.commands ?? []).map((c) => ({
      id: c.id,
      key: c.data.key as string,
      summary: c.data.summary as unknown as CliCommandSummary,
      code: c.code as CliCommandCode<Messages>,
    }));
    this.companyCommands = { list: () => commands };
  }
}

/** The commands hold no live resources, so the registry holds nothing. */
const noResources: Resources = {
  register: () => () => {},
  claim: () => undefined,
};

/** Boots `CompanyCommandsModule` against this package's generated table and returns what it collected. */
export async function bootCompanyCommands(): Promise<readonly CompanyCommand[]> {
  const ifaces = table as unknown as IfaceTable & { modules: ManifestTable };
  const root = moduleDefOf(CompanyCommandsModule, { manifests: ifaces.modules });
  const tree = await bootModules(root, { ifaces, resources: noResources });
  try {
    return tree.api<CompanyCommands>("CompanyCommandsModule", "companyCommands").list();
  } finally {
    tree.dispose();
  }
}
