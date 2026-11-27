/**
 * The retirement, as a node of its own: it contributes to the organization module, so it must
 * not require the organization gateway that module provides (a cycle). It hands the
 * organization to the retirements the plugin's modules registered (org-retire.ts).
 */
import { Bind, Component } from "@prismshadow/penguin-core/plugin";
import { retireRegistered, type OrgRef } from "./org-retire.js";

/** The retirement's contribution id, as the manifest names it. */
export const RETIRE_ID = "company-proposals.retirement";

@Component({
  contributes: {
    "OrganizationModule.retirements": [
      {
        id: "company-proposals.retirement",
        description:
          "Stops the organization's Action runs (deploys among them), PR graph refresh and PR status reads, drops its company workflows, and closes its databases.",
      },
    ],
  },
})
export class ProposalsRetirement {
  @Bind(RETIRE_ID) retire!: (org: OrgRef) => Promise<void>;

  setup() {
    this.retire = retireRegistered;
  }
}
