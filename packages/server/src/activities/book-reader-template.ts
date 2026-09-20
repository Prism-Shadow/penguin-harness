/** Framework-free native reader state model staged into generated book modules. */
export const bookReaderTemplate = String.raw`
type BookMode = 'readAlong' | 'decodable';
type ReaderState = 'ready' | 'readingDelay' | 'playing' | 'paused' | 'followupWaiting' | 'followupPlaying' | 'wordPlaying' | 'disposed';

type AudioCue = { key: string; script?: string };
type BookScene = {
  id: string;
  role?: 'cover' | 'title' | 'story';
  pageNumber?: number | null;
  media?: { audioCues?: AudioCue[]; narration?: AudioCue | null };
};

type ReaderSnapshot = Readonly<{
  currentIndex: number;
  currentPageId: string | null;
  state: ReaderState;
  visitedPageIds: readonly string[];
  delayedPageIds: readonly string[];
  completedNarrationPageIds: readonly string[];
  activeCueIndex: number | null;
  narrationPaused: boolean;
  wordPlaying: boolean;
  introPlaying: boolean;
  navigationLocked: boolean;
  activityComplete: boolean;
  disposed: boolean;
  readingDelaySeconds: number;
}>;

type ReaderResult = Readonly<{
  snapshot: ReaderSnapshot;
  event: string;
  token?: number;
  cueIndex?: number;
  delayMs?: number;
}>;

type PlaybackResult = ReaderResult & Readonly<{ token: number; cueIndex: number }>;

function visibleWordCount(text: string): number {
  const matches = text.match(/[\p{L}\p{N}]+(?:['\u2019][\p{L}\p{N}]+)*/gu);
  return matches ? matches.length : 0;
}

export class BookReaderModel {
  readonly scenes: readonly BookScene[];
  readonly mode: BookMode;
  readonly readingDelay: Readonly<{ secondsPerWord: number; minimumSeconds: number; maximumSeconds: number }>;
  private currentIndex = 0;
  private state: ReaderState = 'ready';
  private readonly visited = new Set<string>();
  private readonly delayed = new Set<string>();
  private readonly completedNarration = new Set<string>();
  private activeCueIndex: number | null = null;
  private playbackCueCount = 0;
  private playbackToken = 0;
  private delayToken: number | null = null;
  private narrationToken: number | null = null;
  private pausedNarrationToken: number | null = null;
  private wordToken: number | null = null;
  private wordSequence = 0;
  private restorePausedAfterWord = false;
  private readonly followupCompleted = new Set<string>();
  private pendingAutoplayPageId: string | null = null;
  private activityComplete = false;
  private introPlaying = false;
  private disposed = false;

  constructor(scenes: readonly BookScene[], mode: BookMode, readingDelay = { secondsPerWord: 0.5, minimumSeconds: 3, maximumSeconds: 10 }) {
    if (mode !== 'readAlong' && mode !== 'decodable') throw new Error('Book reader mode must be readAlong or decodable.');
    this.scenes = structuredClone(scenes);
    this.mode = mode;
    this.readingDelay = { ...readingDelay };
  }

  get snapshot(): ReaderSnapshot {
    const scene = this.scenes[this.currentIndex];
    return Object.freeze({
      currentIndex: this.currentIndex,
      currentPageId: scene ? scene.id : null,
      state: this.state,
      visitedPageIds: Object.freeze([...this.visited]),
      delayedPageIds: Object.freeze([...this.delayed]),
      completedNarrationPageIds: Object.freeze([...this.completedNarration]),
      activeCueIndex: this.activeCueIndex,
      narrationPaused: this.state === 'paused',
      wordPlaying: this.state === 'wordPlaying',
      introPlaying: this.introPlaying,
      navigationLocked: this.navigationLocked,
      activityComplete: this.activityComplete,
      disposed: this.disposed,
      readingDelaySeconds: this.delaySeconds(scene),
    });
  }

  private get navigationLocked(): boolean {
    return this.introPlaying || this.state === 'playing' || this.state === 'followupWaiting' || this.state === 'followupPlaying' || this.state === 'wordPlaying';
  }

  private currentScene(): BookScene | undefined { return this.scenes[this.currentIndex]; }

  private cues(scene = this.currentScene()): AudioCue[] {
    if (!scene) return [];
    if (Array.isArray(scene.media?.audioCues)) return scene.media.audioCues.slice();
    return scene.media?.narration ? [scene.media.narration] : [];
  }

  private isStory(scene = this.currentScene()): boolean { return scene?.role === 'story'; }

  private delaySeconds(scene = this.currentScene()): number {
    if (!scene || !this.isStory(scene) || this.mode !== 'decodable') return 0;
    const words = visibleWordCount(scene.media?.narration?.script || this.cues(scene)[0]?.script || '');
    return Math.max(this.readingDelay.minimumSeconds, Math.min(this.readingDelay.maximumSeconds, words * this.readingDelay.secondsPerWord));
  }

  private result(event: string, token?: number): ReaderResult {
    return token === undefined ? { snapshot: this.snapshot, event } : { snapshot: this.snapshot, event, token };
  }

  private preparePage(index: number, direct: boolean): ReaderResult {
    const scene = this.scenes[index];
    if (!scene || this.disposed) return this.result(this.disposed ? 'disposed' : 'invalid-page');
    this.stopPlayback();
    this.currentIndex = index;
    this.pendingAutoplayPageId = null;
    if (this.introPlaying) {
      this.pendingAutoplayPageId = scene.id;
      return this.result('autoplay-deferred');
    }
    const firstVisit = !this.visited.has(scene.id);
    this.visited.add(scene.id);
    if (this.mode === 'decodable' && !this.delayed.has(scene.id) && this.isStory(scene) && !this.activityComplete) {
      this.state = 'readingDelay';
      this.delayed.delete(scene.id);
      this.delayToken = this.playbackToken;
      return { snapshot: this.snapshot, event: direct ? 'direct-start-reading-delay' : 'page-reading-delay', token: this.delayToken, delayMs: this.delaySeconds(scene) * 1000 };
    }
    this.delayToken = null;
    this.state = 'ready';
    if (!this.activityComplete && firstVisit && this.cues(scene).length && (this.mode === 'readAlong' || !this.isStory(scene))) {
      return this.result('autoplay-requested');
    }
    if (this.isLastPageWithoutAudio(scene) && this.mode === 'readAlong') {
      return this.completeActivity() ? this.result('activity-completed') : this.result('page-ready');
    }
    return this.result(direct ? 'direct-started' : 'page-ready');
  }

  initialize(): ReaderResult { return this.preparePage(0, false); }
  directStart(index = 0): ReaderResult { return this.preparePage(this.bound(index), true); }

  finishReadingDelay(token: number): ReaderResult {
    if (this.disposed || this.state !== 'readingDelay' || token !== this.delayToken || token !== this.playbackToken) return this.result(this.disposed ? 'disposed' : 'stale-reading-delay');
    const scene = this.currentScene();
    if (scene) this.delayed.add(scene.id);
    this.state = 'ready';
    return this.result('reading-delay-finished');
  }

  next(): ReaderResult { return this.navigate(this.currentIndex + 1, 'next'); }
  previous(): ReaderResult { return this.navigate(this.currentIndex - 1, 'previous'); }

  private navigate(index: number, direction: string): ReaderResult {
    if (this.disposed) return this.result('disposed');
    if (index < 0 || index >= this.scenes.length) return this.result('boundary');
    if (this.navigationLocked || this.state === 'readingDelay') return this.result('navigation-locked');
    const current = this.currentScene();
    if (direction === 'next' && !this.activityComplete && current && this.cues(current).length > 0 && !this.completedNarration.has(current.id)) return this.result('narration-required');
    if (direction === 'next' && this.mode === 'decodable' && !this.activityComplete && current && this.isStory(current) && (!this.delayed.has(current.id) || (this.cues(current).length > 0 && !this.completedNarration.has(current.id)))) return this.result('decodable-reading-gate');
    return this.preparePage(index, false);
  }

  startNarration(): PlaybackResult | ReaderResult {
    if (this.disposed) return this.result('disposed');
    if (this.introPlaying) return this.result('intro-playing');
    if (this.state === 'paused' && this.narrationToken !== null) {
      this.state = 'playing';
      const cueIndex = this.activeCueIndex ?? 0;
      this.activeCueIndex = cueIndex;
      return { snapshot: this.snapshot, event: 'narration-resumed', token: this.narrationToken, cueIndex };
    }
    if (this.state === 'playing' || this.state === 'followupWaiting' || this.state === 'followupPlaying' || this.state === 'wordPlaying') return this.result('narration-busy');
    if (this.state === 'readingDelay') return this.result('reading-delay-required');
    const scene = this.currentScene();
    const cues = this.cues().filter((_cue, index) => index === 0 || !this.followupCompleted.has(scene?.id || ''));
    if (!cues.length) {
      if (this.mode === 'readAlong' && this.isLastPageWithoutAudio()) {
        return this.completeActivity() ? this.result('activity-completed') : this.result('no-narration');
      }
      return this.result('no-narration');
    }
    this.stopPlayback();
    const token = ++this.playbackToken;
    this.narrationToken = token;
    this.activeCueIndex = 0;
    this.playbackCueCount = cues.length;
    this.state = 'playing';
    return { snapshot: this.snapshot, event: 'narration-started', token, cueIndex: 0 };
  }

  pauseNarration(): ReaderResult {
    if (this.disposed) return this.result('disposed');
    if (this.state !== 'playing') return this.result('narration-not-playing');
    this.state = 'paused';
    this.pausedNarrationToken = this.narrationToken;
    return this.result('narration-paused', this.narrationToken ?? undefined);
  }

  resumeNarration(): ReaderResult { return this.startNarration(); }

  finishCue(token: number, success: boolean, cueIndex: number): ReaderResult {
    if (this.disposed || token !== this.narrationToken || token !== this.playbackToken) return this.result('stale-cue');
    if ((this.state !== 'playing' && this.state !== 'followupPlaying') || cueIndex !== this.activeCueIndex) return this.result('stale-cue');
    if (!success) { this.stopPlayback(); return this.result('narration-failed'); }
    const cues = this.cues().slice(0, this.playbackCueCount);
    const cue = this.activeCueIndex ?? 0;
    if (cue === 0 && cues.length > 1) {
      this.state = 'followupWaiting';
      this.activeCueIndex = 1;
      return { snapshot: this.snapshot, event: 'followup-waiting', token, delayMs: 750 };
    }
    if (cue + 1 < cues.length) {
      this.state = 'followupPlaying';
      this.activeCueIndex = cue + 1;
      return this.result('followup-started', token);
    }
    return this.finishNarration(token);
  }

  startFollowup(token: number): ReaderResult {
    if (this.disposed || token !== this.narrationToken || this.state !== 'followupWaiting') return this.result('stale-followup');
    this.state = 'followupPlaying';
    return { snapshot: this.snapshot, event: 'followup-started', token, cueIndex: this.activeCueIndex ?? 1 };
  }

  private finishNarration(token: number): ReaderResult {
    if (token !== this.narrationToken || this.disposed) return this.result('stale-narration');
    const scene = this.currentScene();
    if (scene) this.completedNarration.add(scene.id);
    if (scene) this.followupCompleted.add(scene.id);
    this.state = 'ready';
    this.activeCueIndex = null;
    this.narrationToken = null;
    this.pausedNarrationToken = null;
    if (this.isLastPageWithoutAudio(scene) || (scene && this.currentIndex === this.scenes.length - 1)) {
      if (this.completeActivity()) return this.result('activity-completed');
    }
    return this.result('narration-finished');
  }

  startWord(): ReaderResult {
    if (this.disposed) return this.result('disposed');
    if (this.introPlaying || (this.state !== 'paused' && this.state !== 'ready')) return this.result('word-locked');
    this.restorePausedAfterWord = this.state === 'paused' && this.narrationToken !== null;
    this.wordToken = ++this.wordSequence;
    this.state = 'wordPlaying';
    return this.result('word-started', this.wordToken);
  }

  finishWord(token: number): ReaderResult {
    if (this.disposed || this.state !== 'wordPlaying' || token !== this.wordToken) return this.result(this.disposed ? 'disposed' : 'stale-word');
    this.state = this.restorePausedAfterWord && this.narrationToken === this.pausedNarrationToken ? 'paused' : 'ready';
    this.restorePausedAfterWord = false;
    this.wordToken = null;
    return this.result('word-finished');
  }

  setIntroPlaying(playing: boolean): ReaderResult {
    if (this.disposed) return this.result('disposed');
    if (playing) this.stopPlayback();
    this.introPlaying = playing;
    if (!playing && this.pendingAutoplayPageId === this.currentScene()?.id) {
      this.pendingAutoplayPageId = null;
      return this.preparePage(this.currentIndex, false);
    }
    if (!playing && this.mode === 'decodable' && this.isStory() && !this.delayed.has(this.currentScene()!.id) && !this.activityComplete) return this.preparePage(this.currentIndex, false);
    return this.result(playing ? 'intro-started' : 'intro-finished');
  }

  dispose(): ReaderResult {
    if (this.disposed) return this.result('disposed');
    this.stopPlayback();
    this.disposed = true;
    this.state = 'disposed';
    this.introPlaying = false;
    ++this.playbackToken;
    return this.result('disposed');
  }

  private stopPlayback(): void {
    ++this.playbackToken;
    this.delayToken = null;
    this.narrationToken = null;
    this.pausedNarrationToken = null;
    this.activeCueIndex = null;
    this.playbackCueCount = 0;
    this.restorePausedAfterWord = false;
    this.wordToken = null;
    if (!this.disposed) this.state = 'ready';
  }

  private completeActivity(): boolean {
    if (this.activityComplete) return false;
    this.activityComplete = true;
    return true;
  }
  private isLastPageWithoutAudio(scene = this.currentScene()): boolean {
    return this.currentIndex === this.scenes.length - 1 && this.cues(scene).length === 0;
  }
  private bound(index: number): number { return Math.max(0, Math.min(this.scenes.length - 1, index)); }
}
`;
