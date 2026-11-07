/**
 * The dismissible "something is waiting" badges: what the pages and the shell import from here.
 * The feature composes other features' answers (the models catalog delta, the cost center's error
 * window) into one badge per nav entry, which is why it lives under `features/` and not `lib/`.
 */
export { navNoteFor, useUpdateBadges } from "./use-update-badges";
export { dismissTodo } from "./todo-dismissals";
export { refreshProjectTodos } from "./use-project-todos";
export { bulkOutcome, failedList, firstFailure, noticeCounts } from "./bulk-update";
