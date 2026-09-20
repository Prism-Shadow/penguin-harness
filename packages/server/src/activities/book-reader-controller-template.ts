/** Native adapter coordinator for the generated framework-free book model. */
export const bookReaderControllerTemplate = String.raw`
import { BookReaderModel } from './model.js';

type Snapshot = Readonly<Record<string, unknown>>;
type ModelResult = Readonly<{
  snapshot: Snapshot;
  event: string;
  token?: number;
  cueIndex?: number;
  delayMs?: number;
}>;

type PlaybackOperation = {
  play(): Promise<void>;
  pause(): void;
  resume(): void;
  stop(): void;
};

type BookReaderPort = {
  createCue(sceneId: string, cueIndex: number): PlaybackOperation;
  clock: {
    now(): number;
    setTimeout(callback: () => void, delayMs: number): unknown;
    clearTimeout(handle: unknown): void;
  };
  onChange?(snapshot: Snapshot): void;
  onComplete?(): void;
  onError?(error: unknown): void;
};

export class BookReaderController {
  private readonly model: BookReaderModel;
  private readonly port: BookReaderPort;
  private operation: PlaybackOperation | null = null;
  private operationToken: number | null = null;
  private operationId = 0;
  private timer: unknown = null;
  private timerDueAt = 0;
  private timerKind: 'delay' | 'followup' | null = null;
  private timerToken: number | null = null;
  private timerCueIndex: number | null = null;
  private timerRemainingMs: number | null = null;
  private timerSequence = 0;
  private frameworkPaused = false;
  private resumeOperationAfterFrameworkPause = false;
  private pendingPlayback: { token: number; cueIndex: number; success: boolean; error?: unknown } | null = null;
  private pendingStart: { token: number; cueIndex: number } | null = null;
  private generation = 0;
  private completed = false;
  private disposed = false;

  constructor(model: BookReaderModel, port: BookReaderPort) {
    this.model = model;
    this.port = port;
  }

  initialize(index?: number): Snapshot {
    if (this.disposed) return this.publish(this.model.snapshot);
    this.cancelOwned();
    return this.apply(index === undefined ? this.model.initialize() : this.model.directStart(index));
  }

  next(): Snapshot { return this.changePage(() => this.model.next()); }
  previous(): Snapshot { return this.changePage(() => this.model.previous()); }

  private changePage(change: () => ModelResult): Snapshot {
    if (this.disposed) return this.publish(this.model.snapshot);
    if (this.frameworkPaused) return this.publish(this.model.snapshot);
    const beforeIndex = Number(this.model.snapshot.currentIndex);
    const result = change();
    if (Number(result.snapshot.currentIndex) === beforeIndex) return this.apply(result);
    this.cancelOwned();
    return this.apply(result);
  }

  playPause(): Snapshot {
    if (this.disposed) return this.publish(this.model.snapshot);
    if (this.frameworkPaused) return this.publish(this.model.snapshot);
    const state = String(this.model.snapshot.state || '');
    if (state === 'playing' && this.operation) {
      if (!this.safePause(this.operation)) return this.model.snapshot;
      return this.apply(this.model.pauseNarration());
    }
    if (state === 'paused' && this.operation) {
      const pending = this.pendingPlayback;
      if (!pending && !this.safeResume(this.operation)) return this.model.snapshot;
      this.apply(this.model.resumeNarration());
      if (pending) this.drainPendingPlayback();
      return this.model.snapshot;
    }
    return this.startIntent(this.model.startNarration());
  }

  frameworkPause(): Snapshot {
    if (this.disposed || this.frameworkPaused) return this.publish(this.model.snapshot);
    this.frameworkPaused = true;
    this.resumeOperationAfterFrameworkPause = this.operation !== null && String(this.model.snapshot.state) !== 'paused';
    if (this.operation && this.resumeOperationAfterFrameworkPause) this.safePause(this.operation);
    this.suspendTimer();
    return this.publish(this.model.snapshot);
  }

  frameworkResume(): Snapshot {
    if (this.disposed || !this.frameworkPaused) return this.publish(this.model.snapshot);
    this.frameworkPaused = false;
    const pending = this.pendingPlayback;
    if (!pending && this.operation && this.resumeOperationAfterFrameworkPause) this.safeResume(this.operation);
    this.resumeOperationAfterFrameworkPause = false;
    this.resumeTimer();
    if (pending && String(this.model.snapshot.state) !== 'paused') this.drainPendingPlayback();
    if (!pending && this.pendingStart) {
      const start = this.pendingStart;
      this.pendingStart = null;
      this.startCue(start.token, start.cueIndex);
    }
    return this.publish(this.model.snapshot);
  }

  dispose(): Snapshot {
    if (this.disposed) return this.publish(this.model.snapshot);
    this.cancelOwned();
    this.disposed = true;
    this.frameworkPaused = false;
    return this.apply(this.model.dispose());
  }

  private apply(result: ModelResult): Snapshot {
    this.publish(result.snapshot);
    if (result.event === 'activity-completed' && !this.completed) {
      this.completed = true;
      this.port.onComplete?.();
    }
    if (result.event === 'narration-started') return this.startIntent(result);
    if (result.event === 'autoplay-requested') return this.startIntent(this.model.startNarration());
    if (result.event === 'page-reading-delay' || result.event === 'direct-start-reading-delay') {
      this.scheduleTimer('delay', result.token, undefined, result.delayMs || 0);
    } else if (result.event === 'followup-waiting') {
      this.scheduleTimer('followup', result.token, result.cueIndex ?? 1, result.delayMs || 750);
    } else if (result.event === 'followup-started') {
      this.startCue(result.token, result.cueIndex ?? Number(result.snapshot.activeCueIndex));
    }
    return this.model.snapshot;
  }

  private startIntent(result: ModelResult): Snapshot {
    this.publish(result.snapshot);
    if (result.event === 'narration-started') this.startCue(result.token, result.cueIndex);
    else if (result.event === 'narration-resumed') return result.snapshot;
    else this.apply(result);
    return this.model.snapshot;
  }

  private startCue(token: number | undefined, cueIndex: number | undefined): void {
    if (token === undefined || cueIndex === undefined || this.disposed) return;
    if (this.frameworkPaused) {
      this.pendingStart = { token, cueIndex };
      return;
    }
    this.stopOperation();
    const sceneId = String(this.model.snapshot.currentPageId || '');
    const generation = this.generation;
    const operationId = ++this.operationId;
    try {
      const operation = this.port.createCue(sceneId, cueIndex);
      this.operation = operation;
      this.operationToken = token;
      operation.play().then(
        () => this.cueSettled(generation, operationId, token, cueIndex, operation),
        (error) => this.cueFailed(generation, operationId, token, cueIndex, operation, error),
      );
    } catch (error) {
      this.port.onError?.(error);
      this.stopOperation();
      this.apply(this.model.finishCue(token, false, cueIndex));
    }
  }

  private cueSettled(generation: number, operationId: number, token: number, cueIndex: number, operation: PlaybackOperation): void {
    if (this.disposed || this.frameworkPaused || String(this.model.snapshot.state) === 'paused' || generation !== this.generation || operationId !== this.operationId || token !== this.operationToken || this.operation !== operation) {
      if (!this.disposed && (this.frameworkPaused || String(this.model.snapshot.state) === 'paused') && generation === this.generation && operationId === this.operationId && token === this.operationToken && this.operation === operation) this.pendingPlayback = { token, cueIndex, success: true };
      return;
    }
    this.settleCue(token, cueIndex);
  }

  private settleCue(token: number, cueIndex: number): void {
    if (this.disposed || token !== this.operationToken) return;
    this.stopOperation();
    this.apply(this.model.finishCue(token, true, cueIndex));
  }

  private drainPendingPlayback(): void {
    const pending = this.pendingPlayback;
    if (!pending || this.disposed || this.frameworkPaused || String(this.model.snapshot.state) === 'paused') return;
    this.pendingPlayback = null;
    this.stopOperation();
    if (!pending.success) {
      this.port.onError?.(pending.error);
      this.apply(this.model.finishCue(pending.token, false, pending.cueIndex));
    } else {
      this.apply(this.model.finishCue(pending.token, true, pending.cueIndex));
    }
  }

  private cueFailed(generation: number, operationId: number, token: number, cueIndex: number, operation: PlaybackOperation, error: unknown): void {
    if (this.disposed || generation !== this.generation || operationId !== this.operationId || token !== this.operationToken || this.operation !== operation) return;
    if (this.frameworkPaused) {
      this.pendingPlayback = { token, cueIndex, success: false, error };
      return;
    }
    if (String(this.model.snapshot.state) === 'paused') {
      this.pendingPlayback = { token, cueIndex, success: false, error };
      return;
    }
    this.stopOperation();
    this.port.onError?.(error);
    this.apply(this.model.finishCue(token, false, cueIndex));
  }

  private scheduleTimer(kind: 'delay' | 'followup', token: number | undefined, cueIndex: number | undefined, delayMs: number): void {
    if (this.disposed || token === undefined) return;
    this.clearTimer();
    this.timerKind = kind;
    this.timerToken = token;
    this.timerCueIndex = cueIndex ?? null;
    this.timerRemainingMs = Math.max(0, delayMs);
    this.armTimer();
  }

  private armTimer(): void {
    if (this.timerKind === null || this.timerToken === null || this.frameworkPaused || this.disposed) return;
    const generation = this.generation;
    const sequence = ++this.timerSequence;
    const kind = this.timerKind;
    const token = this.timerToken;
    const cueIndex = this.timerCueIndex;
    const delayMs = this.timerRemainingMs ?? 0;
    this.timerDueAt = this.port.clock.now() + delayMs;
    let handle: unknown;
    handle = this.port.clock.setTimeout(() => {
      if (this.disposed || this.frameworkPaused || generation !== this.generation || sequence !== this.timerSequence || this.timer !== handle) return;
      this.timer = null;
      this.timerKind = null;
      this.timerRemainingMs = null;
      if (kind === 'delay') this.apply(this.model.finishReadingDelay(token));
      else this.apply(this.model.startFollowup(token));
      if (cueIndex !== null && kind === 'followup') void cueIndex;
    }, delayMs);
    this.timer = handle;
  }

  private suspendTimer(): void {
    if (this.timer === null) return;
    this.timerRemainingMs = Math.max(0, this.timerDueAt - this.port.clock.now());
    this.port.clock.clearTimeout(this.timer);
    this.timer = null;
    this.timerSequence += 1;
  }

  private resumeTimer(): void {
    if (this.timerKind !== null && this.timerRemainingMs !== null) this.armTimer();
  }

  private clearTimer(): void {
    if (this.timer !== null) this.port.clock.clearTimeout(this.timer);
    this.timer = null;
    this.timerSequence += 1;
    this.timerKind = null;
    this.timerToken = null;
    this.timerCueIndex = null;
    this.timerRemainingMs = null;
  }

  private stopOperation(): void {
    const operation = this.operation;
    this.operation = null;
    this.operationToken = null;
    if (operation) {
      try { operation.stop(); } catch (error) { this.port.onError?.(error); }
    }
  }

  private safePause(operation: PlaybackOperation): boolean {
    try { operation.pause(); return true; } catch (error) { this.operationControlFailed(error); return false; }
  }

  private safeResume(operation: PlaybackOperation): boolean {
    try { operation.resume(); return true; } catch (error) { this.operationControlFailed(error); return false; }
  }

  private operationControlFailed(error: unknown): void {
    const token = this.operationToken;
    const cueIndex = this.model.snapshot.activeCueIndex;
    this.pendingPlayback = null;
    this.stopOperation();
    this.port.onError?.(error);
    if (token === null || cueIndex === null) return;
    if (this.model.snapshot.state === 'paused') this.model.resumeNarration();
    this.apply(this.model.finishCue(token, false, cueIndex));
  }

  private cancelOwned(): void {
    this.generation += 1;
    this.pendingPlayback = null;
    this.pendingStart = null;
    this.clearTimer();
    this.stopOperation();
  }

  private publish(snapshot: Snapshot): Snapshot {
    this.port.onChange?.(snapshot);
    return snapshot;
  }
}
`;
