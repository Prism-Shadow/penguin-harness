/**
 * The segmented look for filter chips in the activity workspace: a gray track, the chosen
 * chip raised in white. The same look `Segmented` has, for chip rows that wrap or carry
 * counts, which `Segmented`'s fixed columns do not allow.
 */
export const SEGMENTS =
  "inline-flex flex-wrap gap-0.5 rounded-md bg-gray-100 p-0.5 dark:bg-gray-800";
export const SEGMENT = "rounded px-2 py-1 text-xs transition-colors duration-150";
export const SEGMENT_ON =
  "bg-white font-medium text-gray-900 shadow-sm dark:bg-gray-600 dark:text-gray-100";
export const SEGMENT_OFF =
  "text-gray-500 hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-200";
