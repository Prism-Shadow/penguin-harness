/**
 * The Session listing rule and the source vocabulary moved to the session domain package
 * (@prismshadow/penguin-library-session/listing, services+http+cli restack S9, then moved to
 * the session package by S14, whose services speak it at runtime). This file re-exports them
 * unchanged for the trace package's own import paths and every consumer of
 * `@prismshadow/penguin-library-trace/listing`.
 */
export {
  ADOPTED_AT_HEADER,
  BACKGROUND_SOURCES,
  listCategory,
  listingMarksOf,
  listingViewOf,
  readRecordedSource,
  sourceSeenBy,
  unrunSource,
} from "@prismshadow/penguin-library-session/listing";
export type {
  ListingMarks,
  ListingView,
  RecordedSource,
} from "@prismshadow/penguin-library-session/listing";
