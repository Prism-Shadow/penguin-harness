export const ACTIVITY_STATE_EVENT = 'waf:activity-state-change';
export const ACTIVITY_MEDIA_EVENT = 'waf:activity-media-change';
export const ACTIVITY_INTERACTABLES_EVENT = 'waf:activity-interactables-change';
const DEFAULT_HISTORY_LIMIT = 200;

export interface ActivityStateDetails {
  readonly [key: string]: boolean | number | string | null;
}

export interface ActivityStateRecord {
  readonly details: ActivityStateDetails;
  readonly index: number;
  readonly phase: string;
  readonly sceneId: string;
  readonly state: string;
  readonly timestamp: number;
}

export interface ActivityMediaRecord {
  readonly details: ActivityStateDetails;
  readonly index: number;
  readonly key: string;
  readonly kind: string;
  readonly state: string;
  readonly status: string;
  readonly timestamp: number;
}

export interface ActivityStateSnapshot {
  readonly index: number;
  readonly interactive: boolean;
  readonly phase: string;
  readonly sceneId: string;
  readonly state: string;
}

export interface WaitOptions {
  readonly afterIndex?: number;
  readonly timeoutMs?: number;
}

export interface ActivityStateObserver {
  enter(stateId: string, details?: Record<string, unknown>): ActivityStateRecord;
  getCursor(): number;
  getHistory(): ActivityStateRecord[];
  getMediaCursor(): number;
  getMediaHistory(): ActivityMediaRecord[];
  getSnapshot(): ActivityStateSnapshot;
  recordMedia(kind: string, key: string, status: string, details?: Record<string, unknown>): ActivityMediaRecord;
  subscribe(subscriber: (record: ActivityStateRecord) => void): () => void;
  subscribeMedia(subscriber: (record: ActivityMediaRecord) => void): () => void;
  waitForMedia(kind: string, key: string, status: string, options?: WaitOptions): Promise<ActivityMediaRecord>;
  waitForState(stateId: string, options?: WaitOptions): Promise<ActivityStateRecord>;
}

export interface ActivityStateData {
  activityState?: ActivityStateObserver;
}


function positiveInteger(value: number | undefined, fallback: number): number {
  return Number.isInteger(value) && (value as number) > 0 ? value as number : fallback;
}

export function activityStateParts(stateId: string): { phase: string; sceneId: string } {
  const separatorIndex = typeof stateId === 'string' ? stateId.lastIndexOf('.') : -1;
  const sceneId = separatorIndex > 0 ? stateId.slice(0, separatorIndex) : '';
  const phase = separatorIndex > 0 ? stateId.slice(separatorIndex + 1) : '';
  if (!sceneId || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(phase) || /^(?:state(?:-\d+)?|\d+)$/.test(phase)) {
    throw new Error(`Invalid activity state "${stateId}". Use a semantic <scene-id>.<phase> identifier with a lowercase kebab-case phase.`);
  }
  return { phase, sceneId };
}

function publicDetails(details: Record<string, unknown> | undefined): ActivityStateDetails {
  const allowed: Record<string, boolean | number | string | null> = {};
  for (const [key, value] of Object.entries(details ?? {})) {
    if (value === null || typeof value === 'boolean' || typeof value === 'number' || typeof value === 'string') {
      allowed[key] = value;
    }
  }
  return allowed;
}

function copyStateRecord(record: ActivityStateRecord): ActivityStateRecord {
  return { ...record, details: { ...record.details } };
}

function copyMediaRecord(record: ActivityMediaRecord): ActivityMediaRecord {
  return { ...record, details: { ...record.details } };
}

function appendBounded<T>(history: T[], record: T, limit: number): void {
  history.push(record);
  if (history.length > limit) {
    history.splice(0, history.length - limit);
  }
}

function dispatchRootEvent(root: HTMLElement, eventName: string, detail: unknown): void {
  if (typeof root.dispatchEvent === 'function' && typeof CustomEvent === 'function') {
    root.dispatchEvent(new CustomEvent(eventName, { detail }));
  }
}

function notifySubscribers<T>(
  subscribers: ReadonlySet<(record: T) => void>,
  record: T,
  copyRecord: (record: T) => T,
): void {
  subscribers.forEach((subscriber) => {
    try {
      subscriber(copyRecord(record));
    } catch (error) {
      console.error('Activity state observer failed.', error);
    }
  });
}

