/**
 * The dismissible "something is waiting" badges: what the pages and the shell import from here.
 * The feature composes other features' answers (the models catalog delta, the cost center's error
 * window) into one badge per nav entry. The trail modules themselves live in `lib/` (the sidebar's
 * dots and the eager badge owner are contributed by the models feature's MainSidebarBadgesModule);
 * this is the feature's re-export face over them.
 */
export { navNoteFor, useUpdateBadges } from "../../lib/use-update-badges";
export { dismissTodo } from "../../lib/todo-dismissals";
export { refreshProjectTodos } from "../../lib/use-project-todos";
export { bulkOutcome, failedList, firstFailure, noticeCounts } from "../../lib/bulk-update";
