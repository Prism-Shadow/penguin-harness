/**
 * The proposals plugin's web half, the `./web` export the Web App's generated plugin table
 * imports: its module (the page renderer and the event handler) and its endpoint wrappers (the
 * gallery's mock coverage check calls every one).
 */
import * as api from "./api";
import { CompanyProposalsWebModule } from "./module";

// The named halves a test or a host may reach by the same module instance the table boots: the
// page renderer's host component and the session's user-event handler.
export { ProposalsPageHost } from "./module";
export { proposalsUserEvents } from "./context";

export default { modules: [CompanyProposalsWebModule], api };
