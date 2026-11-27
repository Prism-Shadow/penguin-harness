/**
 * The proposals pages' web half: the component the server-contributed proposals page
 * (`org-proposals`) names as its builtin renderer, drawn inside the shell's organization
 * layout; the handler that fans the plugin's events out to the provider below it; and the
 * declaration that these contributions belong to the plugin's running server module — an
 * administrator can stop the plugin, and a server whose Projects all left it out does not run
 * it, which takes this page with it.
 *
 * The provider wraps the whole page: the page and every `proposal:<n>` capsule in its Markdown
 * read one copy of the index (context.tsx).
 */
import type { ComponentType } from "react";
import { useParams } from "react-router";
import { Bind, Module } from "@prismshadow/penguin-core/kernel";
import { ProposalsProvider, proposalsUserEvents } from "./context";
import { OrgProposalsPage } from "./proposals/proposals-page";

export function ProposalsPageHost() {
  const params = useParams<{ projectId?: string; orgId?: string }>();
  if (params.projectId === undefined || params.orgId === undefined) return null;
  return (
    <ProposalsProvider projectId={params.projectId} orgId={params.orgId}>
      <OrgProposalsPage />
    </ProposalsProvider>
  );
}

@Module({
  contributes: {
    "WebAppModule.pageRenderers": [
      { id: "company-proposals.page-renderers", name: "OrgProposalsPage" },
    ],
    "WebAppModule.serverModules": [
      { id: "company-proposals.web", module: "CompanyProposalsPlugin" },
    ],
    "SessionsModule.userEvents": [{ id: "company-proposals.events", order: 25 }],
  },
})
export class CompanyProposalsWebModule {
  // The bind key is the contribution's own id (the kernel checks the two together); the page is
  // found by the renderer NAME the server's page declares (`OrgProposalsPage`).
  @Bind("company-proposals.page-renderers") page = ProposalsPageHost as ComponentType;
  @Bind("company-proposals.events") events = proposalsUserEvents;
}
