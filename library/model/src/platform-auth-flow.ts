/**
 * Penguin Go's key-authorization flow vocabulary: the platform's client id and the
 * normalized catalog shapes it publishes, and the wire shapes both key-authorization
 * flows (Penguin Go's and ModelScope's) answer with — deliberately the same, so the App
 * drives both with one dialog. The endpoints stay separate regardless; only the shapes
 * are shared.
 */
import type { DefaultModelOffer } from "./model.js";

export const PLATFORM_CLIENT_ID = "penguin-harness";

// ---------------------------------------------------------------------------
// The platform's model catalog (the normalized shapes Penguin persists)
// ---------------------------------------------------------------------------

/** One platform model, normalized into the fields Penguin persists for a newly discovered row. */
export type {
  PlatformCatalogPricing,
  PlatformCatalogModel,
  PlatformModelCatalog,
  PlatformModelApplyResult,
} from "./model.js";

// ---------------------------------------------------------------------------
// The flow wire shapes (Penguin Go's; ModelScope's are aliases of these)
// ---------------------------------------------------------------------------

/** A started flow: the page to open and when it expires. */
export interface PlatformAuthStartResponse {
  flowId: string;
  authorizeUrl: string;
  expiresAt: string;
}

export type PlatformAuthFlowErrorCode =
  | "unreachable"
  | "upstream_failed"
  | "invalid_key"
  | "expired"
  | "locked"
  | "already_delivered"
  | "apply_failed";

export interface PlatformAuthFlowStatusResponse {
  status: "pending" | "applying" | "completed" | "cancelled" | "apply_failed" | "error";
  error?: PlatformAuthFlowErrorCode;
  applied?: number;
  /** The default model offered on the delivered key (see DefaultModelOffer); on every `completed` answer. */
  defaultOffer?: DefaultModelOffer;
}

/**
 * ModelScope's flow speaks the same shapes: both flows create a request, poll it, and
 * report the same six states and the same seven failure codes. They are aliases rather
 * than a second declaration because a copy would be the same fields with the same
 * meaning, and a shape that drifted apart in one of the two would be a bug rather than a
 * distinction.
 */
export type ModelScopeAuthStartResponse = PlatformAuthStartResponse;
export type ModelScopeAuthFlowErrorCode = PlatformAuthFlowErrorCode;
export type ModelScopeAuthFlowStatusResponse = PlatformAuthFlowStatusResponse;
