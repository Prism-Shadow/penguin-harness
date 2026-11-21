/**
 * The server's HTTP vocabulary as a library package: the error shape every route throws
 * and every client reads, the request-validation helpers, the JSON answer rules
 * (validators, compression), the public origin and page CSP, and the Hono env the auth
 * middleware fills. One package, no server dependencies — packages/server imports these;
 * nothing here imports the server.
 */
export {
  HttpError,
  badRequest,
  errorBody,
  handleError,
  isMissingCredential,
  modelCredentialMissing,
} from "./errors.js";
export type { ErrorBody, ErrorDetails } from "./errors.js";
export type { AppEnv } from "./app-env.js";
export {
  pathParam,
  requireValidId,
  parseNonNegativeInt,
  positiveIntParam,
  paginationQuery,
  optionalPagingQuery,
  readJson,
  requireString,
  optionalString,
  optionalStringArray,
  requireProjectDir,
  requireEnum,
  optionalEnum,
  optionalNumber,
  optionalBoolean,
  optionalDateParam,
} from "./validate.js";
export type { StringRule, NumberRule } from "./validate.js";
export { mediaType } from "./media-type.js";
export { isJsonAnswer, replaceAnswer } from "./json-answer.js";
export { COMPRESS_MIN_BYTES, pickEncoding, jsonCompression } from "./json-compression.js";
export { jsonEtag, ifNoneMatchHits, jsonValidators } from "./json-validators.js";
export { settleWithin } from "./settle.js";
export { attributedProjectId } from "./attribution.js";
export {
  publicOrigin,
  publicOriginOf,
  forwardedHeaders,
  isOwnOrigin,
  originRule,
  NO_PROXY_RULE,
  acceptsOrigin,
  sameOriginSite,
} from "./public-origin.js";
export type { ForwardedHeaders, OriginRule } from "./public-origin.js";
export { WEB_APP_CSP } from "./page-csp.js";
