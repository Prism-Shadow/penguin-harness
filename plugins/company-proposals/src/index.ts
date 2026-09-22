/**
 * @prismshadow/penguin-plugin-company-proposals — proposals for company mode.
 *
 * A PLUGIN PACKAGE, not part of the harness: a Project lists it in its config and the
 * harness resolves it from the installation (see the server's plugin/loader.ts). It compiles
 * against the type-only `@prismshadow/penguin-core/plugin` and
 * `@prismshadow/penguin-server/plugin` surfaces and bundles its own copy of Hono for the
 * routes.
 *
 * A proposal is a short, abstract, paragraph-commentable account of a change: a person
 * delegates it to an employee, that employee writes it while another builds it, the person
 * reads, comments in batches and approves, and the build lands as a pull request the
 * proposal links as material. The harness lends this package what it already has — the
 * organization (its people, its channels, an employee's session, the Project's event
 * stream), the settings store, the data root — through the organization gateway; what
 * makes those a proposal lives here: ledger.ts is the append-only record, markdown.ts the
 * document form, service.ts the state machine and the channel messages that drive the
 * employees, routes.ts the API. The page is the web app's own `OrgProposalsPage` renderer,
 * declared here as a company-mode page so it appears — with its nav row — only while the
 * plugin is installed.
 */
import type { Hono } from "hono";
import { Bind, Component, Use } from "@prismshadow/penguin-core/plugin";
import type { ClassCtx, Plugin } from "@prismshadow/penguin-core/plugin";
import type { Log, OrgGateway, Paths, Settings } from "@prismshadow/penguin-server/plugin";
import { ProposalService } from "./service.js";
import { ROUTES_ID, proposalRoutes } from "./routes.js";

export { Ledger, LEDGER_FILE, applyLine, foldLedger, ledgerPath, parseLedger } from "./ledger.js";
export type { LedgerEntry, LedgerLine, LedgerState, Proposal } from "./ledger.js";
export {
  ProposalDocumentError,
  linksToFile,
  parseProposalDocument,
  renderProposalDocument,
} from "./markdown.js";
export type { ProposalDocument } from "./markdown.js";
export {
  MATERIAL_KINDS,
  PLUGIN_NAME,
  PROPOSALS_CHANNEL,
  PROPOSALS_CHANNEL_NAME,
  PROPOSALS_CHANNEL_PURPOSE,
  ProposalError,
  ProposalService,
  slugOf,
} from "./service.js";
export type { ServiceDeps } from "./service.js";
export { ROUTES_ID, proposalRoutes } from "./routes.js";

/** The page contribution's id, as the manifest names it. */
export const PAGE_ID = "company-proposals.page";

/**
 * The plugin's one module: the service over the organization gateway, the settings store
 * and the data root, its routes on the HttpModule.routes slot, its page on the web slot.
 * Its manifest is generated into ifaces.json from here.
 */
@Component({
  contributes: {
    "HttpModule.routes": [
      {
        id: "company-proposals.routes",
        prefix: "/api/projects/:projectId/organizations/:orgId/proposals",
        auth: "user",
        order: 140,
      },
    ],
    "WebModule.pages": [
      {
        id: "company-proposals.page",
        key: "org-proposals",
        path: "proposals/:number?",
        nav: "org",
        admin: false,
        renderer: { builtin: "OrgProposalsPage" },
      },
    ],
    "WebModule.quickStarts": [
      {
        id: "company-proposals.quick-start",
        prompt:
          "Explain how proposals work in this organization — who delegates one, who writes it, who builds it and how the person reviews it — and walk me through the `penguin org proposal` commands an author, an implementer and a tester use.",
        promptZh:
          "讲一讲这个组织里的提案是怎么运转的——谁委托、谁写、谁实施、人怎么审——并带我过一遍作者、实施者与测试者各自会用到的 `penguin org proposal` 命令。",
      },
    ],
  },
  context: { version: 1 },
})
export class CompanyProposalsPlugin {
  @Use("CompanyModule") private readonly gateway!: OrgGateway;
  @Use("RuntimeModule") private readonly paths!: Paths;
  @Use("SettingsModule") private readonly settings!: Settings;
  @Use("RuntimeModule") private readonly log!: Log;
  @Bind(ROUTES_ID) routes!: Hono;

  setup(_ctx: ClassCtx) {
    const service = new ProposalService({
      gateway: this.gateway,
      root: this.paths.root,
      settings: this.settings,
      log: this.log,
    });
    this.routes = proposalRoutes(service);
  }
}

const plugin: Plugin = { modules: [CompanyProposalsPlugin] };

export default plugin;