export function createActivityState(
  root: HTMLElement,
  initialState: string,
  options: { readonly historyLimit?: number } = {},
): ActivityStateObserver {
  if (!root?.dataset) {
    throw new Error('Activity state requires the generated activity root element.');
  }
  const limit = positiveInteger(options.historyLimit, DEFAULT_HISTORY_LIMIT);
  const stateHistory: ActivityStateRecord[] = [];
  const mediaHistory: ActivityMediaRecord[] = [];
  const stateSubscribers = new Set<(record: ActivityStateRecord) => void>();
  const mediaSubscribers = new Set<(record: ActivityMediaRecord) => void>();
  let stateCursor = 0;
  let mediaCursor = 0;
  let currentState = '';

  const enter = (stateId: string, details: Record<string, unknown> = {}): ActivityStateRecord => {
    const parts = activityStateParts(stateId);
    const safeDetails = publicDetails(details);
    stateCursor += 1;
    currentState = stateId;
    root.dataset.activityState = stateId;
    root.dataset.activityScene = parts.sceneId;
    root.dataset.activityPhase = parts.phase;
    root.dataset.activityStateIndex = String(stateCursor);
    root.dataset.activityInteractive = safeDetails.interactive === true ? 'true' : 'false';
    const record: ActivityStateRecord = {
      details: safeDetails,
      index: stateCursor,
      phase: parts.phase,
      sceneId: parts.sceneId,
      state: stateId,
      timestamp: Date.now(),
    };
    appendBounded(stateHistory, record, limit);
    dispatchRootEvent(root, ACTIVITY_STATE_EVENT, copyStateRecord(record));
    notifySubscribers(stateSubscribers, record, copyStateRecord);
    return copyStateRecord(record);
  };

  const recordMedia = (
    kind: string,
    key: string,
    mediaStatus: string,
    details: Record<string, unknown> = {},
  ): ActivityMediaRecord => {
    if (!kind || !key || !mediaStatus) {
      throw new Error('Activity media observations require kind, key, and status.');
    }
    mediaCursor += 1;
    const record: ActivityMediaRecord = {
      details: publicDetails(details),
      index: mediaCursor,
      key,
      kind,
      state: currentState,
      status: mediaStatus,
      timestamp: Date.now(),
    };
    appendBounded(mediaHistory, record, limit);
    dispatchRootEvent(root, ACTIVITY_MEDIA_EVENT, copyMediaRecord(record));
    notifySubscribers(mediaSubscribers, record, copyMediaRecord);
    return copyMediaRecord(record);
  };

  const observer: ActivityStateObserver = {
    enter,
    getCursor: () => stateCursor,
    getHistory: () => stateHistory.map(copyStateRecord),
    getMediaCursor: () => mediaCursor,
    getMediaHistory: () => mediaHistory.map(copyMediaRecord),
    getSnapshot: () => {
      const parts = activityStateParts(currentState);
      return {
        index: stateCursor,
        interactive: root.dataset.activityInteractive === 'true',
        phase: parts.phase,
        sceneId: parts.sceneId,
        state: currentState,
      };
    },
    recordMedia,
    subscribe(subscriber) {
      stateSubscribers.add(subscriber);
      return () => stateSubscribers.delete(subscriber);
    },
    subscribeMedia(subscriber) {
      mediaSubscribers.add(subscriber);
      return () => mediaSubscribers.delete(subscriber);
    },
    waitForMedia(kind, key, mediaStatus, waitOptions = {}) {
      const afterIndex = Number.isInteger(waitOptions.afterIndex) ? waitOptions.afterIndex as number : -1;
      const existing = mediaHistory.find((record) => record.index > afterIndex && record.kind === kind && record.key === key && record.status === mediaStatus);
      if (existing) {
        return Promise.resolve(copyMediaRecord(existing));
      }
      return new Promise((resolve, reject) => {
        const timeoutMs = positiveInteger(waitOptions.timeoutMs, 15_000);
        let timeoutId: ReturnType<typeof globalThis.setTimeout> | undefined;
        const unsubscribe = observer.subscribeMedia((record) => {
          if (record.index > afterIndex && record.kind === kind && record.key === key && record.status === mediaStatus) {
            if (timeoutId !== undefined) clearTimeout(timeoutId);
            unsubscribe();
            resolve(record);
          }
        });
        timeoutId = globalThis.setTimeout(() => {
          unsubscribe();
          reject(new Error(`Timed out waiting for ${kind} "${key}" to reach "${mediaStatus}".`));
        }, timeoutMs);
      });
    },
    waitForState(stateId, waitOptions = {}) {
      activityStateParts(stateId);
      const afterIndex = Number.isInteger(waitOptions.afterIndex) ? waitOptions.afterIndex as number : -1;
      const existing = stateHistory.find((record) => record.index > afterIndex && record.state === stateId);
      if (existing) {
        return Promise.resolve(copyStateRecord(existing));
      }
      return new Promise((resolve, reject) => {
        const timeoutMs = positiveInteger(waitOptions.timeoutMs, 15_000);
        let timeoutId: ReturnType<typeof globalThis.setTimeout> | undefined;
        const unsubscribe = observer.subscribe((record) => {
          if (record.index > afterIndex && record.state === stateId) {
            if (timeoutId !== undefined) clearTimeout(timeoutId);
            unsubscribe();
            resolve(record);
          }
        });
        timeoutId = globalThis.setTimeout(() => {
          unsubscribe();
          reject(new Error(`Timed out waiting for activity state "${stateId}".`));
        }, timeoutMs);
      });
    },
  };

  enter(initialState, { cause: 'initialize', interactive: false });
  return observer;
}

export function initializeActivityState<TData extends ActivityStateData>(
  data: TData,
  root: HTMLElement,
  initialState: string,
  options?: { readonly historyLimit?: number },
): ActivityStateObserver {
  data.activityState = createActivityState(root, initialState, options);
  return data.activityState;
}

export function enterActivityState(
  data: ActivityStateData,
  stateId: string,
  details?: Record<string, unknown>,
): ActivityStateRecord {
  if (!data.activityState) {
    throw new Error('Activity state must be initialized before entering a behavior state.');
  }
  return data.activityState.enter(stateId, details);
}

export function recordActivityMedia(
  data: ActivityStateData,
  kind: string,
  key: string,
  status: string,
  details?: Record<string, unknown>,
): ActivityMediaRecord | null {
  return data.activityState?.recordMedia(kind, key, status, details) ?? null;
}
