/**
 * The company group's web half: the company feature's modules, exported for the web app's
 * composition root to assemble. One module today — the tree the web side boots lists it
 * beside the host's own modules exactly as when it lived in packages/web.
 */
export { CompanyModule } from "./company/module.js";

/**
 * The feature's shared hooks and helpers the host's own pages read directly (the
 * company context, the desk-model switch, the org-key parser), exported beside the
 * module so a host page names one address.
 */
export { useCompany } from "./company/company-state.js";
export { switchDeskModel } from "./company/desk-model.js";
export { parseOrgKey } from "./company/index.js";
