/**
 * Runtime helpers over the sandbox vocabulary — the reads themselves are
 * `@prismshadow/penguin-library-sandbox`; this module re-exports them where the platform
 * bundle has always found them.
 */
export {
  SANDBOX_DIMENSIONS,
  providerDimensions,
  requestedDimensions,
} from "@prismshadow/penguin-library-sandbox/dimensions";
