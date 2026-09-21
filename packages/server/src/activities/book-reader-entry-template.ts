/** Native WAF entry for generated book modules: intro, reader and completion. */
export const bookReaderEntryTemplate = String.raw`
import { bootstrapStateMachine } from 'waf-state-machine';
import type {
    StateMachineAction,
    StateMachineImplementations,
    StateMachineRuntime,
} from 'waf-state-machine';
import { clearRepeatAudio, createAudioEvents, htmlToElement } from 'waf-utils';
import { EVENTS } from 'pubsubsingleton';
import { BookReaderModel } from './book-reader/model.js';
import { BookReaderController } from './book-reader/controller.js';
import {
    createBookReaderView,
    type BookReaderView,
    type BookViewControl,
} from './book-reader/view.js';
import {
    connectBookReaderLifecycle,
    cueKeysForScene,
    narrationEventsFromScene,
    type BookReaderLifecycle,
} from './book-reader/adapter.js';
import {
    createImageElement,
    createTimedAudioOperation,
    createVideoOperation,
    pauseTimedAudioOperation,
    playVideoOperation,
    resolveMediaAsset,
    resumeTimedAudioOperation,
    suspendTimedAudioTiming,
} from './runtime/media.js';
import {
    configurationValue,
    languageCodeFromData,
} from './runtime/media/configuration.js';
import type { ActivityContext } from './activity/context.js';

const BOOK_COMPLETE_EVENT = 'BOOK.COMPLETED';
const DEFAULT_READING_DELAY = { secondsPerWord: 0.5, minimumSeconds: 3, maximumSeconds: 10 };

type BookNarration = {
    key: string;
    script?: string;
    timings?: readonly unknown[];
    words?: readonly unknown[];
};

type BookCompiledScene = {
    id: string;
    role?: 'cover' | 'title' | 'story';
    pageNumber?: number | null;
    media?: {
        image?: { key?: string; alt?: string } | null;
        narration?: BookNarration | null;
        audioCues?: readonly { key: string }[];
    };
};

type BookPolicy = {
    mode: 'readAlong' | 'decodable';
    readingDelay: { secondsPerWord: number; minimumSeconds: number; maximumSeconds: number };
    introVideoKey?: string;
};

function asObject(value: unknown): Record<string, unknown> {
    return value && typeof value === 'object' && !Array.isArray(value)
        ? value as Record<string, unknown>
        : {};
}

function bookPolicyOf(data: ActivityContext): BookPolicy {
    const book = asObject(configurationValue(data, 'book'));
    const delay = asObject(book.readingDelay);
    return {
        mode: book.mode === 'decodable' ? 'decodable' : 'readAlong',
        readingDelay: {
            secondsPerWord: typeof delay.secondsPerWord === 'number' ? delay.secondsPerWord : DEFAULT_READING_DELAY.secondsPerWord,
            minimumSeconds: typeof delay.minimumSeconds === 'number' ? delay.minimumSeconds : DEFAULT_READING_DELAY.minimumSeconds,
            maximumSeconds: typeof delay.maximumSeconds === 'number' ? delay.maximumSeconds : DEFAULT_READING_DELAY.maximumSeconds,
        },
        introVideoKey: typeof book.introVideoKey === 'string' ? book.introVideoKey : undefined,
    };
}

function compiledScenesOf(data: ActivityContext): BookCompiledScene[] {
    const configuration = asObject(data.configuration);
    const selected = asObject(configuration[languageCodeFromData(data)]);
    const fallback = asObject(configuration['en-US']);
    const scenes = Array.isArray(selected.scenes)
        ? selected.scenes
        : Array.isArray(fallback.scenes) ? fallback.scenes : [];
    return scenes.map((scene) => asObject(scene) as unknown as BookCompiledScene);
}

function previewStartSceneId(data: ActivityContext): string | null {
    const preview = asObject(asObject(data.configuration).__loomPreview);
    return typeof preview.startSceneId === 'string' ? preview.startSceneId : null;
}

type PlaybackOperation = {
    play(): Promise<void>;
    pause(): void;
    resume(): void;
    stop(): void;
};

let stateMachineRef: { stop(): unknown } | null = null;
let runtimeRef: StateMachineRuntime<ActivityContext> | null = null;
let dataRef: ActivityContext | null = null;
let modelRef: BookReaderModel | null = null;
let controllerRef: BookReaderController | null = null;
let viewRef: BookReaderView | null = null;
let lifecycleRef: BookReaderLifecycle | null = null;
let scenesRef: BookCompiledScene[] = [];
let shownSceneId: string | null = null;
let shownPageIndex = -1;
let highlightedOccurrence: number | null = null;
let detachKeyboard: (() => void) | null = null;

function unavailableOperation(message: string): PlaybackOperation {
    return {
        play: () => Promise.reject(new Error(message)),
        pause() {},
        resume() {},
        stop() {},
    };
}

function createCue(sceneId: string, cueIndex: number): PlaybackOperation {
    if (!dataRef) return unavailableOperation('The book reader is not ready.');
    const scene = scenesRef.find((candidate) => candidate.id === sceneId);
    const keys = scene ? cueKeysForScene(scene) : [];
    const key = keys[cueIndex];
    if (!scene || !key) return unavailableOperation('Narration is unavailable for this page.');
    const events = cueIndex === 0 ? narrationEventsFromScene(scene) : [];
    const clip = createTimedAudioOperation(dataRef, key, {
        channel: 'vocals',
        events,
        onAudioTimeEvent: (event: { id?: string }) => {
            if (!event || typeof event.id !== 'string') return;
            if (event.id.indexOf('word-start:') === 0) {
                highlightedOccurrence = Number(event.id.slice('word-start:'.length));
                viewRef?.setNarrationHighlight(highlightedOccurrence);
            } else if (event.id.indexOf('word-end:') === 0) {
                const occurrence = Number(event.id.slice('word-end:'.length));
                if (highlightedOccurrence !== occurrence) return;
                highlightedOccurrence = null;
                viewRef?.setNarrationHighlight(null);
            }
        },
    });
    if (!clip) {
        // Missing audio surfaces as failed narration, never as success.
        return unavailableOperation('Narration "' + key + '" is unavailable.');
    }
    const fallbackEvents = typeof clip.playAsync === 'function' ? null : createAudioEvents(clip);
    return {
        play: () => {
            if (fallbackEvents) {
                clip.play();
                return fallbackEvents.completed;
            }
            return clip.playAsync!();
        },
        pause: () => pauseTimedAudioOperation(clip),
        resume: () => resumeTimedAudioOperation(clip),
        stop: () => {
            suspendTimedAudioTiming(clip);
            try {
                if (typeof clip.stop === 'function') clip.stop();
            } catch (error) {
                console.warn('Book narration stop failed.', error);
            }
        },
    };
}

function displayState(snapshot: Readonly<Record<string, unknown>>): string {
    if (snapshot.activityComplete === true) return 'complete';
    if (snapshot.introPlaying === true) return 'intro';
    switch (String(snapshot.state)) {
        case 'readingDelay': return 'delay';
        case 'playing': return 'narrating';
        case 'paused': return 'paused';
        case 'followupWaiting':
        case 'followupPlaying': return 'follow-up-audio';
        case 'wordPlaying': return 'word-audio';
        default: return 'ready';
    }
}

function controlStates(
    snapshot: Readonly<Record<string, unknown>>,
    scene: BookCompiledScene,
): Record<BookViewControl, { visible: boolean; enabled: boolean; active?: boolean }> {
    const index = Number(snapshot.currentIndex);
    const locked = snapshot.navigationLocked === true || snapshot.state === 'readingDelay';
    return {
        previous: { visible: true, enabled: !locked && index > 0 },
        next: { visible: true, enabled: !locked },
        narration: {
            visible: cueKeysForScene(scene).length > 0,
            enabled: snapshot.introPlaying !== true && snapshot.state !== 'readingDelay',
            active: snapshot.state === 'playing' || snapshot.state === 'followupWaiting' || snapshot.state === 'followupPlaying',
        },
    };
}

function narrationHint(snapshot: Readonly<Record<string, unknown>>): string | null {
  const scene = scenesRef[Number(snapshot.currentIndex)];
  const cues = scene ? cueKeysForScene(scene).length : 0;
    const completed = Array.isArray(snapshot.completedNarrationPageIds)
        ? snapshot.completedNarrationPageIds as readonly string[]
        : [];
    if (cues > 0 && !completed.includes(String(snapshot.currentPageId)) && snapshot.activityComplete !== true) {
        return 'Listen to the whole page before turning it.';
    }
    return null;
}

function applySnapshot(snapshot: Readonly<Record<string, unknown>>): void {
    if (!viewRef) return;
    const index = Number(snapshot.currentIndex);
    const scene = scenesRef[index];
    if (!scene) return;
    if (scene.id !== shownSceneId) {
        const firstPage = shownPageIndex < 0;
        const direction = index >= shownPageIndex ? 'forward' : 'backward';
        shownSceneId = scene.id;
        shownPageIndex = index;
        viewRef.showPage(scene, firstPage ? null : direction);
    }
    viewRef.setReaderState(displayState(snapshot));
    viewRef.setControls(controlStates(snapshot, scene));
}

function onControl(control: BookViewControl): void {
    const controller = controllerRef;
    if (!controller) return;
    const before = Number(modelRef?.snapshot.currentIndex ?? 0);
    const snapshot = control === 'previous'
        ? controller.previous()
        : control === 'next' ? controller.next() : controller.playPause();
    if (control !== 'narration' && Number(snapshot.currentIndex) === before) {
        const atEdge = control === 'previous' ? before === 0 : before === scenesRef.length - 1;
        viewRef?.announce(narrationHint(snapshot) ?? (atEdge
            ? control === 'previous' ? 'You are on the first page.' : 'You are on the last page.'
            : 'Turning the page is not available right now.'));
    }
    applySnapshot(snapshot);
}

function onWord(occurrence: number): void {
    const model = modelRef;
    if (!model || !viewRef || !dataRef) return;
    const snapshot = model.snapshot;
    if (snapshot.state !== 'ready' && snapshot.state !== 'paused') return;
    const scene = scenesRef[Number(snapshot.currentIndex)];
    const narration = scene?.media?.narration;
    const words = narration && Array.isArray(narration.words) ? narration.words : [];
    const word = asObject(words[occurrence]);
    const audioKey = typeof word.audioKey === 'string' ? word.audioKey : '';
    if (!audioKey) {
        // This book carries no word audio: say so, never fake a tap sound.
        viewRef.announce('Word audio is not available for this book.');
        return;
    }
    const started = model.startWord();
    if (started.event !== 'word-started') return;
    const token = started.token ?? 0;
    const clip = createTimedAudioOperation(dataRef, audioKey, { channel: 'sfx' });
    const finish = () => {
        model.finishWord(token);
        applySnapshot(model.snapshot);
    };
    if (!clip) {
        viewRef.announce('Word audio is not available right now.');
        finish();
        return;
    }
    const playback = typeof clip.playAsync === 'function'
        ? clip.playAsync()
        : (clip.play(), createAudioEvents(clip).completed);
    void playback.then(finish, () => {
        try {
            if (typeof clip.stop === 'function') clip.stop();
        } catch {
            /* The word tap is finished regardless. */
        }
        finish();
    });
}

function releaseReader(): void {
    detachKeyboard?.();
    detachKeyboard = null;
    viewRef?.dispose();
    viewRef = null;
    stateMachineRef?.stop();
    lifecycleRef?.teardown();
    lifecycleRef = null;
    controllerRef = null;
    modelRef = null;
    shownSceneId = null;
    shownPageIndex = -1;
}

const enterReader: StateMachineAction<ActivityContext> = async ({ context, send, signal }) => {
    if (controllerRef) return;
    dataRef = context;
    scenesRef = compiledScenesOf(context);
    const book = bookPolicyOf(context);
    const previewSceneId = previewStartSceneId(context);
    const previewIndex = previewSceneId
        ? scenesRef.findIndex((scene) => scene.id === previewSceneId)
        : -1;

    if (book.introVideoKey && previewIndex <= 0 && !signal.aborted) {
        runtimeRef?.setInteractive(false);
        const operation = createVideoOperation(context, book.introVideoKey);
        if (operation) {
            const section = htmlToElement('<section class="book-intro" id="book-intro"></section>');
            operation.videoElement.setAttribute('data-book-intro-video', '');
            operation.videoElement.setAttribute('playsinline', '');
            section.appendChild(operation.videoElement);
            context.root.appendChild(section);
            try {
                await playVideoOperation(context, book.introVideoKey, operation);
            } catch (error) {
                console.warn('Book intro video did not play; continuing to the reader.', error);
            }
            section.remove();
        }
        runtimeRef?.setInteractive(true);
        if (signal.aborted) return;
    }

    const view = createBookReaderView({
        root: context.root,
        scenes: scenesRef,
        onControl,
        onWord,
        resolveImage: (key, className) => {
            if (!dataRef || !key) return null;
            return createImageElement(resolveMediaAsset(dataRef, key), className);
        },
        trackInteractable: (interactable) => {
            context.sceneInteractables.push(interactable);
        },
    });
    viewRef = view;

    const model = new BookReaderModel(
        scenesRef as unknown as ConstructorParameters<typeof BookReaderModel>[0],
        book.mode,
        book.readingDelay,
    );
    const controller = new BookReaderController(model, {
        createCue,
        clock: {
            now: () => Date.now(),
            setTimeout: (callback, delayMs) => window.setTimeout(callback, delayMs),
            clearTimeout: (handle) => window.clearTimeout(handle as number),
        },
        onChange: (snapshot) => applySnapshot(snapshot),
        onComplete: () => {
            // Completion publishes activity end through the state machine once;
            // the view stays mounted so Previous and rereading keep working.
            viewRef?.setReaderState('complete');
            viewRef?.announce('Book complete.');
            send({ type: BOOK_COMPLETE_EVENT });
        },
        onError: (error) => {
            console.warn('Book playback error.', error);
            viewRef?.announce('Narration is unavailable right now.');
        },
    });
    modelRef = model;
    controllerRef = controller;

    lifecycleRef = connectBookReaderLifecycle({
        controller,
        pauseEvent: EVENTS.activity.pause,
        resumeEvent: EVENTS.activity.resume,
        subscribe: (event, listener) => context.pubSub.subscribe(event, listener),
        unsubscribe: (event, listener) => {
            const pubSub = context.pubSub as {
                unsubscribe?(event: string, listener: (...payload: unknown[]) => void): void;
                off?(event: string, listener: (...payload: unknown[]) => void): void;
            };
            if (typeof pubSub.unsubscribe === 'function') pubSub.unsubscribe(event, listener);
            else if (typeof pubSub.off === 'function') pubSub.off(event, listener);
        },
        registerPagehide: (handler) => {
            window.addEventListener('pagehide', () => {
                releaseReader();
                handler();
            }, { once: true });
        },
    });

    const keydown = (event: KeyboardEvent) => {
        if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
        event.stopPropagation();
        onControl(event.key === 'ArrowLeft' ? 'previous' : 'next');
    };
    document.addEventListener('keydown', keydown, true);
    detachKeyboard = () => document.removeEventListener('keydown', keydown, true);

    runtimeRef?.setInteractive(true);
    applySnapshot(controller.initialize(previewIndex > 0 ? previewIndex : undefined));
};

const bookFinalize: StateMachineAction<ActivityContext> = ({ context }) => {
    context.activityFinished = true;
    void clearRepeatAudio();
};

bootstrapStateMachine<ActivityContext>({
    rootId: '__ROOT_ID__',
    beforeHydrate: ({ stateMachine }) => {
        stateMachineRef = stateMachine;
    },
    createImplementations: (data, runtime): StateMachineImplementations<ActivityContext> => {
        runtimeRef = runtime;
        return {
            actions: {
                enterReader,
                bookFinalize,
            },
        };
    },
});
`;
