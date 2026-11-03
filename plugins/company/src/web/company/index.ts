/**
 * Company mode's public face: the company state (work mode, the server's switch, the open
 * organization) for the shell and the features that change with the mode.
 */
export { useCompany } from "./company-state";

<<<<<<< HEAD:packages/web/src/features/company/index.ts
export { parseOrgKey } from "../../lib/company-nav";

export { switchDeskModel } from "./desk-model";
||||||| parent of 432bbe64b1 (refactor(server,web): company mode moves into its functional group package under plugins/):packages/web/src/features/company/index.ts
export { parseOrgKey } from "../../lib/company-nav";
=======
export { parseOrgKey } from "@prismshadow/penguin-web/internal";
>>>>>>> 432bbe64b1 (refactor(server,web): company mode moves into its functional group package under plugins/):plugins/company/src/web/company/index.ts
