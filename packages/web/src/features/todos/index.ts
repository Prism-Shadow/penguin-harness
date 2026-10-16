/**
 * The dismissible "something is waiting" badges: what the pages import from here (the sidebar's
 * dots are this module's contributions, module.ts).
 * The feature composes other features' answers (the models catalog delta, the cost center's error
 * window) into one badge per nav entry, which is why it lives under `features/` and not `lib/`.
 */
export { useUpdateBadges } from "../../lib/use-update-badges";
export { dismissTodo } from "./todo-dismissals";
export { refreshProjectTodos } from "./use-project-todos";
export { bulkOutcome, failedList, firstFailure, noticeCounts } from "./bulk-update";
