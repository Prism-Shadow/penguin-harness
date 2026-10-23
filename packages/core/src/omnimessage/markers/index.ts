/**
 * Special message markers ([user_steering], [use_skills], [handoff_from], …) — every marker the
 * product writes into message text, with its producers and parsers.
 *
 * The module lives in `@prismshadow/amsp` (`packages/amsp/src/omnimessage/markers/`), beside the
 * records whose text carries the markers; its head describes the three families and the
 * consumption boundary core keeps (core builds markers but never branches on them). This entry
 * re-exports it, so `@prismshadow/penguin-core/markers` keeps working.
 */
export * from "@prismshadow/amsp/markers";
