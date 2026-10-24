/**
 * Company mode's public face: the company state (work mode, the server's switch, the open
 * organization) for the shell and the features that change with the mode.
 */
export { useCompany } from "./company-state";
export { switchDeskModel } from "./desk-model";

export { parseOrgKey } from "../../lib/company-nav";
